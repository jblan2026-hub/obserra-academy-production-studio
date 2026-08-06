const { app, BrowserWindow, ipcMain, safeStorage, session, dialog } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const crypto = require("node:crypto");
const Store = require("electron-store");
const { resolvedConnectors, normalizeBaseUrl } = require("./connectors.cjs");

const store = new Store({ name: "owner-command-center" });
const REQUEST_TIMEOUT_MS = 10000;

function assertLocalOnly() {
  app.commandLine.appendSwitch("disable-remote-fonts");
  app.commandLine.appendSwitch("disable-background-networking");
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
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });
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

function setSecret(key, value) {
  store.set(`secrets.${key}`, encryptForDevice(value));
}

function connectorHeaders(connector) {
  const secret = connector.credentialKey ? getSecret(connector.credentialKey) : undefined;
  const headers = { Accept: "application/json", "User-Agent": "Obserra-Owner-Command-Center" };
  if (!secret) return headers;
  if (connector.id === "stripe") headers.Authorization = `Bearer ${secret}`;
  else headers.Authorization = `Bearer ${secret}`;
  return headers;
}

async function probeConnector(connector) {
  const configured = !connector.credentialKey || Boolean(store.get(`secrets.${connector.credentialKey}`));
  if (!configured) {
    return { ...connector, status: "unconfigured", configured: false, controlEnabled: false, checkedAt: new Date().toISOString() };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${connector.url}${connector.healthPath}`, {
      method: "GET",
      headers: connectorHeaders(connector),
      signal: controller.signal,
      redirect: "error"
    });
    const healthy = response.ok;
    const result = {
      ...connector,
      configured: true,
      status: healthy ? "connected" : "degraded",
      httpStatus: response.status,
      controlEnabled: healthy && connector.control === true,
      checkedAt: new Date().toISOString()
    };
    store.set(`connectors.${connector.id}.lastStatus`, result);
    return result;
  } catch (error) {
    const cached = store.get(`connectors.${connector.id}.lastStatus`);
    return {
      ...connector,
      configured: true,
      status: "failed",
      controlEnabled: false,
      cachedStatus: cached || null,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

function deriveBundleKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32);
}

function encryptRecoveryBundle(payload, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveBundleKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    schemaVersion: "1.0",
    algorithm: "aes-256-gcm+scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
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

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  ipcMain.handle("system:getSnapshot", async () => ({
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model ?? "Unknown CPU",
    logicalProcessors: os.cpus().length,
    totalMemoryGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    freeMemoryGb: Math.round(os.freemem() / 1024 / 1024 / 1024),
    uptimeSeconds: os.uptime(),
    localOnly: true,
    windowsEncryption: safeStorage.isEncryptionAvailable()
  }));

  ipcMain.handle("connectors:list", async () => resolvedConnectors(store).map((connector) => ({
    ...connector,
    configured: !connector.credentialKey || Boolean(store.get(`secrets.${connector.credentialKey}`)),
    controlEnabled: false
  })));

  ipcMain.handle("connectors:probe", async (_event, id) => {
    const connector = resolvedConnectors(store).find((item) => item.id === id);
    if (!connector) throw new Error("Unknown connector");
    return probeConnector(connector);
  });

  ipcMain.handle("connectors:probeAll", async () => Promise.all(resolvedConnectors(store).map(probeConnector)));

  ipcMain.handle("connectors:configure", async (_event, payload) => {
    const connector = resolvedConnectors(store).find((item) => item.id === payload?.id);
    if (!connector) throw new Error("Unknown connector");
    if (payload.url) store.set(`connectors.${connector.id}.url`, normalizeBaseUrl(payload.url));
    if (connector.credentialKey && payload.secret) setSecret(connector.credentialKey, payload.secret);
    return probeConnector(resolvedConnectors(store).find((item) => item.id === connector.id));
  });

  ipcMain.handle("recovery:export", async (_event, passphrase) => {
    if (typeof passphrase !== "string" || passphrase.length < 14) throw new Error("Recovery passphrase must contain at least 14 characters");
    const secrets = {};
    for (const connector of resolvedConnectors(store)) {
      if (connector.credentialKey) {
        const value = getSecret(connector.credentialKey);
        if (value) secrets[connector.credentialKey] = value;
      }
    }
    const payload = {
      createdAt: new Date().toISOString(),
      ownerDevice: os.hostname(),
      connectors: resolvedConnectors(store).map(({ id, url }) => ({ id, url })),
      secrets
    };
    const result = await dialog.showSaveDialog({
      title: "Export encrypted Obserra owner recovery bundle",
      defaultPath: `Obserra-Owner-Recovery-${new Date().toISOString().slice(0, 10)}.obserra-recovery`,
      filters: [{ name: "Obserra Recovery Bundle", extensions: ["obserra-recovery"] }]
    });
    if (result.canceled || !result.filePath) return { exported: false };
    fs.writeFileSync(result.filePath, JSON.stringify(encryptRecoveryBundle(payload, passphrase), null, 2), { encoding: "utf8", mode: 0o600 });
    return { exported: true, path: result.filePath };
  });

  ipcMain.handle("recovery:import", async (_event, passphrase) => {
    if (typeof passphrase !== "string" || !passphrase) throw new Error("Recovery passphrase is required");
    const result = await dialog.showOpenDialog({
      title: "Import encrypted Obserra owner recovery bundle",
      properties: ["openFile"],
      filters: [{ name: "Obserra Recovery Bundle", extensions: ["obserra-recovery"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { imported: false };
    const bundle = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
    const payload = decryptRecoveryBundle(bundle, passphrase);
    for (const connector of payload.connectors || []) store.set(`connectors.${connector.id}.url`, normalizeBaseUrl(connector.url));
    for (const [key, value] of Object.entries(payload.secrets || {})) setSecret(key, String(value));
    return { imported: true, connectors: await Promise.all(resolvedConnectors(store).map(probeConnector)) };
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
