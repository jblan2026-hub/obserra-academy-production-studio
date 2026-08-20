import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DECISION_MARKER,
  SELECTED_EVIDENCE_PATHS,
  createAcademyGithubEvidence,
  crc32,
  extractSelectedZipEntries,
  normalizeZipPath,
} = require("../electron/academy-github-evidence.cjs");
const { stableHash } = require("../electron/academy-release-approval.cjs");

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

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [fileName, input] of Object.entries(entries)) {
    const name = Buffer.from(fileName, "utf8");
    const content = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
    const compressed = zlib.deflateRawSync(content);
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localRecord = Buffer.concat([localHeader, name, compressed]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([centralHeader, name]));
    localOffset += localRecord.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralParts.length, 8);
  eocd.writeUInt16LE(centralParts.length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localData, centralData, eocd]);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const allocation = {
  portfolioWorkerCount: 36,
  courseWorkerAllocation: 36,
  applicationWorkerAllocation: 0,
  workerMode: "interchangeable-course-production",
  crossRoleReassignmentAllowed: true,
};
const gate = {
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
  stagedCourseIds: Array.from({ length: 61 }, (_, index) => `course-${String(index + 1).padStart(2, "0")}`),
  courses: Array.from({ length: 61 }, (_, index) => ({
    courseId: `course-${String(index + 1).padStart(2, "0")}`,
    stagedForOwnerApproval: true,
    ownerAcceptanceRecorded: false,
    publicationAuthorized: false,
  })),
};
const evidenceEntries = {
  "catalog/academy-hollywood-provider-preflight.json": json({ ready: true, provider: "openai", model: "gpt-5" }),
  "catalog/academy-hollywood-course-audit.json": json({ allocation, totals: { discovered: 61, ownerReviewEligible: 61 } }),
  "catalog/academy-hollywood-checkpoint-restore.json": json({ evaluated: 61, restored: 61, skipped: false }),
  "catalog/academy-hollywood-parallel-summary.json": json({ allocation, launchedWorkerCount: 36, completedCourses: 61, successfulCourses: 61, failedCourses: 0, interchangeableRoles: ["instructional-design"] }),
  "catalog/academy-hollywood-compliance-staging.json": json({ allocation, discoveredCourses: 61, complianceStagingReadyCourses: 61, publicationReadyCourses: 61, readyForComplianceStaging: true, publicationReady: true }),
  "catalog/academy-hollywood-media-submission.json": json({ requestedVideoJobs: 300, submittedVideoJobs: 300, configurationRequiredVideoJobs: 0, failedVideoJobs: 0, allJobsSubmitted: true }),
  "catalog/academy-release-approval-gate.json": json(gate),
  "catalog/learner-catalog-readiness.json": json({ ready: true, discoveredCourses: 61 }),
  "unselected/readme.txt": "This entry must not be materialized.\n",
};
const zipBuffer = buildZip(evidenceEntries);
const artifactDigest = crypto.createHash("sha256").update(zipBuffer).digest("hex");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "obserra-github-evidence-"));
const previousLocalAppData = process.env.LOCALAPPDATA;
delete process.env.LOCALAPPDATA;
const store = new MemoryStore();
store.set("secrets.githubToken", Buffer.from("protected:test-github-token", "utf8").toString("base64"));
const safeStorage = {
  isEncryptionAvailable: () => true,
  decryptString: (buffer) => {
    const decoded = buffer.toString("utf8");
    if (!decoded.startsWith("protected:")) throw new Error("Invalid protected value");
    return decoded.slice("protected:".length);
  },
};
const app = { getPath: () => temporaryRoot };
const observedRequests = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  observedRequests.push({ pathname: parsed.pathname, search: parsed.search, method: options.method || "GET", body: options.body || null });
  if (parsed.pathname === "/user") {
    return new Response(json({ login: "jblan2026-hub", id: 309821056 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (parsed.pathname.endsWith("/actions/workflows/academy-36-worker-hollywood-production.yml/runs")) {
    return new Response(json({
      workflow_runs: [{
        id: 9001,
        run_number: 77,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
        event: "workflow_dispatch",
        head_branch: "agent/academy-36-worker-hollywood-production",
        head_sha: "a".repeat(40),
        created_at: "2026-08-08T03:00:00Z",
        updated_at: "2026-08-08T03:20:00Z",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (parsed.pathname.endsWith("/actions/runs/9001/artifacts")) {
    return new Response(json({
      artifacts: [{
        id: 8001,
        name: "academy-36-worker-production-9001",
        size_in_bytes: zipBuffer.length,
        digest: `sha256:${artifactDigest}`,
        expired: false,
        created_at: "2026-08-08T03:20:00Z",
        expires_at: "2026-11-06T03:20:00Z",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (parsed.pathname.endsWith("/actions/artifacts/8001/zip")) {
    return new Response(zipBuffer, { status: 200, headers: { "Content-Type": "application/zip", "Content-Length": String(zipBuffer.length) } });
  }
  if (parsed.pathname.endsWith("/issues/27/comments") && (options.method || "GET") === "POST") {
    const request = JSON.parse(options.body);
    assert.ok(request.body.includes(DECISION_MARKER));
    assert.ok(request.body.includes(stableHash(gate)));
    assert.ok(request.body.includes("Publication authorized by this decision: **NO**"));
    return new Response(json({ id: 7001, html_url: "https://github.example/decision/7001" }), { status: 201, headers: { "Content-Type": "application/json" } });
  }
  return new Response(json({ message: `Unexpected test endpoint: ${parsed.pathname}` }), { status: 404, headers: { "Content-Type": "application/json" } });
};

try {
  assert.equal(normalizeZipPath("catalog\\academy-release-approval-gate.json"), "catalog/academy-release-approval-gate.json");
  assert.throws(() => normalizeZipPath("../unsafe.json"), /traversal/);
  assert.throws(() => normalizeZipPath("C:/unsafe.json"), /absolute/);

  const extracted = extractSelectedZipEntries(zipBuffer);
  assert.equal(extracted.size, SELECTED_EVIDENCE_PATHS.length);
  assert.equal(extracted.has("unselected/readme.txt"), false);
  assert.equal(JSON.parse(extracted.get("catalog/academy-release-approval-gate.json").toString("utf8")).expectedCourses, 61);

  const unsafeZip = buildZip({ "../unsafe.json": json({ unsafe: true }) });
  assert.throws(() => extractSelectedZipEntries(unsafeZip, ["../unsafe.json"]), /traversal/);

  const githubEvidence = createAcademyGithubEvidence({ store, safeStorage, app });
  const before = githubEvidence.snapshot();
  assert.equal(before.tokenConfigured, true);
  assert.equal(before.evidenceAvailable, false);

  const synchronization = await githubEvidence.synchronize();
  assert.equal(synchronization.ok, true);
  assert.equal(synchronization.run.id, 9001);
  assert.equal(synchronization.artifact.id, 8001);
  assert.equal(synchronization.gateHash, stableHash(gate));
  assert.equal(synchronization.expectedCourses, 61);
  assert.equal(synchronization.stagedCourses, 61);
  assert.equal(synchronization.blockedCourses, 0);
  assert.equal(synchronization.allStagedForOwnerApproval, true);
  assert.equal(synchronization.publicationAuthorized, false);
  assert.equal(synchronization.checkoutAuthorized, false);

  for (const fileName of SELECTED_EVIDENCE_PATHS) {
    assert.ok(fs.existsSync(path.join(githubEvidence.cacheRoot, ...fileName.split("/"))), `Missing synchronized evidence: ${fileName}`);
  }
  assert.equal(fs.existsSync(path.join(githubEvidence.cacheRoot, "unselected", "readme.txt")), false);

  const after = githubEvidence.snapshot();
  assert.equal(after.evidenceAvailable, true);
  assert.equal(after.gate.gateHash, stableHash(gate));
  assert.equal(after.gate.expectedCourses, 61);
  assert.equal(after.gate.stagedCourses, 61);
  assert.equal(after.gate.allStagedForOwnerApproval, true);
  assert.equal(after.gate.publicationAuthorized, false);
  assert.equal(after.gate.checkoutAuthorized, false);

  const decision = {
    schemaVersion: "1.0",
    decisionId: "decision-verification-001",
    decidedAt: new Date().toISOString(),
    decision: "approve",
    note: "Verification decision for the exact synchronized course portfolio.",
    gateHash: stableHash(gate),
    gateGeneratedAt: gate.generatedAt,
    portfolioDefinition: gate.portfolioDefinition,
    expectedCourses: 61,
    stagedCourses: 61,
    blockedCourses: 0,
    stagedCourseIds: gate.stagedCourseIds,
    owner: { username: "verification-owner", hostname: os.hostname(), platform: os.type() },
    endpoint: { deviceId: "device-001", deviceFingerprint: "b".repeat(64), hostname: os.hostname(), enrollmentState: "enrolled", endpointReady: true, controlPlaneOperational: true },
    approvalScope: "owner-decision-on-exact-staged-portfolio",
    publicationAuthorized: false,
    checkoutAuthorized: false,
    pricingChangeAuthorized: false,
    learnerAccessAuthorized: false,
    releaseExecutionRequired: true,
    releaseExecutionCompleted: false,
    signatureAlgorithm: "hmac-sha256-device-bound",
    signature: "c".repeat(64),
  };
  const receipt = await githubEvidence.submitDecision(decision);
  assert.equal(receipt.issueCommentId, 7001);
  assert.equal(receipt.submittedBy, "jblan2026-hub");
  assert.equal(receipt.gateHash, stableHash(gate));
  assert.equal(receipt.publicationAuthorized, false);
  assert.equal(receipt.checkoutAuthorized, false);
  assert.equal(receipt.releaseExecutionCompleted, false);
  assert.ok(fs.existsSync(githubEvidence.submissionPath));

  const finalSnapshot = githubEvidence.snapshot();
  assert.equal(finalSnapshot.submission.decisionId, decision.decisionId);
  assert.equal(finalSnapshot.submission.issueCommentId, 7001);
  assert.ok(observedRequests.some((request) => request.pathname.endsWith("/actions/artifacts/8001/zip")));
  assert.ok(observedRequests.some((request) => request.pathname.endsWith("/issues/27/comments") && request.method === "POST"));

  console.log(JSON.stringify({
    gate: "command-center-authenticated-github-academy-evidence",
    ownerIdentityVerified: true,
    workflowRunSelected: synchronization.run.id,
    artifactDigestVerified: synchronization.artifact.downloadedSha256 === artifactDigest,
    selectedEvidenceFiles: synchronization.writtenEvidenceFiles.length,
    unsafeZipPathRejected: true,
    gateHash: synchronization.gateHash,
    expectedCourses: synchronization.expectedCourses,
    stagedCourses: synchronization.stagedCourses,
    decisionSubmitted: receipt.issueCommentId === 7001,
    publicationAuthorized: receipt.publicationAuthorized,
    checkoutAuthorized: receipt.checkoutAuthorized,
    passed: true,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
