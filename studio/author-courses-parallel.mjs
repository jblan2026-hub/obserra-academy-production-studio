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

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "catalog", "continuous-course-audit.json");
const summaryPath = path.join(root, "catalog", "parallel-authoring-summary.json");
const failureContractVersion = "1.1";
const performanceContractVersion = "1.0";
const portfolioWorkerCount = 36;
const applicationWorkerAllocation = 20;
const courseWorkerAllocation = 16;

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const provider = process.env.ACADEMY_AUTHORING_PROVIDER || "openai";
const concurrency = boundedNumber(
  process.env.ACADEMY_AUTHORING_CONCURRENCY,
  courseWorkerAllocation,
  1,
  courseWorkerAllocation,
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
const heartbeatIntervalMs = 30 * 1000;

if (applicationWorkerAllocation + courseWorkerAllocation !== portfolioWorkerCount) {
  throw new Error(
    "Portfolio worker allocation must remain 36 total: 20 application workers and 16 course workers.",
  );
}

if (!fs.existsSync(reportPath)) {
  throw new Error(`Course audit report not found: ${reportPath}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const unorderedTargets = (report.courses ?? []).filter(
  (course) =>
    course.ownerReviewEligible &&
    (course.authoringMissing ||
      course.findings?.includes("stale-ai-course-package") ||
      course.findings?.includes("untraceable-ai-course-package")),
);
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

function runAuthoring(courseId, attempt) {
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
        "studio/author-course-ai.mjs",
        "--course",
        courseId,
        "--provider",
        provider,
        "--force",
      ],
      {
        cwd: root,
        env: process.env,
        stdio: "inherit",
      },
    );

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.error(
        `[Academy Studio] Authoring process for ${courseId} exceeded ${Math.round(
          processTimeoutMs / 1000,
        )} seconds; terminating for retry.`,
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
      });
    });

    child.on("exit", (code, signal) => {
      const ok = code === 0 && !timedOut;
      const classification = ok
        ? { category: null, retryable: false, exitCode: 0 }
        : classificationFromAuthoringExit({
            exitCode: code,
            timedOut,
            signal,
          });
      finalize({
        ok,
        code,
        signal,
        timedOut,
        error: ok
          ? null
          : timedOut
            ? `authoring process timed out after ${Math.round(
                processTimeoutMs / 1000,
              )} seconds`
            : `authoring process exited with code ${code ?? "unknown"}${
                signal ? ` signal ${signal}` : ""
              }`,
        attempt,
        failureCategory: classification.category,
        retryable: classification.retryable,
      });
    });
  });
}

async function authorWithRetry(courseId) {
  const courseStartedAt = Date.now();
  const attemptHistory = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(
      `[Academy Studio] Authoring ${courseId}, attempt ${attempt}/${maxAttempts}`,
    );
    const result = await runAuthoring(courseId, attempt);
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
      console.error(
        `[Academy Studio] ${courseId} encountered non-retryable authoring failure ${result.failureCategory}; retry loop stopped for this course.`,
      );
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
      console.warn(
        `[Academy Studio] ${courseId} failed attempt ${attempt} with ${result.failureCategory}; retrying in ${waitMs} ms with bounded deterministic jitter.`,
      );
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
    attempt: maxAttempts,
    elapsedMs: Date.now() - courseStartedAt,
    outputBytes: 0,
    attemptHistory,
  };
}

function shouldHaltPortfolio(result) {
  const category = String(result?.failureCategory ?? "").toLowerCase();
  return (
    category.includes("authentication") ||
    category.includes("quota") ||
    category.includes("billing") ||
    category.includes("credit") ||
    category.includes("checkpoint")
  );
}

function haltQueue(results, queue, result) {
  if (results.halted) return;
  results.halted = true;
  results.haltReason = result.failureCategory || "shared_authoring_prerequisite_failure";
  results.haltExitCode = result.code || 2;
  results.queuedCoursesSkipped = queue.length;
  queue.splice(0, queue.length);
  console.error(
    `[Academy Studio] Governed parallel authoring halted: reason=${results.haltReason}; ${results.queuedCoursesSkipped} queued course(s) were not started.`,
  );
}

async function worker(workerId, queue, results) {
  const workerStartedAt = Date.now();
  let completedByWorker = 0;
  let productiveMs = 0;

  while (queue.length > 0 && !results.halted) {
    const course = queue.shift();
    if (!course) break;
    const position = results.started + 1;
    results.started += 1;
    results.assignments.push({
      courseId: course.courseId,
      estimatedWork: course.estimatedWork,
      schedulingPolicy: "longest-estimated-work-first",
      queuePosition: position,
      workerId,
      assignedAt: new Date().toISOString(),
    });
    console.log(
      `[Academy Studio] Worker ${workerId} starting ${position}/${targets.length}: ${course.courseId}; estimatedWork=${course.estimatedWork}.`,
    );

    const result = await authorWithRetry(course.courseId);
    completedByWorker += 1;
    productiveMs += Math.max(0, Number(result.elapsedMs || 0));
    results.completed.push({
      ...result,
      estimatedWork: course.estimatedWork,
      workerId,
    });

    if (result.ok) {
      console.log(
        `[Academy Studio] Worker ${workerId} completed ${course.courseId} in ${Math.round(
          result.elapsedMs / 1000,
        )} seconds; outputBytes=${result.outputBytes}.`,
      );
    } else {
      console.error(
        `[Academy Studio] Worker ${workerId} failed ${course.courseId}: ${result.error}`,
      );
      if (shouldHaltPortfolio(result)) {
        haltQueue(results, queue, result);
      }
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
  const performance = buildAuthoringPerformanceMetrics({
    results: [],
    elapsedMs: 0,
    launchedWorkerCount: 0,
    requestedCourses: 0,
  });
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        schemaVersion: "1.4",
        failureContractVersion,
        performanceContractVersion,
        generatedAt: new Date().toISOString(),
        provider,
        portfolioWorkerCount,
        applicationWorkerAllocation,
        courseWorkerAllocation,
        requestedCourses: 0,
        startedCourses: 0,
        completedCourses: 0,
        successfulCourses: 0,
        failedCourses: 0,
        schedulingPolicy: "longest-estimated-work-first",
        performance,
        message:
          "No missing, stale, or untraceable owner-review course packages require AI authoring.",
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    "[Academy Studio] No missing, stale, or untraceable owner-review course packages require AI authoring.",
  );
  process.exit(0);
}

console.log(
  `[Academy Studio] Starting governed parallel authoring for ${targets.length} course(s) with concurrency ${concurrency} from the fixed 16-worker course allocation, scheduling=longest-estimated-work-first, request timeout ${Math.round(
    boundedNumber(
      process.env.ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS,
      15 * 60 * 1000,
      60 * 1000,
      30 * 60 * 1000,
    ) / 1000,
  )} seconds, process timeout ${Math.round(
    processTimeoutMs / 1000,
  )} seconds, and failure contract ${failureContractVersion}.`,
);

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
const startedAt = Date.now();
const heartbeat = setInterval(() => {
  const active = Math.max(0, results.started - results.completed.length);
  const successful = results.completed.filter((result) => result.ok).length;
  const failures = results.completed.length - successful;
  const elapsedMinutes = Math.max(
    1,
    Math.round((Date.now() - startedAt) / 60000),
  );
  console.log(
    `[Academy Studio] Parallel authoring heartbeat: ${results.completed.length}/${targets.length} complete, ${successful} successful, ${failures} failed, ${active} active, ${queue.length} queued, ${elapsedMinutes} minute(s) elapsed, halted=${results.halted}.`,
  );
}, heartbeatIntervalMs);
heartbeat.unref?.();

const workers = Array.from({ length: launchedWorkerCount }, (_, index) =>
  worker(index + 1, queue, results),
);
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
fs.writeFileSync(
  summaryPath,
  `${JSON.stringify(
    {
      schemaVersion: "1.4",
      failureContractVersion,
      performanceContractVersion,
      generatedAt: new Date().toISOString(),
      provider,
      portfolioWorkerCount,
      applicationWorkerAllocation,
      courseWorkerAllocation,
      concurrency,
      launchedWorkerCount,
      maxAttempts,
      processTimeoutMs,
      schedulingPolicy: "longest-estimated-work-first",
      orderedTargets: targets.map(({ courseId, estimatedWork }) => ({
        courseId,
        estimatedWork,
      })),
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
      claimBoundary:
        "A successful worker run proves protected package generation and checkpoint persistence only. Performance metrics describe the observed governed build. They do not establish independent source verification, legal sufficiency, mastered media, rights clearance, accessibility acceptance, psychometric approval, LCMS persistence, learner availability, publication, checkout readiness, or owner acceptance.",
    },
    null,
    2,
  )}\n`,
);

console.log(
  `[Academy Studio] Performance summary: throughput=${performance.throughputCoursesPerHour} courses/hour; firstPassYield=${performance.firstPassYieldPercent}%; retryRate=${performance.retryRatePercent}%; p50=${Math.round(
    performance.p50SuccessfulCourseMs / 1000,
  )}s; p95=${Math.round(
    performance.p95SuccessfulCourseMs / 1000,
  )}s; utilization=${performance.estimatedWorkerUtilizationPercent}%.`,
);

if (failures.length > 0) {
  console.error(
    `[Academy Studio] Parallel authoring failed for ${failures.length} course(s): ${failures
      .map((item) => item.courseId)
      .join(", ")}`,
  );
  if (results.halted) {
    console.error(
      `[Academy Studio] Shared provider or checkpoint prerequisite failed: ${results.haltReason}. Restore the prerequisite before rerunning the protected authoring workflow.`,
    );
  }
  process.exit(results.haltExitCode || 2);
}

console.log(
  `[Academy Studio] Parallel authoring completed successfully for all ${targets.length} course(s).`,
);
