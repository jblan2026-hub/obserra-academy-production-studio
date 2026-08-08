import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { classificationFromAuthoringExit } from "./authoring-provider-errors.mjs";
import {
  assertAcademyWorkerAllocation,
  interchangeableCourseRoles,
  mandatoryContractDomains,
  workerDescriptor,
} from "./academy-worker-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "catalog", "academy-hollywood-course-audit.json");
const summaryPath = path.join(root, "catalog", "academy-hollywood-parallel-summary.json");
const failureContractVersion = "2.0";
const allocation = assertAcademyWorkerAllocation();

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

const provider = process.env.ACADEMY_AUTHORING_PROVIDER || "openai";
const concurrency = boundedNumber(
  process.env.ACADEMY_AUTHORING_CONCURRENCY,
  allocation.courseWorkerAllocation,
  1,
  allocation.courseWorkerAllocation,
);
const maxAttempts = boundedNumber(process.env.ACADEMY_AUTHORING_MAX_ATTEMPTS, 3, 1, 5);
const baseDelayMs = boundedNumber(process.env.ACADEMY_AUTHORING_RETRY_BASE_MS, 5000, 1000, 120000);
const processTimeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_PROCESS_TIMEOUT_MS,
  35 * 60 * 1000,
  5 * 60 * 1000,
  45 * 60 * 1000,
);
const terminationGraceMs = 10000;
const heartbeatIntervalMs = 60 * 1000;

if (!fs.existsSync(reportPath)) {
  throw new Error(`Cinematic course audit report not found: ${reportPath}`);
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const targets = Array.isArray(report.targetCourseIds)
  ? report.targetCourseIds.map((courseId) => ({ courseId }))
  : [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAuthoring(courseId, attempt, descriptor) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let forceKillTimer = null;
    let timeoutTimer = null;

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve(result);
    };

    const child = spawn(
      process.execPath,
      [
        "studio/author-course-hollywood-with-checkpoint.mjs",
        "--course",
        courseId,
        "--provider",
        provider,
        "--force",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          ACADEMY_CURRENT_WORKER_ID: String(descriptor.workerId),
          ACADEMY_CURRENT_WORKER_ROLE: descriptor.currentRole,
        },
        stdio: "inherit",
      },
    );

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.error(`[Academy Studio] Worker ${descriptor.workerId} exceeded ${Math.round(processTimeoutMs / 1000)} seconds for ${courseId}; terminating for governed retry.`);
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, terminationGraceMs);
      }
    }, processTimeoutMs);

    child.on("error", (error) => {
      finalize({
        ok: false,
        error: String(error),
        code: null,
        signal: null,
        timedOut,
        attempt,
        failureCategory: "authoring_process_spawn_failure",
        retryable: false,
        worker: descriptor,
      });
    });

    child.on("exit", (code, signal) => {
      const ok = code === 0 && !timedOut;
      const classification = ok
        ? { category: null, retryable: false, exitCode: 0 }
        : classificationFromAuthoringExit({ exitCode: code, timedOut, signal });
      finalize({
        ok,
        code,
        signal,
        timedOut,
        error: ok
          ? null
          : timedOut
            ? `authoring process timed out after ${Math.round(processTimeoutMs / 1000)} seconds`
            : `authoring process exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}`,
        attempt,
        failureCategory: classification.category,
        retryable: classification.retryable,
        worker: descriptor,
      });
    });
  });
}

async function authorWithRetry(courseId, descriptor) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[Academy Studio] ${descriptor.workerName} role=${descriptor.currentRole} authoring ${courseId}, attempt ${attempt}/${maxAttempts}.`);
    const result = await runAuthoring(courseId, attempt, descriptor);
    if (result.ok) return { courseId, ...result };
    if (result.retryable === false) return { courseId, ...result };
    if (attempt < maxAttempts) {
      const waitMs = baseDelayMs * (2 ** (attempt - 1));
      console.warn(`[Academy Studio] ${courseId} failed attempt ${attempt} with ${result.failureCategory}; retrying in ${waitMs} ms.`);
      await delay(waitMs);
    } else {
      return { courseId, ...result };
    }
  }
  return {
    courseId,
    ok: false,
    error: "unreachable retry state",
    failureCategory: "unreachable_retry_state",
    retryable: false,
    worker: descriptor,
  };
}

function shouldHaltPortfolio(result) {
  const category = String(result.failureCategory ?? "");
  return result.retryable === false && (
    category.includes("authentication")
    || category.includes("quota")
    || category.includes("billing")
    || category.includes("checkpoint")
    || category.includes("provider_request_invalid")
  );
}

function haltQueue(results, queue, result) {
  if (results.halted) return;
  results.halted = true;
  results.haltReason = result.failureCategory || "non_retryable_portfolio_failure";
  results.haltExitCode = result.code || 2;
  results.queuedCoursesSkipped = queue.length;
  queue.splice(0, queue.length);
  console.error(`[Academy Studio] Governed 36-worker course surge halted: reason=${results.haltReason}; ${results.queuedCoursesSkipped} queued course(s) were not started.`);
}

async function worker(workerId, queue, results) {
  while (queue.length > 0 && !results.halted) {
    const course = queue.shift();
    if (!course) return;
    const assignmentIndex = results.started;
    const currentRole = interchangeableCourseRoles[assignmentIndex % interchangeableCourseRoles.length];
    const descriptor = workerDescriptor(workerId, currentRole);
    results.started += 1;
    results.assignments.push({
      courseId: course.courseId,
      workerId,
      workerName: descriptor.workerName,
      currentRole,
      assignedAt: new Date().toISOString(),
    });
    console.log(`[Academy Studio] ${descriptor.workerName} accepted ${course.courseId} as ${currentRole}; all course-production capabilities remain available for reassignment.`);
    const result = await authorWithRetry(course.courseId, descriptor);
    results.completed.push(result);
    if (result.ok) {
      console.log(`[Academy Studio] ${descriptor.workerName} completed and checkpointed ${course.courseId}.`);
    } else {
      console.error(`[Academy Studio] ${descriptor.workerName} failed ${course.courseId}: ${result.error}`);
      if (shouldHaltPortfolio(result)) haltQueue(results, queue, result);
    }
  }
}

if (targets.length === 0) {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify({
    schemaVersion: "2.0",
    generatedAt: new Date().toISOString(),
    allocation,
    requestedCourses: 0,
    startedCourses: 0,
    completedCourses: 0,
    successfulCourses: 0,
    failedCourses: 0,
    message: "No missing, stale, or older-contract course packages require cinematic authoring.",
  }, null, 2)}\n`);
  console.log("[Academy Studio] No cinematic course packages require authoring.");
  process.exit(0);
}

console.log(`[Academy Studio] Starting owner-approved Academy surge for ${targets.length} course(s) with ${concurrency} interchangeable workers. Application allocation=0; course allocation=36; publication authority=false.`);
const queue = [...targets];
const launchedWorkerCount = Math.min(concurrency, targets.length);
const results = {
  started: 0,
  completed: [],
  assignments: [],
  halted: false,
  haltReason: null,
  haltExitCode: null,
  queuedCoursesSkipped: 0,
};
const workerRoster = Array.from({ length: launchedWorkerCount }, (_, index) =>
  workerDescriptor(index + 1, interchangeableCourseRoles[index % interchangeableCourseRoles.length]),
);
const startedAt = Date.now();
const heartbeat = setInterval(() => {
  const active = Math.max(0, results.started - results.completed.length);
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  console.log(`[Academy Studio] 36-worker surge heartbeat: ${results.completed.length}/${targets.length} complete, ${active} active, ${queue.length} queued, ${elapsedMinutes} minute(s) elapsed, halted=${results.halted}.`);
}, heartbeatIntervalMs);
heartbeat.unref?.();

const workers = workerRoster.map((descriptor) => worker(descriptor.workerId, queue, results));
try {
  await Promise.all(workers);
} finally {
  clearInterval(heartbeat);
}

const failures = results.completed.filter((result) => !result.ok);
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify({
  schemaVersion: "2.0",
  failureContractVersion,
  generatedAt: new Date().toISOString(),
  provider,
  allocation,
  concurrency,
  launchedWorkerCount,
  workerRoster,
  interchangeableRoles: interchangeableCourseRoles,
  mandatoryContractDomains,
  maxAttempts,
  processTimeoutMs,
  checkpointPersistenceRequired: String(process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED ?? "true").toLowerCase() === "true",
  requestedCourses: targets.length,
  startedCourses: results.started,
  completedCourses: results.completed.length,
  successfulCourses: results.completed.length - failures.length,
  failedCourses: failures.length,
  halted: results.halted,
  haltReason: results.haltReason,
  queuedCoursesSkipped: results.queuedCoursesSkipped,
  elapsedMs: Date.now() - startedAt,
  assignments: results.assignments,
  results: results.completed,
  claimBoundary: "A successful worker run proves protected package generation and checkpoint persistence only. It does not establish verified references, mastered media, rights clearance, accessibility acceptance, review approval, LCMS publication, or learner availability.",
}, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`[Academy Studio] Cinematic parallel authoring failed for ${failures.length} course(s): ${failures.map((item) => item.courseId).join(", ")}`);
  process.exit(results.haltExitCode || 2);
}

console.log(`[Academy Studio] Cinematic parallel authoring completed successfully for all ${targets.length} targeted course(s), with protected checkpoints required.`);
