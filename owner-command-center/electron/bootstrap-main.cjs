const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { app, BrowserWindow, dialog } = require("electron");

const APP_ID = "com.obserra.ownercommandcenter";
const BOOTSTRAP_FILE = "Obserra-Command-Center-Bootstrap.json";
const STARTUP_SMOKE_TEST = process.env.OBSERRA_STARTUP_SMOKE_TEST === "true";
const STARTUP_STARTED_AT = performance.now();
const STARTUP_STARTED_WALL_CLOCK = new Date().toISOString();
const rendererRecoveryAttempts = new WeakMap();
const retainedWindows = new Set();
let bootstrapLoaded = false;
let startupFailed = false;
let splashWindow = null;
let smokeWatchdog = null;
let smokeTestCompleted = false;

if (typeof app.setAppUserModelId === "function") {
  app.setAppUserModelId(APP_ID);
}

function startupHealthPath() {
  const configuredPath = String(process.env.OBSERRA_STARTUP_HEALTH_PATH || "").trim();
  if (configuredPath) return path.resolve(configuredPath);
  try {
    return path.join(app.getPath("userData"), "startup-health.json");
  } catch {
    const fallbackRoot = process.env.LOCALAPPDATA || os.tmpdir();
    return path.join(fallbackRoot, "Obserra", "OwnerCommandCenter", "startup-health.json");
  }
}

function writeStartupHealth(event, details = {}) {
  try {
    const destination = startupHealthPath();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const record = {
      schemaVersion: "1.1",
      event,
      recordedAt: new Date().toISOString(),
      startupStartedAt: STARTUP_STARTED_WALL_CLOCK,
      elapsedMs: Math.round(performance.now() - STARTUP_STARTED_AT),
      appVersion: typeof app.getVersion === "function" ? app.getVersion() : null,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      ...details,
    };
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, destination);
  } catch {
    // Startup telemetry must never prevent the owner application from opening.
  }
}

function safeError(error) {
  return String(error instanceof Error ? error.stack || error.message : error)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, 12000);
}

function completeStartupSmokeTest(passed, details = {}) {
  if (!STARTUP_SMOKE_TEST || smokeTestCompleted) return;
  smokeTestCompleted = true;
  if (smokeWatchdog) clearTimeout(smokeWatchdog);
  writeStartupHealth(passed ? "startup-smoke-passed" : "startup-smoke-failed", details);
  setTimeout(() => app.exit(passed ? 0 : 1), 250);
}

function failStartup(error) {
  if (startupFailed) return;
  startupFailed = true;
  const detail = safeError(error);
  writeStartupHealth("startup-failed", { error: detail });
  if (STARTUP_SMOKE_TEST) {
    completeStartupSmokeTest(false, { error: detail });
    return;
  }
  try {
    dialog.showErrorBox(
      "Obserra Command Center startup error",
      `The application could not start. A diagnostic record was written to:\n\n${startupHealthPath()}\n\n${detail.slice(0, 1800)}`,
    );
  } catch {
    console.error(detail);
  }
  if (app.isReady()) app.exit(1);
  else app.whenReady().then(() => app.exit(1));
}

process.on("uncaughtException", failStartup);
process.on("unhandledRejection", (reason) => {
  if (!bootstrapLoaded) failStartup(reason);
  else writeStartupHealth("runtime-unhandled-rejection", { error: safeError(reason) });
});

function packagedBootstrapCandidates() {
  const candidates = [
    process.env.OBSERRA_COMMAND_CENTER_BOOTSTRAP,
    path.join(path.dirname(process.execPath), BOOTSTRAP_FILE),
    process.resourcesPath ? path.join(process.resourcesPath, BOOTSTRAP_FILE) : null,
    path.join(app.getAppPath(), BOOTSTRAP_FILE),
    path.join(app.getAppPath(), "resources", BOOTSTRAP_FILE),
  ].filter(Boolean);
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

if (!process.env.OBSERRA_COMMAND_CENTER_BOOTSTRAP) {
  const packagedBootstrap = packagedBootstrapCandidates().find((candidate) => fs.existsSync(candidate));
  if (packagedBootstrap) {
    process.env.OBSERRA_COMMAND_CENTER_BOOTSTRAP = packagedBootstrap;
  }
}

function splashMarkup() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#05070b;color:#f5f7fb;font-family:Segoe UI,Arial,sans-serif;overflow:hidden}
    body{display:grid;place-items:center}.card{width:480px;padding:34px;border:1px solid #2b3548;border-radius:18px;background:linear-gradient(145deg,#0a1020,#05070b);box-shadow:0 24px 70px rgba(0,0,0,.55)}
    .brand{font-size:12px;letter-spacing:.18em;color:#d9b35f;text-transform:uppercase}.title{font-size:25px;font-weight:750;margin-top:10px}.status{margin-top:12px;color:#aeb8c9;font-size:14px}
    .bar{height:4px;margin-top:26px;border-radius:999px;background:#182033;overflow:hidden}.bar:after{content:"";display:block;width:42%;height:100%;background:#d9b35f;animation:load 1.1s ease-in-out infinite alternate}@keyframes load{from{transform:translateX(-70%)}to{transform:translateX(210%)}}
  </style></head><body><div class="card"><div class="brand">OBSERRA EXECUTIVE PROTECTION &amp; INTELLIGENCE LLC</div><div class="title">Owner AI Command Center</div><div class="status">Starting the secure owner interface. Live monitoring will initialize in the background.</div><div class="bar"></div></div></body></html>`;
}

function createSplashWindow() {
  if (STARTUP_SMOKE_TEST || splashWindow) return;
  splashWindow = new BrowserWindow({
    width: 560,
    height: 260,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#05070b",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  retainedWindows.add(splashWindow);
  splashWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(splashMarkup())}`);
  splashWindow.once("ready-to-show", () => {
    splashWindow?.show();
    writeStartupHealth("splash-ready");
  });
  splashWindow.on("closed", () => {
    retainedWindows.delete(splashWindow);
    splashWindow = null;
  });
}

function focusBestWindow() {
  const primary = [...retainedWindows].find(
    (window) => window && !window.isDestroyed() && window !== splashWindow,
  );
  const target = primary || (splashWindow && !splashWindow.isDestroyed() ? splashWindow : null);
  if (!target) return false;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  return true;
}

function registerPrimaryWindow(window) {
  if (!window || window.isDestroyed()) return;
  retainedWindows.add(window);
  let primaryReadyRecorded = false;

  const markPrimaryReady = () => {
    if (primaryReadyRecorded || window.isDestroyed()) return;
    primaryReadyRecorded = true;
    writeStartupHealth("primary-window-ready", {
      visible: window.isVisible(),
      minimized: window.isMinimized(),
    });
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    if (STARTUP_SMOKE_TEST) {
      completeStartupSmokeTest(true, { primaryWindowReady: true });
    }
  };

  window.once("ready-to-show", markPrimaryReady);
  window.webContents.once("did-finish-load", () => {
    writeStartupHealth("primary-window-content-loaded");
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    writeStartupHealth("renderer-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    const attempts = rendererRecoveryAttempts.get(window) || 0;
    if (!window.isDestroyed() && attempts < 1 && details.reason !== "clean-exit") {
      rendererRecoveryAttempts.set(window, attempts + 1);
      setTimeout(() => {
        if (!window.isDestroyed()) window.reload();
      }, 750);
    }
  });
  window.on("closed", () => retainedWindows.delete(window));
}

app.on("browser-window-created", (_event, window) => {
  retainedWindows.add(window);
  window.on("closed", () => retainedWindows.delete(window));
});
app.on("obserra:primary-window-created", registerPrimaryWindow);
app.on("second-instance", () => {
  writeStartupHealth("second-instance-requested");
  focusBestWindow();
});
app.on("activate", () => {
  focusBestWindow();
});

app.whenReady().then(() => {
  createSplashWindow();
  if (STARTUP_SMOKE_TEST) {
    smokeWatchdog = setTimeout(() => {
      completeStartupSmokeTest(false, {
        reason: "primary-window-ready-timeout",
        timeoutMs: 30000,
      });
    }, 30000);
  }
});

app.on("child-process-gone", (_event, details) => {
  writeStartupHealth("child-process-gone", {
    processType: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName || null,
    name: details.name || null,
  });
});

function installElectronStoreCompatibility(ElectronStore) {
  const originalLoad = Module._load;
  const sharedStores = new Map();

  class SharedElectronStore extends ElectronStore {
    constructor(options = {}) {
      const normalizedOptions = options && typeof options === "object" ? options : {};
      const storeName = String(normalizedOptions.name || "config");
      const existing = sharedStores.get(storeName);
      if (existing) return existing;
      super(normalizedOptions);
      sharedStores.set(storeName, this);
    }
  }

  Module._load = function loadWithElectronStoreCompatibility(request, parent, isMain) {
    if (request === "electron-store") return SharedElectronStore;
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = originalLoad;
  };
}

async function startMainProcess() {
  writeStartupHealth("bootstrap-started");
  const electronStoreModule = await import("electron-store");
  const ElectronStore = electronStoreModule.default;
  if (typeof ElectronStore !== "function") {
    throw new TypeError("electron-store did not provide its expected default constructor.");
  }

  const restoreModuleLoader = installElectronStoreCompatibility(ElectronStore);
  try {
    require("./main-with-remediation.cjs");
    bootstrapLoaded = true;
    writeStartupHealth("main-process-loaded", {
      esmCompatibility: "electron-store-dynamic-import",
      sharedStore: true,
    });
  } finally {
    restoreModuleLoader();
  }
}

startMainProcess().catch(failStartup);
