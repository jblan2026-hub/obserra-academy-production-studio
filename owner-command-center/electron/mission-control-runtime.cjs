const dns = require("node:dns").promises;
const os = require("node:os");
const crypto = require("node:crypto");

const { resolvedConnectors } = require("./connectors.cjs");
const { createAcademyReviewCache } = require("./academy-review-cache.cjs");

const REQUEST_TIMEOUT_MS = 12000;
const WORKER_HISTORY_KEY = "missionControl.workerHeartbeatHistory";
const WEB_HISTORY_KEY = "missionControl.webMonitorHistory";
const MAX_HISTORY_POINTS = 360;
const WORKER_ACTIONS = new Set([
  "pause",
  "resume",
  "stop",
  "drain",
  "restart",
  "quarantine",
  "retire",
]);

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/https:\/\/[^\s:@]+:[^\s@]+@/gi, "https://[redacted]@")
    .replace(/\s+/g, " ")
    .slice(0, 1600);
}

function decryptSecret(store, safeStorage, key) {
  const encrypted = store.get(`secrets.${key}`);
  if (typeof encrypted !== "string" || !encrypted) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Device encryption is unavailable.");
  return safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim() || null;
}

function requestHeaders(store, safeStorage, connector, accept = "application/json") {
  const headers = {
    Accept: accept,
    "User-Agent": "Obserra-Owner-Command-Center",
  };
  if (connector.credentialKey) {
    const token = decryptSecret(store, safeStorage, connector.credentialKey);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function timedFetch(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: options.redirect || "follow",
    });
    return { response, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRequest(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { response, latencyMs } = await timedFetch(url, options, timeoutMs);
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { detail: text.slice(0, 1600) }; }
  }
  if (!response.ok) {
    const detail = payload?.detail || payload?.message || `HTTP ${response.status}`;
    throw new Error(`Request failed with HTTP ${response.status}: ${detail}`);
  }
  return { payload, latencyMs, status: response.status, finalUrl: response.url };
}

function appendHistory(store, key, point) {
  const current = store.get(key);
  const history = Array.isArray(current) ? current : [];
  history.push(point);
  const trimmed = history.slice(-MAX_HISTORY_POINTS);
  store.set(key, trimmed);
  return trimmed;
}

function heartbeatState(worker, now = Date.now()) {
  const raw = worker.last_heartbeat_at || worker.lastHeartbeatAt;
  const timestamp = Date.parse(String(raw || ""));
  if (!Number.isFinite(timestamp)) {
    return { state: "unknown", ageSeconds: null, fresh: false };
  }
  const ageSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (ageSeconds <= 45 && String(worker.health_state || worker.healthState).toLowerCase() === "healthy") {
    return { state: "healthy", ageSeconds, fresh: true };
  }
  if (ageSeconds <= 120) return { state: "delayed", ageSeconds, fresh: false };
  return { state: "stale", ageSeconds, fresh: false };
}

function normalizeWorkerSummary(summary, history, latencyMs) {
  const now = Date.now();
  const workers = (summary.workers || []).map((worker) => ({
    ...worker,
    heartbeat: heartbeatState(worker, now),
  }));
  const healthy = workers.filter((worker) => worker.heartbeat.state === "healthy").length;
  const delayed = workers.filter((worker) => worker.heartbeat.state === "delayed").length;
  const stale = workers.filter((worker) => worker.heartbeat.state === "stale").length;
  const unknown = workers.filter((worker) => worker.heartbeat.state === "unknown").length;
  return {
    available: true,
    source: "eios-worker-control",
    generatedAt: summary.generated_at || new Date().toISOString(),
    latencyMs,
    workers,
    tasks: summary.tasks || [],
    recentCommands: summary.recent_commands || [],
    policy: summary.policy || null,
    creditAccounts: summary.credit_accounts || [],
    workerCounts: summary.worker_counts || {},
    taskCounts: summary.task_counts || {},
    totals: {
      workers: workers.length,
      healthy,
      delayed,
      stale,
      unknown,
      activeJobs: Number(summary.total_active_jobs || 0),
      queuedJobs: Number(summary.total_queued_jobs || 0),
      estimatedCostUsd: Number(summary.total_estimated_cost_usd || 0),
      actualCostUsd: Number(summary.total_actual_cost_usd || 0),
    },
    productionOperational: summary.production_operational === true,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    history,
    claimBoundary: "A worker is operational only when the EIOS control plane reports a current authenticated healthy heartbeat. Provisioning records and queued commands are not live compute.",
  };
}

function connectorUrl(connector, suffix = "") {
  const base = String(connector.url || "").replace(/\/$/, "");
  const path = String(suffix || "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function isLoopback(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(String(hostname || "").toLowerCase());
}

function createMissionControlRuntime({ store, safeStorage, app } = {}) {
  if (!store || !safeStorage || !app) throw new Error("Mission Control runtime dependencies are required.");
  const academyReview = createAcademyReviewCache({ store, safeStorage, app });
  let reviewSyncTimer = null;
  let workerCache = null;
  let workerCacheAt = 0;
  let webCache = null;
  let webCacheAt = 0;

  function connector(id) {
    return resolvedConnectors(store).find((item) => item.id === id) || null;
  }

  async function workerSnapshot({ force = false } = {}) {
    if (!force && workerCache && Date.now() - workerCacheAt < 5000) return workerCache;
    const eios = connector("eios");
    const history = Array.isArray(store.get(WORKER_HISTORY_KEY)) ? store.get(WORKER_HISTORY_KEY) : [];
    if (!eios) {
      return {
        available: false,
        source: "eios-worker-control",
        workers: [],
        tasks: [],
        recentCommands: [],
        creditAccounts: [],
        history,
        blockers: ["EIOS connector is not configured."],
        totals: { workers: 0, healthy: 0, delayed: 0, stale: 0, unknown: 0, activeJobs: 0, queuedJobs: 0 },
      };
    }
    const token = eios.credentialKey ? decryptSecret(store, safeStorage, eios.credentialKey) : null;
    if (eios.credentialKey && !token) {
      return {
        available: false,
        source: "eios-worker-control",
        workers: [],
        tasks: [],
        recentCommands: [],
        creditAccounts: [],
        history,
        blockers: ["EIOS owner token is not configured. Authorize the EIOS connector before worker control is enabled."],
        totals: { workers: 0, healthy: 0, delayed: 0, stale: 0, unknown: 0, activeJobs: 0, queuedJobs: 0 },
      };
    }
    try {
      const result = await jsonRequest(
        connectorUrl(eios, "/api/v1/worker-control/summary"),
        { method: "GET", headers: requestHeaders(store, safeStorage, eios) },
      );
      const workers = result.payload?.workers || [];
      const health = workers.map((worker) => heartbeatState(worker));
      const point = {
        at: new Date().toISOString(),
        total: workers.length,
        healthy: health.filter((item) => item.state === "healthy").length,
        delayed: health.filter((item) => item.state === "delayed").length,
        stale: health.filter((item) => item.state === "stale").length,
        activeJobs: Number(result.payload?.total_active_jobs || 0),
        queuedJobs: Number(result.payload?.total_queued_jobs || 0),
        latencyMs: result.latencyMs,
      };
      const nextHistory = appendHistory(store, WORKER_HISTORY_KEY, point);
      workerCache = normalizeWorkerSummary(result.payload || {}, nextHistory, result.latencyMs);
      workerCacheAt = Date.now();
      return workerCache;
    } catch (error) {
      const failed = {
        available: false,
        source: "eios-worker-control",
        workers: [],
        tasks: [],
        recentCommands: [],
        creditAccounts: [],
        history,
        blockers: [safeError(error)],
        totals: { workers: 0, healthy: 0, delayed: 0, stale: 0, unknown: 0, activeJobs: 0, queuedJobs: 0 },
      };
      workerCache = failed;
      workerCacheAt = Date.now();
      return failed;
    }
  }

  async function issueWorkerCommand(payload) {
    const workerId = String(payload?.workerId || "").trim();
    const action = String(payload?.action || "").trim();
    const reason = String(payload?.reason || "").trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(workerId)) throw new Error("A valid worker identifier is required.");
    if (!WORKER_ACTIONS.has(action)) throw new Error("Unsupported worker command.");
    if (reason.length < 3) throw new Error("An owner reason is required.");
    const eios = connector("eios");
    if (!eios) throw new Error("EIOS connector is not configured.");
    const token = eios.credentialKey ? decryptSecret(store, safeStorage, eios.credentialKey) : null;
    if (eios.credentialKey && !token) throw new Error("EIOS owner token is not configured.");
    const result = await jsonRequest(
      connectorUrl(eios, `/api/v1/worker-control/workers/${workerId}/commands`),
      {
        method: "POST",
        headers: {
          ...requestHeaders(store, safeStorage, eios),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          reason,
          payload: payload?.commandPayload && typeof payload.commandPayload === "object"
            ? payload.commandPayload
            : {},
          idempotency_key: String(payload?.idempotencyKey || `owner-${action}-${workerId}-${crypto.randomUUID()}`),
        }),
      },
    );
    workerCacheAt = 0;
    return {
      accepted: true,
      command: result.payload,
      latencyMs: result.latencyMs,
      claimBoundary: "Accepted means the EIOS control plane recorded the owner command. It does not prove the worker executed the command until a later heartbeat and command acknowledgement confirm it.",
    };
  }

  async function monitorOneWebSurface(surface) {
    const parsed = new URL(surface.url);
    const httpsRequired = !isLoopback(parsed.hostname);
    const protocolCompliant = parsed.protocol === "https:" || (!httpsRequired && parsed.protocol === "http:");
    const checkedAt = new Date().toISOString();
    const result = {
      id: surface.id,
      name: surface.name,
      url: surface.url,
      protocol: parsed.protocol.replace(":", ""),
      httpsRequired,
      protocolCompliant,
      htmlReady: false,
      healthReady: false,
      rootStatus: null,
      healthStatus: null,
      contentType: null,
      latencyMs: null,
      finalUrl: null,
      checkedAt,
      error: null,
    };
    if (!protocolCompliant) {
      result.error = "Public web surfaces must use HTTPS.";
      return result;
    }
    try {
      const rootResponse = await timedFetch(
        surface.url,
        {
          method: "GET",
          headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Obserra-Owner-Command-Center" },
        },
        15000,
      );
      result.rootStatus = rootResponse.response.status;
      result.finalUrl = rootResponse.response.url;
      result.contentType = rootResponse.response.headers.get("content-type");
      result.latencyMs = rootResponse.latencyMs;
      result.htmlReady = rootResponse.response.ok && /text\/html|application\/xhtml\+xml/i.test(result.contentType || "");
      await rootResponse.response.body?.cancel?.();

      const healthResponse = await timedFetch(
        connectorUrl(surface, surface.healthPath || "/api/health"),
        { method: "GET", headers: requestHeaders(store, safeStorage, surface) },
        12000,
      );
      result.healthStatus = healthResponse.response.status;
      result.healthReady = healthResponse.response.ok;
      await healthResponse.response.body?.cancel?.();
    } catch (error) {
      result.error = safeError(error);
    }
    return result;
  }

  async function webMonitorSnapshot({ force = false } = {}) {
    if (!force && webCache && Date.now() - webCacheAt < 10000) return webCache;
    const surfaces = resolvedConnectors(store).filter((item) => ["website", "academy", "store", "lcms", "eios"].includes(item.id));
    const results = await Promise.all(surfaces.map(monitorOneWebSurface));
    const point = {
      at: new Date().toISOString(),
      total: results.length,
      httpsCompliant: results.filter((item) => item.protocolCompliant).length,
      htmlReady: results.filter((item) => item.htmlReady).length,
      healthReady: results.filter((item) => item.healthReady).length,
    };
    const history = appendHistory(store, WEB_HISTORY_KEY, point);
    webCache = {
      available: true,
      generatedAt: point.at,
      surfaces: results,
      totals: {
        surfaces: results.length,
        httpsCompliant: point.httpsCompliant,
        htmlReady: point.htmlReady,
        healthReady: point.healthReady,
        failed: results.filter((item) => item.error || !item.protocolCompliant || !item.htmlReady || !item.healthReady).length,
      },
      history,
      blockers: results
        .filter((item) => item.error || !item.protocolCompliant || !item.htmlReady || !item.healthReady)
        .map((item) => `${item.name}: ${item.error || "HTTPS, HTML, or health verification failed."}`),
      claimBoundary: "HTTPS and HTML readiness prove transport and page-response characteristics at the time checked. They do not establish application security, business-logic correctness, authorization, or regulatory compliance.",
    };
    webCacheAt = Date.now();
    return webCache;
  }

  async function networkSnapshot() {
    const connectors = resolvedConnectors(store);
    const nodes = await Promise.all(connectors.map(async (item) => {
      const parsed = new URL(item.url);
      let addresses = [];
      let error = null;
      try {
        addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
      } catch (lookupError) {
        error = safeError(lookupError);
      }
      return {
        id: item.id,
        name: item.name,
        hostname: parsed.hostname,
        protocol: parsed.protocol.replace(":", ""),
        port: parsed.port || (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : null),
        localOnly: item.localOnly === true,
        addresses,
        error,
      };
    }));
    return {
      generatedAt: new Date().toISOString(),
      localHostname: os.hostname(),
      localPlatform: `${os.type()} ${os.release()}`,
      nodes,
      totals: {
        nodes: nodes.length,
        resolved: nodes.filter((node) => node.addresses.length > 0).length,
        unresolved: nodes.filter((node) => node.addresses.length === 0).length,
        https: nodes.filter((node) => node.protocol === "https").length,
        loopback: nodes.filter((node) => node.localOnly).length,
      },
    };
  }

  async function missionSnapshot() {
    const [workers, web, academy, network] = await Promise.all([
      workerSnapshot(),
      webMonitorSnapshot(),
      Promise.resolve(academyReview.snapshot()),
      networkSnapshot(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      workers,
      web,
      academy,
      network,
      system: {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        logicalProcessors: os.cpus().length,
        freeMemoryGb: Math.round(os.freemem() / 1024 / 1024 / 1024),
        uptimeSeconds: os.uptime(),
      },
    };
  }

  function registerIpc(ipcMain) {
    ipcMain.handle("mission:getSnapshot", async () => missionSnapshot());
    ipcMain.handle("workers:getSnapshot", async (_event, payload) => workerSnapshot({ force: payload?.force === true }));
    ipcMain.handle("workers:command", async (_event, payload) => issueWorkerCommand(payload));
    ipcMain.handle("web-monitor:getSnapshot", async (_event, payload) => webMonitorSnapshot({ force: payload?.force === true }));
    ipcMain.handle("network:getSnapshot", async () => networkSnapshot());
    ipcMain.handle("academy-review:getSnapshot", async () => academyReview.snapshot());
    ipcMain.handle("academy-review:synchronize", async () => academyReview.synchronize());
    ipcMain.handle("academy-review:getCourse", async (_event, courseId) => academyReview.courseDetail(courseId));
    ipcMain.handle("academy-review:recordDecision", async (_event, payload) => academyReview.recordDecision(payload));
  }

  async function start() {
    if (academyReview.tokenConfigured()) {
      await academyReview.synchronize().catch((error) => {
        store.set("academy.reviewStartupSyncFailure", {
          failedAt: new Date().toISOString(),
          error: safeError(error),
        });
      });
    }
    reviewSyncTimer = setInterval(() => {
      if (!academyReview.tokenConfigured()) return;
      academyReview.synchronize().catch(() => {});
    }, 5 * 60 * 1000);
    reviewSyncTimer.unref?.();
  }

  function stop() {
    if (reviewSyncTimer) clearInterval(reviewSyncTimer);
    reviewSyncTimer = null;
  }

  return {
    registerIpc,
    start,
    stop,
    missionSnapshot,
    workerSnapshot,
    webMonitorSnapshot,
    networkSnapshot,
    academyReview,
  };
}

module.exports = { createMissionControlRuntime };
