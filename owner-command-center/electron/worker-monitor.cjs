const crypto = require("node:crypto");

const { resolvedConnectors } = require("./connectors.cjs");

const REQUEST_TIMEOUT_MS = 15000;
const HISTORY_LIMIT = 120;
const FRESH_HEARTBEAT_SECONDS = 60;
const STALE_HEARTBEAT_SECONDS = 180;
const ALLOWED_ACTIONS = new Set([
  "pause",
  "resume",
  "drain",
  "restart",
  "stop",
  "quarantine",
  "retire",
]);

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, 2000);
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(baseUrl, path) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  return new URL(path, `${base}/`).toString();
}

function heartbeatAgeSeconds(value, now = Date.now()) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((now - timestamp) / 1000));
}

function heartbeatState(worker, now = Date.now()) {
  const ageSeconds = heartbeatAgeSeconds(worker.last_heartbeat_at, now);
  if (worker.health_state === "healthy" && ageSeconds !== null && ageSeconds <= FRESH_HEARTBEAT_SECONDS) {
    return { state: "healthy", pulse: 1, ageSeconds };
  }
  if (ageSeconds !== null && ageSeconds <= STALE_HEARTBEAT_SECONDS) {
    return { state: "stale", pulse: 0.45, ageSeconds };
  }
  if (["failed", "unhealthy", "quarantined"].includes(worker.health_state)) {
    return { state: "failed", pulse: 0, ageSeconds };
  }
  return { state: "unknown", pulse: 0.15, ageSeconds };
}

function createUnavailableSnapshot(store, reason, status = "unavailable") {
  const cached = store.get("workers.lastSnapshot");
  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    available: false,
    status,
    source: "eios-worker-control",
    workers: [],
    tasks: [],
    creditAccounts: [],
    history: cached?.history || store.get("workers.heartbeatHistory") || {},
    totals: {
      registeredWorkers: 0,
      healthyWorkers: 0,
      activeJobs: 0,
      queuedJobs: 0,
      tokensUsed: 0,
      tokenBudget: 0,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    },
    policy: null,
    productionOperational: false,
    blockers: [reason],
    lastSuccessfulAt: store.get("workers.lastSuccessfulAt") || null,
    claimBoundary: "No worker is represented as healthy or operational without a current authenticated EIOS response and heartbeat evidence.",
  };
}

function createWorkerMonitor({ store, safeStorage }) {
  if (!store || !safeStorage) throw new Error("Worker monitor dependencies are required.");
  let refreshInFlight = null;

  function connector() {
    return resolvedConnectors(store).find((item) => item.id === "eios") || null;
  }

  function bearerToken() {
    const encrypted = store.get("secrets.eiosToken");
    if (typeof encrypted !== "string" || !encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows credential encryption is required to access EIOS worker telemetry.");
    }
    const token = safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim();
    return token || null;
  }

  async function requestCandidates(paths, init = {}) {
    const eios = connector();
    if (!eios) throw new Error("The EIOS connector is not available in the approved connector inventory.");
    const token = bearerToken();
    if (!token) throw new Error("Authorize the Obserra EIOS connector before loading worker telemetry or issuing worker controls.");
    const failures = [];

    for (const candidate of paths) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const url = normalizeUrl(eios.url, candidate);
      try {
        const response = await fetch(url, {
          ...init,
          redirect: "error",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "Obserra-Owner-Command-Center/0.4",
            ...(init.headers || {}),
          },
          signal: controller.signal,
        });
        const text = await response.text();
        let payload = null;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = { detail: text.slice(0, 1000) };
          }
        }
        if (response.ok) return { payload, url, status: response.status };
        failures.push(`${candidate}: HTTP ${response.status} ${payload?.detail || payload?.error?.message || "request failed"}`);
        if ([401, 403].includes(response.status)) break;
      } catch (error) {
        failures.push(`${candidate}: ${controller.signal.aborted ? "request timed out" : safeError(error)}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(failures.join(" | ") || "EIOS worker-control request failed.");
  }

  function updateHistory(workers, checkedAt) {
    const previous = store.get("workers.heartbeatHistory");
    const history = previous && typeof previous === "object" ? { ...previous } : {};
    const now = Date.parse(checkedAt);
    for (const worker of workers) {
      const pulse = heartbeatState(worker, now);
      const workerHistory = Array.isArray(history[worker.worker_id])
        ? history[worker.worker_id].slice(-HISTORY_LIMIT + 1)
        : [];
      workerHistory.push({
        at: checkedAt,
        pulse: pulse.pulse,
        state: pulse.state,
        heartbeatAgeSeconds: pulse.ageSeconds,
        healthState: worker.health_state,
        lifecycleState: worker.lifecycle_state,
        activeJobs: numeric(worker.active_jobs),
        queuedJobs: numeric(worker.queued_jobs),
        progressPercent: numeric(worker.progress_percent),
      });
      history[worker.worker_id] = workerHistory;
    }
    store.set("workers.heartbeatHistory", history);
    return history;
  }

  function normalizeSummary(payload, sourceUrl) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("EIOS returned an invalid worker summary.");
    }
    const checkedAt = new Date().toISOString();
    const workers = Array.isArray(payload.workers) ? payload.workers : [];
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    const creditAccounts = Array.isArray(payload.credit_accounts)
      ? payload.credit_accounts
      : Array.isArray(payload.creditAccounts)
        ? payload.creditAccounts
        : [];
    const history = updateHistory(workers, checkedAt);
    const healthyWorkers = workers.filter(
      (worker) => heartbeatState(worker, Date.parse(checkedAt)).state === "healthy",
    ).length;
    const tokensUsed = tasks.reduce((total, task) => total + numeric(task.tokens_used), 0);
    const tokenBudget = tasks.reduce((total, task) => total + numeric(task.token_budget), 0);
    const estimatedCostUsd = tasks.reduce(
      (total, task) => total + numeric(task.estimated_cost_usd),
      0,
    );
    const actualCostUsd = tasks.reduce(
      (total, task) => total + numeric(task.actual_cost_usd),
      0,
    );
    const blockers = Array.isArray(payload.blockers) ? payload.blockers.map(String) : [];

    const snapshot = {
      schemaVersion: "1.0",
      checkedAt,
      available: true,
      status: payload.production_operational === true ? "operational" : "degraded",
      source: "eios-worker-control",
      sourceUrl,
      workers: workers.map((worker) => ({
        ...worker,
        heartbeat: heartbeatState(worker, Date.parse(checkedAt)),
      })),
      tasks,
      creditAccounts,
      policy: payload.policy || null,
      history,
      totals: {
        registeredWorkers: workers.length,
        healthyWorkers,
        activeJobs: numeric(payload.total_active_jobs),
        queuedJobs: numeric(payload.total_queued_jobs),
        tokensUsed,
        tokenBudget,
        estimatedCostUsd: numeric(payload.total_estimated_cost_usd, estimatedCostUsd),
        actualCostUsd: numeric(payload.total_actual_cost_usd, actualCostUsd),
      },
      productionOperational: payload.production_operational === true,
      blockers,
      lastSuccessfulAt: checkedAt,
      claimBoundary: "Worker health is derived from authenticated EIOS records and heartbeat timestamps. Provisioning records and queued commands are not represented as live compute.",
    };
    store.set("workers.lastSnapshot", snapshot);
    store.set("workers.lastSuccessfulAt", checkedAt);
    store.delete("workers.lastFailure");
    return snapshot;
  }

  async function refresh(trigger = "owner-requested") {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const result = await requestCandidates([
          "/api/enterprise/worker-control/summary",
          "/api/v1/worker-control/summary",
        ]);
        const snapshot = normalizeSummary(result.payload, result.url);
        store.set("workers.lastRefresh", { trigger, checkedAt: snapshot.checkedAt });
        return snapshot;
      } catch (error) {
        const message = safeError(error);
        store.set("workers.lastFailure", {
          trigger,
          failedAt: new Date().toISOString(),
          error: message,
        });
        const status = /Authorize the Obserra EIOS connector/i.test(message)
          ? "authorization-required"
          : "unavailable";
        return createUnavailableSnapshot(store, message, status);
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  function getSnapshot() {
    const cached = store.get("workers.lastSnapshot");
    if (cached && typeof cached === "object") return cached;
    return createUnavailableSnapshot(
      store,
      "Worker telemetry has not completed an authenticated EIOS refresh.",
      "not-checked",
    );
  }

  async function command(payload) {
    const workerId = String(payload?.workerId || "").trim();
    const action = String(payload?.action || "").trim().toLowerCase();
    const reason = String(payload?.reason || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(workerId)) {
      throw new Error("A valid worker identifier is required.");
    }
    if (!ALLOWED_ACTIONS.has(action)) throw new Error("Unsupported worker control action.");
    if (reason.length < 3 || reason.length > 2000) {
      throw new Error("A worker-control reason between 3 and 2000 characters is required.");
    }
    const body = JSON.stringify({
      action,
      reason,
      idempotency_key: crypto.randomUUID(),
      payload: { requested_from: "owner-desktop-worker-heartbeat" },
    });
    const result = await requestCandidates([
      `/api/enterprise/worker-control/workers/${encodeURIComponent(workerId)}/commands`,
      `/api/v1/worker-control/workers/${encodeURIComponent(workerId)}/commands`,
    ], { method: "POST", body });
    const snapshot = await refresh(`worker-command:${action}`);
    return { command: result.payload, snapshot };
  }

  return {
    getSnapshot,
    refresh,
    command,
  };
}

module.exports = {
  ALLOWED_ACTIONS,
  createWorkerMonitor,
  heartbeatAgeSeconds,
  heartbeatState,
};
