import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildAuthoringPerformanceMetrics,
  orderTargetsByEstimatedWork,
  retryDelayMs,
} from "./academy-authoring-performance.mjs";
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
const failureContractVersion = "2.1";
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
const heartbeatIntervalMs = 30 * 1000;

if (!fs.existsSync(reportPath)) {
  throw new Error(`Cinematic course audit report not found: ${reportPath}`);
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const unorderedTargets = Array.isArray(report.targetCourseIds)
  ? report.targetCourseIds.map((courseId) => ({ courseId }))
  : [];
const targets = orderTargetsByEstimatedWork(root, unorderedTargets);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generatedPackageBytes(courseId) {
  const packagePath = path.join(
    root,
    "courses",
    courseId,
    "generated",
    "authoring",
    "course-package.json",
  );
  try {
    return fs.statSync(packagePath).size;
  } catch {
    return 0;
  }
}

function runAuthoring(courseId, attempt, descriptor) {
  return new Promise((resolve) => {
    const attemptStartedAt = Date.now();
    let settled = false;
    let timedOut = false;
    let forceKillTimer = null;
    let timeoutTimer = null;

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({
        ...result,
        attemptStartedAt: new Date(attemptStartedAt).toISOString(),
        attemptCompletedAt: new Date().toISOString(),
        attemptElapsedMs: Date.now() - attemptStartedAt,
      });
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
  const courseStartedAt = Date.now();
  const attemptHistory = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[Academy Studio] ${descriptor.workerName} role=${descriptor.currentRole} authoring ${courseId}, attempt ${attempt}/${maxAttempts}.`);
    const result = await runAuthoring(courseId, attempt, descriptor);
    attemptHistory.push({
      attempt,
      ok: result.ok,
      elapsedMs: result.attemptElapsedMs,
      failureCategory: result.failureCategory,
      retryable: result.retryable,
    });

    if (result.ok) {
      return {
        courseId,
        ...result,
        elapsedMs: Date.now() - courseStartedAt,
        outputBytes: generatedPackageBytes(courseId),
        attemptHistory,
      };
    }
    if (result.retryable === false) {
      return {
        courseId,
        ...result,
        elapsedMs: Date.now() - courseStartedAt,
        outputBytes: 0,
        attemptHistory,
      };
    }
    if (attempt < maxAttempts) {
      const waitMs = retryDelayMs(baseDelayMs, attempt, courseId);
      console.warn(`[Academy Studio] ${courseId} failed attempt ${attempt} with ${result.failureCategory}; retrying in ${waitMs} ms with bounded deterministic jitter.`);
      await delay(waitMs);
    } else {
      return {
        courseId,
        ...result,
        elapsedMs: Date.now() - courseStartedAt,
        outputBytes: 0,
        attemptHistory,
      };
    }
  }
  return {
    courseId,
    ok: false,
    error: "unreachable retry state",
    failureCategory: "unreachable_retry_state",
    retryable: false,
    worker: descriptor,
    elapsedMs: Date.now() - courseStartedAt,
    outputBytes: 0,
    attemptHistory,
  };
}

function shouldHaltPortfolio(result) {
  const category = String(result.failureCategory ?? "");
  return result.retryable === false && (
    category.includes("authentication")
    || category.includes("quota")
    || category.includes("billing")
    || category.includes("checkpoint")
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
  const workerStartedAt = Date.now();
  let completedByWorker = 0;
  let productiveMs = 0;

  while (queue.length > 0 && !results.halted) {
    const course = queue.shift();
    if (!course) break;
    const assignmentIndex = results.started;
    const currentRole = interchangeableCourseRoles[assignmentIndex % interchangeableCourseRoles.length];
    const descriptor = workerDescriptor(workerId, currentRole);
    results.started += 1;
    results.assignments.push({
      courseId: course.courseId,
      estimatedWork: course.estimatedWork,
      schedulingPolicy: "longest-estimated-work-first",
      queuePosition: assignmentIndex + 1,
      workerId,
      workerName: descriptor.workerName,
      currentRole,
      assignedAt: new Date().toISOString(),
    });
    console.log(`[Academy Studio] ${descriptor.workerName} accepted ${course.courseId} as ${currentRole}; estimatedWork=${course.estimatedWork}; all course-production capabilities remain available for reassignment.`);
    const result = await authorWithRetry(course.courseId, descriptor);
    completedByWorker += 1;
    productiveMs += Math.max(0, Number(result.elapsedMs || 0));
    results.completed.push({
      ...result,
      estimatedWork: course.estimatedWork,
    });
    if (result.ok) {
      console.log(`[Academy Studio] ${descriptor.workerName} completed and checkpointed ${course.courseId} in ${Math.round(result.elapsedMs / 1000)} seconds; outputBytes=${result.outputBytes}.`);
    } else {
      console.error(`[Academy Studio] ${descriptor.workerName} failed ${course.courseId}: ${result.error}`);
      if (shouldHaltPortfolio(result)) haltQueue(results, queue, result);
    }
  }

  results.workerPerformance.push({
    workerId,
    completedCourses: completedByWorker,
    productiveMs,
    elapsedMs: Date.now() - workerStartedAt,
  });
}

if (targets.length === 0) {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify({
    schemaVersion: "2.1",
    generatedAt: new Date().toISOString(),
    allocation,
    requestedCourses: 0,
    startedCourses: 0,
    completedCourses: 0,
    successfulCourses: 0,
    failedCourses: 0,
    performance: buildAuthoringPerformanceMetrics({
      results: [],
      elapsedMs: 0,
      launchedWorkerCount: 0,
      requestedCourses: 0,
    }),
    message: "No missing, stale, or older-contract course packages require cinematic authoring.",
  }, null, 2)}\n`);
  console.log("[Academy Studio] No cinematic course packages require authoring.");
  process.exit(0);
}

console.log(`[Academy Studio] Starting owner-approved Academy surge for ${targets.length} course(s) with ${concurrency} interchangeable workers. Scheduling=longest-estimated-work-first; application allocation=0; course allocation=36; publication authority=false.`);
const queue = [...targets];
const launchedWorkerCount = Math.min(concurrency, targets.length);
const results = {
  started: 0,
  completed: [],
  assignments: [],
  workerPerformance: [],
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
  const successful = results.completed.filter((result) => result.ok).length;
  const failures = results.completed.length - successful;
  console.log(`[Academy Studio] 36-worker surge heartbeat: ${results.completed.length}/${targets.length} complete, ${successful} successful, ${failures} failed, ${active} active, ${queue.length} queued, ${elapsedMinutes} minute(s) elapsed, halted=${results.halted}.`);
}, heartbeatIntervalMs);
heartbeat.unref?.();

const workers = workerRoster.map((descriptor) => worker(descriptor.workerId, queue, results));
try {
  await Promise.all(workers);
} finally {
  clearInterval(heartbeat);
}

const elapsedMs = Date.now() - startedAt;
const failures = results.completed.filter((result) => !result.ok);
const performance = buildAuthoringPerformanceMetrics({
  results: results.completed,
  elapsedMs,
  launchedWorkerCount,
  requestedCourses: targets.length,
});
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify({
  schemaVersion: "2.1",
  failureContractVersion,
  generatedAt: new Date().toISOString(),
  provider,
  allocation,
  concurrency,
  launchedWorkerCount,
  workerRoster,
  interchangeableRoles: interchangeableCourseRoles,
  mandatoryContractDomains,
  schedulingPolicy: "longest-estimated-work-first",
  orderedTargets: targets.map(({ courseId, estimatedWork }) => ({ courseId, estimatedWork })),
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
  elapsedMs,
  performance,
  workerPerformance: results.workerPerformance,
  assignments: results.assignments,
  results: results.completed,
  claimBoundary: "A successful worker run proves protected package generation and checkpoint persistence only. Performance metrics describe the observed governed build. They do not establish verified references, mastered media, rights clearance, accessibility acceptance, review approval, LCMS publication, or learner availability.",
}, null, 2)}\n`);

console.log(`[Academy Studio] Performance summary: throughput=${performance.throughputCoursesPerHour} courses/hour; firstPassYield=${performance.firstPassYieldPercent}%; retryRate=${performance.retryRatePercent}%; p50=${Math.round(performance.p50SuccessfulCourseMs / 1000)}s; p95=${Math.round(performance.p95SuccessfulCourseMs / 1000)}s; utilization=${performance.estimatedWorkerUtilizationPercent}%.`);

if (failures.length > 0) {
  console.error(`[Academy Studio] Cinematic parallel authoring failed for ${failures.length} course(s): ${failures.map((item) => item.courseId).join(", ")}`);
  process.exit(results.haltExitCode || 2);
}

console.log(`[Academy Studio] Cinematic parallel authoring completed successfully for all ${targets.length} targeted course(s), with protected checkpoints required.`);
