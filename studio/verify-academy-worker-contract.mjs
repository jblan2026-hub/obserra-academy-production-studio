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

try {
  process.env.OBSERRA_PORTFOLIO_WORKER_COUNT = "36";
  process.env.OBSERRA_APPLICATION_WORKER_COUNT = "0";
  process.env.ACADEMY_COURSE_WORKER_COUNT = "36";
  process.env.ACADEMY_AUTHORING_CONCURRENCY = "36";
  process.env.ACADEMY_WORKER_MODE = "interchangeable-course-production";

  const allocation = assertAcademyWorkerAllocation();
  assert.equal(portfolioWorkerCount, 36);
  assert.equal(applicationWorkerAllocation, 0);
  assert.equal(courseWorkerAllocation, 36);
  assert.equal(allocation.portfolioWorkerCount, 36);
  assert.equal(allocation.applicationWorkerAllocation, 0);
  assert.equal(allocation.courseWorkerAllocation, 36);
  assert.equal(allocation.concurrency, 36);
  assert.equal(allocation.workerMode, workerMode);
  assert.equal(allocation.allocationAuthority, allocationAuthority);
  assert.equal(allocation.applicationWorkAllowed, false);
  assert.equal(allocation.crossRoleReassignmentAllowed, true);
  assert.equal(allocation.publicationAuthorityGranted, false);
  assert.ok(interchangeableCourseRoles.length >= 12);
  assert.ok(mandatoryContractDomains.length >= 10);

  const roster = Array.from({ length: 36 }, (_, index) =>
    workerDescriptor(index + 1, interchangeableCourseRoles[index % interchangeableCourseRoles.length]),
  );
  assert.equal(roster.length, 36);
  assert.equal(new Set(roster.map((worker) => worker.workerName)).size, 36);
  assert.ok(roster.every((worker) => worker.interchangeable === true));
  assert.ok(roster.every((worker) => worker.capabilities.length === interchangeableCourseRoles.length));
  assert.ok(roster.every((worker) => worker.applicationWorkAllowed === false));
  assert.ok(roster.every((worker) => worker.publicationAuthorityGranted === false));

  const requiredFiles = [
    "studio/author-course-hollywood.mjs",
    "studio/author-course-hollywood-with-checkpoint.mjs",
    "studio/author-courses-hollywood-parallel.mjs",
    "studio/audit-hollywood-course-readiness.mjs",
    "studio/validate-hollywood-course-contract.mjs",
    "studio/submit-hollywood-media-jobs.mjs",
    "studio/academy-hollywood-checkpoints.mjs",
    "docs/ACADEMY-36-WORKER-HOLLYWOOD-PRODUCTION-CONTRACT.md",
  ];
  for (const relative of requiredFiles) {
    assert.ok(fs.existsSync(path.join(root, relative)), `Required Academy surge asset is missing: ${relative}`);
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
  ]) {
    assert.ok(authoring.includes(phrase), `Cinematic authoring contract missing ${phrase}`);
  }

  console.log(JSON.stringify({
    gate: "academy-36-worker-interchangeable-course-production",
    portfolioWorkerCount,
    applicationWorkerAllocation,
    courseWorkerAllocation,
    workerMode,
    interchangeableRoles: interchangeableCourseRoles.length,
    mandatoryContractDomains: mandatoryContractDomains.length,
    rosterSize: roster.length,
    applicationWorkAllowed: false,
    publicationAuthorityGranted: false,
    passed: true,
  }, null, 2));
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
