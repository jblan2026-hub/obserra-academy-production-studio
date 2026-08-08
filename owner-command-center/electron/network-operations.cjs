const { app, ipcMain, safeStorage } = require("electron");
const Store = require("electron-store");

const { resolvedConnectors } = require("./connectors.cjs");
const { analyzeApprovedNetwork } = require("./discovery.cjs");
const { monitorWebPages } = require("./web-monitor.cjs");

const store = new Store({ name: "owner-command-center" });
const WEB_MONITOR_INTERVAL_MS = 30000;
let webMonitorTimer = null;
let webMonitorInFlight = null;
let networkAnalysisInFlight = null;

function decryptForDevice(value) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}

function connectorHeaders(connector) {
  const headers = {
    Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    "User-Agent": "Obserra-Owner-Command-Center-Network-Monitor",
  };
  if (!connector.credentialKey) return headers;
  const encrypted = store.get(`secrets.${connector.credentialKey}`);
  const secret = typeof encrypted === "string" ? decryptForDevice(encrypted) : null;
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

async function refreshWebMonitor(trigger = "scheduled") {
  if (webMonitorInFlight) return webMonitorInFlight;
  webMonitorInFlight = (async () => {
    const snapshot = await monitorWebPages(resolvedConnectors(store), connectorHeaders);
    const recorded = { ...snapshot, trigger };
    store.set("webMonitor.lastSnapshot", recorded);
    return recorded;
  })();
  try {
    return await webMonitorInFlight;
  } finally {
    webMonitorInFlight = null;
  }
}

async function analyzeNetwork(trigger = "owner-requested") {
  if (networkAnalysisInFlight) return networkAnalysisInFlight;
  networkAnalysisInFlight = (async () => {
    const snapshot = await analyzeApprovedNetwork(resolvedConnectors(store), connectorHeaders);
    const recorded = { ...snapshot, trigger };
    store.set("network.lastAnalysis", recorded);
    store.set("webMonitor.lastSnapshot", {
      schemaVersion: "1.0",
      checkedAt: recorded.checkedAt,
      trigger,
      monitorMode: "approved-https-and-html-pages",
      unrestrictedCrawling: false,
      pages: recorded.webPages,
      summary: {
        total: recorded.summary.webpageTotal,
        healthy: recorded.summary.webpageHealthy,
        protected: recorded.summary.webpageProtected,
        degraded: recorded.summary.webpageDegraded,
        failed: recorded.summary.webpageFailed,
        httpsValid: recorded.webPages.filter((page) => page.httpsValid).length,
        htmlValid: recorded.webPages.filter((page) => page.htmlValid).length,
      },
      claimBoundary: recorded.claimBoundary,
    });
    return recorded;
  })();
  try {
    return await networkAnalysisInFlight;
  } finally {
    networkAnalysisInFlight = null;
  }
}

function registerIpc() {
  ipcMain.handle("network:getSnapshot", async () => (
    store.get("network.lastAnalysis") || analyzeNetwork("initial-network-analysis")
  ));
  ipcMain.handle("network:analyzeNow", async () => analyzeNetwork("owner-requested-network-analysis"));
  ipcMain.handle("webMonitor:getSnapshot", async () => (
    store.get("webMonitor.lastSnapshot") || refreshWebMonitor("initial-web-monitor")
  ));
  ipcMain.handle("webMonitor:refresh", async () => refreshWebMonitor("owner-requested-web-monitor"));
}

app.whenReady().then(() => {
  registerIpc();
  setTimeout(() => {
    void analyzeNetwork("startup-background-analysis").catch((error) => {
      store.set("network.lastError", {
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 500);
  webMonitorTimer = setInterval(() => {
    void refreshWebMonitor("scheduled-web-monitor").catch((error) => {
      store.set("webMonitor.lastError", {
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, WEB_MONITOR_INTERVAL_MS);
  webMonitorTimer.unref?.();
});

app.on("before-quit", () => {
  if (webMonitorTimer) clearInterval(webMonitorTimer);
  webMonitorTimer = null;
});

module.exports = {
  WEB_MONITOR_INTERVAL_MS,
  analyzeNetwork,
  refreshWebMonitor,
};
