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
const courseId = String(process.env.ACADEMY_COURSE_ID || "").trim();
const PIPELINE_REVISION = "2026.08.08.5-course-isolated";
const researchScript =
  String(process.env.ACADEMY_RESEARCH_PROVIDER || "local").trim().toLowerCase() === "local"
    ? "studio/research-course-authoritative-sources-local.mjs"
    : "studio/research-course-authoritative-sources.mjs";

if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error("ACADEMY_COURSE_ID must contain one governed course identifier.");
}

const activeCourseIds = fs
  .readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((id) => fs.existsSync(path.join(coursesRoot, id, "course-manifest.json")))
  .filter((id) => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(coursesRoot, id, "course-manifest.json"), "utf8"),
    );
    return !["retired", "archived"].includes(
      String(manifest.release?.status || "draft").toLowerCase(),
    );
  })
  .sort();

if (activeCourseIds.length !== 61) {
  throw new Error(
    `Course-isolated runner requires exactly 61 active courses; found ${activeCourseIds.length}.`,
  );
}
if (!activeCourseIds.includes(courseId)) {
  throw new Error(`ACADEMY_COURSE_ID is not an active governed course: ${courseId}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

const statusPath = path.join(
  coursesRoot,
  courseId,
  "generated",
  "status",
  "assembly-line-status.json",
);
const reportPath = path.join(root, "catalog", `academy-zero-cost-course-${courseId}.json`);
const startedAt = new Date().toISOString();
const attempts = {};

function writeStatus(stage, status, extra = {}) {
  atomicWriteJson(statusPath, {
    schemaVersion: "1.0",
    pipelineRevision: PIPELINE_REVISION,
    updatedAt: new Date().toISOString(),
    startedAt,
    courseId,
    stage,
    status,
    attempts,
    estimatedCommercialModelApiCostUsd: 0,
    paidFallbackAllowed: false,
    ...extra,
  });
}

function runNode(args, label) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) =>
      resolve({ ok: false, code: null, error: `${label}: ${error.message}` }),
    );
    child.once("exit", (code, signal) =>
      resolve({
        ok: code === 0,
        code,
        signal: signal || null,
        error:
          code === 0
            ? null
            : `${label} exited ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`,
      }),
    );
  });
}

async function runStage({ stage, attemptsAllowed, factory, retryDelayMs = 3000 }) {
  let last = null;
  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    attempts[stage] = attempt;
    writeStatus(stage, "running", { attempt, attemptsAllowed });
    console.log(`[Academy Studio] ${courseId} ${stage}, attempt ${attempt}/${attemptsAllowed}.`);
    last = await factory();
    if (last.ok) {
      writeStatus(stage, "passed", { attempt, attemptsAllowed });
      return last;
    }
    writeStatus(stage, "failed", {
      attempt,
      attemptsAllowed,
      error: last.error,
    });
    if (attempt < attemptsAllowed) await delay(retryDelayMs * attempt);
  }
  return last;
}

function readGate() {
  return readJsonIfPresent(
    path.join(
      coursesRoot,
      courseId,
      "generated",
      "quality",
      "deterministic-local-course-gate.json",
    ),
  );
}

function writeRemediationContext(gate) {
  const filePath = path.join(coursesRoot, courseId, "course-qa-local-remediation.json");
  atomicWriteJson(filePath, {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    courseId,
    purpose: "deterministic-zero-cost-authoring-remediation",
    instruction:
      "Regenerate only the deficient module or course element and correct every finding below. Preserve exact manifest identity, valid checkpointed work, and verified source boundaries. Do not invent facts, URLs, cases, clauses, dates, statistics, or authorities.",
    findings: Array.isArray(gate?.findings)
      ? gate.findings
      : ["deterministic-gate-failed-without-readable-findings"],
  });
  return filePath;
}

function courseState() {
  const courseRoot = path.join(coursesRoot, courseId);
  const manifest = readJsonIfPresent(path.join(courseRoot, "course-manifest.json"));
  const research = readJsonIfPresent(
    path.join(courseRoot, "generated", "research", "authoritative-source-research.json"),
  );
  const envelope = readJsonIfPresent(
    path.join(courseRoot, "generated", "authoring", "course-package.json"),
  );
  const review = readJsonIfPresent(
    path.join(courseRoot, "generated", "quality", "independent-course-quality-review.json"),
  );

  let packageValid = false;
  if (manifest && envelope) {
    try {
      validateHollywoodEnvelope({ courseId, envelope, manifest });
      packageValid =
        envelope.provider === "local" &&
        envelope.authoringPolicyVersion === AUTHORING_POLICY_VERSION;
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
      research.unresolvedTopics.length === 0,
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
      review.review.requiredCorrections.length === 0,
  );

  return {
    manifest,
    research,
    envelope,
    review,
    researchValid,
    packageValid,
    reviewValid,
  };
}

async function fail(stage, result, extra = {}) {
  const report = {
    schemaVersion: "1.0",
    pipelineRevision: PIPELINE_REVISION,
    generatedAt: new Date().toISOString(),
    courseId,
    startedAt,
    completedAt: new Date().toISOString(),
    stage,
    passed: false,
    attempts,
    error: result?.error || "unknown-stage-failure",
    estimatedCommercialModelApiCostUsd: 0,
    paidFallbackAllowed: false,
    ...extra,
  };
  atomicWriteJson(reportPath, report);
  writeStatus(stage, "failed", report);
  console.error(`[Academy Studio] ${courseId} failed at ${stage}: ${report.error}`);
  process.exitCode = 2;
}

async function main() {
  writeStatus("starting", "running");
  console.log(`[Academy Studio] Course-isolated pipeline ${PIPELINE_REVISION}: ${courseId}.`);

  let state = courseState();
  if (state.researchValid && state.packageValid && state.reviewValid) {
    const reuse = await runNode(
      [".github/scripts/validate-zero-cost-course.mjs", courseId],
      `${courseId} restored deterministic gate`,
    );
    if (reuse.ok) {
      const report = {
        schemaVersion: "1.0",
        pipelineRevision: PIPELINE_REVISION,
        generatedAt: new Date().toISOString(),
        courseId,
        startedAt,
        completedAt: new Date().toISOString(),
        stage: "reused-protected-checkpoint",
        passed: true,
        reused: true,
        remediated: false,
        attempts,
        estimatedCommercialModelApiCostUsd: 0,
        paidFallbackAllowed: false,
      };
      atomicWriteJson(reportPath, report);
      writeStatus("complete", "passed", report);
      console.log(`[Academy Studio] Reused fully validated protected checkpoint for ${courseId}.`);
      return;
    }
  }

  let researchRegenerated = false;
  if (!state.researchValid) {
    const research = await runStage({
      stage: "research",
      attemptsAllowed: 2,
      factory: () =>
        runNode([researchScript, "--course", courseId], `${courseId} research`),
    });
    if (!research.ok) return fail("research", research);
    researchRegenerated = true;
    state = courseState();
  }

  let authorRegenerated = false;
  if (!state.packageValid || researchRegenerated) {
    const authorArgs = [
      "studio/author-course-hollywood-with-checkpoint.mjs",
      "--course",
      courseId,
      "--provider",
      "local",
    ];
    if (state.envelope || researchRegenerated) authorArgs.push("--force");
    const author = await runStage({
      stage: "authoring",
      attemptsAllowed: 2,
      factory: () => runNode(authorArgs, `${courseId} authoring`),
    });
    if (!author.ok) return fail("authoring", author);
    authorRegenerated = true;
    state = courseState();
  }

  let deterministic = await runNode(
    [".github/scripts/validate-zero-cost-course.mjs", courseId],
    `${courseId} deterministic gate`,
  );
  let remediated = false;
  if (!deterministic.ok) {
    const gate = readGate();
    const remediationPath = writeRemediationContext(gate);
    console.warn(
      `[Academy Studio] ${courseId} failed deterministic gate. One targeted local remediation pass is authorized from ${path.relative(root, remediationPath)}.`,
    );
    const remediation = await runStage({
      stage: "remediation-authoring",
      attemptsAllowed: 1,
      factory: () =>
        runNode(
          [
            "studio/author-course-hollywood-with-checkpoint.mjs",
            "--course",
            courseId,
            "--provider",
            "local",
            "--force",
          ],
          `${courseId} remediation authoring`,
        ),
    });
    if (!remediation.ok) {
      return fail("remediation-authoring", remediation, {
        findings: gate?.findings || [],
      });
    }
    remediated = true;
    authorRegenerated = true;
    deterministic = await runNode(
      [".github/scripts/validate-zero-cost-course.mjs", courseId],
      `${courseId} post-remediation deterministic gate`,
    );
  }
  if (!deterministic.ok) {
    const gate = readGate();
    return fail("deterministic-gate", deterministic, {
      remediated,
      findings: gate?.findings || [],
    });
  }
  writeStatus("deterministic-gate", "passed", { remediated });

  state = courseState();
  if (!state.reviewValid || authorRegenerated) {
    const review = await runStage({
      stage: "independent-review",
      attemptsAllowed: 1,
      factory: () =>
        runNode(
          ["studio/review-course-quality.mjs", "--course", courseId],
          `${courseId} review`,
        ),
    });
    if (!review.ok) return fail("independent-review", review, { remediated });
  }

  const refresh = await runStage({
    stage: "checkpoint-refresh",
    attemptsAllowed: 1,
    factory: () =>
      runNode(
        [
          "studio/author-course-hollywood-with-checkpoint.mjs",
          "--course",
          courseId,
          "--provider",
          "local",
        ],
        `${courseId} review checkpoint refresh`,
      ),
  });
  if (!refresh.ok) return fail("checkpoint-refresh", refresh, { remediated });

  const finalState = courseState();
  const finalValidation = await runNode(
    [".github/scripts/validate-zero-cost-course.mjs", courseId],
    `${courseId} final deterministic verification`,
  );
  if (
    !finalState.researchValid ||
    !finalState.packageValid ||
    !finalState.reviewValid ||
    !finalValidation.ok
  ) {
    return fail("final-course-verification", finalValidation, {
      remediated,
      researchValid: finalState.researchValid,
      packageValid: finalState.packageValid,
      reviewValid: finalState.reviewValid,
    });
  }

  const report = {
    schemaVersion: "1.0",
    pipelineRevision: PIPELINE_REVISION,
    generatedAt: new Date().toISOString(),
    courseId,
    startedAt,
    completedAt: new Date().toISOString(),
    stage: "complete",
    passed: true,
    reused: false,
    remediated,
    attempts,
    estimatedCommercialModelApiCostUsd: 0,
    paidFallbackAllowed: false,
  };
  atomicWriteJson(reportPath, report);
  writeStatus("complete", "passed", report);
  console.log(
    `[Academy Studio] ${courseId} completed content, deterministic validation, independent review, and protected checkpointing.`,
  );
}

await main();
