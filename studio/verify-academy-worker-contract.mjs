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
const checks = [];
const original = {
  portfolio: process.env.OBSERRA_PORTFOLIO_WORKER_COUNT,
  application: process.env.OBSERRA_APPLICATION_WORKER_COUNT,
  course: process.env.ACADEMY_COURSE_WORKER_COUNT,
  concurrency: process.env.ACADEMY_AUTHORING_CONCURRENCY,
  mode: process.env.ACADEMY_WORKER_MODE,
  expectedSurge: process.env.ACADEMY_EXPECTED_SURGE_COURSES,
};

function record(name, condition, detail = null) {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  assert.ok(passed, `${name}${detail == null ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
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
  record("application worker allocation disabled", applicationWorkerAllocation === 0 && allocation.applicationWorkerAllocation === 0, allocation.applicationWorkerAllocation);
  record("course worker allocation", courseWorkerAllocation === 36 && allocation.courseWorkerAllocation === 36, allocation.courseWorkerAllocation);
  record("authoring concurrency bounded", allocation.concurrency === 36, allocation.concurrency);
  record("interchangeable worker mode", allocation.workerMode === workerMode, allocation.workerMode);
  record("owner-approved allocation authority", allocation.allocationAuthority === allocationAuthority, allocation.allocationAuthority);
  record("application work prohibited", allocation.applicationWorkAllowed === false);
  record("publication authority not granted", allocation.publicationAuthorityGranted === false);
  record("interchangeable role catalog", interchangeableCourseRoles.length >= 12, interchangeableCourseRoles.length);
  record("mandatory contract domains", mandatoryContractDomains.length >= 10, mandatoryContractDomains.length);

  const roster = Array.from({ length: 36 }, (_, index) => workerDescriptor(index + 1, interchangeableCourseRoles[index % interchangeableCourseRoles.length]));
  record("36 worker descriptors generated", roster.length === 36);
  record("worker identities unique", new Set(roster.map((worker) => worker.workerName)).size === 36);
  record("workers remain interchangeable", roster.every((worker) => worker.interchangeable === true));
  record("workers have no publication authority", roster.every((worker) => worker.publicationAuthorityGranted === false));

  record("60 standard courses remain in surge portfolio", portfolio.selectedCourses.length === 60, portfolio.selectedCourses.length);
  record("supplemental PMP excluded from core surge", portfolio.excludedCourseIds.includes("pmp-exam-prep-business-application"), portfolio.excludedCourseIds);
  record("61 governed manifests remain discoverable", portfolio.discoveredManifests === 61, portfolio.discoveredManifests);

  for (const relative of [
    "studio/academy-course-portfolio.mjs",
    "studio/academy-worker-contract.mjs",
    "studio/academy-hollywood-checkpoints.mjs",
    "studio/academy-media-checkpoints.mjs",
    "studio/author-courses-hollywood-parallel.mjs",
    "studio/materialize-hollywood-course-assets.mjs",
    "studio/validate-academy-hollywood-surge.mjs",
    "studio/verify-hollywood-final-media.mjs",
    "studio/stage-courses-for-release-approval.mjs",
    "studio/initialize-course-versions.mjs",
    "studio/verify-course-versioning.mjs",
    "policy/academy-course-versioning.json",
    "policy/academy-course-identity-and-certificate-naming.json",
    "owner-command-center/electron/academy-release-approval.cjs",
    "owner-command-center/electron/academy-production-evidence.cjs",
    "owner-command-center/electron/academy-website-retrieval.cjs",
    "owner-command-center/package.json",
    "package.json",
  ]) record(`required asset ${relative}`, exists(relative));

  const authoring = read("studio/author-course-hollywood.mjs");
  for (const phrase of [
    "publicationBlockedUntilOwnerApproval",
    "Never fabricate a locator",
    "rightsAndLicensingPlan",
    "audioDescriptionPlan",
    "certificatePackage",
  ]) record(`authoring control ${phrase}`, authoring.includes(phrase));

  const staging = read("studio/stage-courses-for-release-approval.mjs");
  for (const phrase of ["publicationAuthorized: false", "checkoutAuthorized: false", "ownerAcceptanceRecorded: false"]) {
    record(`release staging fail-closed ${phrase}`, staging.includes(phrase));
  }

  const packageJson = JSON.parse(read("package.json"));
  const scripts = packageJson.scripts ?? {};
  record("worker contract command", scripts["verify:academy-worker-contract"] === "node studio/verify-academy-worker-contract.mjs", scripts["verify:academy-worker-contract"]);
  record("public verification binds worker contract", String(scripts["verify:public"] ?? "").includes("verify:academy-worker-contract"), scripts["verify:public"]);
  record("CI binds worker contract", String(scripts.ci ?? "").includes("verify:academy-worker-contract"), scripts.ci);
  record("version verification is release-bound", String(scripts["verify:public"] ?? "").includes("verify:versions"), scripts["verify:public"]);

  const commandCenterPackage = JSON.parse(read("owner-command-center/package.json"));
  const [major, minor] = String(commandCenterPackage.version || "0.0.0").split(".").map(Number);
  record("Academy Command Center generation is current", Number.isInteger(major) && Number.isInteger(minor) && (major > 0 || minor >= 4), commandCenterPackage.version);
  record("Academy Command Center product identity", commandCenterPackage.name === "obserra-academy-command-center", commandCenterPackage.name);
  record("Command Center verification preserves GitHub evidence", String(commandCenterPackage.scripts?.verify ?? "").includes("verify-academy-github-evidence.mjs"), commandCenterPackage.scripts?.verify);
  record("Command Center verification preserves device-bound release approval", String(commandCenterPackage.scripts?.verify ?? "").includes("verify-academy-release-approval.mjs"), commandCenterPackage.scripts?.verify);
  record("Command Center verification preserves security controls", String(commandCenterPackage.scripts?.verify ?? "").includes("verify-payment-control-behavior.mjs") && String(commandCenterPackage.scripts?.verify ?? "").includes("verify-credential-encryption-controls.mjs"), commandCenterPackage.scripts?.verify);

  const report = {
    schemaVersion: "3.0",
    verifiedAt: new Date().toISOString(),
    gate: "academy-worker-and-owner-command-center-contract",
    selectedSurgeCourses: portfolio.selectedCourses.length,
    governedManifestCount: portfolio.discoveredManifests,
    portfolioWorkerCount,
    applicationWorkerAllocation,
    courseWorkerAllocation,
    workerMode,
    allocationAuthority,
    commandCenterVersion: commandCenterPackage.version,
    checks,
    passed: checks.every((check) => check.passed),
  };

  fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
  fs.writeFileSync(path.join(root, "catalog", "academy-worker-contract-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[Academy Studio] Worker and Academy Command Center contract verification passed: ${checks.length} checks.`);
} finally {
  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("OBSERRA_PORTFOLIO_WORKER_COUNT", original.portfolio);
  restore("OBSERRA_APPLICATION_WORKER_COUNT", original.application);
  restore("ACADEMY_COURSE_WORKER_COUNT", original.course);
  restore("ACADEMY_AUTHORING_CONCURRENCY", original.concurrency);
  restore("ACADEMY_WORKER_MODE", original.mode);
  restore("ACADEMY_EXPECTED_SURGE_COURSES", original.expectedSurge);
}
