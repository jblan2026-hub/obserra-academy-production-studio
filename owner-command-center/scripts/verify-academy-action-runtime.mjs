import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  studioActionArgs,
  actionTimeoutMs,
  readReleaseApprovalGate,
} = require("../electron/academy-studio.cjs");

const courseId = "cybersecurity-foundations";

assert.deepEqual(studioActionArgs("author", courseId), ["run", "author:course", "--", "--course", courseId]);
assert.deepEqual(studioActionArgs("revise", courseId), ["run", "author:course", "--", "--course", courseId, "--force"]);
assert.deepEqual(studioActionArgs("build", courseId), ["run", "build:course", "--", "--course", courseId]);
assert.deepEqual(studioActionArgs("author-all"), ["run", "author:all"]);
assert.deepEqual(studioActionArgs("build-all"), ["run", "build:all"]);
assert.deepEqual(studioActionArgs("catalog"), ["run", "catalog"]);
assert.deepEqual(studioActionArgs("verify"), ["run", "verify:70x"]);
assert.deepEqual(studioActionArgs("stage-approval"), ["run", "stage:release-approval"]);

assert.throws(() => studioActionArgs("author"), /Invalid course identifier/);
assert.throws(() => studioActionArgs("build", "../unsafe"), /Invalid course identifier/);
assert.throws(() => studioActionArgs("unsupported"), /Unsupported Studio action/);

const previousTimeout = process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
try {
  delete process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
  assert.equal(actionTimeoutMs("catalog"), 10 * 60 * 1000);
  assert.equal(actionTimeoutMs("author"), 45 * 60 * 1000);
  assert.equal(actionTimeoutMs("author-all"), 12 * 60 * 60 * 1000);
  assert.equal(actionTimeoutMs("build-all"), 2 * 60 * 60 * 1000);
  assert.equal(actionTimeoutMs("stage-approval"), 60 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = "1";
  assert.equal(actionTimeoutMs("verify"), 2 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = String(24 * 60 * 60 * 1000);
  assert.equal(actionTimeoutMs("verify"), 12 * 60 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = "not-a-number";
  assert.equal(actionTimeoutMs("build-all"), 2 * 60 * 60 * 1000);
} finally {
  if (previousTimeout === undefined) delete process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
  else process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = previousTimeout;
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "obserra-release-gate-"));
try {
  const missing = readReleaseApprovalGate(temporaryRoot);
  assert.equal(missing.expectedCourses, 60);
  assert.equal(missing.stagedCourses, 0);
  assert.equal(missing.allStagedForOwnerApproval, false);
  assert.equal(missing.publicationAuthorized, false);
  assert.equal(missing.checkoutAuthorized, false);

  const catalog = path.join(temporaryRoot, "catalog");
  fs.mkdirSync(catalog, { recursive: true });
  fs.writeFileSync(path.join(catalog, "academy-release-approval-gate.json"), JSON.stringify({
    schemaVersion: "1.0",
    expectedCourses: 60,
    discoveredCourses: 60,
    stagedCourses: 60,
    blockedCourses: 0,
    progressPercent: 100,
    allStagedForOwnerApproval: true,
    publicationAuthorized: false,
    checkoutAuthorized: false,
    ownerIssueNumber: 27,
    courses: [],
    blockersByFrequency: [],
  }));
  const ready = readReleaseApprovalGate(temporaryRoot);
  assert.equal(ready.allStagedForOwnerApproval, true);
  assert.equal(ready.ownerDecisionRequired, true);
  assert.equal(ready.ownerAcceptanceRecorded, false);
  assert.equal(ready.publicationAuthorized, false);
  assert.equal(ready.checkoutAuthorized, false);

  fs.writeFileSync(path.join(catalog, "academy-release-approval-gate.json"), JSON.stringify({
    expectedCourses: 60,
    discoveredCourses: 59,
    stagedCourses: 60,
    allStagedForOwnerApproval: true,
    publicationAuthorized: false,
    checkoutAuthorized: false,
  }));
  const inconsistent = readReleaseApprovalGate(temporaryRoot);
  assert.equal(inconsistent.allStagedForOwnerApproval, false);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("[Owner Command Center] Academy action dispatch, timeout, and 60-course release gate verification passed.");
