import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { classificationFromAuthoringExit } from "./authoring-provider-errors.mjs";
import {
  ACADEMY_WORKSTREAM,
  WORKER_TOTAL,
  assertTaskAssignment,
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  taskContract,
  validateAllocation,
  verifyWorkerPoolContract,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "catalog", "continuous-course-audit.json");
const summaryPath = path.join(root, "catalog", "parallel-authoring-summary.json");
const failureContractVersion = "1.3";
const taskType = "protected-authoring";
const governedTask = taskContract(taskType);
const governedRole = governedTask.role;

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

const provider = process.env.ACADEMY_AUTHORING_PROVIDER || "openai";
const applicationWorkerAllocation = boundedNumber(
  process.env.OBSERRA_APPLICATION_WORKER_COUNT,
  0,
  0,
  WORKER_TOTAL,
);
const commandCenterWorkerAllocation = boundedNumber(
  process.env.COMMAND_CENTER_WORKER_ALLOCATION,
  0,
  0,
  WORKER_TOTAL,
);
const idleWorkerAllocation = boundedNumber(
  process.env.IDLE_WORKER_ALLOCATION,
  0,
  0,
  WORKER_TOTAL,
);
const academyWorkerAllocation = WORKER_TOTAL
  - commandCenterWorkerAllocation
  - idleWorkerAllocation;

validateAllocation({
  academyWorkers: academyWorkerAllocation,
  commandCenterWorkers: commandCenterWorkerAllocation,
  idleWorkers: idleWorkerAllocation,
  applicationWorkers: applicationWorkerAllocation,
});

const contractVerification = verifyWorkerPoolContract();
if (!contractVerification.ready) {
  throw new Error(
    `Worker pool contract verification failed: ${contractVerification.findings.join(", ")}`,
  );
}

const concurrency = academyWorkerAllocation === 0
  ? 0
  : boundedNumber(
    process.env.ACADEMY_AUTHORING_CONCURRENCY,
    academyWorkerAllocation,
    1,
    academyWorkerAllocation,
  );
const maxAttempts = boundedNumber(
  process.env.ACADEMY_AUTHORING_MAX_ATTEMPTS,
  3,
  1,
  5,
);
const baseDelayMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_RETRY_BASE_MS,
  5000,
  1000,
  120000,
);
const processTimeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_PROCESS_TIMEOUT_MS,
  20 * 60 * 1000,
  2 * 60 * 1000,
  30 * 60 * 1000,
);
const terminationGraceMs = 10000;
const heartbeatIntervalMs = 60 * 1000;

if (!fs.existsSync(reportPath)) {
  throw new Error(`Course audit report not found: ${reportPath}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const targets = (report.courses ?? []).filter((course) =>
  course.ownerReviewEligible && (
    course.authoringMissing
    || course.findings?.includes("stale-ai-course-package")
    || course.findings?.includes("untraceable-ai-course-package")
    || course.findings?.includes("outdated-ai-authoring-policy")
  )
);

if (targets.length > 0 && academyWorkerAllocation === 0) {
  throw new Error(
    "Academy authoring tasks are pending, but the governed allocation assigns zero workers to Academy course production.",
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function governedAssignment(workerId, courseId) {
  const assignment = assertTaskAssignment({
    workstream: ACADEMY_WORKSTREAM,
    taskType,
    role: governedRole,
    acknowledgedRules: governedTask.appliedRules,
  });
  return {
    ...assignment,
    workerId,
    courseId,
  };
}

function runAuthoring(courseId, attempt, assignment) {
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
        "studio/author-course-with-checkpoint.mjs",
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
          OBSERRA_WORKER_CONTRACT_ID: assignment.contractId,
          OBSERRA_WORKER_CONTRACT_HASH: assignment.contractHash,
          OBSERRA_WORKER_ROLE: assignment.role,
          OBSERRA_WORKER_TASK_TYPE: assignment.taskType,
          OBSERRA_WORKER_WORKSTREAM: assignment.workstream,
          OBSERRA_PRODUCTION_STANDARD_ID: assignment.productionStandardId,
          OBSERRA_PRODUCTION_STANDARD_HASH: assignment.productionStandardHash,
          OBSERRA_PRODUCTION_QUALITY_TIER: assignment.qualityTier,
        },
        stdio: "inherit",
      },
    );

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.error(
        `[Academy Studio] Authoring process for ${courseId} exceeded ${Math.round(processTimeoutMs / 1000)} seconds; terminating for governed retry.`,
      );
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
        assignment,
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
        assignment,
      });
    });
  });
}

async function authorWithRetry(courseId, assignment) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(
      `[Academy Studio] ${assignment.workerId} operating as ${assignment.role} for ${courseId}, attempt ${attempt}/${maxAttempts}, quality=${assignment.qualityTier}.`,
    );
    const result = await runAuthoring(courseId, attempt, assignment);
    if (result.ok) return { courseId, ...result };
    if (result.retryable === false) {
      console.error(
        `[Academy Studio] ${courseId} encountered non-retryable authoring failure ${result.failureCategory}; retry loop stopped.`,
      );
      return { courseId, ...result };
    }
    if (attempt < maxAttempts) {
      const waitMs = baseDelayMs * (2 ** (attempt - 1));
      console.warn(
        `[Academy Studio] ${courseId} failed attempt ${attempt} with ${result.failureCategory}; retrying in ${waitMs} ms.`,
      );
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
    assignment,
  };
}

function haltQueue(results, queue, result) {
  if (results.halted) return;
  results.halted = true;
  results.haltReason = result.failureCategory || "non_retryable_authoring_failure";
  results.haltExitCode = result.code || 2;
  results.queuedCoursesSkipped = queue.length;
  queue.splice(0, queue.length);
  console.error(
    `[Academy Studio] Governed parallel authoring halted: reason=${results.haltReason}; ${results.queuedCoursesSkipped} queued course(s) were not started.`,
  );
}

async function worker(workerNumber, queue, results) {
  const workerId = `academy-elastic-worker-${String(workerNumber).padStart(2, "0")}`;
  while (queue.length > 0 && !results.halted) {
    const course = queue.shift();
    if (!course) return;
    const assignment = governedAssignment(workerId, course.courseId);
    const position = results.started + 1;
    results.started += 1;
    results.assignments.push({
      workerId,
      courseId: course.courseId,
      role: assignment.role,
      taskType: assignment.taskType,
      workstream: assignment.workstream,
      contractHash: assignment.contractHash,
      productionStandardId: assignment.productionStandardId,
      productionStandardHash: assignment.productionStandardHash,
      qualityTier: assignment.qualityTier,
      appliedRules: assignment.appliedRules,
      startedAt: new Date().toISOString(),
    });
    console.log(
      `[Academy Studio] ${workerId} claimed ${position}/${targets.length}: ${course.courseId} under role ${assignment.role} and standard ${assignment.productionStandardId}.`,
    );
    const result = await authorWithRetry(course.courseId, assignment);
    results.completed.push(result);
    if (result.ok) {
      console.log(
        `[Academy Studio] ${workerId} completed and checkpointed ${course.courseId}.`,
      );
    } else {
      console.error(
        `[Academy Studio] ${workerId} failed ${course.courseId}: ${result.error}`,
      );
      if (result.retryable === false) haltQueue(results, queue, result);
    }
  }
}

function writeSummary(results, startedAt) {
  const failures = results.completed.filter((result) => !result.ok);
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify({
    schemaVersion: "1.6",
    failureContractVersion,
    generatedAt: new Date().toISOString(),
    provider,
    contractId: workerPoolContract.contractId,
    contractHash: contractHash(),
    contractVerification,
    productionStandardId: commercialProductionStandard.standardId,
    productionStandardHash: commercialProductionStandardHash(),
    qualityTier: commercialProductionStandard.qualityTier,
    assignmentMode: workerPoolContract.assignmentMode,
    totalLogicalWorkers: WORKER_TOTAL,
    applicationWorkerAllocation,
    academyWorkerAllocation,
    commandCenterWorkerAllocation,
    idleWorkerAllocation,
    concurrency,
    taskType,
    role: governedRole,
    appliedRules: governedTask.appliedRules,
    maxAttempts,
    processTimeoutMs,
    checkpointPersistenceRequired:
      String(process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED ?? "false").toLowerCase()
      === "true",
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
  }, null, 2)}\n`);
  return failures;
}

const results = {
  started: 0,
  completed: [],
  assignments: [],
  halted: false,
  haltReason: null,
  haltExitCode: null,
  queuedCoursesSkipped: 0,
};
const startedAt = Date.now();

if (targets.length === 0) {
  writeSummary(results, startedAt);
  console.log(
    "[Academy Studio] No missing, stale, untraceable, or policy-outdated owner review course packages require AI authoring.",
  );
  process.exit(0);
}

console.log(
  `[Academy Studio] Starting contract governed parallel authoring for ${targets.length} course(s) with ${concurrency} active Academy workers from the elastic ${WORKER_TOTAL} worker pool. Command Center allocation=${commandCenterWorkerAllocation}; idle allocation=${idleWorkerAllocation}; application allocation=${applicationWorkerAllocation}; contract=${workerPoolContract.contractId}; productionStandard=${commercialProductionStandard.standardId}; quality=${commercialProductionStandard.qualityTier}; contractHash=${contractHash()}; standardHash=${commercialProductionStandardHash()}.`,
);

const queue = [...targets];
const heartbeat = setInterval(() => {
  const active = Math.max(0, results.started - results.completed.length);
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  console.log(
    `[Academy Studio] Contract heartbeat: ${results.completed.length}/${targets.length} complete, ${active} active, ${queue.length} queued, ${elapsedMinutes} minute(s) elapsed, halted=${results.halted}, contractHash=${contractHash()}, standardHash=${commercialProductionStandardHash()}.`,
  );
}, heartbeatIntervalMs);
heartbeat.unref?.();

const workers = Array.from(
  { length: Math.min(concurrency, targets.length) },
  (_, index) => worker(index + 1, queue, results),
);
try {
  await Promise.all(workers);
} finally {
  clearInterval(heartbeat);
}

const failures = writeSummary(results, startedAt);
if (failures.length > 0) {
  console.error(
    `[Academy Studio] Parallel authoring failed for ${failures.length} course(s): ${failures.map((item) => item.courseId).join(", ")}`,
  );
  if (results.halted) {
    console.error(
      `[Academy Studio] Failure is non-retryable at the current provider or checkpoint boundary: ${results.haltReason}. Restore the prerequisite before rerunning the protected authoring workflow.`,
    );
  }
  process.exit(results.haltExitCode || 2);
}

console.log(
  `[Academy Studio] Contract governed parallel authoring completed successfully for all ${targets.length} course(s), with every generated package checkpointed when required.`,
);
