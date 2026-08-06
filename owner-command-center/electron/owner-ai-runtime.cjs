const { createOwnerAI } = require("./owner-ai.cjs");
const { discoverApprovedServices } = require("./service-discovery.cjs");

const MONITOR_INTERVAL_MS = 15000;

function installOwnerAIRuntime({ ipcMain, store, resolvedConnectors, probeConnector, getStudioSnapshot }) {
  const ownerAI = createOwnerAI(store);
  let cycleInFlight = false;
  let timer = null;

  async function runCycle(origin = "continuous-monitor") {
    if (cycleInFlight) return ownerAI.getSnapshot();
    cycleInFlight = true;
    try {
      const connectors = await Promise.all(resolvedConnectors(store).map(probeConnector));
      const academy = getStudioSnapshot();
      const discovery = await discoverApprovedServices(connectors, store);
      const intelligenceReports = connectors
        .filter((item) => item.intelligence && typeof item.intelligence === "object")
        .map((item) => ({ sourceId: item.id, ...item.intelligence }));
      const result = ownerAI.analyzeCycle({
        connectors,
        academy,
        network: discovery.network,
        serviceManifest: discovery.serviceManifest,
        deployment: discovery.deployment,
        identity: discovery.identity,
        intelligenceReports,
        origin
      });
      store.set("ownerAi.runtime", {
        intervalMs: MONITOR_INTERVAL_MS,
        lastCycleAt: new Date().toISOString(),
        lastCycleStatus: "complete"
      });
      return result.snapshot;
    } catch (error) {
      store.set("ownerAi.runtime", {
        intervalMs: MONITOR_INTERVAL_MS,
        lastCycleAt: new Date().toISOString(),
        lastCycleStatus: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      return ownerAI.getSnapshot();
    } finally {
      cycleInFlight = false;
    }
  }

  function assertActionAllowed(scope) {
    return ownerAI.assertScopeWritable(scope);
  }

  ipcMain.handle("ownerAi:getSnapshot", async () => ownerAI.getSnapshot());
  ipcMain.handle("ownerAi:runCycle", async () => runCycle("manual-owner-refresh"));
  ipcMain.handle("ownerAi:remember", async (_event, payload) => ownerAI.remember(payload?.text, payload?.source || "owner", payload?.tags || []));
  ipcMain.handle("ownerAi:decideApproval", async (_event, payload) => ownerAI.decideApproval(payload?.id, payload?.decision, payload?.note || ""));
  ipcMain.handle("ownerAi:acknowledgeRecommendation", async (_event, id) => ownerAI.acknowledgeRecommendation(id));
  ipcMain.handle("ownerAi:getRuntime", async () => store.get("ownerAi.runtime") || { intervalMs: MONITOR_INTERVAL_MS, lastCycleStatus: "not-run" });

  runCycle("startup");
  timer = setInterval(() => runCycle("continuous-monitor"), MONITOR_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();

  return {
    ownerAI,
    runCycle,
    assertActionAllowed,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = { installOwnerAIRuntime, MONITOR_INTERVAL_MS };
