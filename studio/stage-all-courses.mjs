import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ACADEMY_WORKSTREAM,
  WORKER_TOTAL,
  assertTaskAssignment,
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  taskContract,
  validateAllocation,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const summaryPath = path.join(root, "catalog", "compliance-staging-summary.json");
const governedTask = taskContract("compliance-staging");
const timeoutMs = 20 * 60 * 1000;
const killGraceMs = 10_000;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const applicationWorkers = boundedInteger(
  process.env.OBSERRA_APPLICATION_WORKER_COUNT,
  0,
  0,
  WORKER_TOTAL,
);
const commandCenterWorkers = boundedInteger(
  process.env.COMMAND_CENTER_WORKER_ALLOCATION,
  0,
  0,
  WORKER_TOTAL,
);
const idleWorkers = boundedInteger(
  process.env.IDLE_WORKER_ALLOCATION,
  0,
  0,
  WORKER_TOTAL,
);
const academyWorkers = WORKER_TOTAL - commandCenterWorkers - idleWorkers;
validateAllocation({
  academyWorkers,
  commandCenterWorkers,
  idleWorkers,
  applicationWorkers,
});

if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
const targets = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (["archived", "retired"].includes(String(manifest.release?.status ?? "draft"))) return null;
    return { courseId: manifest.course?.id ?? entry.name, title: manifest.course?.title ?? entry.name };
  })
  .filter(Boolean)
  .sort((left, right) => left.courseId.localeCompare(right.courseId));

if (targets.length > 0 && academyWorkers === 0) {
  throw new Error("Compliance staging work is pending, but Academy has zero governed workers.");
}
const concurrency = targets.length === 0
  ? 0
  : boundedInteger(
    process.env.ACADEMY_STAGING_CONCURRENCY,
    academyWorkers,
    1,
    academyWorkers,
  );

function assignment(workerId, courseId) {
  return {
    ...assertTaskAssignment({
      workstream: ACADEMY_WORKSTREAM,
      taskType: governedTask.taskType,
      role: governedTask.role,
      acknowledgedRules: governedTask.appliedRules,
    }),
    workerId,
    courseId,
  };
}

function runStage(target, workerAssignment) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    let timedOut = false;
    let forceKillTimer = null;
    const child = spawn(
      process.execPath,
      ["studio/build-course.mjs", "--course", target.courseId],
      {
        cwd: root,
        env: {
          ...process.env,
          OBSERRA_WORKER_CONTRACT_ID: workerAssignment.contractId,
          OBSERRA_WORKER_CONTRACT_HASH: workerAssignment.contractHash,
          OBSERRA_WORKER_ROLE: workerAssignment.role,
          OBSERRA_WORKER_TASK_TYPE: workerAssignment.taskType,
          OBSERRA_WORKER_WORKSTREAM: workerAssignment.workstream,
          OBSERRA_PRODUCTION_STANDARD_ID: workerAssignment.productionStandardId,
          OBSERRA_PRODUCTION_STANDARD_HASH: workerAssignment.productionStandardHash,
          OBSERRA_PRODUCTION_QUALITY_TIER: workerAssignment.qualityTier,
        },
        stdio: "inherit",
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, killGraceMs);
      }
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({
        courseId: target.courseId,
        title: target.title,
        workerId: workerAssignment.workerId,
        role: workerAssignment.role,
        taskType: workerAssignment.taskType,
        contractHash: workerAssignment.contractHash,
        productionStandardHash: workerAssignment.productionStandardHash,
        qualityTier: workerAssignment.qualityTier,
        startedAt,
        completedAt: new Date().toISOString(),
        timedOut,
        ...result,
      });
    };
    child.once("error", (error) => finish({ ok: false, exitCode: null, signal: null, error: String(error) }));
    child.once("exit", (code, signal) => finish({
      ok: code === 0 && !timedOut,
      exitCode: code,
      signal: signal ?? null,
      error: code === 0 && !timedOut
        ? null
        : timedOut
          ? `Compliance staging timed out after ${timeoutMs} ms.`
          : `Compliance staging exited with code ${code ?? "unknown"}.`,
    }));
  });
}

async function worker(workerNumber, queue, results) {
  const workerId = `academy-stage-worker-${String(workerNumber).padStart(2, "0")}`;
  while (queue.length > 0) {
    const target = queue.shift();
    if (!target) return;
    const workerAssignment = assignment(workerId, target.courseId);
    console.log(`[Academy Studio] ${workerId} staging ${target.courseId} as ${workerAssignment.role}.`);
    const result = await runStage(target, workerAssignment);
    results.push(result);
  }
}

const queue = [...targets];
const results = [];
const startedAt = Date.now();
await Promise.all(Array.from(
  { length: Math.min(concurrency, targets.length) },
  (_, index) => worker(index + 1, queue, results),
));
const failures = results.filter((result) => !result.ok);
const summary = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  totalLogicalWorkers: WORKER_TOTAL,
  applicationWorkers,
  academyWorkers,
  commandCenterWorkers,
  idleWorkers,
  concurrency,
  taskType: governedTask.taskType,
  role: governedTask.role,
  requestedCourses: targets.length,
  completedCourses: results.length,
  successfulCourses: results.length - failures.length,
  failedCourses: failures.length,
  elapsedMs: Date.now() - startedAt,
  status: failures.length ? "failed" : "compliance-staged",
  publicationAllowed: false,
  checkoutAllowed: false,
  results,
};
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exit(2);
