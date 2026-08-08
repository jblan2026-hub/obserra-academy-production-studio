import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ENROLL_CONFIRMATION,
  REVOKE_CONFIRMATION,
  createEndpointEnrollmentRuntime,
  isHeartbeatFresh,
  validateBootstrapProfile,
} = require("../electron/endpoint-enrollment.cjs");

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
  delete(key) {
    const parts = this.parts(key);
    let value = this.state;
    for (const part of parts.slice(0, -1)) {
      if (!value[part] || typeof value[part] !== "object") return;
      value = value[part];
    }
    delete value[parts.at(-1)];
  }
}

class IpcRegistry {
  constructor() { this.handlers = new Map(); }
  handle(name, handler) {
    if (this.handlers.has(name)) throw new Error(`Duplicate IPC handler ${name}`);
    this.handlers.set(name, handler);
  }
  async invoke(name, payload) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Missing IPC handler ${name}`);
    return handler({}, payload);
  }
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "obserra-command-center-endpoint-"));
const previousLocalAppData = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = temporaryRoot;

let loginItemSettings = { openAtLogin: false };
const app = {
  getPath: () => temporaryRoot,
  getVersion: () => "0.3.0-test",
  setLoginItemSettings: (settings) => { loginItemSettings = { ...settings }; },
  getLoginItemSettings: () => ({ ...loginItemSettings }),
};
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (value) => {
    const decoded = value.toString("utf8");
    if (!decoded.startsWith("protected:")) throw new Error("Invalid protected value");
    return decoded.slice("protected:".length);
  },
};
const store = new MemoryStore();
const ipcMain = new IpcRegistry();

const bootstrapPath = path.join(temporaryRoot, "Obserra-Command-Center-Endpoint-Bootstrap.json");
const bootstrapProfile = {
  schemaVersion: "2.0",
  profileId: "test-live-endpoint",
  targetHostname: os.hostname().toLowerCase(),
  localOnly: true,
  requireEnrollment: true,
  autoEnroll: true,
  autoStart: true,
  heartbeatIntervalSeconds: 15,
  connectors: [{ id: "academy", url: "https://example.invalid" }],
};
fs.writeFileSync(bootstrapPath, `${JSON.stringify(bootstrapProfile, null, 2)}\n`);
store.set("bootstrap", {
  appliedAt: new Date().toISOString(),
  profilePath: bootstrapPath,
  profileId: bootstrapProfile.profileId,
  targetHostname: bootstrapProfile.targetHostname,
});

const academyEvidenceProvider = () => ({
  available: true,
  operational: false,
  blockers: ["Synthetic verification fixture keeps Academy blocked."],
  workerTarget: 36,
  workerStatus: { configuredCourseWorkers: 36, configuredApplicationWorkers: 0 },
});

const runtime = createEndpointEnrollmentRuntime({
  store,
  app,
  safeStorage,
  ipcMain,
  academyEvidenceProvider,
  heartbeatIntervalMs: 5000,
  startHealthServer: true,
});

try {
  const validation = validateBootstrapProfile(bootstrapProfile, os.hostname());
  assert.equal(validation.autoEnroll, true);
  assert.equal(validation.autoStart, true);
  assert.equal(validation.wildcard, false);
  assert.throws(
    () => validateBootstrapProfile({ ...bootstrapProfile, targetHostname: "another-host" }, os.hostname()),
    /targets another-host/,
  );

  const snapshot = await runtime.start();
  assert.equal(snapshot.endpointReady, true);
  assert.equal(snapshot.controlPlaneOperational, false);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.windowsEncryption, true);
  assert.equal(snapshot.bootstrap.applied, true);
  assert.equal(snapshot.bootstrap.schemaVersion, "2.0");
  assert.equal(snapshot.enrollment.state, "enrolled");
  assert.equal(snapshot.enrollment.automatic, true);
  assert.equal(snapshot.autoStartEnabled, true);
  assert.equal(loginItemSettings.openAtLogin, true);
  assert.ok(snapshot.deviceId);
  assert.match(snapshot.deviceFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(snapshot.healthServer.readinessUrl);
  assert.ok(isHeartbeatFresh(snapshot.lastHeartbeatAt));
  assert.ok(fs.existsSync(runtime.receiptPath));
  assert.ok(fs.existsSync(runtime.installationReceiptPath));

  const readinessResponse = await fetch(snapshot.healthServer.readinessUrl);
  assert.equal(readinessResponse.status, 200);
  const readiness = await readinessResponse.json();
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.deviceId, snapshot.deviceId);

  const revoked = await ipcMain.invoke("endpoint:revoke", {
    confirmation: REVOKE_CONFIRMATION,
    reason: "verification-test",
  });
  assert.equal(revoked.state, "revoked");
  const revokedSnapshot = await ipcMain.invoke("endpoint:getSnapshot");
  assert.equal(revokedSnapshot.endpointReady, false);
  assert.notEqual(revokedSnapshot.enrollment.state, "enrolled");

  const enrolled = await ipcMain.invoke("endpoint:enroll", { confirmation: ENROLL_CONFIRMATION });
  assert.equal(enrolled.state, "enrolled");
  const reenrolledSnapshot = await ipcMain.invoke("endpoint:refresh");
  assert.equal(reenrolledSnapshot.endpointReady, true);

  console.log(JSON.stringify({
    gate: "owner-command-center-endpoint-enrollment",
    endpointReady: snapshot.endpointReady,
    controlPlaneOperational: snapshot.controlPlaneOperational,
    enrollmentState: snapshot.enrollment.state,
    autoStartEnabled: snapshot.autoStartEnabled,
    loopbackReadiness: readiness.status,
    receiptCreated: fs.existsSync(runtime.receiptPath),
    installationReceiptCreated: fs.existsSync(runtime.installationReceiptPath),
    revocationVerified: revoked.state === "revoked",
    reenrollmentVerified: reenrolledSnapshot.endpointReady,
    passed: true,
  }, null, 2));
} finally {
  await runtime.stop();
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
