const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ENDPOINT_SCHEMA_VERSION = "1.0";
const BOOTSTRAP_SCHEMA_VERSION = "2.0";
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;
const RECEIPT_FILE = "endpoint-status.json";
const INSTALL_RECEIPT_FILE = "installation-receipt.json";
const ENROLL_CONFIRMATION = "ENROLL THIS ENDPOINT";
const REVOKE_CONFIRMATION = "REVOKE THIS ENDPOINT";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(temporaryPath, filePath);
}

function endpointDataDirectory(app) {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return path.join(localAppData, "Obserra", "OwnerCommandCenter");
  return path.join(app.getPath("userData"), "endpoint");
}

function validateBootstrapProfile(profile, hostname = os.hostname()) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("Command Center bootstrap profile is required for endpoint enrollment.");
  }
  if (profile.schemaVersion !== BOOTSTRAP_SCHEMA_VERSION) {
    throw new Error(`Endpoint enrollment requires bootstrap schema ${BOOTSTRAP_SCHEMA_VERSION}.`);
  }
  const targetHostname = String(profile.targetHostname || "").trim().toLowerCase();
  if (!targetHostname) throw new Error("Bootstrap targetHostname is required.");
  const normalizedHostname = String(hostname || "").trim().toLowerCase();
  const wildcard = targetHostname === "*";
  if (!wildcard && targetHostname !== normalizedHostname) {
    throw new Error(`Bootstrap targets ${targetHostname}, but the current endpoint is ${normalizedHostname}.`);
  }
  if (!Array.isArray(profile.connectors) || profile.connectors.length < 1) {
    throw new Error("Bootstrap connector inventory is required.");
  }
  if (profile.localOnly !== true) throw new Error("Bootstrap must enforce localOnly=true.");
  if (profile.requireEnrollment !== true) throw new Error("Bootstrap must require endpoint enrollment.");
  return {
    targetHostname,
    normalizedHostname,
    wildcard,
    autoEnroll: profile.autoEnroll === true,
    autoStart: profile.autoStart === true,
    heartbeatIntervalSeconds: Number.isFinite(Number(profile.heartbeatIntervalSeconds))
      ? Math.max(5, Math.min(300, Number(profile.heartbeatIntervalSeconds)))
      : DEFAULT_HEARTBEAT_INTERVAL_MS / 1000,
    profileId: String(profile.profileId || "").trim() || null
  };
}

function readBootstrapProfile(store) {
  const bootstrap = store.get("bootstrap");
  const profilePath = bootstrap?.profilePath;
  if (!profilePath || !fs.existsSync(profilePath)) {
    return { profile: null, validation: null, error: "verified-bootstrap-profile-not-found" };
  }
  try {
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    const validation = validateBootstrapProfile(profile);
    return { profile, validation, error: null };
  } catch (error) {
    return { profile: null, validation: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function encryptIdentitySecret(safeStorage, secret) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows credential encryption is required for endpoint identity.");
  }
  return safeStorage.encryptString(secret).toString("base64");
}

function decryptIdentitySecret(safeStorage, encrypted) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows credential encryption is required for endpoint identity.");
  }
  return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
}

function loadOrCreateIdentity(store, safeStorage) {
  const existing = store.get("endpoint.identity");
  if (existing?.deviceId && existing?.encryptedSecret) {
    const secret = decryptIdentitySecret(safeStorage, existing.encryptedSecret);
    return {
      deviceId: existing.deviceId,
      createdAt: existing.createdAt,
      secret,
      fingerprint: sha256(`${existing.deviceId}:${secret}:${os.hostname().toLowerCase()}`)
    };
  }

  const deviceId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("base64url");
  const createdAt = new Date().toISOString();
  store.set("endpoint.identity", {
    schemaVersion: ENDPOINT_SCHEMA_VERSION,
    deviceId,
    createdAt,
    encryptedSecret: encryptIdentitySecret(safeStorage, secret)
  });
  return {
    deviceId,
    createdAt,
    secret,
    fingerprint: sha256(`${deviceId}:${secret}:${os.hostname().toLowerCase()}`)
  };
}

function connectorSummary(store) {
  const configured = store.get("connectors") || {};
  const values = Object.values(configured)
    .map((entry) => entry?.lastStatus)
    .filter((entry) => entry && typeof entry === "object");
  return {
    observed: values.length,
    connected: values.filter((entry) => entry.status === "connected").length,
    degraded: values.filter((entry) => entry.status === "degraded").length,
    failed: values.filter((entry) => entry.status === "failed").length,
    controlEnabled: values.filter((entry) => entry.controlEnabled === true).length,
    lastCheckedAt: values.map((entry) => entry.checkedAt).filter(Boolean).sort().at(-1) || null
  };
}

function isHeartbeatFresh(value, now = Date.now(), maximumAgeMs = 60000) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= maximumAgeMs;
}

function sanitizeEndpointSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    product: snapshot.product,
    appVersion: snapshot.appVersion,
    hostname: snapshot.hostname,
    platform: snapshot.platform,
    deviceId: snapshot.deviceId,
    deviceFingerprint: snapshot.deviceFingerprint,
    enrollment: snapshot.enrollment,
    localOnly: snapshot.localOnly,
    windowsEncryption: snapshot.windowsEncryption,
    bootstrap: snapshot.bootstrap,
    endpointReady: snapshot.endpointReady,
    controlPlaneOperational: snapshot.controlPlaneOperational,
    blockers: snapshot.blockers,
    connectorSummary: snapshot.connectorSummary,
    academyProduction: snapshot.academyProduction,
    healthServer: snapshot.healthServer,
    installedExecutable: snapshot.installedExecutable,
    autoStartEnabled: snapshot.autoStartEnabled,
    processId: snapshot.processId,
    processStartedAt: snapshot.processStartedAt,
    lastHeartbeatAt: snapshot.lastHeartbeatAt,
    claimBoundary: snapshot.claimBoundary
  };
}

function createEndpointEnrollmentRuntime({
  store,
  app,
  safeStorage,
  ipcMain,
  academyEvidenceProvider,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  startHealthServer = true
}) {
  if (!store || !app || !safeStorage || !ipcMain) throw new Error("Endpoint runtime dependencies are required.");
  if (typeof academyEvidenceProvider !== "function") throw new Error("academyEvidenceProvider is required.");

  const processStartedAt = new Date().toISOString();
  const dataDirectory = endpointDataDirectory(app);
  const receiptPath = path.join(dataDirectory, RECEIPT_FILE);
  const installationReceiptPath = path.join(dataDirectory, INSTALL_RECEIPT_FILE);
  let identity = null;
  let healthServer = null;
  let healthPort = null;
  let heartbeatTimer = null;
  let latestSnapshot = null;
  let started = false;

  function enrollmentRecord() {
    return store.get("endpoint.enrollment") || null;
  }

  function configureAutoStart(profileValidation) {
    if (!profileValidation?.autoStart || typeof app.setLoginItemSettings !== "function") return false;
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: []
    });
    const settings = typeof app.getLoginItemSettings === "function" ? app.getLoginItemSettings() : { openAtLogin: true };
    return settings.openAtLogin === true;
  }

  function enroll({ confirmation = null, automatic = false } = {}) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    const bootstrap = readBootstrapProfile(store);
    if (bootstrap.error || !bootstrap.validation) throw new Error(bootstrap.error || "Verified bootstrap profile is unavailable.");
    if (bootstrap.validation.wildcard && automatic) {
      throw new Error("Wildcard bootstrap profiles require explicit owner enrollment.");
    }
    if (!automatic && confirmation !== ENROLL_CONFIRMATION) {
      throw new Error(`Endpoint enrollment requires confirmation text: ${ENROLL_CONFIRMATION}`);
    }
    if (!identity) identity = loadOrCreateIdentity(store, safeStorage);
    const enrolledAt = new Date().toISOString();
    const record = {
      schemaVersion: ENDPOINT_SCHEMA_VERSION,
      state: "enrolled",
      deviceId: identity.deviceId,
      deviceFingerprint: identity.fingerprint,
      hostname: os.hostname().toLowerCase(),
      profileId: bootstrap.validation.profileId,
      targetHostname: bootstrap.validation.targetHostname,
      automatic,
      enrolledAt
    };
    store.set("endpoint.enrollment", record);
    store.delete("endpoint.revocation");
    return record;
  }

  function revoke({ confirmation = null, reason = "owner-requested-revocation" } = {}) {
    if (confirmation !== REVOKE_CONFIRMATION) {
      throw new Error(`Endpoint revocation requires confirmation text: ${REVOKE_CONFIRMATION}`);
    }
    const current = enrollmentRecord();
    const revoked = {
      schemaVersion: ENDPOINT_SCHEMA_VERSION,
      state: "revoked",
      deviceId: current?.deviceId || identity?.deviceId || null,
      reason: String(reason || "owner-requested-revocation").slice(0, 500),
      revokedAt: new Date().toISOString()
    };
    store.set("endpoint.revocation", revoked);
    store.delete("endpoint.enrollment");
    return revoked;
  }

  function maybeAutoEnroll() {
    if (enrollmentRecord()) return;
    const bootstrap = readBootstrapProfile(store);
    if (bootstrap.error || !bootstrap.validation) return;
    if (!bootstrap.validation.autoEnroll || bootstrap.validation.wildcard) return;
    enroll({ automatic: true });
  }

  function buildSnapshot() {
    const heartbeatAt = new Date().toISOString();
    const bootstrap = readBootstrapProfile(store);
    const enrollment = enrollmentRecord();
    const academyProduction = academyEvidenceProvider();
    const encryption = safeStorage.isEncryptionAvailable();
    const bootstrapApplied = store.get("bootstrap.appliedAt") || store.get("bootstrap")?.appliedAt || null;
    const enrollmentValid = enrollment?.state === "enrolled"
      && enrollment.deviceId === identity?.deviceId
      && enrollment.deviceFingerprint === identity?.fingerprint
      && enrollment.hostname === os.hostname().toLowerCase();
    const blockers = [];
    if (!encryption) blockers.push("Windows credential encryption is unavailable.");
    if (bootstrap.error) blockers.push(`Bootstrap profile: ${bootstrap.error}.`);
    if (!bootstrapApplied) blockers.push("Bootstrap profile has not been applied by the Command Center.");
    if (!enrollmentValid) blockers.push("Endpoint enrollment is not verified.");
    if (!healthPort && startHealthServer) blockers.push("Loopback health service is not listening.");
    if (!academyProduction?.available) blockers.push("Academy production workspace evidence is unavailable.");

    const endpointReady = blockers.filter((blocker) => !blocker.startsWith("Academy production")).length === 0;
    const controlPlaneOperational = endpointReady
      && academyProduction?.available === true
      && academyProduction?.operational === true;
    const autoStartEnabled = bootstrap.validation ? configureAutoStart(bootstrap.validation) : false;

    return {
      schemaVersion: ENDPOINT_SCHEMA_VERSION,
      product: "Obserra Owner AI Command Center",
      appVersion: typeof app.getVersion === "function" ? app.getVersion() : "unknown",
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      deviceId: identity?.deviceId || null,
      deviceFingerprint: identity?.fingerprint || null,
      enrollment: enrollmentValid ? enrollment : { state: store.get("endpoint.revocation")?.state || "not-enrolled" },
      localOnly: true,
      windowsEncryption: encryption,
      bootstrap: {
        applied: Boolean(bootstrapApplied),
        appliedAt: bootstrapApplied,
        profileId: bootstrap.validation?.profileId || null,
        targetHostname: bootstrap.validation?.targetHostname || null,
        schemaVersion: bootstrap.profile?.schemaVersion || null,
        error: bootstrap.error
      },
      endpointReady,
      controlPlaneOperational,
      blockers: [...blockers, ...(academyProduction?.blockers || []).map((blocker) => `Academy: ${blocker}`)],
      connectorSummary: connectorSummary(store),
      academyProduction: academyProduction || null,
      healthServer: {
        boundAddress: "127.0.0.1",
        port: healthPort,
        healthUrl: healthPort ? `http://127.0.0.1:${healthPort}/healthz` : null,
        readinessUrl: healthPort ? `http://127.0.0.1:${healthPort}/readyz` : null
      },
      installedExecutable: process.execPath,
      autoStartEnabled,
      processId: process.pid,
      processStartedAt,
      lastHeartbeatAt: heartbeatAt,
      claimBoundary: "Endpoint ready proves the local process, target-bound bootstrap, encrypted device identity, enrollment, heartbeat receipt, and loopback health service. It does not prove that every connector is authenticated, every Academy course is complete, or publication is authorized."
    };
  }

  function refresh() {
    maybeAutoEnroll();
    latestSnapshot = buildSnapshot();
    atomicWriteJson(receiptPath, sanitizeEndpointSnapshot(latestSnapshot));
    if (latestSnapshot.endpointReady) {
      atomicWriteJson(installationReceiptPath, {
        schemaVersion: ENDPOINT_SCHEMA_VERSION,
        installedAt: store.get("endpoint.installationReceipt.installedAt") || new Date().toISOString(),
        verifiedAt: latestSnapshot.lastHeartbeatAt,
        hostname: latestSnapshot.hostname,
        deviceId: latestSnapshot.deviceId,
        deviceFingerprint: latestSnapshot.deviceFingerprint,
        appVersion: latestSnapshot.appVersion,
        executable: latestSnapshot.installedExecutable,
        bootstrapProfileId: latestSnapshot.bootstrap.profileId,
        endpointReady: true,
        controlPlaneOperational: latestSnapshot.controlPlaneOperational,
        receiptPath
      });
      store.set("endpoint.installationReceipt", {
        installedAt: store.get("endpoint.installationReceipt.installedAt") || new Date().toISOString(),
        verifiedAt: latestSnapshot.lastHeartbeatAt
      });
    }
    return sanitizeEndpointSnapshot(latestSnapshot);
  }

  function sendJson(response, statusCode, body) {
    const payload = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": payload.length,
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
    });
    response.end(payload);
  }

  function startLoopbackServer() {
    if (!startHealthServer || healthServer) return Promise.resolve();
    healthServer = http.createServer((request, response) => {
      const remoteAddress = request.socket.remoteAddress;
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
      if (!loopback) return sendJson(response, 403, { status: "denied" });
      if (!["GET", "HEAD"].includes(request.method || "")) return sendJson(response, 405, { status: "method-not-allowed" });
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const snapshot = latestSnapshot || refresh();
      if (url.pathname === "/healthz") {
        return sendJson(response, 200, {
          status: "ok",
          deviceId: snapshot.deviceId,
          endpointReady: snapshot.endpointReady,
          lastHeartbeatAt: snapshot.lastHeartbeatAt
        });
      }
      if (url.pathname === "/readyz") {
        return sendJson(response, snapshot.endpointReady ? 200 : 503, {
          status: snapshot.endpointReady ? "ready" : "not-ready",
          deviceId: snapshot.deviceId,
          endpointReady: snapshot.endpointReady,
          controlPlaneOperational: snapshot.controlPlaneOperational,
          blockers: snapshot.blockers,
          lastHeartbeatAt: snapshot.lastHeartbeatAt
        });
      }
      return sendJson(response, 404, { status: "not-found" });
    });
    return new Promise((resolve, reject) => {
      healthServer.once("error", reject);
      healthServer.listen(0, "127.0.0.1", () => {
        const address = healthServer.address();
        healthPort = typeof address === "object" && address ? address.port : null;
        resolve();
      });
    });
  }

  async function start() {
    if (started) return refresh();
    started = true;
    identity = loadOrCreateIdentity(store, safeStorage);
    await startLoopbackServer();
    ipcMain.handle("endpoint:getSnapshot", async () => refresh());
    ipcMain.handle("endpoint:refresh", async () => refresh());
    ipcMain.handle("endpoint:enroll", async (_event, payload) => {
      const record = enroll({ confirmation: payload?.confirmation });
      refresh();
      return record;
    });
    ipcMain.handle("endpoint:revoke", async (_event, payload) => {
      const record = revoke({ confirmation: payload?.confirmation, reason: payload?.reason });
      refresh();
      return record;
    });
    refresh();
    heartbeatTimer = setInterval(() => {
      try { refresh(); }
      catch (error) {
        store.set("endpoint.lastHeartbeatError", {
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, Math.max(5000, heartbeatIntervalMs));
    heartbeatTimer.unref?.();
    return sanitizeEndpointSnapshot(latestSnapshot);
  }

  async function stop() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (healthServer) {
      await new Promise((resolve) => healthServer.close(resolve));
    }
    healthServer = null;
    healthPort = null;
  }

  return {
    start,
    stop,
    refresh,
    enroll,
    revoke,
    getSnapshot: () => latestSnapshot ? sanitizeEndpointSnapshot(latestSnapshot) : refresh(),
    receiptPath,
    installationReceiptPath
  };
}

module.exports = {
  BOOTSTRAP_SCHEMA_VERSION,
  ENDPOINT_SCHEMA_VERSION,
  ENROLL_CONFIRMATION,
  INSTALL_RECEIPT_FILE,
  RECEIPT_FILE,
  REVOKE_CONFIRMATION,
  atomicWriteJson,
  createEndpointEnrollmentRuntime,
  endpointDataDirectory,
  isHeartbeatFresh,
  sanitizeEndpointSnapshot,
  validateBootstrapProfile
};
