import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const concurrency = Math.max(1, Math.min(36, Number(process.env.ACADEMY_AUTHORING_CONCURRENCY || 36)));
const maxAttempts = Math.max(1, Math.min(4, Number(process.env.ACADEMY_AUTHORING_MAX_ATTEMPTS || 3)));
const timeoutMs = Math.max(5 * 60_000, Math.min(45 * 60_000, Number(process.env.ACADEMY_AUTHORING_PROCESS_TIMEOUT_MS || 30 * 60_000)));

const courses = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .filter((courseId) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(coursesRoot, courseId, "course-manifest.json"), "utf8"));
    return !["retired", "archived"].includes(String(manifest.release?.status || "draft").toLowerCase());
  })
  .sort();

if (courses.length !== 61) throw new Error(`Cinematic completion lane requires exactly 61 active governed courses; discovered ${courses.length}.`);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCourse(courseId, attempt) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      "studio/author-course-hollywood-with-checkpoint.mjs",
      "--course",
      courseId,
      "--provider",
      process.env.ACADEMY_AUTHORING_PROVIDER || "openai",
      "--force"
    ], {
      cwd: root,
      env: process.env,
      stdio: "inherit"
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGTERM");
      finish({ courseId, attempt, ok: false, code: null, timedOut: true, error: `authoring timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }
    child.once("error", (error) => finish({ courseId, attempt, ok: false, code: null, timedOut: false, error: error.message }));
    child.once("exit", (code, signal) => finish({
      courseId,
      attempt,
      ok: code === 0,
      code,
      signal: signal || null,
      timedOut: false,
      error: code === 0 ? null : `cinematic authoring exited with ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`
    }));
  });
}

async function runWithRetry(courseId) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[Academy Studio] Cinematic worker starting ${courseId}, attempt ${attempt}/${maxAttempts}.`);
    last = await runCourse(courseId, attempt);
    if (last.ok) return last;
    if (attempt < maxAttempts) await delay(5000 * (2 ** (attempt - 1)));
  }
  return last;
}

const queue = [...courses];
const results = [];
async function worker(workerId) {
  while (queue.length > 0) {
    const courseId = queue.shift();
    if (!courseId) return;
    console.log(`[Academy Studio] Academy course worker ${workerId}/36 assigned ${courseId}.`);
    const result = await runWithRetry(courseId);
    results.push({ workerId, ...result });
    console.log(`[Academy Studio] Academy course worker ${workerId}/36 ${result.ok ? "completed" : "failed"} ${courseId}.`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, courses.length) }, (_, index) => worker(index + 1)));
const failed = results.filter((result) => !result.ok);
const summary = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  objective: "complete-all-61-academy-courses-only",
  portfolioWorkerCount: 36,
  applicationWorkerAllocation: 0,
  courseWorkerAllocation: 36,
  discoveredCourses: courses.length,
  concurrency,
  completed: results.filter((result) => result.ok).length,
  failed: failed.length,
  results
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-61-cinematic-authoring-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[Academy Studio] Cinematic authoring complete for ${summary.completed}/61 courses.`);
if (failed.length > 0) process.exit(2);
