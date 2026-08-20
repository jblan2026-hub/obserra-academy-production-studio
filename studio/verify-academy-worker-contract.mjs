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
    "studio/academy-media-checkpoints.mjs",
    "studio/bootstrap-academy-hollywood-checkpoints.mjs",
    "studio/bootstrap-academy-media-checkpoints.mjs",
    "studio/restore-academy-hollywood-checkpoints.mjs",
    "studio/restore-academy-media-checkpoints.mjs",
    "studio/prepare-hollywood-source-context.mjs",
    "studio/audit-hollywood-course-readiness.mjs",
    "studio/author-course-hollywood.mjs",
    "studio/author-course-hollywood-with-checkpoint.mjs",
    "studio/author-courses-hollywood-parallel.mjs",
    "studio/materialize-hollywood-course-assets.mjs",
    "studio/validate-academy-hollywood-surge.mjs",
    "studio/generate-hollywood-learner-catalog.mjs",
    "studio/submit-hollywood-media-jobs.mjs",
    "studio/checkpoint-academy-media-jobs.mjs",
    "studio/reconcile-hollywood-media-results.mjs",
    "studio/verify-hollywood-final-media.mjs",
    "studio/load-academy-hollywood-surge-to-lcms.mjs",
    "studio/stage-courses-for-release-approval.mjs",
    "studio/preflight-academy-hollywood-provider.mjs",
    ".github/workflows/academy-36-worker-hollywood-production.yml",
    "owner-command-center/electron/academy-release-approval.cjs",
    "owner-command-center/electron/academy-github-evidence.cjs",
    "owner-command-center/electron/academy-production-evidence.cjs",
    "owner-command-center/electron/main-with-remediation.cjs",
    "owner-command-center/src/academy-github-evidence.js",
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

  const protectedCatalog = read("studio/generate-hollywood-learner-catalog.mjs");
  for (const phrase of [
    "expectedCourses: 61",
    "academy-learner-course-catalog.json",
    "learner-catalog-readiness.json",
    "60 core Academy courses plus the supplemental PMP course",
    "publicationAuthorized: false",
    "checkoutAuthorized: false",
  ]) record(`protected learner catalog requirement ${phrase}`, protectedCatalog.includes(phrase));

  const mediaSubmission = read("studio/submit-hollywood-media-jobs.mjs");
  for (const phrase of [
    "ACADEMY_CINEMATIC_TEMPLATE_APPROVED",
    "Media submission requires exactly 60 compliance-staged courses",
    "ACADEMY_MEDIA_MAX_SCRIPT_CHARS",
    "preserved-submitted",
    "academy-media-job.json",
    "publicationAuthorized: false",
  ]) record(`media submission requirement ${phrase}`, mediaSubmission.includes(phrase));

  const mediaCheckpoints = read("studio/academy-media-checkpoints.mjs");
  for (const phrase of [
    "AcademyHollywoodMediaJobCheckpoint",
    "persistMediaJobCheckpoint",
    "restoreMediaJobCheckpoints",
    "publicationAuthorized !== false",
    "scriptHash",
  ]) record(`media checkpoint requirement ${phrase}`, mediaCheckpoints.includes(phrase));

  const mediaReconciliation = read("studio/reconcile-hollywood-media-results.mjs");
  for (const phrase of [
    "api.synthesia.io/v2/videos",
    "api.heygen.com/v1/video_status.get",
    "academy-course-media",
    "public: false",
    "supabase://",
    "ffmpeg",
    "captions.vtt",
    "audio-description.md",
    "media-rights-ledger",
    "publicationAuthorized: false",
  ]) record(`media reconciliation requirement ${phrase}`, mediaReconciliation.includes(phrase));

  const finalMedia = read("studio/verify-hollywood-final-media.mjs");
  for (const phrase of [
    "expectedCourses: portfolio.expectedCourses",
    "audio-verification-failed",
    "invalid-vtt-header",
    "module-not-assembled-and-archived",
    "module-media-not-registered-in-lcms",
    "private-storage-receipts-incomplete",
    "publicationAuthorized: false",
  ]) record(`final media verification requirement ${phrase}`, finalMedia.includes(phrase));

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
    "schemaVersion: \"1.1\"",
    "ACADEMY_CORE_COURSE_TARGET || 60",
    "ACADEMY_SUPPLEMENTAL_COURSE_TARGET || 1",
    "60 core Academy courses plus the supplemental PMP course",
    "allStagedForOwnerApproval",
    "publicationAuthorized: false",
    "checkoutAuthorized: false",
    "ownerAcceptanceRecorded: false",
  ]) record(`release staging requirement ${phrase}`, staging.includes(phrase));

  const releaseApproval = read("owner-command-center/electron/academy-release-approval.cjs");
  for (const phrase of [
    "const GATE_SCHEMA_VERSION = \"1.1\"",
    "allStagedForOwnerApproval",
    "publicationAuthorized !== false",
    "checkoutAuthorized !== false",
    "portfolioWorkerCount",
    "courseWorkerAllocation",
    "applicationWorkerAllocation",
    "interchangeable-course-production",
    "createHmac(\"sha256\"",
    "endpointReady",
    "deviceFingerprint",
    "APPROVE ${expectedCourses} COURSES FOR RELEASE",
  ]) record(`device-bound approval requirement ${phrase}`, releaseApproval.includes(phrase));

  const githubEvidence = read("owner-command-center/electron/academy-github-evidence.cjs");
  for (const phrase of [
    "DEFAULT_BRANCH = \"agent/academy-36-worker-hollywood-production\"",
    "DEFAULT_WORKFLOW = \"academy-36-worker-hollywood-production.yml\"",
    "MAX_ARTIFACT_BYTES",
    "MAX_SELECTED_BYTES",
    "DECISION_MARKER",
    "academy-release-approval-gate.json",
    "learner-catalog-readiness.json",
    "GitHub owner token is not configured",
    "X-GitHub-Api-Version",
  ]) record(`authenticated GitHub evidence requirement ${phrase}`, githubEvidence.includes(phrase));

  const productionEvidence = read("owner-command-center/electron/academy-production-evidence.cjs");
  for (const phrase of [
    "releaseGate: \"academy-release-approval-gate.json\"",
    "ownerDecision: \"academy-owner-release-decision.json\"",
    "learnerCatalog: \"learner-catalog-readiness.json\"",
    "allStagedForOwnerApproval",
    "ownerDecisionMatchesGate",
    "controlPlaneOperational",
    "productionOperational",
    "publicationLocked",
  ]) record(`Command Center production evidence requirement ${phrase}`, productionEvidence.includes(phrase));

  const workflow = read(".github/workflows/academy-36-worker-hollywood-production.yml");
  for (const phrase of [
    "OBSERRA_PORTFOLIO_WORKER_COUNT: 36",
    "OBSERRA_APPLICATION_WORKER_COUNT: 0",
    "ACADEMY_COURSE_WORKER_COUNT: 36",
    "ACADEMY_AUTHORING_CONCURRENCY: 36",
    "ACADEMY_EXPECTED_SURGE_COURSES: 60",
    "ACADEMY_EXPECTED_REVIEW_COURSES: 61",
    "ACADEMY_CINEMATIC_TEMPLATE_APPROVED",
    "SUPABASE_SECRET_KEY",
    "Prepare exact authoritative source context",
    "Restore protected cinematic media job checkpoints",
    "Materialize protected learner materials, exams, media plans, and certificates",
    "Validate exact 60-course compliance staging contract",
    "Preserve exact core 60 compliance evidence",
    "Stage exactly 60 protected courses in the LCMS",
    "Generate protected 61-course learner catalog readiness",
    "Reconcile, assemble, archive, and register final cinematic media",
    "Verify every final module video and accessibility package",
    "Update owner notification issue",
    "catalog/learner-catalog-readiness.json",
  ]) record(`production workflow requirement ${phrase}`, workflow.includes(phrase));

  const packageJson = JSON.parse(read("package.json"));
  const scripts = packageJson.scripts ?? {};
  record("worker contract package command", scripts["verify:academy-worker-contract"] === "node studio/verify-academy-worker-contract.mjs", scripts["verify:academy-worker-contract"]);
  record("source context command", scripts["prepare:sources:hollywood"] === "node studio/prepare-hollywood-source-context.mjs", scripts["prepare:sources:hollywood"]);
  record("parallel authoring uses 36-worker coordinator", scripts["author:parallel:hollywood"] === "node studio/author-courses-hollywood-parallel.mjs", scripts["author:parallel:hollywood"]);
  record("materialization command", scripts["materialize:hollywood"] === "node studio/materialize-hollywood-course-assets.mjs", scripts["materialize:hollywood"]);
  record("exact surge validation command", scripts["validate:hollywood:surge"] === "node studio/validate-academy-hollywood-surge.mjs", scripts["validate:hollywood:surge"]);
  record("protected learner catalog command", scripts["catalog:hollywood:protected"] === "node studio/generate-hollywood-learner-catalog.mjs", scripts["catalog:hollywood:protected"]);
  record("media checkpoint bootstrap command", scripts["db:bootstrap:hollywood-media-checkpoints"] === "node studio/bootstrap-academy-media-checkpoints.mjs", scripts["db:bootstrap:hollywood-media-checkpoints"]);
  record("media checkpoint restore command", scripts["restore:hollywood-media-checkpoints"] === "node studio/restore-academy-media-checkpoints.mjs", scripts["restore:hollywood-media-checkpoints"]);
  record("media checkpoint persistence command", scripts["checkpoint:hollywood-media"] === "node studio/checkpoint-academy-media-jobs.mjs", scripts["checkpoint:hollywood-media"]);
  record("media reconciliation command", scripts["reconcile:hollywood-media"] === "node studio/reconcile-hollywood-media-results.mjs", scripts["reconcile:hollywood-media"]);
  record("final media verification command", scripts["verify:hollywood-final-media"] === "node studio/verify-hollywood-final-media.mjs", scripts["verify:hollywood-final-media"]);
  record("protected LCMS dry-run command", scripts["load:hollywood:check"] === "node studio/load-academy-hollywood-surge-to-lcms.mjs --dry-run", scripts["load:hollywood:check"]);
  record("protected LCMS load command", scripts["load:hollywood"] === "node studio/load-academy-hollywood-surge-to-lcms.mjs", scripts["load:hollywood"]);
  record("61-course release approval status command", scripts["stage:release-approval"] === "node studio/stage-courses-for-release-approval.mjs", scripts["stage:release-approval"]);
  record("full cinematic production command", [
    "prepare:sources:hollywood",
    "author:parallel:hollywood",
    "materialize:hollywood",
    "validate:hollywood:surge",
    "load:hollywood",
    "catalog:hollywood:protected",
    "media:submit:hollywood",
    "checkpoint:hollywood-media",
    "reconcile:hollywood-media",
    "verify:hollywood-final-media",
    "stage:release-approval",
  ].every((name) => String(scripts["build:all:hollywood"] ?? "").includes(name)), scripts["build:all:hollywood"]);
  record("public verification binds worker contract", String(scripts["verify:public"] ?? "").includes("verify:academy-worker-contract"), scripts["verify:public"]);
  record("CI binds worker contract", String(scripts.ci ?? "").includes("verify:academy-worker-contract"), scripts.ci);

  const commandCenterPackage = JSON.parse(read("owner-command-center/package.json"));
  record("current Command Center generation preserved", commandCenterPackage.version === "0.3.3", commandCenterPackage.version);
  record("current Command Center verification preserved", String(commandCenterPackage.scripts?.verify ?? "").includes("verify-academy-github-evidence.mjs"), commandCenterPackage.scripts?.verify);
  record("current device-bound approval verification preserved", String(commandCenterPackage.scripts?.verify ?? "").includes("verify-academy-release-approval.mjs"), commandCenterPackage.scripts?.verify);

  const report = {
    schemaVersion: "2.2",
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
    commandCenterVersion: commandCenterPackage.version,
    applicationWorkAllowed: false,
    publicationAuthorityGranted: false,
    ready: checks.every((check) => check.passed),
    checkCount: checks.length,
    passedCount: checks.filter((check) => check.passed).length,
    checks,
    claimBoundary: "This verification proves source-level worker allocation, exact 60-course surge selection, protected 61-course learner-catalog evidence, authoritative-source binding, concrete protected asset materialization, resumable provider media jobs, private-storage reconciliation, final media verification, LCMS compliance staging, the separate 61-course owner-release gate, authenticated GitHub evidence synchronization, and device-bound owner decisions. It does not prove provider execution, course generation, media mastering, owner approval, publication, or endpoint installation.",
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
