import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const concurrency = Math.max(1, Math.min(36, Number(process.env.ACADEMY_REVIEW_CONCURRENCY || 36)));
const maxAttempts = Math.max(1, Math.min(3, Number(process.env.ACADEMY_REVIEW_MAX_ATTEMPTS || 2)));

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .sort();
if (courseIds.length !== 61) throw new Error(`Independent quality review requires exactly 61 courses; discovered ${courseIds.length}.`);

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function run(courseId, attempt) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["studio/review-course-quality.mjs", "--course", courseId], {
      cwd: root,
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", (error) => resolve({ courseId, attempt, ok: false, code: null, error: error.message }));
    child.once("exit", (code, signal) => resolve({ courseId, attempt, ok: code === 0, code, signal: signal || null, error: code === 0 ? null : `review exited with ${code ?? "unknown"}` }));
  });
}
async function runWithRetry(courseId) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await run(courseId, attempt);
    if (last.ok) return last;
    if (attempt < maxAttempts) await delay(4000 * attempt);
  }
  return last;
}

const queue = [...courseIds];
const results = [];
async function worker(workerId) {
  while (queue.length) {
    const courseId = queue.shift();
    if (!courseId) return;
    console.log(`[Academy Studio] Independent reviewer ${workerId}/36 assigned ${courseId}.`);
    const result = await runWithRetry(courseId);
    results.push({ workerId, ...result });
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, courseIds.length) }, (_, index) => worker(index + 1)));
const failed = results.filter((result) => !result.ok);
const summary = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  expectedCourses: 61,
  reviewerWorkers: 36,
  applicationWorkers: 0,
  passedCourses: results.length - failed.length,
  failedCourses: failed.length,
  results
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-61-independent-review-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[Academy Studio] Independent content review passed ${summary.passedCourses}/61 courses.`);
if (failed.length) process.exit(2);
