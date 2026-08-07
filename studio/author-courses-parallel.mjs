import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { classificationFromAuthoringExit } from "./authoring-provider-errors.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "catalog", "continuous-course-audit.json");

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const provider = process.env.ACADEMY_AUTHORING_PROVIDER || "openai";
const concurrency = boundedNumber(process.env.ACADEMY_AUTHORING_CONCURRENCY, 6, 1, 12);
const maxAttempts = boundedNumber(process.env.ACADEMY_AUTHORING_MAX_ATTEMPTS, 3, 1, 5);
const baseDelayMs = boundedNumber(process.env.ACADEMY_AUTHORING_RETRY_BASE_MS, 5000, 1000, 120000);
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
    course.authoringMissing ||
    course.findings?.includes("stale-ai-course-package") ||
    course.findings?.includes("untraceable-ai-course-package")
  )
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAuthoring(courseId, attempt) {
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
      ["studio/author-course-ai.mjs", "--course", courseId, "--provider", provider, "--force"],
      {
        cwd: root,
        env: process.env,
        stdio: "inherit",
      },
    );

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.error(`[Academy Studio] Authoring process for ${courseId} exceeded ${Math.round(processTimeoutMs / 1000)} seconds; terminating for retry.`);
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
      });
    });
  });
}

async function authorWithRetry(courseId) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[Academy Studio] Authoring ${courseId}, attempt ${attempt}/${maxAttempts}`);
    const result = await runAuthoring(courseId, attempt);
    if (result.ok) return { courseId, ...result };
    if (result.retryable === false) {
      console.error(`[Academy Studio] ${courseId} encountered non-retryable authoring failure ${result.failureCategory}; retry loop stopped.`);
      return { courseId, ...result };
    }
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

async function worker(workerId, queue, results) {
  while (queue.length > 0 && !results.halted) {
    const course = queue.shift();
    if (!course) return;
    const position = results.started + 1;
    results.started += 1;
    console.log(`[Academy Studio] Worker ${workerId} starting ${position}/${targets.length}: ${course.courseId}`);
    const result = await authorWithRetry(course.courseId);
    results.completed.push(result);
    if (result.ok) {
      console.log(`[Academy Studio] Worker ${workerId} completed ${course.courseId}`);
    } else {
      console.error(`[Academy Studio] Worker ${workerId} failed ${course.courseId}: ${result.error}`);
      if (result.retryable === false) {
        haltQueue(results, queue, result);
      }
    }
  }
}

if (targets.length === 0) {
  console.log("[Academy Studio] No missing, stale, or untraceable owner-review course packages require AI authoring.");
  process.exit(0);
}

console.log(`[Academy Studio] Starting governed parallel authoring for ${targets.length} course(s) with concurrency ${concurrency}, request timeout ${Math.round(boundedNumber(process.env.ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS, 15 * 60 * 1000, 60 * 1000, 30 * 60 * 1000) / 1000)} seconds, and process timeout ${Math.round(processTimeoutMs / 1000)} seconds.`);
const queue = [...targets];
const results = {
  started: 0,
  completed: [],
  halted: false,
  haltReason: null,
  haltExitCode: null,
  queuedCoursesSkipped: 0,
};
const startedAt = Date.now();
const heartbeat = setInterval(() => {
  const active = Math.max(0, results.started - results.completed.length);
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  console.log(`[Academy Studio] Parallel authoring heartbeat: ${results.completed.length}/${targets.length} complete, ${active} active, ${queue.length} queued, ${elapsedMinutes} minute(s) elapsed, halted=${results.halted}.`);
}, heartbeatIntervalMs);
heartbeat.unref?.();

const workers = Array.from({ length: Math.min(concurrency, targets.length) }, (_, index) => worker(index + 1, queue, results));
try {
  await Promise.all(workers);
} finally {
  clearInterval(heartbeat);
}

const failures = results.completed.filter((result) => !result.ok);
const summaryPath = path.join(root, "catalog", "parallel-authoring-summary.json");
fs.writeFileSync(summaryPath, `${JSON.stringify({
  schemaVersion: "1.2",
  generatedAt: new Date().toISOString(),
  provider,
  concurrency,
  maxAttempts,
  processTimeoutMs,
  requestedCourses: targets.length,
  startedCourses: results.started,
  completedCourses: results.completed.length,
  successfulCourses: results.completed.length - failures.length,
  failedCourses: failures.length,
  halted: results.halted,
  haltReason: results.haltReason,
  queuedCoursesSkipped: results.queuedCoursesSkipped,
  elapsedMs: Date.now() - startedAt,
  results: results.completed,
}, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`[Academy Studio] Parallel authoring failed for ${failures.length} course(s): ${failures.map((item) => item.courseId).join(", ")}`);
  if (results.halted) {
    console.error(`[Academy Studio] Failure is non-retryable at the current provider boundary: ${results.haltReason}. Restore the provider prerequisite before rerunning the protected authoring workflow.`);
  }
  process.exit(results.haltExitCode || 2);
}

console.log(`[Academy Studio] Parallel authoring completed successfully for all ${targets.length} course(s).`);