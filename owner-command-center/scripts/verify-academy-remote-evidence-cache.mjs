import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getAcademyProductionEvidence } = require("../electron/academy-production-evidence.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "obserra-remote-academy-evidence-"));
const catalogRoot = path.join(root, "catalog");
fs.mkdirSync(catalogRoot, { recursive: true });

function writeJson(name, value) {
  fs.writeFileSync(path.join(catalogRoot, name), `${JSON.stringify(value, null, 2)}\n`);
}

const allocation = {
  portfolioWorkerCount: 36,
  courseWorkerAllocation: 36,
  applicationWorkerAllocation: 0,
  workerMode: "interchangeable-course-production",
  crossRoleReassignmentAllowed: true,
};
const courseIds = Array.from({ length: 61 }, (_, index) => `remote-course-${String(index + 1).padStart(2, "0")}`);

writeJson("academy-hollywood-course-audit.json", {
  allocation,
  totals: { discovered: 61, ownerReviewEligible: 61 },
});
writeJson("academy-hollywood-parallel-summary.json", {
  allocation,
  launchedWorkerCount: 36,
  startedCourses: 61,
  completedCourses: 61,
  successfulCourses: 61,
  failedCourses: 0,
  interchangeableRoles: ["instructional-design", "assessment-development"],
});
writeJson("academy-hollywood-compliance-staging.json", {
  allocation,
  discoveredCourses: 61,
  complianceStagingReadyCourses: 61,
  publicationReadyCourses: 61,
  readyForComplianceStaging: true,
  publicationReady: true,
});
writeJson("academy-hollywood-media-submission.json", {
  requestedVideoJobs: 300,
  submittedVideoJobs: 300,
  configurationRequiredVideoJobs: 0,
  failedVideoJobs: 0,
  allJobsSubmitted: true,
});
writeJson("academy-hollywood-provider-preflight.json", {
  ready: true,
  provider: "openai",
  model: "gpt-5",
  checkedAt: new Date().toISOString(),
});
writeJson("academy-hollywood-checkpoint-restore.json", {
  evaluated: 61,
  restored: 61,
  skipped: false,
});
writeJson("learner-catalog-readiness.json", {
  ready: true,
  discoveredCourses: 61,
});
writeJson("academy-release-approval-gate.json", {
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  portfolioDefinition: "60 core Academy courses plus the supplemental PMP course",
  expectedCourses: 61,
  discoveredCourses: 61,
  stagedCourses: 61,
  blockedCourses: 0,
  progressPercent: 100,
  portfolioCountMatches: true,
  allStagedForOwnerApproval: true,
  ownerDecisionRequired: true,
  ownerAcceptanceRecorded: false,
  publicationAuthorized: false,
  checkoutAuthorized: false,
  allocation,
  stagedCourseIds: courseIds,
  courses: courseIds.map((courseId) => ({
    courseId,
    stagedForOwnerApproval: true,
    ownerAcceptanceRecorded: false,
    publicationAuthorized: false,
  })),
});

try {
  const evidence = getAcademyProductionEvidence(root);
  assert.equal(evidence.available, true);
  assert.equal(evidence.source, "authenticated-github-actions-evidence-cache");
  assert.equal(evidence.courseStatus.discovered, 61);
  assert.equal(evidence.courseStatus.ownerReviewEligible, 61);
  assert.equal(evidence.courseStatus.complianceStagingReady, 61);
  assert.equal(evidence.courseStatus.publicationReady, 61);
  assert.equal(evidence.workerStatus.configuredPortfolioWorkers, 36);
  assert.equal(evidence.workerStatus.configuredCourseWorkers, 36);
  assert.equal(evidence.workerStatus.configuredApplicationWorkers, 0);
  assert.equal(evidence.workerStatus.interchangeable, true);
  assert.equal(evidence.approvalStatus.expectedCourses, 61);
  assert.equal(evidence.approvalStatus.stagedCourses, 61);
  assert.equal(evidence.approvalStatus.blockedCourses, 0);
  assert.equal(evidence.approvalStatus.allStagedForOwnerApproval, true);
  assert.equal(evidence.approvalStatus.ownerDecisionRequired, true);
  assert.equal(evidence.publicationLocked, true);
  assert.equal(evidence.controlPlaneOperational, true);
  assert.equal(evidence.productionOperational, true);
  assert.deepEqual(evidence.blockers, []);

  fs.rmSync(path.join(catalogRoot, "learner-catalog-readiness.json"));
  const degraded = getAcademyProductionEvidence(root);
  assert.equal(degraded.controlPlaneOperational, true);
  assert.equal(degraded.productionOperational, false);
  assert.ok(degraded.blockers.some((blocker) => blocker.includes("learner catalog readiness")));

  console.log(JSON.stringify({
    gate: "command-center-remote-academy-evidence-cache",
    source: evidence.source,
    discoveredCourses: evidence.courseStatus.discovered,
    ownerReviewEligible: evidence.courseStatus.ownerReviewEligible,
    configuredCourseWorkers: evidence.workerStatus.configuredCourseWorkers,
    configuredApplicationWorkers: evidence.workerStatus.configuredApplicationWorkers,
    allStagedForOwnerApproval: evidence.approvalStatus.allStagedForOwnerApproval,
    controlPlaneOperational: evidence.controlPlaneOperational,
    productionOperational: evidence.productionOperational,
    missingLearnerCatalogFailsProductionClosed: degraded.productionOperational === false,
    passed: true,
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
