import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  AUTHORING_POLICY_VERSION,
  validateHollywoodEnvelope,
} from "../../studio/academy-hollywood-checkpoints.mjs";

const root = process.cwd();
const coursesRoot = path.join(root, "courses");
const directCourseId = String(process.env.ACADEMY_COURSE_ID || "").trim();
const shardIndex = Number(process.env.ACADEMY_SHARD_INDEX ?? 0);
const shardCount = Number(process.env.ACADEMY_SHARD_COUNT || 1);
const maxAttempts = Math.max(1, Math.min(3, Number(process.env.ACADEMY_LOCAL_SHARD_MAX_ATTEMPTS || 3)));
const skippedCourseId = String(process.env.ACADEMY_SKIP_COURSE_ID || "").trim();
const PIPELINE_REVISION = "2026.08.08.6";
const researchScript = String(process.env.ACADEMY_RESEARCH_PROVIDER || "local").trim().toLowerCase() === "local"
  ? "studio/research-course-authoritative-sources-local.mjs"
  : "studio/research-course-authoritative-sources.mjs";

if (!directCourseId && (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount)) {
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

if (courseIds.length !== 61) throw new Error(`Zero-cost course runner requires exactly 61 active courses; discovered ${courseIds.length}.`);
if (directCourseId && !courseIds.includes(directCourseId)) {
  throw new Error(`ACADEMY_COURSE_ID=${directCourseId} is not an active governed course.`);
}
if (skippedCourseId && !courseIds.includes(skippedCourseId)) {
  throw new Error(`ACADEMY_SKIP_COURSE_ID=${skippedCourseId} is not an active governed course.`);
}
if (directCourseId && skippedCourseId && directCourseId === skippedCourseId) {
  throw new Error(`ACADEMY_COURSE_ID=${directCourseId} cannot also be the skipped course.`);
}

const schedulableCourseIds = skippedCourseId ? courseIds.filter((courseId) => courseId !== skippedCourseId) : courseIds;
const selected = directCourseId
  ? [directCourseId]
  : schedulableCourseIds.filter((_courseId, index) => index % shardCount === shardIndex);
if (!selected.length) throw new Error(`Course runner received no courses.`);

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}
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
function readGate(courseId) {
  return readJsonIfPresent(path.join(coursesRoot, courseId, "generated", "quality", "deterministic-local-course-gate.json"));
}
function writeRemediationContext(courseId, gate) {
  const filePath = path.join(coursesRoot, courseId, "course-qa-local-remediation.json");
  const payload = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    courseId,
    purpose: "deterministic-zero-cost-authoring-remediation",
    instruction: "Regenerate the complete course package and correct every finding below. Preserve exact manifest module identity and verified primary-source boundaries. Do not omit previously valid content and do not invent facts, URLs, cases, clauses, dates, statistics, or authorities.",
    findings: Array.isArray(gate?.findings) ? gate.findings : ["deterministic-gate-failed-without-readable-findings"],
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return filePath;
}

function courseState(courseId) {
  const courseRoot = path.join(coursesRoot, courseId);
  const manifest = readJsonIfPresent(path.join(courseRoot, "course-manifest.json"));
  const research = readJsonIfPresent(path.join(courseRoot, "generated", "research", "authoritative-source-research.json"));
  const envelope = readJsonIfPresent(path.join(courseRoot, "generated", "authoring", "course-package.json"));
  const review = readJsonIfPresent(path.join(courseRoot, "generated", "quality", "independent-course-quality-review.json"));

  let packageValid = false;
  if (manifest && envelope) {
    try {
      validateHollywoodEnvelope({ courseId, envelope, manifest });
      packageValid = envelope.provider === "local" && envelope.authoringPolicyVersion === AUTHORING_POLICY_VERSION;
    } catch {
      packageValid = false;
    }
  }

  const researchValid = Boolean(
    manifest &&
    research?.courseId === courseId &&
    research?.provider === "local" &&
    research?.passed === true &&
    research?.manifestHash === stableHash(manifest) &&
    Array.isArray(research?.unresolvedTopics) &&
    research.unresolvedTopics.length === 0
  );

  const scores = Object.values(review?.review?.scores || {});
  const reviewValid = Boolean(
    review?.courseId === courseId &&
    review?.provider === "local" &&
    review?.passed === true &&
    review?.review?.passed === true &&
    scores.length === 10 &&
    scores.every((score) => Number.isInteger(score) && score >= 90 && score <= 100) &&
    Array.isArray(review?.review?.criticalFindings) &&
    review.review.criticalFindings.length === 0 &&
    Array.isArray(review?.review?.requiredCorrections) &&
    review.review.requiredCorrections.length === 0
  );

  return { manifest, research, envelope, review, researchValid, packageValid, reviewValid };
}

const results = [];
for (const [position, courseId] of selected.entries()) {
  const startedAt = new Date().toISOString();
  console.log(`[Academy Studio] Pipeline ${PIPELINE_REVISION}, course ${position + 1}/${selected.length}: ${courseId}.`);

  let state = courseState(courseId);
  if (state.researchValid && state.packageValid && state.reviewValid) {
    const deterministicReuse = await runNode([".github/scripts/validate-zero-cost-course.mjs", courseId], `${courseId} restored deterministic gate`);
    if (deterministicReuse.ok) {
      console.log(`[Academy Studio] Reused fully validated protected checkpoint for ${courseId}; no model inference was required.`);
      results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "reused-protected-checkpoint", passed: true, reused: true, remediated: false });
      continue;
    }
    console.warn(`[Academy Studio] Restored evidence for ${courseId} did not pass the current deterministic gate and will be repaired locally.`);
  }

  let researchRegenerated = false;
  if (!state.researchValid) {
    const research = await withRetry(
      () => runNode([researchScript, "--course", courseId], `${courseId} research`),
      `${courseId} governed zero-cost primary-source research`,
    );
    if (!research.ok) {
      results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "research", passed: false, error: research.error });
      continue;
    }
    researchRegenerated = true;
    state = courseState(courseId);
  } else {
    console.log(`[Academy Studio] Reused current local primary-source research for ${courseId}.`);
  }

  let authorRegenerated = false;
  if (!state.packageValid || researchRegenerated) {
    const authorArgs = ["studio/author-course-hollywood-with-checkpoint.mjs", "--course", courseId, "--provider", "local"];
    if (state.envelope || researchRegenerated) authorArgs.push("--force");
    const author = await withRetry(
      () => runNode(authorArgs, `${courseId} authoring`),
      `${courseId} local authoring and protected checkpoint`,
    );
    if (!author.ok) {
      results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "authoring", passed: false, error: author.error });
      continue;
    }
    authorRegenerated = true;
    state = courseState(courseId);
  } else {
    console.log(`[Academy Studio] Reused current governed course package for ${courseId}.`);
  }

  let deterministic = await runNode([".github/scripts/validate-zero-cost-course.mjs", courseId], `${courseId} deterministic gate`);
  let remediated = false;
  if (!deterministic.ok) {
    const gate = readGate(courseId);
    const remediationPath = writeRemediationContext(courseId, gate);
    console.warn(`[Academy Studio] ${courseId} failed deterministic production gate. Local remediation is required from ${path.relative(root, remediationPath)}.`);
    const remediation = await withRetry(
      () => runNode(["studio/author-course-hollywood-with-checkpoint.mjs", "--course", courseId, "--provider", "local", "--force"], `${courseId} remediation authoring`),
      `${courseId} local deterministic remediation`,
    );
    if (!remediation.ok) {
      results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "remediation-authoring", passed: false, error: remediation.error, findings: gate?.findings || [] });
      continue;
    }
    remediated = true;
    authorRegenerated = true;
    deterministic = await runNode([".github/scripts/validate-zero-cost-course.mjs", courseId], `${courseId} post-remediation deterministic gate`);
  }
  if (!deterministic.ok) {
    const gate = readGate(courseId);
    results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "deterministic-gate", passed: false, remediated, error: deterministic.error, findings: gate?.findings || [] });
    continue;
  }

  state = courseState(courseId);
  if (!state.reviewValid || authorRegenerated) {
    const review = await withRetry(
      () => runNode(["studio/review-course-quality.mjs", "--course", courseId], `${courseId} review`),
      `${courseId} local independent review`,
    );
    if (!review.ok) {
      results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "review", passed: false, remediated, error: review.error });
      continue;
    }
  } else {
    console.log(`[Academy Studio] Reused current independent local quality review for ${courseId}.`);
  }

  const refreshCheckpoint = await withRetry(
    () => runNode(["studio/author-course-hollywood-with-checkpoint.mjs", "--course", courseId, "--provider", "local"], `${courseId} review checkpoint refresh`),
    `${courseId} protected review-evidence checkpoint refresh`,
  );
  if (!refreshCheckpoint.ok) {
    results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "checkpoint-refresh", passed: false, remediated, error: refreshCheckpoint.error });
    continue;
  }

  results.push({ courseId, startedAt, completedAt: new Date().toISOString(), stage: "complete", passed: true, reused: false, remediated });
}

const passed = results.filter((item) => item.passed).length;
const report = {
  schemaVersion: "1.4",
  pipelineRevision: PIPELINE_REVISION,
  generatedAt: new Date().toISOString(),
  directCourseId: directCourseId || null,
  shardIndex,
  shardCount,
  expectedPortfolioCourses: 61,
  skippedCourseId: skippedCourseId || null,
  schedulableCourseCount: schedulableCourseIds.length,
  selectedCourses: selected,
  completedCourses: passed,
  reusedCourses: results.filter((item) => item.reused).length,
  remediatedCourses: results.filter((item) => item.remediated).length,
  failedCourses: results.filter((item) => !item.passed).length,
  estimatedCommercialModelApiCostUsd: 0,
  externalPaidModelAllowed: false,
  results,
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
const reportName = directCourseId
  ? `academy-zero-cost-course-${directCourseId}.json`
  : `academy-zero-cost-shard-${String(shardIndex).padStart(2, "0")}.json`;
fs.writeFileSync(path.join(root, "catalog", reportName), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Zero-cost course runner: ${passed}/${selected.length} course(s) fully checkpointed, ${report.reusedCourses} reused, ${report.remediatedCourses} remediated, ${report.failedCourses} failed.`);
if (passed !== selected.length) process.exit(2);
