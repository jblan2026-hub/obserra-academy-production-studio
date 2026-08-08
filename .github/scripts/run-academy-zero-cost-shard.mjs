import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const coursesRoot = path.join(root, "courses");
const shardIndex = Number(process.env.ACADEMY_SHARD_INDEX);
const shardCount = Number(process.env.ACADEMY_SHARD_COUNT || 16);
const maxAttempts = Math.max(1, Math.min(2, Number(process.env.ACADEMY_LOCAL_SHARD_MAX_ATTEMPTS || 2)));

if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
  throw new Error(`Invalid ACADEMY_SHARD_INDEX=${process.env.ACADEMY_SHARD_INDEX}; expected 0..${shardCount - 1}.`);
}

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .filter((courseId) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(coursesRoot, courseId, "course-manifest.json"), "utf8"));
    return !["retired", "archived"].includes(String(manifest.release?.status || "draft").toLowerCase());
  })
  .sort();

if (courseIds.length !== 61) throw new Error(`Zero-cost shard runner requires exactly 61 active courses; discovered ${courseIds.length}.`);
const selected = courseIds.filter((_courseId, index) => index % shardCount === shardIndex);
if (!selected.length) throw new Error(`Shard ${shardIndex}/${shardCount} received no courses.`);

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function runNode(args, label) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", (error) => resolve({ ok: false, code: null, error: `${label}: ${error.message}` }));
    child.once("exit", (code, signal) => resolve({ ok: code === 0, code, signal: signal || null, error: code === 0 ? null : `${label} exited ${code ?? "unknown"}${signal ? ` (${signal})` : ""}` }));
  });
}
async function withRetry(factory, label) {
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[Academy Studio] ${label}, attempt ${attempt}/${maxAttempts}.`);
    last = await factory();
    if (last.ok) return last;
    if (attempt < maxAttempts) await delay(3000 * attempt);
  }
  return last;
}

const results = [];
for (const [position, courseId] of selected.entries()) {
  const startedAt = new Date().toISOString();
  console.log(`[Academy Studio] Shard ${shardIndex + 1}/${shardCount}, course ${position + 1}/${selected.length}: ${courseId}.`);

  const research = await withRetry(
    () => runNode(["studio/research-course-authoritative-sources.mjs", "--course", courseId], `${courseId} research`),
    `${courseId} local primary-source research`,
  );
  if (!research.ok) {
    results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "research", passed: false, error: research.error });
    break;
  }

  const author = await withRetry(
    () => runNode(["studio/author-course-hollywood-with-checkpoint.mjs", "--course", courseId, "--provider", "local"], `${courseId} authoring`),
    `${courseId} local authoring and protected checkpoint`,
  );
  if (!author.ok) {
    results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "authoring", passed: false, error: author.error });
    break;
  }

  const review = await withRetry(
    () => runNode(["studio/review-course-quality.mjs", "--course", courseId], `${courseId} review`),
    `${courseId} local independent review`,
  );
  if (!review.ok) {
    results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "review", passed: false, error: review.error });
    break;
  }

  const refreshCheckpoint = await withRetry(
    () => runNode(["studio/author-course-hollywood-with-checkpoint.mjs", "--course", courseId, "--provider", "local"], `${courseId} review checkpoint refresh`),
    `${courseId} protected review-evidence checkpoint refresh`,
  );
  if (!refreshCheckpoint.ok) {
    results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "checkpoint-refresh", passed: false, error: refreshCheckpoint.error });
    break;
  }

  results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "complete", passed: true });
}

const passed = results.filter((item) => item.passed).length;
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  shardIndex,
  shardCount,
  expectedPortfolioCourses: 61,
  selectedCourses: selected,
  completedCourses: passed,
  failedCourses: results.filter((item) => !item.passed).length,
  estimatedCommercialModelApiCostUsd: 0,
  externalPaidModelAllowed: false,
  results,
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", `academy-zero-cost-shard-${String(shardIndex).padStart(2, "0")}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Zero-cost shard ${shardIndex + 1}/${shardCount}: ${passed}/${selected.length} course(s) fully checkpointed.`);
if (passed !== selected.length) process.exit(2);
