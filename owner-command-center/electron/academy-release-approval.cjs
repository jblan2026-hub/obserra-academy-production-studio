const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveStudioRoot } = require("./academy-studio.cjs");

const DECISION_SCHEMA_VERSION = "1.0";
const GATE_SCHEMA_VERSION = "1.1";
const ALLOWED_DECISIONS = new Set(["approve", "reject", "revise"]);
const CURRENT_DECISION_FILE = "academy-owner-release-decision.json";
const DECISION_HISTORY_DIRECTORY = "academy-owner-release-decisions";

function normalizedForHash(value) {
  if (Array.isArray(value)) return value.map(normalizedForHash);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizedForHash(value[key])]),
    );
  }
  return value;
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalizedForHash(value)))
    .digest("hex");
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function decisionPaths(root) {
  const catalogRoot = path.join(root, "catalog");
  return {
    gatePath: path.join(catalogRoot, "academy-release-approval-gate.json"),
    currentDecisionPath: path.join(catalogRoot, CURRENT_DECISION_FILE),
    historyRoot: path.join(catalogRoot, DECISION_HISTORY_DIRECTORY),
  };
}

function evaluateReleaseGate(gate) {
  const blockers = [];
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    return { blockers: ["Release-approval gate is missing or invalid."], expectedCourses: null, courseIds: [] };
  }
  if (gate.schemaVersion !== GATE_SCHEMA_VERSION) blockers.push(`Release-approval gate must use schema ${GATE_SCHEMA_VERSION}.`);

  const expectedCourses = Number(gate.expectedCourses);
  const discoveredCourses = Number(gate.discoveredCourses);
  const stagedCourses = Number(gate.stagedCourses);
  const blockedCourses = Number(gate.blockedCourses);
  const courseIds = Array.isArray(gate.stagedCourseIds) ? gate.stagedCourseIds.map(String) : [];
  const uniqueCourseIds = new Set(courseIds);
  const courseRecords = Array.isArray(gate.courses) ? gate.courses : [];

  if (!Number.isInteger(expectedCourses) || expectedCourses < 1) blockers.push("Expected course count is invalid.");
  if (discoveredCourses !== expectedCourses) blockers.push(`Discovered course count ${discoveredCourses} does not equal expected count ${expectedCourses}.`);
  if (stagedCourses !== expectedCourses) blockers.push(`Staged course count ${stagedCourses} does not equal expected count ${expectedCourses}.`);
  if (blockedCourses !== 0) blockers.push(`${blockedCourses} course package(s) remain blocked.`);
  if (gate.portfolioCountMatches !== true) blockers.push("Portfolio count reconciliation has not passed.");
  if (gate.allStagedForOwnerApproval !== true) blockers.push("The complete portfolio is not staged for owner approval.");
  if (gate.ownerDecisionRequired !== true) blockers.push("The gate is not requesting an owner decision.");
  if (gate.ownerAcceptanceRecorded !== false) blockers.push("The staging gate already reports owner acceptance and must be regenerated before another decision.");
  if (gate.publicationAuthorized !== false) blockers.push("The staging gate must not grant publication authority.");
  if (gate.checkoutAuthorized !== false) blockers.push("The staging gate must not grant checkout authority.");
  if (courseIds.length !== expectedCourses || uniqueCourseIds.size !== expectedCourses) blockers.push("Staged course identity inventory is incomplete or contains duplicates.");
  if (courseRecords.length !== expectedCourses) blockers.push("Course-level staging records do not reconcile to the expected portfolio.");
  if (courseRecords.some((course) => course?.stagedForOwnerApproval !== true)) blockers.push("At least one course-level staging record is not ready for owner approval.");
  if (courseRecords.some((course) => course?.publicationAuthorized !== false)) blockers.push("A course-level staging record improperly grants publication authority.");
  if (courseRecords.some((course) => course?.ownerAcceptanceRecorded !== false)) blockers.push("A course-level staging record contains premature owner acceptance.");

  const allocation = gate.allocation || {};
  if (Number(allocation.portfolioWorkerCount) !== 36) blockers.push("Gate evidence does not reconcile to the governed 36-worker portfolio.");
  if (Number(allocation.courseWorkerAllocation) !== 36) blockers.push("Gate evidence does not show all 36 workers allocated to Academy production.");
  if (Number(allocation.applicationWorkerAllocation) !== 0) blockers.push("Gate evidence does not show zero unrelated application workers.");
  if (allocation.workerMode !== "interchangeable-course-production") blockers.push("Gate evidence does not show interchangeable course-production workers.");

  return {
    blockers: [...new Set(blockers)],
    expectedCourses: Number.isInteger(expectedCourses) ? expectedCourses : null,
    discoveredCourses: Number.isInteger(discoveredCourses) ? discoveredCourses : null,
    stagedCourses: Number.isInteger(stagedCourses) ? stagedCourses : null,
    blockedCourses: Number.isInteger(blockedCourses) ? blockedCourses : null,
    courseIds: [...uniqueCourseIds].sort(),
  };
}

function approvalConfirmation(expectedCourses) {
  return `APPROVE ${expectedCourses} COURSES FOR RELEASE`;
}

function rejectionConfirmation(expectedCourses) {
  return `REJECT ${expectedCourses} COURSE RELEASE`;
}

function revisionConfirmation(expectedCourses) {
  return `RETURN ${expectedCourses} COURSES FOR REVISION`;
}

function expectedConfirmation(decision, expectedCourses) {
  if (decision === "approve") return approvalConfirmation(expectedCourses);
  if (decision === "reject") return rejectionConfirmation(expectedCourses);
  return revisionConfirmation(expectedCourses);
}

function safeOwnerIdentity() {
  let username = "unknown-owner";
  try {
    username = os.userInfo().username || username;
  } catch {}
  return {
    username,
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
  };
}

function createAcademyReleaseApproval({ store, safeStorage, endpointRuntime, studioRootProvider = resolveStudioRoot }) {
  if (!store || !safeStorage || !endpointRuntime) throw new Error("Academy release approval dependencies are required.");

  function rootOrThrow() {
    const root = studioRootProvider();
    if (!root) throw new Error("Academy Studio workspace is unavailable.");
    return root;
  }

  function deviceSecret() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is required for an owner release decision.");
    const encryptedSecret = store.get("endpoint.identity.encryptedSecret");
    if (!encryptedSecret) throw new Error("The enrolled endpoint identity is unavailable.");
    return safeStorage.decryptString(Buffer.from(encryptedSecret, "base64"));
  }

  function signDecision(payload) {
    return crypto
      .createHmac("sha256", deviceSecret())
      .update(JSON.stringify(normalizedForHash(payload)))
      .digest("hex");
  }

  function getSnapshot() {
    const root = studioRootProvider();
    if (!root) {
      return {
        available: false,
        canDecide: false,
        blockers: ["Academy Studio workspace is unavailable."],
        gate: null,
        gateHash: null,
        decision: null,
        expectedConfirmation: null,
      };
    }

    const paths = decisionPaths(root);
    let gate = null;
    let gateError = null;
    try {
      gate = readJsonIfPresent(paths.gatePath);
    } catch (error) {
      gateError = error instanceof Error ? error.message : String(error);
    }
    const evaluation = evaluateReleaseGate(gate);
    if (gateError) evaluation.blockers.unshift(`Release-approval gate could not be read: ${gateError}`);

    let decision = null;
    let decisionError = null;
    try {
      decision = readJsonIfPresent(paths.currentDecisionPath);
    } catch (error) {
      decisionError = error instanceof Error ? error.message : String(error);
    }
    const endpoint = endpointRuntime.getSnapshot();
    const endpointDecisionReady = endpoint?.endpointReady === true
      && endpoint?.enrollment?.state === "enrolled"
      && Boolean(endpoint?.deviceId)
      && Boolean(endpoint?.deviceFingerprint);
    const blockers = [...evaluation.blockers];
    if (!endpointDecisionReady) blockers.push("The Command Center endpoint must be enrolled and endpoint-ready before an owner release decision can be recorded.");
    if (decisionError) blockers.push(`Existing owner decision could not be read: ${decisionError}`);

    const gateHash = gate ? stableHash(gate) : null;
    const currentDecisionMatchesGate = decision?.gateHash === gateHash;
    const decisionAlreadyRecorded = currentDecisionMatchesGate && ALLOWED_DECISIONS.has(decision?.decision);
    if (decisionAlreadyRecorded) blockers.push(`An owner ${decision.decision} decision is already recorded for this exact staging gate.`);

    return {
      available: Boolean(gate),
      canDecide: blockers.length === 0,
      blockers: [...new Set(blockers)],
      gate: gate
        ? {
            schemaVersion: gate.schemaVersion,
            generatedAt: gate.generatedAt,
            portfolioDefinition: gate.portfolioDefinition,
            expectedCourses: evaluation.expectedCourses,
            discoveredCourses: evaluation.discoveredCourses,
            stagedCourses: evaluation.stagedCourses,
            blockedCourses: evaluation.blockedCourses,
            progressPercent: gate.progressPercent,
            allStagedForOwnerApproval: gate.allStagedForOwnerApproval === true,
            ownerDecisionRequired: gate.ownerDecisionRequired === true,
            publicationAuthorized: gate.publicationAuthorized === true,
            checkoutAuthorized: gate.checkoutAuthorized === true,
            stagedCourseIds: evaluation.courseIds,
          }
        : null,
      gateHash,
      decision: decision || null,
      currentDecisionMatchesGate,
      endpoint: endpoint
        ? {
            endpointReady: endpoint.endpointReady === true,
            controlPlaneOperational: endpoint.controlPlaneOperational === true,
            deviceId: endpoint.deviceId || null,
            deviceFingerprint: endpoint.deviceFingerprint || null,
            enrollmentState: endpoint.enrollment?.state || "not-enrolled",
            hostname: endpoint.hostname || os.hostname(),
          }
        : null,
      expectedConfirmation: evaluation.expectedCourses
        ? {
            approve: approvalConfirmation(evaluation.expectedCourses),
            reject: rejectionConfirmation(evaluation.expectedCourses),
            revise: revisionConfirmation(evaluation.expectedCourses),
          }
        : null,
      claimBoundary: "An owner decision records acceptance, rejection, or revision of the exact staged portfolio. It does not publish courses, enable checkout, alter pricing, or grant learner access. A separate governed release action remains required.",
    };
  }

  function recordDecision({ decision, confirmation, note = "" } = {}) {
    const normalizedDecision = String(decision || "").trim().toLowerCase();
    if (!ALLOWED_DECISIONS.has(normalizedDecision)) throw new Error("Owner decision must be approve, reject, or revise.");

    const snapshot = getSnapshot();
    if (!snapshot.canDecide) throw new Error(`Owner release decision is blocked: ${snapshot.blockers.join(" ")}`);
    const expectedCourses = snapshot.gate.expectedCourses;
    const requiredConfirmation = expectedConfirmation(normalizedDecision, expectedCourses);
    if (String(confirmation || "").trim() !== requiredConfirmation) {
      throw new Error(`Owner confirmation must exactly match: ${requiredConfirmation}`);
    }
    const normalizedNote = String(note || "").trim();
    if (["reject", "revise"].includes(normalizedDecision) && normalizedNote.length < 10) {
      throw new Error("Reject and revise decisions require a substantive owner note of at least 10 characters.");
    }

    const root = rootOrThrow();
    const paths = decisionPaths(root);
    const endpoint = endpointRuntime.getSnapshot();
    const decidedAt = new Date().toISOString();
    const decisionId = crypto.randomUUID();
    const unsignedRecord = {
      schemaVersion: DECISION_SCHEMA_VERSION,
      decisionId,
      decidedAt,
      decision: normalizedDecision,
      note: normalizedNote || null,
      gateHash: snapshot.gateHash,
      gateGeneratedAt: snapshot.gate.generatedAt,
      portfolioDefinition: snapshot.gate.portfolioDefinition,
      expectedCourses,
      stagedCourses: snapshot.gate.stagedCourses,
      blockedCourses: snapshot.gate.blockedCourses,
      stagedCourseIds: snapshot.gate.stagedCourseIds,
      owner: safeOwnerIdentity(),
      endpoint: {
        deviceId: endpoint.deviceId,
        deviceFingerprint: endpoint.deviceFingerprint,
        hostname: endpoint.hostname,
        enrollmentState: endpoint.enrollment?.state,
        endpointReady: endpoint.endpointReady === true,
        controlPlaneOperational: endpoint.controlPlaneOperational === true,
      },
      approvalScope: "owner-decision-on-exact-staged-portfolio",
      publicationAuthorized: false,
      checkoutAuthorized: false,
      pricingChangeAuthorized: false,
      learnerAccessAuthorized: false,
      releaseExecutionRequired: normalizedDecision === "approve",
      releaseExecutionCompleted: false,
      claimBoundary: "This device-bound owner decision does not publish courses, enable checkout, change pricing, or grant learner access. Approved decisions require a separate governed release execution and post-release verification.",
    };
    const record = {
      ...unsignedRecord,
      signatureAlgorithm: "hmac-sha256-device-bound",
      signature: signDecision(unsignedRecord),
    };

    const safeTimestamp = decidedAt.replaceAll(":", "-");
    const historyPath = path.join(paths.historyRoot, `${safeTimestamp}-${decisionId}.json`);
    atomicWriteJson(historyPath, record);
    atomicWriteJson(paths.currentDecisionPath, record);
    store.set("academy.releaseDecision", {
      decisionId,
      gateHash: snapshot.gateHash,
      decision: normalizedDecision,
      decidedAt,
      historyPath,
    });
    return record;
  }

  return {
    getSnapshot,
    recordDecision,
  };
}

module.exports = {
  ALLOWED_DECISIONS,
  CURRENT_DECISION_FILE,
  DECISION_HISTORY_DIRECTORY,
  DECISION_SCHEMA_VERSION,
  GATE_SCHEMA_VERSION,
  approvalConfirmation,
  createAcademyReleaseApproval,
  evaluateReleaseGate,
  expectedConfirmation,
  rejectionConfirmation,
  revisionConfirmation,
  stableHash,
};
