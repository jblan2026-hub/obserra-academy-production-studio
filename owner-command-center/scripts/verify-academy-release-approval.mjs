import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  approvalConfirmation,
  createAcademyReleaseApproval,
  evaluateReleaseGate,
  stableHash,
} = require("../electron/academy-release-approval.cjs");

class MemoryStore {
  constructor() { this.state = {}; }
  parts(key) { return String(key).split("."); }
  get(key) {
    let value = this.state;
    for (const part of this.parts(key)) {
      if (!value || typeof value !== "object" || !(part in value)) return undefined;
      value = value[part];
    }
    return value;
  }
  set(key, input) {
    const parts = this.parts(key);
    let value = this.state;
    for (const part of parts.slice(0, -1)) {
      if (!value[part] || typeof value[part] !== "object") value[part] = {};
      value = value[part];
    }
    value[parts.at(-1)] = input;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "obserra-release-approval-"));
const catalogRoot = path.join(root, "catalog");
fs.mkdirSync(catalogRoot, { recursive: true });
const gatePath = path.join(catalogRoot, "academy-release-approval-gate.json");

const allocation = {
  portfolioWorkerCount: 36,
  courseWorkerAllocation: 36,
  applicationWorkerAllocation: 0,
  workerMode: "interchangeable-course-production",
};
const gate = {
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  portfolioDefinition: "Two-course owner approval verification fixture",
  expectedCourses: 2,
  discoveredCourses: 2,
  stagedCourses: 2,
  blockedCourses: 0,
  progressPercent: 100,
  portfolioCountMatches: true,
  allStagedForOwnerApproval: true,
  ownerDecisionRequired: true,
  ownerAcceptanceRecorded: false,
  publicationAuthorized: false,
  checkoutAuthorized: false,
  allocation,
  stagedCourseIds: ["course-a", "course-b"],
  courses: [
    { courseId: "course-a", stagedForOwnerApproval: true, ownerAcceptanceRecorded: false, publicationAuthorized: false },
    { courseId: "course-b", stagedForOwnerApproval: true, ownerAcceptanceRecorded: false, publicationAuthorized: false },
  ],
};
fs.writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`);

const deviceSecret = "verification-device-secret";
const store = new MemoryStore();
store.set("endpoint.identity.encryptedSecret", Buffer.from(`protected:${deviceSecret}`, "utf8").toString("base64"));
const safeStorage = {
  isEncryptionAvailable: () => true,
  decryptString: (buffer) => {
    const decoded = buffer.toString("utf8");
    if (!decoded.startsWith("protected:")) throw new Error("Invalid protected secret");
    return decoded.slice("protected:".length);
  },
};
const endpointRuntime = {
  getSnapshot: () => ({
    endpointReady: true,
    controlPlaneOperational: true,
    deviceId: "device-verification-001",
    deviceFingerprint: "f".repeat(64),
    hostname: os.hostname(),
    enrollment: { state: "enrolled" },
  }),
};

const approval = createAcademyReleaseApproval({
  store,
  safeStorage,
  endpointRuntime,
  studioRootProvider: () => root,
});

try {
  const evaluation = evaluateReleaseGate(gate);
  assert.deepEqual(evaluation.blockers, []);
  assert.equal(evaluation.expectedCourses, 2);
  assert.deepEqual(evaluation.courseIds, ["course-a", "course-b"]);

  const initial = approval.getSnapshot();
  assert.equal(initial.available, true);
  assert.equal(initial.canDecide, true);
  assert.deepEqual(initial.blockers, []);
  assert.equal(initial.gate.expectedCourses, 2);
  assert.equal(initial.gate.stagedCourses, 2);
  assert.equal(initial.gate.blockedCourses, 0);
  assert.equal(initial.gate.publicationAuthorized, false);
  assert.equal(initial.gate.checkoutAuthorized, false);
  assert.equal(initial.endpoint.endpointReady, true);
  assert.equal(initial.endpoint.enrollmentState, "enrolled");
  assert.equal(initial.expectedConfirmation.approve, approvalConfirmation(2));
  assert.equal(initial.gateHash, stableHash(gate));

  assert.throws(
    () => approval.recordDecision({ decision: "approve", confirmation: "approve" }),
    /must exactly match/,
  );
  assert.throws(
    () => approval.recordDecision({
      decision: "revise",
      confirmation: "RETURN 2 COURSES FOR REVISION",
      note: "short",
    }),
    /at least 10 characters/,
  );

  const record = approval.recordDecision({
    decision: "approve",
    confirmation: approvalConfirmation(2),
    note: "Owner accepts the exact staged verification portfolio for separate governed release execution.",
  });
  assert.equal(record.decision, "approve");
  assert.equal(record.gateHash, stableHash(gate));
  assert.equal(record.expectedCourses, 2);
  assert.equal(record.stagedCourses, 2);
  assert.equal(record.blockedCourses, 0);
  assert.deepEqual(record.stagedCourseIds, ["course-a", "course-b"]);
  assert.equal(record.endpoint.endpointReady, true);
  assert.equal(record.endpoint.enrollmentState, "enrolled");
  assert.equal(record.publicationAuthorized, false);
  assert.equal(record.checkoutAuthorized, false);
  assert.equal(record.pricingChangeAuthorized, false);
  assert.equal(record.learnerAccessAuthorized, false);
  assert.equal(record.releaseExecutionRequired, true);
  assert.equal(record.releaseExecutionCompleted, false);
  assert.match(record.signature, /^[a-f0-9]{64}$/);
  assert.equal(record.signatureAlgorithm, "hmac-sha256-device-bound");

  const currentDecisionPath = path.join(catalogRoot, "academy-owner-release-decision.json");
  assert.ok(fs.existsSync(currentDecisionPath));
  const persisted = JSON.parse(fs.readFileSync(currentDecisionPath, "utf8"));
  assert.equal(persisted.decisionId, record.decisionId);
  assert.equal(persisted.signature, record.signature);

  const historyRoot = path.join(catalogRoot, "academy-owner-release-decisions");
  const historyFiles = fs.readdirSync(historyRoot).filter((name) => name.endsWith(".json"));
  assert.equal(historyFiles.length, 1);

  const after = approval.getSnapshot();
  assert.equal(after.canDecide, false);
  assert.equal(after.currentDecisionMatchesGate, true);
  assert.equal(after.decision.decision, "approve");
  assert.ok(after.blockers.some((blocker) => blocker.includes("already recorded")));
  assert.throws(
    () => approval.recordDecision({ decision: "approve", confirmation: approvalConfirmation(2) }),
    /already recorded/,
  );

  const invalidGate = { ...gate, allStagedForOwnerApproval: false, stagedCourses: 1, blockedCourses: 1 };
  const invalidEvaluation = evaluateReleaseGate(invalidGate);
  assert.ok(invalidEvaluation.blockers.length >= 3);

  console.log(JSON.stringify({
    gate: "command-center-device-bound-academy-release-approval",
    stagedPortfolioVerified: initial.canDecide,
    exactConfirmationRequired: true,
    deviceBoundSignatureCreated: Boolean(record.signature),
    immutableHistoryCreated: historyFiles.length === 1,
    duplicateDecisionBlocked: after.canDecide === false,
    publicationAuthorized: record.publicationAuthorized,
    checkoutAuthorized: record.checkoutAuthorized,
    releaseExecutionRequired: record.releaseExecutionRequired,
    passed: true,
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
