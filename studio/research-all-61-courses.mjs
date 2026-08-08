import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const concurrency = Math.max(1, Math.min(36, Number(process.env.ACADEMY_RESEARCH_CONCURRENCY || 36)));
const maxAttempts = Math.max(1, Math.min(3, Number(process.env.ACADEMY_RESEARCH_MAX_ATTEMPTS || 2)));

const courses = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .filter((courseId) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(coursesRoot, courseId, "course-manifest.json"), "utf8"));
    const status = String(manifest.release?.status || "draft").toLowerCase();
    return !["retired", "archived"].includes(status);
  })
  .sort();

if (courses.length !== 61) throw new Error(`Course completion lane requires exactly 61 active governed courses; discovered ${courses.length}.`);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCourse(courseId, attempt) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["studio/research-course-authoritative-sources.mjs", "--course", courseId], {
      cwd: root,
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", (error) => resolve({ courseId, attempt, ok: false, code: null, error: error.message }));
    child.once("exit", (code, signal) => resolve({
      courseId,
      attempt,
      ok: code === 0,
      code,
      signal: signal || null,
      error: code === 0 ? null : `research process exited with ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`
    }));
  });
}

async function runWithRetry(courseId) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[Academy Studio] Research worker starting ${courseId}, attempt ${attempt}/${maxAttempts}.`);
    last = await runCourse(courseId, attempt);
    if (last.ok) return last;
    if (attempt < maxAttempts) await delay(3000 * attempt);
  }
  return last;
}

const queue = [...courses];
const results = [];
async function worker(workerId) {
  while (queue.length > 0) {
    const courseId = queue.shift();
    if (!courseId) return;
    console.log(`[Academy Studio] Research worker ${workerId}/36 assigned ${courseId}.`);
    const result = await runWithRetry(courseId);
    results.push(result);
    console.log(`[Academy Studio] Research worker ${workerId}/36 ${result.ok ? "completed" : "failed"} ${courseId}.`);
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
  researchWorkerAllocation: 36,
  discoveredCourses: courses.length,
  concurrency,
  completed: results.filter((result) => result.ok).length,
  failed: failed.length,
  results
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-61-source-research-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[Academy Studio] Authoritative research complete for ${summary.completed}/61 courses.`);
if (failed.length > 0) process.exit(2);
