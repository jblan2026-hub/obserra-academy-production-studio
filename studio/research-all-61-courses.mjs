import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const concurrency = Math.max(1, Math.min(36, Number(process.env.ACADEMY_RESEARCH_CONCURRENCY || process.env.ACADEMY_PAID_RESEARCH_CONCURRENCY || 2)));
const maxAttempts = Math.max(1, Math.min(3, Number(process.env.ACADEMY_RESEARCH_MAX_ATTEMPTS || 1)));
const canaryCount = Math.max(1, Math.min(3, Number(process.env.ACADEMY_PAID_CANARY_COUNT || 1)));

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function reusableResearch(courseId) {
  const manifestPath = path.join(coursesRoot, courseId, "course-manifest.json");
  const evidencePath = path.join(coursesRoot, courseId, "generated", "research", "authoritative-source-research.json");
  const manifest = readJson(manifestPath);
  const evidence = readJson(evidencePath);
  return Boolean(
    manifest &&
    evidence?.passed === true &&
    evidence?.manifestHash === stableHash(manifest) &&
    Array.isArray(evidence?.unresolvedTopics) &&
    evidence.unresolvedTopics.length === 0
  );
}

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
    if ([42, 43, 44].includes(last.code)) return last;
    if (attempt < maxAttempts) await delay(3000 * attempt);
  }
  return last;
}

const reusable = courses.filter(reusableResearch);
const queue = courses.filter((courseId) => !reusable.includes(courseId));
const results = reusable.map((courseId) => ({ courseId, attempt: 0, ok: true, reused: true, canary: false, code: 0, error: null }));
let circuitOpen = false;
let canaryFailed = false;

for (let index = 0; index < Math.min(canaryCount, queue.length); index += 1) {
  const courseId = queue.shift();
  console.log(`[Academy Studio] Paid research canary ${index + 1}/${canaryCount} assigned ${courseId}.`);
  const result = await runWithRetry(courseId);
  results.push({ ...result, reused: false, canary: true });
  if (!result.ok) {
    canaryFailed = true;
    circuitOpen = true;
    console.error(`[Academy Studio] Paid research canary failed for ${courseId}; batch research will not start.`);
    break;
  }
}

async function worker(workerId) {
  while (queue.length > 0 && !circuitOpen) {
    const courseId = queue.shift();
    if (!courseId) return;
    console.log(`[Academy Studio] Paid research slot ${workerId}/${concurrency} assigned ${courseId}.`);
    const result = await runWithRetry(courseId);
    results.push({ ...result, workerId, reused: false, canary: false });
    if ([42, 43].includes(result.code)) {
      circuitOpen = true;
      console.error(`[Academy Studio] Paid research circuit opened after nonretryable provider failure on ${courseId}; remaining courses will not consume credits.`);
    }
  }
}

if (!circuitOpen) {
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, (_, index) => worker(index + 1)));
}
const deferred = queue.splice(0);
for (const courseId of deferred) {
  results.push({ courseId, attempt: 0, ok: false, reused: false, canary: false, deferred: true, code: null, error: canaryFailed ? "not-started-paid-canary-failed" : "not-started-provider-circuit-open" });
}

const failed = results.filter((result) => !result.ok);
const summary = {
  schemaVersion: "1.2",
  generatedAt: new Date().toISOString(),
  objective: "complete-all-61-academy-courses-only-credit-last",
  portfolioWorkerCount: 36,
  applicationWorkerAllocation: 0,
  logicalResearchWorkers: 36,
  paidResearchConcurrency: concurrency,
  paidCanaryCount: canaryCount,
  discoveredCourses: courses.length,
  reused: results.filter((result) => result.reused).length,
  canaryCompleted: results.filter((result) => result.canary && result.ok).length,
  newlyCompleted: results.filter((result) => result.ok && !result.reused).length,
  completed: results.filter((result) => result.ok).length,
  failed: failed.filter((result) => !result.deferred).length,
  deferred: results.filter((result) => result.deferred).length,
  providerCircuitOpened: circuitOpen,
  canaryFailed,
  results
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-61-source-research-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[Academy Studio] Authoritative research ready for ${summary.completed}/61 courses: ${summary.reused} reused, ${summary.newlyCompleted} newly researched, ${summary.deferred} deferred without paid calls.`);
if (failed.length > 0) process.exit(2);
