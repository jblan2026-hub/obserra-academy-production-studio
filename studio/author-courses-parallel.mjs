import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "catalog", "continuous-course-audit.json");
const provider = process.env.ACADEMY_AUTHORING_PROVIDER || "openai";
const concurrency = Math.max(1, Math.min(12, Number(process.env.ACADEMY_AUTHORING_CONCURRENCY || 6)));
const maxAttempts = Math.max(1, Math.min(5, Number(process.env.ACADEMY_AUTHORING_MAX_ATTEMPTS || 3)));
const baseDelayMs = Math.max(1000, Number(process.env.ACADEMY_AUTHORING_RETRY_BASE_MS || 5000));

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
    const child = spawn(
      process.execPath,
      ["studio/author-course-ai.mjs", "--course", courseId, "--provider", provider, "--force"],
      {
        cwd: root,
        env: process.env,
        stdio: "inherit",
      },
    );

    child.on("error", (error) => {
      resolve({ ok: false, error: String(error), code: null, attempt });
    });

    child.on("exit", (code, signal) => {
      resolve({
        ok: code === 0,
        code,
        signal,
        error: code === 0 ? null : `authoring process exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}`,
        attempt,
      });
    });
  });
}

async function authorWithRetry(courseId) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[Academy Studio] Authoring ${courseId}, attempt ${attempt}/${maxAttempts}`);
    const result = await runAuthoring(courseId, attempt);
    if (result.ok) return { courseId, ...result };
    if (attempt < maxAttempts) {
      const waitMs = baseDelayMs * (2 ** (attempt - 1));
      console.warn(`[Academy Studio] ${courseId} failed attempt ${attempt}; retrying in ${waitMs} ms.`);
      await delay(waitMs);
    } else {
      return { courseId, ...result };
    }
  }
  return { courseId, ok: false, error: "unreachable retry state" };
}

async function worker(workerId, queue, results) {
  while (queue.length > 0) {
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
    }
  }
}

if (targets.length === 0) {
  console.log("[Academy Studio] No missing, stale, or untraceable owner-review course packages require AI authoring.");
  process.exit(0);
}

console.log(`[Academy Studio] Starting governed parallel authoring for ${targets.length} course(s) with concurrency ${concurrency}.`);
const queue = [...targets];
const results = { started: 0, completed: [] };
const workers = Array.from({ length: Math.min(concurrency, targets.length) }, (_, index) => worker(index + 1, queue, results));
await Promise.all(workers);

const failures = results.completed.filter((result) => !result.ok);
const summaryPath = path.join(root, "catalog", "parallel-authoring-summary.json");
fs.writeFileSync(summaryPath, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  provider,
  concurrency,
  maxAttempts,
  requestedCourses: targets.length,
  completedCourses: results.completed.length,
  successfulCourses: results.completed.length - failures.length,
  failedCourses: failures.length,
  results: results.completed,
}, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`[Academy Studio] Parallel authoring failed for ${failures.length} course(s): ${failures.map((item) => item.courseId).join(", ")}`);
  process.exit(2);
}

console.log(`[Academy Studio] Parallel authoring completed successfully for all ${targets.length} course(s).`);
