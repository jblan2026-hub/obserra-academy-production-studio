const { app, BrowserWindow, ipcMain, safeStorage, session } = require("electron");
const path = require("node:path");
const os = require("node:os");
const Store = require("electron-store");

const store = new Store({ name: "owner-command-center" });

function assertLocalOnly() {
  app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");
  app.commandLine.appendSwitch("disable-remote-fonts");
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

function encrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable");
  return safeStorage.encryptString(value).toString("base64");
}

function decrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable");
  return safeStorage.decryptString(Buffer.from(value, "base64"));
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
    localOnly: true
  }));

  ipcMain.handle("secrets:set", async (_event, key, value) => {
    if (typeof key !== "string" || typeof value !== "string" || !key || !value) throw new Error("Invalid secret payload");
    store.set(`secrets.${key}`, encrypt(value));
    return { stored: true };
  });

  ipcMain.handle("secrets:has", async (_event, key) => Boolean(store.get(`secrets.${key}`)));

  ipcMain.handle("connectors:probe", async (_event, connector) => {
    const configuration = store.get(`connectors.${connector}`);
    return {
      connector,
      configured: Boolean(configuration),
      status: configuration ? "configured" : "not-configured",
      checkedAt: new Date().toISOString()
    };
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
