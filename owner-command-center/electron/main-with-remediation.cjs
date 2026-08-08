const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const Store = require("electron-store");
const { createRemediationQueue } = require("./remediation-queue.cjs");

const APP_USER_MODEL_ID = "com.obserra.ownercommandcenter";
const hasSingleInstanceLock = app.requestSingleInstanceLock({
  application: "Obserra Owner AI Command Center",
  appId: APP_USER_MODEL_ID,
});

function runtimeEvidencePath() {
  return path.join(app.getPath("userData"), "runtime-evidence.jsonl");
}

function writeRuntimeEvidence(event, detail = {}) {
  try {
    const filePath = runtimeEvidencePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({
        schemaVersion: "1.0",
        recordedAt: new Date().toISOString(),
        event,
        pid: process.pid,
        platform: process.platform,
        ...detail,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch {
    // Runtime evidence must never expose secrets or prevent a fail-closed exit.
  }
}

if (!hasSingleInstanceLock) {
  writeRuntimeEvidence("second-instance-denied");
  app.quit();
} else {
  app.setAppUserModelId(APP_USER_MODEL_ID);

  app.on("second-instance", () => {
    writeRuntimeEvidence("second-instance-focused-existing-window");
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    writeRuntimeEvidence("render-process-gone", {
      webContentsId: webContents?.id || null,
      reason: details?.reason || "unknown",
      exitCode: Number.isInteger(details?.exitCode) ? details.exitCode : null,
    });
  });

  app.on("child-process-gone", (_event, details) => {
    writeRuntimeEvidence("child-process-gone", {
      processType: details?.type || "unknown",
      reason: details?.reason || "unknown",
      exitCode: Number.isInteger(details?.exitCode) ? details.exitCode : null,
      serviceName: details?.serviceName || null,
    });
  });

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    writeRuntimeEvidence("uncaught-exception", {
      origin: origin || "unknown",
      name: error?.name || "Error",
      message: error?.message || String(error),
    });
  });

  process.on("unhandledRejection", (reason) => {
    writeRuntimeEvidence("unhandled-rejection", {
      name: reason?.name || "Error",
      message: reason?.message || String(reason),
    });
    app.exit(1);
  });

  const store = new Store({ name: "owner-command-center" });
  const remediationQueue = createRemediationQueue(store);

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

  app.whenReady().then(() => {
    writeRuntimeEvidence("main-process-ready", {
      appVersion: app.getVersion(),
      appUserModelId: APP_USER_MODEL_ID,
      singleInstanceLock: true,
    });

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
  });

  app.on("before-quit", () => {
    writeRuntimeEvidence("main-process-before-quit");
  });

  require("./main.cjs");
}
