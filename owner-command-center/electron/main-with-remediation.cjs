const fs = require("node:fs");
const path = require("node:path");
const { app, ipcMain, safeStorage } = require("electron");

const { createRemediationQueue } = require("./remediation-queue.cjs");
const { getAcademyProductionEvidence } = require("./academy-production-evidence.cjs");
const { createAcademyReleaseApproval } = require("./academy-release-approval.cjs");
const { createAcademyGithubEvidence } = require("./academy-github-evidence.cjs");
const { resolveStudioRoot } = require("./academy-studio.cjs");
const { createEndpointEnrollmentRuntime } = require("./endpoint-enrollment.cjs");
const { getOwnerCommandCenterStore } = require("./store.cjs");
const { createWebNetworkMonitor } = require("./web-network-monitor.cjs");

const BOOTSTRAP_FILE = "Obserra-Command-Center-Bootstrap.json";
const store = getOwnerCommandCenterStore();
const remediationQueue = createRemediationQueue(store);
const academyGithubEvidence = createAcademyGithubEvidence({ store, safeStorage, app });
const webNetworkMonitor = createWebNetworkMonitor({ store });
const githubSyncIntervalMs = Math.max(
  30000,
  Math.min(15 * 60 * 1000, Number(process.env.ACADEMY_GITHUB_SYNC_INTERVAL_MS || 60000)),
);
const webpageMonitorIntervalMs = Math.max(
  30000,
  Math.min(15 * 60 * 1000, Number(process.env.OBSERRA_WEBPAGE_MONITOR_INTERVAL_MS || 60000)),
);
const networkMonitorIntervalMs = Math.max(
  30000,
  Math.min(15 * 60 * 1000, Number(process.env.OBSERRA_NETWORK_MONITOR_INTERVAL_MS || 60000)),
);
let githubSyncTimer = null;
let webpageMonitorTimer = null;
let networkMonitorTimer = null;
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

endpointRuntime = createEndpointEnrollmentRuntime({
  store,
  app,
  safeStorage,
  ipcMain,
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

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function stableMappingKey(mapping) {
  if (typeof mapping === "string") return mapping.trim();
  return [mapping?.framework, mapping?.id, mapping?.title].filter(Boolean).join(":");
}

function resolveVerifiedFinding(findingId) {
  const lastScan = store.get("security.lastScan");
  const findings = lastScan?.scan?.findings;
  if (!Array.isArray(findings)) {
    throw new Error("A completed verified security scan is required before remediation can be proposed");
  }
  const verified = findings.find(
    (item) => String(item.id || item.findingId || "") === String(findingId || ""),
  );
  if (!verified) {
    throw new Error("Remediation finding is not present in the latest verified security scan");
  }
  if (verified.knownBad !== true) {
    throw new Error("Only verified mapped known-bad findings can enter remediation");
  }
  if (!["high", "critical"].includes(String(verified.severity || "").toLowerCase())) {
    throw new Error("Remediation requires a high or critical verified finding");
  }
  if (!Array.isArray(verified.mappings) || verified.mappings.length === 0) {
    throw new Error("Verified MITRE or OWASP mappings are required");
  }
  return verified;
}

function assertFindingEvidenceMatch(requestFinding, verifiedFinding) {
  const requestedMappings = new Set(
    (requestFinding.mappings || []).map(stableMappingKey).filter(Boolean),
  );
  const verifiedMappings = new Set(
    (verifiedFinding.mappings || []).map(stableMappingKey).filter(Boolean),
  );
  if (
    requestedMappings.size !== verifiedMappings.size
    || [...requestedMappings].some((item) => !verifiedMappings.has(item))
  ) {
    throw new Error("Remediation mappings do not match the latest verified scan evidence");
  }
  if (
    String(requestFinding.severity || "").toLowerCase()
    !== String(verifiedFinding.severity || "").toLowerCase()
  ) {
    throw new Error("Remediation severity does not match the latest verified scan evidence");
  }
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

function bootstrapCandidates() {
  const candidates = [
    process.env.OBSERRA_COMMAND_CENTER_BOOTSTRAP,
    store.get("bootstrap.profilePath"),
    path.join(path.dirname(process.execPath), BOOTSTRAP_FILE),
    process.resourcesPath ? path.join(process.resourcesPath, BOOTSTRAP_FILE) : null,
    path.join(app.getAppPath(), BOOTSTRAP_FILE),
    path.join(app.getAppPath(), "resources", BOOTSTRAP_FILE),
  ].filter(Boolean);
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function resolveBootstrapProfilePath() {
  return bootstrapCandidates().find((candidate) => fs.existsSync(candidate)) || null;
}

async function waitForBootstrapProfile(timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const profilePath = resolveBootstrapProfilePath();
    if (profilePath) return profilePath;
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
  const targetHostname = String(profile.targetHostname || "*").trim().toLowerCase() || "*";
  const endpointProfile = {
    ...profile,
    schemaVersion: "2.0",
    targetHostname,
    localOnly: true,
    requireEnrollment: true,
    autoEnroll: profile.autoEnroll === true && targetHostname !== "*",
    autoStart: profile.autoStart !== false,
    heartbeatIntervalSeconds: Number(profile.heartbeatIntervalSeconds || 15),
    endpointProfileGeneratedAt: new Date().toISOString(),
  };
  const endpointPath = path.join(
    app.getPath("userData"),
    "Obserra-Command-Center-Endpoint-Bootstrap.json",
  );
  atomicWriteJson(endpointPath, endpointProfile);
  const appliedAt = new Date().toISOString();
  store.set("bootstrap", {
    appliedAt,
    profilePath: endpointPath,
    originalProfilePath: profilePath,
    endpointProfilePath: endpointPath,
    targetHostname,
    profileId: endpointProfile.profileId || null,
  });
  return endpointPath;
}

function endpointFailureSnapshot(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    schemaVersion: "1.0",
    product: "Obserra Owner AI Command Center",
    appVersion: typeof app.getVersion === "function" ? app.getVersion() : "unknown",
    hostname: require("node:os").hostname(),
    platform: `${require("node:os").type()} ${require("node:os").release()}`,
    deviceId: null,
    enrollment: { state: "unavailable" },
    localOnly: true,
    windowsEncryption: safeStorage.isEncryptionAvailable(),
    bootstrap: {
      applied: Boolean(store.get("bootstrap.appliedAt")),
      profileId: store.get("bootstrap.profileId") || null,
      targetHostname: store.get("bootstrap.targetHostname") || null,
      error: message,
    },
    endpointReady: false,
    controlPlaneOperational: false,
    blockers: [`Endpoint enrollment runtime failed to start: ${message}`],
    connectorSummary: {},
    academyProduction: null,
    healthServer: { boundAddress: "127.0.0.1", port: null, healthUrl: null, readinessUrl: null },
    autoStartEnabled: false,
    processId: process.pid,
    processStartedAt: null,
    lastHeartbeatAt: null,
    claimBoundary: "The endpoint is not operational because its enrollment runtime did not start.",
  };
}

function registerEndpointFailureHandlers(error) {
  const snapshot = endpointFailureSnapshot(error);
  for (const name of [
    "endpoint:getSnapshot",
    "endpoint:refresh",
    "endpoint:enroll",
    "endpoint:revoke",
  ]) {
    ipcMain.removeHandler(name);
  }
  ipcMain.handle("endpoint:getSnapshot", async () => snapshot);
  ipcMain.handle("endpoint:refresh", async () => snapshot);
  ipcMain.handle("endpoint:enroll", async () => {
    throw new Error(snapshot.blockers[0]);
  });
  ipcMain.handle("endpoint:revoke", async () => {
    throw new Error(snapshot.blockers[0]);
  });
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

async function runtimeHealth() {
  let endpoint;
  try {
    endpoint = endpointRuntime.getSnapshot();
  } catch (error) {
    endpoint = endpointFailureSnapshot(error);
  }
  const webpage = webNetworkMonitor.getPageSnapshot();
  const network = webNetworkMonitor.getNetworkSnapshot();
  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    },
    endpoint,
    webpage,
    network,
    background: {
      academyGithubSync: store.get("academy.lastGithubSync") || null,
      academyGithubSyncFailure: store.get("academy.lastGithubSyncFailure") || null,
      endpointStartupFailure: store.get("endpoint.startupFailure") || null,
      commandCenterStartup: store.get("startup") || null,
      monitorLastCycle: store.get("monitor.lastCycle") || null,
    },
  };
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
    ipcMain.handle("runtime:getHealth", async () => runtimeHealth());
    ipcMain.handle("webpages:getSnapshot", async () => webNetworkMonitor.getPageSnapshot());
    ipcMain.handle("webpages:scanAll", async () => webNetworkMonitor.scanAll("owner-requested"));
    ipcMain.handle("webpages:scanOne", async (_event, pageId) => webNetworkMonitor.scanOne(pageId));
    ipcMain.handle("webpages:add", async (_event, payload) => {
      const page = webNetworkMonitor.addOrUpdatePage(requireObject(payload, "Monitored webpage"));
      const result = await webNetworkMonitor.scanOne(page.id);
      return { page, result, snapshot: webNetworkMonitor.getPageSnapshot() };
    });
    ipcMain.handle("webpages:remove", async (_event, pageId) => {
      const result = webNetworkMonitor.removePage(pageId);
      return { ...result, snapshot: webNetworkMonitor.getPageSnapshot() };
    });
    ipcMain.handle("network:getSnapshot", async () => webNetworkMonitor.getNetworkSnapshot());
    ipcMain.handle("network:analyzeNow", async () => webNetworkMonitor.analyzeNetwork("owner-requested"));

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
      return remediationQueue.decide(
        String(request.proposalId || ""),
        String(request.decision || ""),
        String(request.note || ""),
      );
    });
    ipcMain.handle(
      "remediation:execute",
      async (_event, proposalId) => remediationQueue.execute(String(proposalId || "")),
    );
    ipcMain.handle("academy:getProductionEvidence", async () => currentAcademyEvidence());
    ipcMain.handle("academy:getGithubEvidence", async () => academyGithubEvidence.snapshot());
    ipcMain.handle(
      "academy:syncGithubEvidence",
      async () => synchronizeGithubEvidence("owner-requested"),
    );
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

    try {
      const profilePath = resolveBootstrapProfilePath() || await waitForBootstrapProfile();
      if (!profilePath) {
        throw new Error("The installed Command Center bootstrap profile could not be located.");
      }
      promoteEndpointBootstrapProfile(profilePath);
      await endpointRuntime.start();
      if (academyGithubEvidence.snapshot().tokenConfigured) {
        await synchronizeGithubEvidence("startup").catch(() => {});
      }
    } catch (error) {
      store.set("endpoint.startupFailure", {
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      registerEndpointFailureHandlers(error);
    }

    await Promise.allSettled([
      webNetworkMonitor.scanAll("startup"),
      webNetworkMonitor.analyzeNetwork("startup"),
    ]);

    if (academyGithubEvidence.snapshot().tokenConfigured) {
      githubSyncTimer = setInterval(() => {
        if (!academyGithubEvidence.snapshot().tokenConfigured) return;
        synchronizeGithubEvidence("scheduled").catch(() => {});
      }, githubSyncIntervalMs);
      githubSyncTimer.unref?.();
    }
    webpageMonitorTimer = setInterval(() => {
      webNetworkMonitor.scanAll("scheduled").catch((error) => {
        store.set("webpages.lastFailure", {
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, webpageMonitorIntervalMs);
    webpageMonitorTimer.unref?.();
    networkMonitorTimer = setInterval(() => {
      webNetworkMonitor.analyzeNetwork("scheduled").catch((error) => {
        store.set("network.lastFailure", {
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, networkMonitorIntervalMs);
    networkMonitorTimer.unref?.();
  });

  app.on("before-quit", () => {
    if (githubSyncTimer) clearInterval(githubSyncTimer);
    if (webpageMonitorTimer) clearInterval(webpageMonitorTimer);
    if (networkMonitorTimer) clearInterval(networkMonitorTimer);
    endpointRuntime.stop().catch(() => {});
  });

  require("./main.cjs");
}
