const fs = require("node:fs");
const path = require("node:path");
const { app, ipcMain, safeStorage } = require("electron");
const Store = require("electron-store");
const { createRemediationQueue } = require("./remediation-queue.cjs");
const { getAcademyProductionEvidence } = require("./academy-production-evidence.cjs");
const { createAcademyReleaseApproval } = require("./academy-release-approval.cjs");
const { createAcademyGithubEvidence } = require("./academy-github-evidence.cjs");
const { createAcademyCourseControl } = require("./academy-course-control.cjs");
const { resolveStudioRoot } = require("./academy-studio.cjs");
const { createEndpointEnrollmentRuntime } = require("./endpoint-enrollment.cjs");

const store = new Store({ name: "owner-command-center" });
const remediationQueue = createRemediationQueue(store);
const academyGithubEvidence = createAcademyGithubEvidence({ store, safeStorage, app });
const githubSyncIntervalMs = Math.max(
  30000,
  Math.min(15 * 60 * 1000, Number(process.env.ACADEMY_GITHUB_SYNC_INTERVAL_MS || 60000)),
);
let githubSyncTimer = null;
let endpointRuntime;

function readGateTimestamp(root) {
  if (!root) return 0;
  const gatePath = path.join(root, "catalog", "academy-release-approval-gate.json");
  if (!fs.existsSync(gatePath)) return 0;
  try {
    const gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
    const parsed = Date.parse(String(gate.generatedAt || ""));
    return Number.isFinite(parsed) ? parsed : fs.statSync(gatePath).mtimeMs;
  } catch {
    return 0;
  }
}

function resolveAcademyEvidenceRoot() {
  const localRoot = resolveStudioRoot();
  const remoteRoot = academyGithubEvidence.evidenceRoot();
  if (localRoot && remoteRoot) {
    const localTimestamp = readGateTimestamp(localRoot);
    const remoteTimestamp = readGateTimestamp(remoteRoot);
    if (remoteTimestamp > localTimestamp) return remoteRoot;
    if (localTimestamp > 0) return localRoot;
    return remoteRoot;
  }
  return remoteRoot || localRoot || null;
}

function currentAcademyEvidence() {
  return getAcademyProductionEvidence(resolveAcademyEvidenceRoot());
}

const endpointIpcMain = {
  handle(name, handler) {
    if (name !== "endpoint:revoke") {
      ipcMain.handle(name, handler);
      return;
    }
    ipcMain.handle(name, async (...args) => {
      const revoked = await handler(...args);
      store.set("endpoint.enrollment", revoked);
      store.set("endpoint.revocation", revoked);
      endpointRuntime.refresh();
      return revoked;
    });
  },
};
endpointRuntime = createEndpointEnrollmentRuntime({
  store,
  app,
  safeStorage,
  ipcMain: endpointIpcMain,
  academyEvidenceProvider: () => {
    const evidence = currentAcademyEvidence();
    return { ...evidence, operational: evidence.controlPlaneOperational === true };
  },
});
const academyReleaseApproval = createAcademyReleaseApproval({
  store,
  safeStorage,
  endpointRuntime,
  studioRootProvider: resolveAcademyEvidenceRoot,
});
const academyCourseControl = createAcademyCourseControl({
  store,
  safeStorage,
  studioRootProvider: resolveStudioRoot,
});

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} is required`);
  return value;
}

function stableMappingKey(mapping) {
  if (typeof mapping === "string") return mapping.trim();
  return [mapping?.framework, mapping?.id, mapping?.title].filter(Boolean).join(":");
}

function resolveVerifiedFinding(findingId) {
  const lastScan = store.get("security.lastScan");
  const findings = lastScan?.scan?.findings;
  if (!Array.isArray(findings)) throw new Error("A completed verified security scan is required before remediation can be proposed");
  const verified = findings.find((item) => String(item.id || item.findingId || "") === String(findingId || ""));
  if (!verified) throw new Error("Remediation finding is not present in the latest verified security scan");
  if (verified.knownBad !== true) throw new Error("Only verified mapped known-bad findings can enter remediation");
  if (!["high", "critical"].includes(String(verified.severity || "").toLowerCase())) throw new Error("Remediation requires a high or critical verified finding");
  if (!Array.isArray(verified.mappings) || verified.mappings.length === 0) throw new Error("Verified MITRE or OWASP mappings are required");
  return verified;
}

function assertFindingEvidenceMatch(requestFinding, verifiedFinding) {
  const requestedMappings = new Set((requestFinding.mappings || []).map(stableMappingKey).filter(Boolean));
  const verifiedMappings = new Set((verifiedFinding.mappings || []).map(stableMappingKey).filter(Boolean));
  if (requestedMappings.size !== verifiedMappings.size || [...requestedMappings].some((item) => !verifiedMappings.has(item))) {
    throw new Error("Remediation mappings do not match the latest verified scan evidence");
  }
  if (String(requestFinding.severity || "").toLowerCase() !== String(verifiedFinding.severity || "").toLowerCase()) {
    throw new Error("Remediation severity does not match the latest verified scan evidence");
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

async function waitForBootstrapProfile(timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const profilePath = store.get("bootstrap.profilePath");
    if (profilePath && fs.existsSync(profilePath)) return profilePath;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function promoteEndpointBootstrapProfile(profilePath) {
  if (!profilePath || !fs.existsSync(profilePath)) return null;
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  if (!["1.0", "2.0"].includes(profile.schemaVersion)) {
    throw new Error("Unsupported Command Center bootstrap profile for endpoint enrollment");
  }
  const endpointProfile = {
    ...profile,
    schemaVersion: "2.0",
    localOnly: true,
    requireEnrollment: true,
    autoEnroll: profile.autoEnroll !== false,
    autoStart: profile.autoStart !== false,
    heartbeatIntervalSeconds: Number(profile.heartbeatIntervalSeconds || 15),
    endpointProfileGeneratedAt: new Date().toISOString(),
  };
  const endpointPath = path.join(path.dirname(profilePath), "Obserra-Command-Center-Endpoint-Bootstrap.json");
  atomicWriteJson(endpointPath, endpointProfile);
  store.set("bootstrap.originalProfilePath", profilePath);
  store.set("bootstrap.endpointProfilePath", endpointPath);
  store.set("bootstrap.profilePath", endpointPath);
  return endpointPath;
}

async function synchronizeGithubEvidence(trigger) {
  try {
    const result = await academyGithubEvidence.synchronize();
    store.set("academy.lastGithubSync", {
      trigger,
      synchronizedAt: result.synchronizedAt,
      runId: result.run?.id || null,
      artifactId: result.artifact?.id || null,
      gateHash: result.gateHash,
      stagedCourses: result.stagedCourses,
      expectedCourses: result.expectedCourses,
    });
    endpointRuntime.refresh();
    return result;
  } catch (error) {
    store.set("academy.lastGithubSyncFailure", {
      trigger,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function submitDecisionToGithub(decision) {
  let remoteSnapshot = academyGithubEvidence.snapshot();
  if (!remoteSnapshot.evidenceAvailable || remoteSnapshot.gate?.gateHash !== decision.gateHash) {
    await synchronizeGithubEvidence("owner-decision-pre-submit");
    remoteSnapshot = academyGithubEvidence.snapshot();
  }
  if (remoteSnapshot.gate?.gateHash !== decision.gateHash) {
    throw new Error("The synchronized GitHub approval gate does not match the recorded owner decision.");
  }
  return academyGithubEvidence.submitDecision(decision);
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    store.set("endpoint.lastDuplicateLaunch", {
      at: new Date().toISOString(),
      action: "duplicate-process-denied",
    });
  });

  app.whenReady().then(async () => {
    ipcMain.handle("remediation:getSnapshot", async () => remediationQueue.snapshot());
    ipcMain.handle("remediation:propose", async (_event, payload) => {
      const request = requireObject(payload, "Remediation proposal");
      const requestFinding = requireObject(request.finding, "Known-bad finding");
      const verifiedFinding = resolveVerifiedFinding(requestFinding.id || requestFinding.findingId);
      assertFindingEvidenceMatch(requestFinding, verifiedFinding);
      return remediationQueue.propose(
        { ...verifiedFinding, id: verifiedFinding.id || verifiedFinding.findingId },
        String(request.target || ""),
        Array.isArray(request.files) ? request.files : [],
      );
    });
    ipcMain.handle("remediation:decide", async (_event, payload) => {
      const request = requireObject(payload, "Remediation decision");
      return remediationQueue.decide(String(request.proposalId || ""), String(request.decision || ""), String(request.note || ""));
    });
    ipcMain.handle("remediation:execute", async (_event, proposalId) => remediationQueue.execute(String(proposalId || "")));
    ipcMain.handle("academy:getProductionEvidence", async () => currentAcademyEvidence());
    ipcMain.handle("academy:getGithubEvidence", async () => academyGithubEvidence.snapshot());
    ipcMain.handle("academy:syncGithubEvidence", async () => synchronizeGithubEvidence("owner-requested"));
    ipcMain.handle("academy:getReleaseApproval", async () => academyReleaseApproval.getSnapshot());
    ipcMain.handle("academy:recordReleaseDecision", async (_event, payload) => {
      const request = requireObject(payload, "Academy owner release decision");
      const decision = academyReleaseApproval.recordDecision({
        decision: request.decision,
        confirmation: request.confirmation,
        note: request.note,
      });
      let submission = null;
      let submissionError = null;
      try {
        submission = await submitDecisionToGithub(decision);
      } catch (error) {
        submissionError = error instanceof Error ? error.message : String(error);
      }
      endpointRuntime.refresh();
      return {
        decision,
        submission,
        submissionError,
        approval: academyReleaseApproval.getSnapshot(),
        githubEvidence: academyGithubEvidence.snapshot(),
        productionEvidence: currentAcademyEvidence(),
      };
    });
    ipcMain.handle("academy:submitRecordedReleaseDecision", async () => {
      const approval = academyReleaseApproval.getSnapshot();
      if (!approval.decision || approval.currentDecisionMatchesGate !== true) {
        throw new Error("No current device-bound owner decision is available for GitHub submission.");
      }
      return submitDecisionToGithub(approval.decision);
    });

    ipcMain.handle("academy:getControlSnapshot", async () => academyCourseControl.snapshot());
    ipcMain.handle("academy:updateReview", async (_event, payload) => academyCourseControl.updateReview(payload));
    ipcMain.handle("academy:transitionCourse", async (_event, payload) => academyCourseControl.transitionCourse(payload));
    ipcMain.handle("academy:listPurchases", async (_event, payload) => academyCourseControl.listPurchases(payload));
    ipcMain.handle("academy:verifyPurchase", async (_event, payload) => academyCourseControl.verifyPurchase(payload));
    ipcMain.handle("academy:getCommerceHealth", async () => academyCourseControl.commerceHealth({ force: true }));
    ipcMain.handle("academy:getPublicationJobs", async () => academyCourseControl.publicationJobs());
    ipcMain.handle("academy:getControlLedger", async (_event, limit) => academyCourseControl.ledger(limit));

    try {
      const profilePath = await waitForBootstrapProfile();
      if (profilePath) promoteEndpointBootstrapProfile(profilePath);
      await endpointRuntime.start();
      if (academyGithubEvidence.snapshot().tokenConfigured) {
        await synchronizeGithubEvidence("startup").catch(() => {});
      }
      githubSyncTimer = setInterval(() => {
        if (!academyGithubEvidence.snapshot().tokenConfigured) return;
        synchronizeGithubEvidence("scheduled").catch(() => {});
      }, githubSyncIntervalMs);
      githubSyncTimer.unref?.();
    } catch (error) {
      store.set("endpoint.startupFailure", {
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.on("before-quit", () => {
    if (githubSyncTimer) clearInterval(githubSyncTimer);
    endpointRuntime.stop().catch(() => {});
  });

  require("./main.cjs");
}
