import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  AUTHORING_POLICY_VERSION,
  stableHash,
  validateHollywoodEnvelope,
} from "./academy-hollywood-checkpoints.mjs";

const root = process.cwd();
const coursesRoot = path.join(root, "courses");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course") || String(process.env.ACADEMY_COURSE_ID || "").trim();
const githubOutput = arg("--github-output");

if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error(
    "Usage: node studio/academy-course-runtime-preflight.mjs --course <course-id> [--github-output <path>]",
  );
}

const courseRoot = path.join(coursesRoot, courseId);
const manifestPath = path.join(courseRoot, "course-manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error(`Course manifest not found for ${courseId}.`);

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

const manifest = readJsonIfPresent(manifestPath);
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

const reviewScores = Object.values(review?.review?.scores || {});
const reviewValid = Boolean(
  review?.courseId === courseId &&
    review?.provider === "local" &&
    review?.passed === true &&
    review?.review?.passed === true &&
    reviewScores.length === 10 &&
    reviewScores.every((score) => Number.isInteger(score) && score >= 90 && score <= 100) &&
    Array.isArray(review?.review?.criticalFindings) &&
    review.review.criticalFindings.length === 0 &&
    Array.isArray(review?.review?.requiredCorrections) &&
    review.review.requiredCorrections.length === 0,
);

let deterministicValid = false;
if (researchValid && packageValid && reviewValid) {
  const validation = spawnSync(
    process.execPath,
    [".github/scripts/validate-zero-cost-course.mjs", courseId],
    {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  deterministicValid = validation.status === 0;
}

const reusable = researchValid && packageValid && reviewValid && deterministicValid;
const result = {
  schemaVersion: "1.0",
  evaluatedAt: new Date().toISOString(),
  courseId,
  researchValid,
  packageValid,
  reviewValid,
  deterministicValid,
  reusable,
  modelRequired: !reusable,
  estimatedCommercialModelApiCostUsd: 0,
};

if (githubOutput) {
  fs.appendFileSync(
    githubOutput,
    [
      `model_required=${result.modelRequired ? "true" : "false"}`,
      `reusable=${result.reusable ? "true" : "false"}`,
      `course_id=${courseId}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

console.log(JSON.stringify(result));
