import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";
import {
  allocationAuthority,
  applicationWorkerAllocation,
  assertAcademyWorkerAllocation,
  courseWorkerAllocation,
  interchangeableCourseRoles,
  mandatoryContractDomains,
  portfolioWorkerCount,
  workerDescriptor,
  workerMode,
} from "./academy-worker-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const original = {
  portfolio: process.env.OBSERRA_PORTFOLIO_WORKER_COUNT,
  application: process.env.OBSERRA_APPLICATION_WORKER_COUNT,
  course: process.env.ACADEMY_COURSE_WORKER_COUNT,
  concurrency: process.env.ACADEMY_AUTHORING_CONCURRENCY,
  mode: process.env.ACADEMY_WORKER_MODE,
  expectedSurge: process.env.ACADEMY_EXPECTED_SURGE_COURSES,
};
const checks = [];

function record(name, condition, detail = null) {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  assert.ok(passed, `${name}${detail ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

try {
  process.env.OBSERRA_PORTFOLIO_WORKER_COUNT = "36";
  process.env.OBSERRA_APPLICATION_WORKER_COUNT = "0";
  process.env.ACADEMY_COURSE_WORKER_COUNT = "36";
  process.env.ACADEMY_AUTHORING_CONCURRENCY = "36";
  process.env.ACADEMY_WORKER_MODE = "interchangeable-course-production";
  process.env.ACADEMY_EXPECTED_SURGE_COURSES = "60";

  const allocation = assertAcademyWorkerAllocation();
  const portfolio = academySurgePortfolio();
  record("portfolio worker total", portfolioWorkerCount === 36 && allocation.portfolioWorkerCount === 36, allocation.portfolioWorkerCount);
  record("application allocation disabled", applicationWorkerAllocation === 0 && allocation.applicationWorkerAllocation === 0, allocation.applicationWorkerAllocation);
  record("all workers allocated to Academy surge", courseWorkerAllocation === 36 && allocation.courseWorkerAllocation === 36, allocation.courseWorkerAllocation);
  record("authoring concurrency bounded at 36", allocation.concurrency === 36, allocation.concurrency);
  record("interchangeable worker mode", allocation.workerMode === workerMode, allocation.workerMode);
  record("owner-approved allocation authority", allocation.allocationAuthority === allocationAuthority, allocation.allocationAuthority);
  record("application work prohibited", allocation.applicationWorkAllowed === false);
  record("cross-role reassignment allowed", allocation.crossRoleReassignmentAllowed === true);
  record("publication authority not granted", allocation.publicationAuthorityGranted === false);
  record("interchangeable role catalog", interchangeableCourseRoles.length >= 12, interchangeableCourseRoles.length);
  record("mandatory contract domains", mandatoryContractDomains.length >= 10, mandatoryContractDomains.length);

  const roster = Array.from({ length: 36 }, (_, index) =>
    workerDescriptor(index + 1, interchangeableCourseRoles[index % interchangeableCourseRoles.length]),
  );
  record("36-worker roster generated", roster.length === 36, roster.length);
  record("worker identities unique", new Set(roster.map((worker) => worker.workerName)).size === 36);
  record("all workers interchangeable", roster.every((worker) => worker.interchangeable === true));
  record("all workers receive complete capability catalog", roster.every((worker) => worker.capabilities.length === interchangeableCourseRoles.length));
  record("no worker has application authority", roster.every((worker) => worker.applicationWorkAllowed === false));
  record("no worker has publication authority", roster.every((worker) => worker.publicationAuthorityGranted === false));

  record("exactly 60 standard Academy courses selected", portfolio.selectedCourses.length === 60, portfolio.selectedCourses.length);
  record("PMP excluded from 36-worker surge", portfolio.excludedCourseIds.includes("pmp-exam-prep-business-application"), portfolio.excludedCourseIds);
  record("portfolio contains 61 governed manifests", portfolio.discoveredManifests === 61, portfolio.discoveredManifests);
  record("selected course ids unique", new Set(portfolio.selectedCourseIds).size === 60);

  const requiredFiles = [
    "studio/academy-course-portfolio.mjs",
    "studio/academy-worker-contract.mjs",
    "studio/academy-hollywood-checkpoints.mjs",
    "studio/prepare-hollywood-source-context.mjs",
    "studio/audit-hollywood-course-readiness.mjs",
    "studio/author-course-hollywood.mjs",
    "studio/author-course-hollywood-with-checkpoint.mjs",
    "studio/author-courses-hollywood-parallel.mjs",
    "studio/materialize-hollywood-course-assets.mjs",
    "studio/validate-academy-hollywood-surge.mjs",
    "studio/submit-hollywood-media-jobs.mjs",
    "studio/load-academy-hollywood-surge-to-lcms.mjs",
    "studio/stage-courses-for-release-approval.mjs",
    "studio/preflight-academy-hollywood-provider.mjs",
    "studio/bootstrap-academy-hollywood-checkpoints.mjs",
    "studio/restore-academy-hollywood-checkpoints.mjs",
    ".github/workflows/academy-36-worker-hollywood-production.yml",
    "owner-command-center/electron/academy-studio.cjs",
    "owner-command-center/src/academy-batch.js",
    "docs/ACADEMY-36-WORKER-HOLLYWOOD-PRODUCTION-CONTRACT.md",
    "sources/authoritative-sources.json",
    "package.json",
  ];
  for (const relative of requiredFiles) record(`required asset ${relative}`, fs.existsSync(path.join(root, relative)));

  const authoring = read("studio/author-course-hollywood.mjs");
  for (const phrase of [
    "premium-documentary-cinematic",
    "applicabilityMatrix",
    "referenceApplications",
    "cinematicTreatment",
    "audioDescriptionPlan",
    "certificatePackage",
    "rightsAndLicensingPlan",
    "publicationBlockedUntilOwnerApproval",
    "Never fabricate a locator",
    "at least 1,200 words",
    "at least 30 original questions",
  ]) record(`cinematic authoring requirement ${phrase}`, authoring.includes(phrase));

  const sourcePreparation = read("studio/prepare-hollywood-source-context.mjs");
  for (const phrase of [
    "sources/authoritative-sources.json",
    "exactLocatorRequiredWhenSupplied",
    "inventedLocatorProhibited",
    "whereItAppliesAndDoesNotApplyRequired",
    "sourceCardsRequiredInCinematicMedia",
  ]) record(`source preparation requirement ${phrase}`, sourcePreparation.includes(phrase));

  const materializer = read("studio/materialize-hollywood-course-assets.mjs");
  for (const phrase of [
    "instructor-manuscript.md",
    "learner-guide.md",
    "learner-workbook.md",
    "assessment-bank.json",
    "answer-key.json",
    "certificate-template.html",
    "certificate-template.svg",
    "artifact-manifest.json",
    "publicationAuthorized: false",
  ]) record(`materialization requirement ${phrase}`, materializer.includes(phrase));

  const validation = read("studio/validate-academy-hollywood-surge.mjs");
  for (const phrase of [
    "minimumExactAuthoritativeSources",
    "does-not-match-authoritative-registry",
    "applicability-matrix-missing-module",
    "missing-exact-authoritative-reference-application",
    "assessment-missing-module",
    "certificate-runtime-output-not-verified",
    "complianceStagingReadyCourses",
  ]) record(`surge validation requirement ${phrase}`, validation.includes(phrase));

  const loader = read("studio/load-academy-hollywood-surge-to-lcms.mjs");
  for (const phrase of [
    "Exactly 60 courses must pass",
    "status: \"REVIEW\"",
    "status: \"STAGED\"",
    "cinematic-production-plan",
    "planned-not-mastered",
    "publicationAuthorized: false",
    "academy.course.compliance_stage.load",
  ]) record(`protected LCMS staging requirement ${phrase}`, loader.includes(phrase));

  const staging = read("studio/stage-courses-for-release-approval.mjs");
  for (const phrase of [
    "ACADEMY_CORE_COURSE_TARGET || 60",
    "ACADEMY_SUPPLEMENTAL_COURSE_TARGET || 1",
    "60 core Academy courses plus the supplemental PMP course",
    "allStagedForOwnerApproval",
    "publicationAuthorized: false",
    "checkoutAuthorized: false",
    "ownerAcceptanceRecorded: false",
  ]) record(`release staging requirement ${phrase}`, staging.includes(phrase));

  const commandCenter = read("owner-command-center/electron/academy-studio.cjs");
  for (const phrase of [
    "academy-release-approval-gate.json",
    "stagedForOwnerApproval",
    "allStagedForOwnerApproval",
    "ownerDecisionRequired",
    "stage-approval",
    "Publication cannot be enabled from course metadata",
  ]) record(`Command Center release gate binding ${phrase}`, commandCenter.includes(phrase));

  const workflow = read(".github/workflows/academy-36-worker-hollywood-production.yml");
  for (const phrase of [
    "OBSERRA_PORTFOLIO_WORKER_COUNT: 36",
    "OBSERRA_APPLICATION_WORKER_COUNT: 0",
    "ACADEMY_COURSE_WORKER_COUNT: 36",
    "ACADEMY_AUTHORING_CONCURRENCY: 36",
    "ACADEMY_EXPECTED_SURGE_COURSES: 60",
    "ACADEMY_EXPECTED_REVIEW_COURSES: 61",
    "Prepare exact authoritative source context",
    "Materialize protected learner materials, exams, media plans, and certificates",
    "Validate exact 60-course compliance staging contract",
    "Stage exactly 60 protected courses in the LCMS",
    "Update owner notification issue",
  ]) record(`production workflow requirement ${phrase}`, workflow.includes(phrase));

  const packageJson = JSON.parse(read("package.json"));
  const scripts = packageJson.scripts ?? {};
  record("worker contract package command", scripts["verify:academy-worker-contract"] === "node studio/verify-academy-worker-contract.mjs", scripts["verify:academy-worker-contract"]);
  record("source context command", scripts["prepare:sources:hollywood"] === "node studio/prepare-hollywood-source-context.mjs", scripts["prepare:sources:hollywood"]);
  record("parallel authoring uses 36-worker coordinator", scripts["author:parallel:hollywood"] === "node studio/author-courses-hollywood-parallel.mjs", scripts["author:parallel:hollywood"]);
  record("materialization command", scripts["materialize:hollywood"] === "node studio/materialize-hollywood-course-assets.mjs", scripts["materialize:hollywood"]);
  record("exact surge validation command", scripts["validate:hollywood:surge"] === "node studio/validate-academy-hollywood-surge.mjs", scripts["validate:hollywood:surge"]);
  record("protected LCMS dry-run command", scripts["load:hollywood:check"] === "node studio/load-academy-hollywood-surge-to-lcms.mjs --dry-run", scripts["load:hollywood:check"]);
  record("protected LCMS load command", scripts["load:hollywood"] === "node studio/load-academy-hollywood-surge-to-lcms.mjs", scripts["load:hollywood"]);
  record("61-course release approval status command", scripts["stage:release-approval"] === "node studio/stage-courses-for-release-approval.mjs", scripts["stage:release-approval"]);
  record("full cinematic production command", [
    "prepare:sources:hollywood",
    "author:parallel:hollywood",
    "materialize:hollywood",
    "validate:hollywood:surge",
    "media:submit:hollywood",
    "load:hollywood",
    "stage:release-approval",
  ].every((name) => String(scripts["build:all:hollywood"] ?? "").includes(name)), scripts["build:all:hollywood"]);
  record("public verification binds worker contract", String(scripts["verify:public"] ?? "").includes("verify:academy-worker-contract"), scripts["verify:public"]);
  record("CI binds worker contract", String(scripts.ci ?? "").includes("verify:academy-worker-contract"), scripts.ci);

  const report = {
    schemaVersion: "2.0",
    verifiedAt: new Date().toISOString(),
    gate: "academy-36-worker-interchangeable-course-production",
    surgePortfolioDefinition: "exactly 60 standard Academy courses",
    ownerReleasePortfolioDefinition: "60 standard Academy courses plus the supplemental PMP course",
    selectedSurgeCourses: portfolio.selectedCourses.length,
    excludedCourseIds: portfolio.excludedCourseIds,
    discoveredGovernedManifests: portfolio.discoveredManifests,
    portfolioWorkerCount,
    applicationWorkerAllocation,
    courseWorkerAllocation,
    workerMode,
    interchangeableRoles: interchangeableCourseRoles.length,
    mandatoryContractDomains: mandatoryContractDomains.length,
    rosterSize: roster.length,
    applicationWorkAllowed: false,
    publicationAuthorityGranted: false,
    ready: checks.every((check) => check.passed),
    checkCount: checks.length,
    passedCount: checks.filter((check) => check.passed).length,
    checks,
    claimBoundary: "This verification proves source-level worker allocation, exact 60-course surge selection, authoritative-source binding, concrete protected asset materialization, LCMS compliance staging, the separate 61-course owner-release gate, and Command Center visibility. It does not prove provider execution, course generation, media mastering, owner approval, publication, or endpoint installation.",
  };
  fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
  fs.writeFileSync(path.join(root, "catalog", "academy-worker-contract-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const [name, value] of Object.entries({
    OBSERRA_PORTFOLIO_WORKER_COUNT: original.portfolio,
    OBSERRA_APPLICATION_WORKER_COUNT: original.application,
    ACADEMY_COURSE_WORKER_COUNT: original.course,
    ACADEMY_AUTHORING_CONCURRENCY: original.concurrency,
    ACADEMY_WORKER_MODE: original.mode,
    ACADEMY_EXPECTED_SURGE_COURSES: original.expectedSurge,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
