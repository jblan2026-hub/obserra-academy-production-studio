import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  commercialProductionStandard,
  commercialProductionStandardHash,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checks = [];

function record(name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function requireTrueGroup(groupName) {
  const group = commercialProductionStandard[groupName];
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    record(`${groupName}-present`, false, `${groupName} is missing or invalid.`);
    return;
  }
  for (const [name, value] of Object.entries(group)) {
    record(`${groupName}.${name}`, value === true, value);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function includesAll(name, source, markers) {
  const missing = markers.filter((marker) => !source.includes(marker));
  record(name, missing.length === 0, missing.length ? { missing } : null);
}

requireTrueGroup("realWorldApplication");
requireTrueGroup("implementationGuidance");

for (const deliverable of [
  "documented-real-world-case-register",
  "course-implementation-strategy",
  "standards-implementation-map",
  "prioritized-recommendation-register",
  "implementation-evidence-and-metrics-plan",
]) {
  record(
    `course-deliverable-${deliverable}`,
    commercialProductionStandard.requiredCourseDeliverables.includes(deliverable),
  );
}

for (const deliverable of [
  "documented-real-world-case-study",
  "implementation-playbook",
  "prioritized-recommendations",
  "standards-implementation-guidance",
  "evidence-and-metrics-plan",
]) {
  record(
    `lesson-deliverable-${deliverable}`,
    commercialProductionStandard.requiredInstructionalLessonDeliverables.includes(deliverable),
  );
}

for (const evidence of [
  "real-world-case-source-audit",
  "recommendation-and-implementation-review",
  "standards-implementation-traceability",
  "implementation-evidence-and-metrics-review",
]) {
  record(
    `release-evidence-${evidence}`,
    commercialProductionStandard.requiredReleaseEvidence.includes(evidence),
  );
}

const supplementPath = "studio/enrich-commercial-implementation-guidance.mjs";
const wrapperPath = "studio/author-course-with-checkpoint.mjs";
const batchPath = "studio/author-all-courses.mjs";
const catalogPath = "studio/generate-catalog.mjs";
const baseValidatorPath = "studio/validate-learner-catalog.mjs";
const implementationValidatorPath = "studio/validate-commercial-implementation-guidance.mjs";
const packagePath = "package.json";

for (const relativePath of [
  supplementPath,
  wrapperPath,
  batchPath,
  catalogPath,
  baseValidatorPath,
  implementationValidatorPath,
  packagePath,
]) {
  record(`required-file-${relativePath}`, fs.existsSync(path.join(root, relativePath)));
}

const supplement = read(supplementPath);
includesAll("supplement-schema-and-guardrails", supplement, [
  "courseImplementationStrategy",
  "documentedRealWorldCaseRegister",
  "standardsImplementationMap",
  "prioritizedRecommendations",
  "documentedRealWorldCases",
  "implementationPlaybook",
  "standardImplementationGuidance",
  "evidenceAndMetricsPlan",
  "Do not invent a company event",
  "documented-public-case",
  "verification-required",
  "at least five sequenced steps",
  "at least three prioritized recommendations",
  "educational and informational",
]);

const wrapper = read(wrapperPath);
includesAll("checkpoint-wrapper-enrichment-binding", wrapper, [
  "studio/author-course-ai.mjs",
  "studio/enrich-commercial-implementation-guidance.mjs",
  "persistGeneratedPackage",
]);

const batch = read(batchPath);
includesAll("batch-authoring-enrichment-binding", batch, [
  "author-course-with-checkpoint.mjs",
  "implementationGuidanceRequired: true",
  "checkpointRequired: true",
]);

const catalog = read(catalogPath);
includesAll("learner-catalog-implementation-projection", catalog, [
  "courseImplementationStrategy",
  "documentedRealWorldCaseRegister",
  "standardsImplementationMap",
  "prioritizedRecommendations",
  "documentedRealWorldCases",
  "implementationPlaybook",
  "standardImplementationGuidance",
  "evidenceAndMetricsPlan",
]);

const baseValidator = read(baseValidatorPath);
includesAll("base-learner-readiness-gate-preserved", baseValidator, [
  "requiredAuthoringPolicyVersion = \"2026.08.07.3\"",
  "lesson-narrative-below-",
  "learner-catalog-worker-contract-mismatch",
  "learner-catalog-production-standard-mismatch",
]);

const implementationValidator = read(implementationValidatorPath);
includesAll("learner-readiness-implementation-gate", implementationValidator, [
  "missing-documented-real-world-case-register",
  "missing-course-implementation-strategy",
  "missing-standards-implementation-map",
  "insufficient-prioritized-recommendations",
  "missing-implementation-playbook",
  "insufficient-module-recommendations",
  "missing-standard-implementation-guidance",
  "missing-evidence-and-metrics-plan",
]);

const packageJson = JSON.parse(read(packagePath));
record(
  "direct-course-authoring-uses-checkpoint-wrapper",
  packageJson.scripts?.["author:course"] === "node studio/author-course-with-checkpoint.mjs",
  packageJson.scripts?.["author:course"] ?? null,
);
record(
  "commercial-course-gate-script-present",
  packageJson.scripts?.["verify:course-production-standard"]
    === "node studio/verify-commercial-course-production-standard.mjs",
  packageJson.scripts?.["verify:course-production-standard"] ?? null,
);
record(
  "worker-contract-gate-includes-commercial-course-gate",
  String(packageJson.scripts?.["verify:worker-contract"] ?? "")
    .includes("verify:course-production-standard"),
  packageJson.scripts?.["verify:worker-contract"] ?? null,
);
record(
  "learner-catalog-gate-includes-implementation-validator",
  String(packageJson.scripts?.["validate:learner-catalog"] ?? "")
    .includes("validate-commercial-implementation-guidance.mjs"),
  packageJson.scripts?.["validate:learner-catalog"] ?? null,
);

const failures = checks.filter((check) => !check.passed);
const report = {
  schemaVersion: "1.1",
  verifiedAt: new Date().toISOString(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  ready: failures.length === 0,
  checkCount: checks.length,
  passedCount: checks.length - failures.length,
  failureCount: failures.length,
  failures,
  checks,
  claimBoundary:
    "This gate proves that commercial cinematic, real-world case, recommendation, and implementation-to-standard requirements are encoded and bound to the authoring and learner-readiness paths. It does not prove that sources have been independently verified, videos have been rendered and mastered, human reviews have passed, or courses are authorized for publication.",
};

const reportPath = path.join(root, "catalog", "commercial-course-production-standard-verification.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${report.ready}\n`);
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `production_standard_hash=${report.productionStandardHash}\n`,
  );
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `failure_count=${report.failureCount}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Commercial cinematic course production gate",
      "",
      `- Standard: ${report.productionStandardId}`,
      `- Standard hash: ${report.productionStandardHash}`,
      `- Quality target: ${report.qualityTier}`,
      `- Ready: ${report.ready}`,
      `- Checks: ${report.passedCount}/${report.checkCount} passed`,
      "",
      report.claimBoundary,
      "",
    ].join("\n"),
  );
}

console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(2);
