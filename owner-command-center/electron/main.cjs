const { app, BrowserWindow, ipcMain, safeStorage, session, dialog } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const crypto = require("node:crypto");
const Store = require("electron-store");
const { resolvedConnectors, normalizeBaseUrl } = require("./connectors.cjs");
const { getStudioSnapshot, updateCourseMetadata, runStudioAction } = require("./academy-studio.cjs");
const { previewCourse, previewMaterials, previewCertificate } = require("./academy-preview.cjs");
const { createOwnerAI } = require("./owner-ai.cjs");
const { networkTopology, collectIntelligence } = require("./discovery.cjs");

const store = new Store({ name: "owner-command-center" });
const ownerAI = createOwnerAI(store);
const REQUEST_TIMEOUT_MS = 10000;
const MONITOR_INTERVAL_MS = 30000;
const BOOTSTRAP_FILE = "Obserra-Command-Center-Bootstrap.json";
let monitorTimer;
let monitorInFlight = false;

function assertLocalOnly() {
  app.commandLine.appendSwitch("disable-remote-fonts");
  app.commandLine.appendSwitch("disable-background-networking");
}

function bootstrapCandidates() {
  return [
    process.env.OBSERRA_COMMAND_CENTER_BOOTSTRAP,
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Obserra", "OwnerCommandCenter", BOOTSTRAP_FILE),
    path.join(path.dirname(process.execPath), BOOTSTRAP_FILE),
    path.join(app.getPath("userData"), BOOTSTRAP_FILE)
  ].filter(Boolean);
}

function applyBootstrapProfile() {
  const profilePath = bootstrapCandidates().find((candidate) => fs.existsSync(candidate));
  if (!profilePath) return { applied: false, reason: "not-found" };
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  if (profile.schemaVersion !== "1.0") throw new Error("Unsupported Command Center bootstrap schema");
  const hostname = os.hostname().toLowerCase();
  const target = String(profile.targetHostname || "").toLowerCase();
  if (target && target !== "*" && hostname !== target) return { applied: false, reason: "hostname-mismatch", targetHostname: target, hostname };
  for (const connector of profile.connectors || []) {
    if (!connector?.id || !connector?.url) continue;
    store.set(`connectors.${connector.id}.url`, normalizeBaseUrl(connector.url));
  }
  store.set("bootstrap", { appliedAt: new Date().toISOString(), profilePath, targetHostname: target || "*", profileId: profile.profileId || null });
  return { applied: true, profilePath, targetHostname: target || "*", profileId: profile.profileId || null };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1720,
    height: 1040,
    minWidth: 1280,
    minHeight: 760,
    backgroundColor: "#05070b",
    title: "Obserra Owner AI Command Center",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: process.env.NODE_ENV !== "production"
    }
  });
  window.removeMenu();
  window.loadFile(path.join(__dirname, "../src/index.html"));
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("file://")) event.preventDefault(); });
}

function encryptForDevice(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable");
  return safeStorage.encryptString(value).toString("base64");
}
function decryptForDevice(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable");
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}
function getSecret(key) {
  const value = store.get(`secrets.${key}`);
  return typeof value === "string" ? decryptForDevice(value) : undefined;
}
function setSecret(key, value) { store.set(`secrets.${key}`, encryptForDevice(value)); }
function connectorHeaders(connector) {
  const secret = connector.credentialKey ? getSecret(connector.credentialKey) : undefined;
  const headers = { Accept: "application/json", "User-Agent": "Obserra-Owner-Command-Center" };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

async function probeConnector(connector) {
  const credentialConfigured = !connector.credentialKey || Boolean(store.get(`secrets.${connector.credentialKey}`));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${connector.url}${connector.healthPath}`, { method: "GET", headers: connectorHeaders(connector), signal: controller.signal, redirect: "error" });
    const healthy = response.ok;
    const result = { ...connector, configured: true, credentialConfigured, status: healthy ? "connected" : "degraded", httpStatus: response.status, controlEnabled: healthy && connector.control === true && credentialConfigured, checkedAt: new Date().toISOString() };
    store.set(`connectors.${connector.id}.lastStatus`, result);
    return result;
  } catch (error) {
    const cached = store.get(`connectors.${connector.id}.lastStatus`);
    return { ...connector, configured: true, credentialConfigured, status: "failed", controlEnabled: false, cachedStatus: cached || null, error: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() };
  } finally { clearTimeout(timeout); }
}

async function runMonitoringCycle(trigger = "continuous-monitor") {
  if (monitorInFlight) return { skipped: true, reason: "monitor-in-flight", ownerAI: ownerAI.getSnapshot() };
  monitorInFlight = true;
  try {
    const connectors = resolvedConnectors(store);
    const [statuses, academy, intelligenceReports] = await Promise.all([
      Promise.all(connectors.map(probeConnector)),
      Promise.resolve(getStudioSnapshot()),
      Promise.all(connectors.filter((connector) => connector.intelligencePath).map((connector) => collectIntelligence(connector, connectorHeaders(connector))))
    ]);
    const network = networkTopology(connectors);
    const websiteReport = intelligenceReports.find((report) => report?.sourceId === "website" && report.status === "reporting")?.report || null;
    const analysis = ownerAI.analyzeCycle({
      connectors: statuses,
      academy,
      network,
      serviceManifest: websiteReport?.services || null,
      deployment: websiteReport?.deployment || null,
      identity: websiteReport?.identity || null,
      intelligenceReports: intelligenceReports.filter(Boolean).map((report) => ({ ...report, trigger }))
    });
    store.set("monitor.lastCycle", { checkedAt: new Date().toISOString(), trigger, connectors: statuses, academySummary: academy.summary, intelligenceReports });
    return { skipped: false, connectors: statuses, academy, intelligenceReports, ownerAI: analysis.snapshot };
  } finally {
    monitorInFlight = false;
  }
}

function authorizeAcademyAction(action, courseId) {
  const scope = courseId ? `academy:${courseId}` : action === "catalog" ? "catalog:academy" : "academy:*";
  ownerAI.assertScopeWritable(scope);
  ownerAI.authorizeChange(scope, { action, courseId: courseId || null, origin: "command-center" });
}

function deriveBundleKey(passphrase, salt) { return crypto.scryptSync(passphrase, salt, 32); }
function encryptRecoveryBundle(payload, passphrase) {
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12); const key = deriveBundleKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { schemaVersion: "1.1", algorithm: "aes-256-gcm+scrypt", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
function decryptRecoveryBundle(bundle, passphrase) {
  if (bundle?.algorithm !== "aes-256-gcm+scrypt") throw new Error("Unsupported recovery bundle format");
  const key = deriveBundleKey(passphrase, Buffer.from(bundle.salt, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(bundle.iv, "base64"));
  decipher.setAuthTag(Buffer.from(bundle.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

assertLocalOnly();
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  let bootstrap;
  try { bootstrap = applyBootstrapProfile(); }
  catch (error) { bootstrap = { applied: false, reason: "invalid", error: error instanceof Error ? error.message : String(error) }; }

  const initialCycle = await runMonitoringCycle("startup");
  store.set("startup", { checkedAt: new Date().toISOString(), bootstrap, connectors: initialCycle.connectors || [] });
  monitorTimer = setInterval(() => { runMonitoringCycle().catch((error) => ownerAI.remember(`Continuous monitor error: ${error.message || String(error)}`, "system", ["monitor-error"])); }, MONITOR_INTERVAL_MS);

  ipcMain.handle("system:getSnapshot", async () => ({ hostname: os.hostname(), platform: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model ?? "Unknown CPU", logicalProcessors: os.cpus().length, totalMemoryGb: Math.round(os.totalmem() / 1024 / 1024 / 1024), freeMemoryGb: Math.round(os.freemem() / 1024 / 1024 / 1024), uptimeSeconds: os.uptime(), localOnly: true, windowsEncryption: safeStorage.isEncryptionAvailable(), bootstrap, startupCheckedAt: store.get("startup.checkedAt"), monitorIntervalSeconds: MONITOR_INTERVAL_MS / 1000 }));
  ipcMain.handle("connectors:list", async () => resolvedConnectors(store).map((connector) => ({ ...connector, configured: true, credentialConfigured: !connector.credentialKey || Boolean(store.get(`secrets.${connector.credentialKey}`)), controlEnabled: false, lastStatus: store.get(`connectors.${connector.id}.lastStatus`) || null })));
  ipcMain.handle("connectors:probe", async (_event, id) => {
    const connector = resolvedConnectors(store).find((item) => item.id === id);
    if (!connector) throw new Error("Unknown connector");
    const result = await probeConnector(connector);
    ownerAI.analyzeCycle({ connectors: [result] });
    return result;
  });
  ipcMain.handle("connectors:probeAll", async () => (await runMonitoringCycle("manual-connector-refresh")).connectors || []);
  ipcMain.handle("connectors:configure", async (_event, payload) => {
    const connector = resolvedConnectors(store).find((item) => item.id === payload?.id);
    if (!connector) throw new Error("Unknown connector");
    ownerAI.assertScopeWritable(`connector:${connector.id}`);
    ownerAI.authorizeChange(`connector:${connector.id}`, { action: "configure", origin: "command-center" });
    if (payload.url) store.set(`connectors.${connector.id}.url`, normalizeBaseUrl(payload.url));
    if (connector.credentialKey && payload.secret) setSecret(connector.credentialKey, payload.secret);
    return probeConnector(resolvedConnectors(store).find((item) => item.id === connector.id));
  });

  ipcMain.handle("academy:getSnapshot", async () => getStudioSnapshot());
  ipcMain.handle("academy:updateCourse", async (_event, payload) => {
    const courseId = payload?.courseId;
    authorizeAcademyAction("update", courseId);
    const result = updateCourseMetadata(payload);
    await runMonitoringCycle("academy-update");
    return result;
  });
  ipcMain.handle("academy:runAction", async (_event, payload) => {
    authorizeAcademyAction(payload?.action, payload?.courseId);
    const result = await runStudioAction(payload?.action, payload?.courseId);
    await runMonitoringCycle(`academy-${payload?.action || "action"}`);
    return result;
  });
  ipcMain.handle("academy:previewCourse", async (_event, courseId) => previewCourse(courseId));
  ipcMain.handle("academy:previewMaterials", async (_event, courseId) => previewMaterials(courseId));
  ipcMain.handle("academy:previewCertificate", async (_event, courseId) => previewCertificate(courseId));

  ipcMain.handle("ownerAI:getSnapshot", async () => ownerAI.getSnapshot());
  ipcMain.handle("ownerAI:analyzeNow", async () => runMonitoringCycle("owner-requested-analysis"));
  ipcMain.handle("ownerAI:remember", async (_event, payload) => ownerAI.remember(payload?.text, "owner", payload?.tags));
  ipcMain.handle("ownerAI:decideApproval", async (_event, payload) => ownerAI.decideApproval(payload?.id, payload?.decision, payload?.note));
  ipcMain.handle("ownerAI:acknowledgeRecommendation", async (_event, id) => ownerAI.acknowledgeRecommendation(id));

  ipcMain.handle("recovery:export", async (_event, passphrase) => {
    if (typeof passphrase !== "string" || passphrase.length < 14) throw new Error("Recovery passphrase must contain at least 14 characters");
    const secrets = {};
    for (const connector of resolvedConnectors(store)) {
      if (connector.credentialKey) {
        const value = getSecret(connector.credentialKey);
        if (value) secrets[connector.credentialKey] = value;
      }
    }
    const payload = { createdAt: new Date().toISOString(), ownerDevice: os.hostname(), connectors: resolvedConnectors(store).map(({ id, url }) => ({ id, url })), secrets, ownerAiState: store.get("ownerAi.state") || null };
    const result = await dialog.showSaveDialog({ title: "Export encrypted Obserra owner recovery bundle", defaultPath: `Obserra-Owner-Recovery-${new Date().toISOString().slice(0, 10)}.obserra-recovery`, filters: [{ name: "Obserra Recovery Bundle", extensions: ["obserra-recovery"] }] });
    if (result.canceled || !result.filePath) return { exported: false };
    fs.writeFileSync(result.filePath, JSON.stringify(encryptRecoveryBundle(payload, passphrase), null, 2), { encoding: "utf8", mode: 0o600 });
    return { exported: true, path: result.filePath };
  });
  ipcMain.handle("recovery:import", async (_event, passphrase) => {
    if (typeof passphrase !== "string" || !passphrase) throw new Error("Recovery passphrase is required");
    const result = await dialog.showOpenDialog({ title: "Import encrypted Obserra owner recovery bundle", properties: ["openFile"], filters: [{ name: "Obserra Recovery Bundle", extensions: ["obserra-recovery"] }] });
    if (result.canceled || !result.filePaths[0]) return { imported: false };
    const payload = decryptRecoveryBundle(JSON.parse(fs.readFileSync(result.filePaths[0], "utf8")), passphrase);
    for (const connector of payload.connectors || []) store.set(`connectors.${connector.id}.url`, normalizeBaseUrl(connector.url));
    for (const [key, value] of Object.entries(payload.secrets || {})) setSecret(key, String(value));
    if (payload.ownerAiState?.schemaVersion === "1.0") store.set("ownerAi.state", payload.ownerAiState);
    return { imported: true, connectors: (await runMonitoringCycle("recovery-import")).connectors || [], ownerAI: ownerAI.getSnapshot() };
  });

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("before-quit", () => { if (monitorTimer) clearInterval(monitorTimer); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
