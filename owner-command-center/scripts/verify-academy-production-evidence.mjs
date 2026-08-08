import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getAcademyProductionEvidence } = require("../electron/academy-production-evidence.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "obserra-academy-evidence-"));
const courseRoot = path.join(root, "courses", "evidence-test-course");
const catalogRoot = path.join(root, "catalog");
fs.mkdirSync(courseRoot, { recursive: true });
fs.mkdirSync(catalogRoot, { recursive: true });

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

writeJson(path.join(courseRoot, "course-manifest.json"), {
  course: { id: "evidence-test-course", title: "Evidence Test Course" },
  release: { status: "draft", publishToAcademy: false },
});
writeJson(path.join(catalogRoot, "academy-hollywood-course-audit.json"), {
  allocation: {
    portfolioWorkerCount: 36,
    courseWorkerAllocation: 36,
    applicationWorkerAllocation: 0,
    workerMode: "interchangeable-course-production",
    crossRoleReassignmentAllowed: true,
  },
});
writeJson(path.join(catalogRoot, "academy-hollywood-parallel-summary.json"), {
  allocation: {
    portfolioWorkerCount: 36,
    courseWorkerAllocation: 36,
    applicationWorkerAllocation: 0,
    workerMode: "interchangeable-course-production",
    crossRoleReassignmentAllowed: true,
  },
  launchedWorkerCount: 1,
  workerRoster: [{ workerId: 1 }],
  startedCourses: 1,
  completedCourses: 1,
  successfulCourses: 1,
  failedCourses: 0,
  halted: false,
  interchangeableRoles: ["instructional-design", "assessment-development"],
});
writeJson(path.join(catalogRoot, "academy-hollywood-compliance-staging.json"), {
  discoveredCourses: 1,
  complianceStagingReadyCourses: 1,
  publicationReadyCourses: 1,
  readyForComplianceStaging: true,
  publicationReady: true,
});
writeJson(path.join(catalogRoot, "academy-hollywood-media-submission.json"), {
  requestedVideoJobs: 4,
  submittedVideoJobs: 4,
  configurationRequiredVideoJobs: 0,
  failedVideoJobs: 0,
  allJobsSubmitted: true,
});
writeJson(path.join(catalogRoot, "academy-hollywood-provider-preflight.json"), {
  ready: true,
  provider: "openai",
  model: "gpt-5",
  checkedAt: new Date().toISOString(),
});
writeJson(path.join(catalogRoot, "academy-hollywood-checkpoint-restore.json"), {
  evaluated: 1,
  restored: 1,
  skipped: false,
});
writeJson(path.join(catalogRoot, "learner-catalog-readiness.json"), {
  ready: true,
  discoveredCourses: 1,
});

try {
  const evidence = getAcademyProductionEvidence(root);
  assert.equal(evidence.available, true);
  assert.equal(evidence.source, "authoritative-repository-evidence");
  assert.equal(evidence.workerStatus.configuredPortfolioWorkers, 36);
  assert.equal(evidence.workerStatus.configuredCourseWorkers, 36);
  assert.equal(evidence.workerStatus.configuredApplicationWorkers, 0);
  assert.equal(evidence.workerStatus.interchangeable, true);
  assert.equal(evidence.workerStatus.launchedWorkers, 1);
  assert.equal(evidence.workerStatus.completedAssignments, 1);
  assert.equal(evidence.courseStatus.ownerReviewEligible, 1);
  assert.equal(evidence.courseStatus.complianceStagingReady, 1);
  assert.equal(evidence.courseStatus.publicationReady, 1);
  assert.equal(evidence.courseStatus.publicationApproved, 0);
  assert.equal(evidence.publicationLocked, true);
  assert.equal(evidence.operational, true);
  assert.deepEqual(evidence.blockers, []);
  assert.equal(evidence.mediaStatus.allJobsSubmitted, true);
  assert.equal(evidence.providerStatus.ready, true);
  assert.equal(evidence.checkpointStatus.restored, 1);

  fs.rmSync(path.join(catalogRoot, "academy-hollywood-provider-preflight.json"));
  const degraded = getAcademyProductionEvidence(root);
  assert.equal(degraded.operational, false);
  assert.ok(degraded.blockers.some((blocker) => blocker.includes("provider preflight evidence")));
  assert.equal(degraded.providerStatus.ready, false);

  console.log(JSON.stringify({
    gate: "command-center-academy-production-evidence",
    authoritativeOperationalEvidence: evidence.operational,
    publicationRemainsLockedWithoutApproval: evidence.publicationLocked,
    configuredCourseWorkers: evidence.workerStatus.configuredCourseWorkers,
    configuredApplicationWorkers: evidence.workerStatus.configuredApplicationWorkers,
    interchangeabilityVerified: evidence.workerStatus.interchangeable,
    complianceStagingReady: evidence.courseStatus.complianceStagingReady,
    missingEvidenceFailsClosed: degraded.operational === false,
    passed: true,
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
