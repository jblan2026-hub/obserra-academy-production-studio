const fs = require("node:fs");
const path = require("node:path");
const { app, ipcMain, safeStorage } = require("electron");
const Store = require("electron-store");
const { createRemediationQueue } = require("./remediation-queue.cjs");
const { getAcademyProductionEvidence } = require("./academy-production-evidence.cjs");
const { createEndpointEnrollmentRuntime } = require("./endpoint-enrollment.cjs");

const store = new Store({ name: "owner-command-center" });
const remediationQueue = createRemediationQueue(store);
const endpointRuntime = createEndpointEnrollmentRuntime({
  store,
  app,
  safeStorage,
  ipcMain,
  academyEvidenceProvider: () => getAcademyProductionEvidence(),
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
  ipcMain.handle("academy:getProductionEvidence", async () => getAcademyProductionEvidence());

  try {
    const profilePath = await waitForBootstrapProfile();
    if (profilePath) promoteEndpointBootstrapProfile(profilePath);
    await endpointRuntime.start();
  } catch (error) {
    store.set("endpoint.startupFailure", {
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.on("before-quit", () => {
  endpointRuntime.stop().catch(() => {});
});

require("./main.cjs");
