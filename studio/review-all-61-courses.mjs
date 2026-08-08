import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const concurrency = Math.max(1, Math.min(36, Number(process.env.ACADEMY_REVIEW_CONCURRENCY || process.env.ACADEMY_PAID_REVIEW_CONCURRENCY || 2)));
const maxAttempts = Math.max(1, Math.min(3, Number(process.env.ACADEMY_REVIEW_MAX_ATTEMPTS || 2)));

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function reusableReview(courseId) {
  const evidence = readJson(path.join(coursesRoot, courseId, "generated", "quality", "independent-course-quality-review.json"));
  const scores = Object.values(evidence?.review?.scores || {});
  return Boolean(
    evidence?.passed === true &&
    evidence?.courseId === courseId &&
    evidence?.review?.passed === true &&
    scores.length >= 8 &&
    scores.every((score) => Number.isInteger(score) && score >= 90) &&
    Array.isArray(evidence?.review?.criticalFindings) && evidence.review.criticalFindings.length === 0 &&
    Array.isArray(evidence?.review?.requiredCorrections) && evidence.review.requiredCorrections.length === 0
  );
}

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
      cwd: root, env: process.env, stdio: "inherit"
    });
    child.once("error", (error) => resolve({ courseId, attempt, ok: false, code: null, error: error.message }));
    child.once("exit", (code, signal) => resolve({
      courseId, attempt, ok: code === 0, code, signal: signal || null,
      error: code === 0 ? null : `review exited with ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`
    }));
  });
}
async function runWithRetry(courseId) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await run(courseId, attempt);
    if (last.ok) return last;
    if ([42, 43, 44].includes(last.code)) return last;
    if (attempt < maxAttempts) await delay(4000 * attempt);
  }
  return last;
}

const reusable = courseIds.filter(reusableReview);
const queue = courseIds.filter((courseId) => !reusable.includes(courseId));
const results = reusable.map((courseId) => ({ courseId, attempt: 0, ok: true, reused: true, code: 0, error: null }));
let circuitOpen = false;

async function worker(workerId) {
  while (queue.length && !circuitOpen) {
    const courseId = queue.shift();
    if (!courseId) return;
    console.log(`[Academy Studio] Paid review slot ${workerId}/${concurrency} assigned ${courseId}.`);
    const result = await runWithRetry(courseId);
    results.push({ workerId, ...result, reused: false });
    if ([42, 43].includes(result.code)) {
      circuitOpen = true;
      console.error(`[Academy Studio] Paid review circuit opened after nonretryable provider failure on ${courseId}; remaining reviews will not consume credits.`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, (_, index) => worker(index + 1)));
for (const courseId of queue.splice(0)) {
  results.push({ courseId, attempt: 0, ok: false, reused: false, code: 42, error: "not-started-provider-circuit-open" });
}

const failed = results.filter((result) => !result.ok);
const summary = {
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  expectedCourses: 61,
  logicalReviewerWorkers: 36,
  paidReviewConcurrency: concurrency,
  applicationWorkers: 0,
  reusedReviews: results.filter((result) => result.reused).length,
  newlyReviewed: results.filter((result) => result.ok && !result.reused).length,
  passedCourses: results.filter((result) => result.ok).length,
  failedCourses: failed.length,
  providerCircuitOpened: circuitOpen,
  results
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-61-independent-review-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[Academy Studio] Independent content review ready ${summary.passedCourses}/61: ${summary.reusedReviews} reused, ${summary.newlyReviewed} newly reviewed.`);
if (failed.length) process.exit(2);
