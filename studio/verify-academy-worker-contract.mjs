import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
};
const checks = [];

function record(name, condition, detail = null) {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  assert.ok(passed, `${name}${detail ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

try {
  process.env.OBSERRA_PORTFOLIO_WORKER_COUNT = "36";
  process.env.OBSERRA_APPLICATION_WORKER_COUNT = "0";
  process.env.ACADEMY_COURSE_WORKER_COUNT = "36";
  process.env.ACADEMY_AUTHORING_CONCURRENCY = "36";
  process.env.ACADEMY_WORKER_MODE = "interchangeable-course-production";

  const allocation = assertAcademyWorkerAllocation();
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

  const requiredFiles = [
    "studio/author-course-hollywood.mjs",
    "studio/author-course-hollywood-with-checkpoint.mjs",
    "studio/author-courses-hollywood-parallel.mjs",
    "studio/audit-hollywood-course-readiness.mjs",
    "studio/validate-hollywood-course-contract.mjs",
    "studio/submit-hollywood-media-jobs.mjs",
    "studio/stage-courses-for-release-approval.mjs",
    "studio/academy-hollywood-checkpoints.mjs",
    "studio/preflight-academy-hollywood-provider.mjs",
    "studio/bootstrap-academy-hollywood-checkpoints.mjs",
    "studio/restore-academy-hollywood-checkpoints.mjs",
    ".github/workflows/academy-36-worker-hollywood-production.yml",
    "owner-command-center/electron/academy-studio.cjs",
    "owner-command-center/src/academy-batch.js",
    "owner-command-center/scripts/verify-academy-action-runtime.mjs",
    "docs/ACADEMY-36-WORKER-HOLLYWOOD-PRODUCTION-CONTRACT.md",
    "package.json",
  ];
  for (const relative of requiredFiles) {
    record(`required asset ${relative}`, fs.existsSync(path.join(root, relative)));
  }

  const authoring = fs.readFileSync(path.join(root, "studio/author-course-hollywood.mjs"), "utf8");
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
  ]) {
    record(`cinematic authoring requirement ${phrase}`, authoring.includes(phrase));
  }

  const staging = fs.readFileSync(path.join(root, "studio/stage-courses-for-release-approval.mjs"), "utf8");
  for (const phrase of [
    "ACADEMY_CORE_COURSE_TARGET || 60",
    "ACADEMY_SUPPLEMENTAL_COURSE_TARGET || 1",
    "ACADEMY_RELEASE_APPROVAL_ISSUE || 27",
    "60 core Academy courses plus the supplemental PMP course",
    "allStagedForOwnerApproval",
    "publicationAuthorized: false",
    "checkoutAuthorized: false",
    "ownerAcceptanceRecorded: false",
    "release-approval-evidence.json",
    "--require-all",
  ]) {
    record(`release staging requirement ${phrase}`, staging.includes(phrase));
  }

  const commandCenter = fs.readFileSync(path.join(root, "owner-command-center/electron/academy-studio.cjs"), "utf8");
  for (const phrase of [
    "academy-release-approval-gate.json",
    "stagedForOwnerApproval",
    "allStagedForOwnerApproval",
    "ownerDecisionRequired",
    "stage-approval",
    "Publication cannot be enabled from course metadata",
  ]) {
    record(`Command Center release gate binding ${phrase}`, commandCenter.includes(phrase));
  }

  const renderer = fs.readFileSync(path.join(root, "owner-command-center/src/academy-batch.js"), "utf8");
  for (const phrase of [
    "RELEASE APPROVAL GATE",
    "READY FOR OWNER APPROVAL",
    "stage-approval",
    "Publication",
    "Checkout",
  ]) {
    record(`Command Center release gate display ${phrase}`, renderer.includes(phrase));
  }

  const workflow = fs.readFileSync(path.join(root, ".github/workflows/academy-36-worker-hollywood-production.yml"), "utf8");
  for (const phrase of [
    "OBSERRA_PORTFOLIO_WORKER_COUNT: 36",
    "OBSERRA_APPLICATION_WORKER_COUNT: 0",
    "ACADEMY_COURSE_WORKER_COUNT: 36",
    "ACADEMY_AUTHORING_CONCURRENCY: 36",
    "ACADEMY_EXPECTED_REVIEW_COURSES: 61",
    "ACADEMY_CORE_COURSE_TARGET: 60",
    "ACADEMY_SUPPLEMENTAL_COURSE_TARGET: 1",
    "ACADEMY_RELEASE_APPROVAL_ISSUE: 27",
    "Launch up to 36 interchangeable course workers",
    "Update owner notification issue",
    "All governed Academy courses are staged for explicit owner release approval",
  ]) {
    record(`production workflow requirement ${phrase}`, workflow.includes(phrase));
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = packageJson.scripts ?? {};
  record("worker contract package command", scripts["verify:academy-worker-contract"] === "node studio/verify-academy-worker-contract.mjs", scripts["verify:academy-worker-contract"]);
  record("direct authoring uses protected cinematic wrapper", scripts["author:course"] === "node studio/author-course-hollywood-with-checkpoint.mjs", scripts["author:course"]);
  record("parallel authoring uses 36-worker coordinator", scripts["author:parallel:hollywood"] === "node studio/author-courses-hollywood-parallel.mjs", scripts["author:parallel:hollywood"]);
  record("release approval status command", scripts["stage:release-approval"] === "node studio/stage-courses-for-release-approval.mjs", scripts["stage:release-approval"]);
  record("release approval enforcement command", scripts["stage:release-approval:require"] === "node studio/stage-courses-for-release-approval.mjs --require-all", scripts["stage:release-approval:require"]);
  record("full cinematic production command", String(scripts["build:all:hollywood"] ?? "").includes("author:parallel:hollywood") && String(scripts["build:all:hollywood"] ?? "").includes("stage:release-approval"), scripts["build:all:hollywood"]);
  record("public verification binds worker contract", String(scripts["verify:public"] ?? "").includes("verify:academy-worker-contract"), scripts["verify:public"]);
  record("CI binds worker contract", String(scripts.ci ?? "").includes("verify:academy-worker-contract"), scripts.ci);

  const report = {
    schemaVersion: "1.1",
    verifiedAt: new Date().toISOString(),
    gate: "academy-36-worker-interchangeable-course-production",
    portfolioDefinition: "60 core Academy courses plus the supplemental PMP course",
    expectedOwnerReviewCourses: 61,
    portfolioWorkerCount,
    applicationWorkerAllocation,
    courseWorkerAllocation,
    workerMode,
    interchangeableRoles: interchangeableCourseRoles.length,
    mandatoryContractDomains: mandatoryContractDomains.length,
    rosterSize: roster.length,
    ownerReleaseApprovalIssue: 27,
    applicationWorkAllowed: false,
    publicationAuthorityGranted: false,
    ready: checks.every((check) => check.passed),
    checkCount: checks.length,
    passedCount: checks.filter((check) => check.passed).length,
    checks,
    claimBoundary: "This verification proves source-level worker allocation, complete-portfolio course-production binding, staging-gate binding, and Command Center visibility. It does not prove course generation, media mastering, release staging, owner approval, publication, or endpoint installation.",
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
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
