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
const originalEnvironment = {
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
  assert.ok(
    passed,
    `${name}${detail === null ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`,
  );
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function restoreEnvironment() {
  const mapping = {
    OBSERRA_PORTFOLIO_WORKER_COUNT: originalEnvironment.portfolio,
    OBSERRA_APPLICATION_WORKER_COUNT: originalEnvironment.application,
    ACADEMY_COURSE_WORKER_COUNT: originalEnvironment.course,
    ACADEMY_AUTHORING_CONCURRENCY: originalEnvironment.concurrency,
    ACADEMY_WORKER_MODE: originalEnvironment.mode,
    ACADEMY_EXPECTED_SURGE_COURSES: originalEnvironment.expectedSurge,
  };
  for (const [name, value] of Object.entries(mapping)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function parseVersion(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function atLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

try {
  process.env.OBSERRA_PORTFOLIO_WORKER_COUNT = String(portfolioWorkerCount);
  process.env.OBSERRA_APPLICATION_WORKER_COUNT = String(applicationWorkerAllocation);
  process.env.ACADEMY_COURSE_WORKER_COUNT = String(courseWorkerAllocation);
  process.env.ACADEMY_AUTHORING_CONCURRENCY = String(courseWorkerAllocation);
  process.env.ACADEMY_WORKER_MODE = workerMode;
  process.env.ACADEMY_EXPECTED_SURGE_COURSES = "60";

  const allocation = assertAcademyWorkerAllocation();
  const portfolio = academySurgePortfolio();

  record(
    "worker allocations reconcile to the governed portfolio",
    applicationWorkerAllocation + courseWorkerAllocation === portfolioWorkerCount,
    { portfolioWorkerCount, applicationWorkerAllocation, courseWorkerAllocation },
  );
  record("allocation authority is explicit", Boolean(allocationAuthority), allocationAuthority);
  record("worker mode is explicit", allocation.workerMode === workerMode, allocation.workerMode);
  record("authoring concurrency is bounded", allocation.concurrency >= 1 && allocation.concurrency <= courseWorkerAllocation, allocation.concurrency);
  record("publication authority is not granted", allocation.publicationAuthorityGranted === false);
  record("interchangeable role catalog is substantive", interchangeableCourseRoles.length >= 12, interchangeableCourseRoles.length);
  record("mandatory course contract domains are substantive", mandatoryContractDomains.length >= 10, mandatoryContractDomains.length);

  const roster = Array.from({ length: courseWorkerAllocation }, (_, index) =>
    workerDescriptor(
      index + 1,
      interchangeableCourseRoles[index % interchangeableCourseRoles.length],
    ),
  );
  record("course worker roster generated", roster.length === courseWorkerAllocation, roster.length);
  record("course worker identities are unique", new Set(roster.map((worker) => worker.workerName)).size === roster.length);
  record("workers receive the approved capability catalog", roster.every((worker) => worker.capabilities.length === interchangeableCourseRoles.length));
  record("workers cannot publish courses", roster.every((worker) => worker.publicationAuthorityGranted === false));

  record("exactly 60 standard Academy courses selected", portfolio.selectedCourses.length === 60, portfolio.selectedCourses.length);
  record("supplemental PMP course is excluded from the core surge", portfolio.excludedCourseIds.includes("pmp-exam-prep-business-application"), portfolio.excludedCourseIds);
  record("portfolio contains 61 governed manifests", portfolio.discoveredManifests === 61, portfolio.discoveredManifests);
  record("selected course identities are unique", new Set(portfolio.selectedCourseIds).size === portfolio.selectedCourseIds.length);

  const requiredFiles = [
    "studio/academy-course-portfolio.mjs",
    "studio/academy-worker-contract.mjs",
    "studio/author-courses-hollywood-parallel.mjs",
    "studio/validate-academy-hollywood-surge.mjs",
    "studio/generate-hollywood-learner-catalog.mjs",
    "studio/load-academy-hollywood-surge-to-lcms.mjs",
    "studio/stage-courses-for-release-approval.mjs",
    "studio/preflight-academy-hollywood-provider.mjs",
    ".github/workflows/academy-36-worker-hollywood-production.yml",
    "owner-command-center/electron/bootstrap-main.cjs",
    "owner-command-center/electron/main-with-remediation.cjs",
    "owner-command-center/electron/academy-release-approval.cjs",
    "owner-command-center/electron/academy-github-evidence.cjs",
    "owner-command-center/electron/academy-production-evidence.cjs",
    "owner-command-center/scripts/verify-packaged-startup-contract.mjs",
    "owner-command-center/package.json",
    "docs/ACADEMY-36-WORKER-HOLLYWOOD-PRODUCTION-CONTRACT.md",
    "package.json",
  ];
  for (const relativePath of requiredFiles) {
    record(`required asset ${relativePath}`, fs.existsSync(path.join(root, relativePath)));
  }

  const rootPackage = JSON.parse(read("package.json"));
  record(
    "worker contract package command",
    rootPackage.scripts?.["verify:academy-worker-contract"] === "node studio/verify-academy-worker-contract.mjs",
    rootPackage.scripts?.["verify:academy-worker-contract"],
  );
  record(
    "public verification binds the worker contract",
    String(rootPackage.scripts?.["verify:public"] || "").includes("verify:academy-worker-contract"),
    rootPackage.scripts?.["verify:public"],
  );

  const commandCenterPackage = JSON.parse(read("owner-command-center/package.json"));
  record(
    "Command Center generation is current",
    atLeast(commandCenterPackage.version, "0.4.1"),
    commandCenterPackage.version,
  );
  record("Command Center uses the resilient bootstrap", commandCenterPackage.main === "electron/bootstrap-main.cjs", commandCenterPackage.main);
  record("desktop shortcut is recreated on install and reinstall", commandCenterPackage.build?.nsis?.createDesktopShortcut === "always", commandCenterPackage.build?.nsis?.createDesktopShortcut);
  record("start menu shortcut is enabled", commandCenterPackage.build?.nsis?.createStartMenuShortcut === true);
  record("installation directory remains selectable", commandCenterPackage.build?.nsis?.allowToChangeInstallationDirectory === true);
  record("normal compression favors install and startup speed", commandCenterPackage.build?.compression === "normal", commandCenterPackage.build?.compression);
  record("startup compatibility verification is bound", String(commandCenterPackage.scripts?.verify || "").includes("verify-packaged-startup-contract.mjs"), commandCenterPackage.scripts?.verify);

  const bootstrap = read("owner-command-center/electron/bootstrap-main.cjs");
  record("native ESM electron-store loads asynchronously", bootstrap.includes('await import("electron-store")'));
  record("CommonJS main process receives the ESM compatibility constructor", bootstrap.includes("installElectronStoreCompatibility"));
  record("startup diagnostics are retained", bootstrap.includes("startup-health.json"));
  record("startup smoke testing is supported", bootstrap.includes("OBSERRA_STARTUP_SMOKE_TEST"));
  record("renderer recovery is bounded", bootstrap.includes("rendererRecoveryAttempts"));

  const report = {
    schemaVersion: "3.0",
    verifiedAt: new Date().toISOString(),
    gate: "academy-worker-and-command-center-contract",
    portfolioWorkerCount,
    applicationWorkerAllocation,
    courseWorkerAllocation,
    selectedSurgeCourses: portfolio.selectedCourses.length,
    discoveredGovernedManifests: portfolio.discoveredManifests,
    commandCenterVersion: commandCenterPackage.version,
    checks,
    passed: checks.every((check) => check.passed),
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  restoreEnvironment();
}
