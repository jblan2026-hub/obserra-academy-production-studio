const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { app, ipcMain, safeStorage } = require("electron");

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_HEARTBEAT_SAMPLES = 90;
const WORKER_HEARTBEAT_CURRENT_SECONDS = 90;
const WORKER_HEARTBEAT_STALE_SECONDS = 300;

let lastSnapshot = null;
let lastSuccessAt = null;
let refreshInFlight = null;
const heartbeatHistory = new Map();

function ownerStorePath() {
  return path.join(app.getPath("userData"), "owner-command-center.json");
}

function readOwnerStore() {
  const filePath = ownerStorePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    throw new Error(
      `The Command Center configuration store could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || "").trim());
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("The EIOS worker-control URL must use HTTPS or local loopback HTTP.");
  }
  if (
    parsed.protocol === "http:"
    && !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
  ) {
    throw new Error("Unencrypted EIOS worker-control access is allowed only on loopback.");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function workerControlConfiguration() {
  const config = readOwnerStore();
  const baseUrl = normalizeBaseUrl(
    config?.connectors?.eios?.url
      || process.env.OBSERRA_EIOS_URL
      || "https://owner.obserrallc.com",
  );
  const encryptedToken = config?.secrets?.eiosToken;
  let token = null;
  if (typeof encryptedToken === "string" && encryptedToken) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Device credential encryption is unavailable for the EIOS owner token.");
    }
    try {
      token = safeStorage.decryptString(Buffer.from(encryptedToken, "base64")).trim();
    } catch {
      throw new Error("The stored EIOS owner token could not be decrypted on this device.");
    }
  }
  return {
    baseUrl,
    token,
    tokenConfigured: Boolean(token),
  };
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, 2000);
}

async function readBoundedResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The response is already bounded and the request will fail closed.
      }
      throw new Error("The EIOS worker-control response exceeded the approved size limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function candidatePaths(relativePath) {
  const normalized = String(relativePath || "").replace(/^\/+/, "");
  return [
    `/api/v1/worker-control/${normalized}`,
    `/api/enterprise/worker-control/${normalized}`,
  ];
}

async function workerRequest(relativePath, options = {}) {
  const configuration = workerControlConfiguration();
  if (!configuration.token) {
    throw new Error(
      "Authorize the Obserra EIOS connector in Connections and Recovery before loading or controlling AI workers.",
    );
  }

  const method = String(options.method || "GET").toUpperCase();
  const paths = candidatePaths(relativePath);
  let lastFailure = null;

  for (const candidate of paths) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${configuration.baseUrl}${candidate}`, {
        method,
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${configuration.token}`,
          "Content-Type": "application/json",
          "User-Agent": "Obserra-Owner-Command-Center-Worker-Fleet",
          "X-Obserra-Owner-Control": "worker-fleet-v1",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await readBoundedResponse(response);
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { detail: text.slice(0, 1000) };
        }
      }
      if (response.ok) {
        return {
          payload,
          sourceUrl: `${configuration.baseUrl}${candidate}`,
          baseUrl: configuration.baseUrl,
          httpStatus: response.status,
        };
      }
      const detail = payload?.detail || payload?.message || `HTTP ${response.status}`;
      lastFailure = new Error(`EIOS worker-control request failed: ${detail}`);
      if (![404, 405].includes(response.status)) throw lastFailure;
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        lastFailure = new Error(
          `EIOS worker-control request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`,
        );
      } else {
        lastFailure = error;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastFailure || new Error("The EIOS worker-control endpoint is unavailable.");
}

function heartbeatAgeSeconds(value, now = Date.now()) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((now - parsed) / 1000));
}

function heartbeatClass(worker, now = Date.now()) {
  const ageSeconds = heartbeatAgeSeconds(worker?.last_heartbeat_at, now);
  if (ageSeconds === null) return { state: "no-heartbeat", ageSeconds: null };
  if (ageSeconds <= WORKER_HEARTBEAT_CURRENT_SECONDS) {
    return { state: worker.health_state === "healthy" ? "current" : "degraded", ageSeconds };
  }
  if (ageSeconds <= WORKER_HEARTBEAT_STALE_SECONDS) {
    return { state: "stale", ageSeconds };
  }
  return { state: "offline", ageSeconds };
}

function pulseValue(worker, heartbeat) {
  if (heartbeat.state === "offline" || heartbeat.state === "no-heartbeat") return 0;
  const health = {
    healthy: 0.95,
    degraded: 0.62,
    unhealthy: 0.25,
    unknown: 0.12,
  }[worker.health_state] ?? 0.12;
  const work = Math.min(0.25, Number(worker.active_jobs || 0) * 0.05);
  return Math.min(1, health + work);
}

function recordHeartbeatHistory(workers, observedAt) {
  const now = Date.parse(observedAt) || Date.now();
  const currentIds = new Set();
  for (const worker of workers) {
    const workerId = String(worker.worker_id);
    currentIds.add(workerId);
    const heartbeat = heartbeatClass(worker, now);
    const history = heartbeatHistory.get(workerId) || [];
    history.push({
      at: observedAt,
      state: heartbeat.state,
      ageSeconds: heartbeat.ageSeconds,
      pulse: pulseValue(worker, heartbeat),
      healthState: worker.health_state,
      lifecycleState: worker.lifecycle_state,
      activeJobs: Number(worker.active_jobs || 0),
      queuedJobs: Number(worker.queued_jobs || 0),
      progressPercent: Number(worker.progress_percent || 0),
    });
    heartbeatHistory.set(workerId, history.slice(-MAX_HEARTBEAT_SAMPLES));
  }

  for (const [workerId, history] of heartbeatHistory.entries()) {
    if (currentIds.has(workerId)) continue;
    heartbeatHistory.set(
      workerId,
      [
        ...history,
        {
          at: observedAt,
          state: "not-reported",
          ageSeconds: null,
          pulse: 0,
          healthState: "unknown",
          lifecycleState: "retired-or-unreported",
          activeJobs: 0,
          queuedJobs: 0,
          progressPercent: 0,
        },
      ].slice(-MAX_HEARTBEAT_SAMPLES),
    );
  }
}

function historySnapshot() {
  return Object.fromEntries(
    [...heartbeatHistory.entries()].map(([workerId, history]) => [workerId, history]),
  );
}

function validateSummary(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("EIOS returned an invalid worker-control summary.");
  }
  if (!Array.isArray(payload.workers) || !Array.isArray(payload.tasks)) {
    throw new Error("EIOS worker-control summary is missing workers or tasks.");
  }
  return payload;
}

async function refreshWorkerFleet(trigger = "owner-requested") {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const configuration = workerControlConfiguration();
    const checkedAt = new Date().toISOString();
    try {
      const response = await workerRequest("summary");
      const summary = validateSummary(response.payload);
      recordHeartbeatHistory(summary.workers, checkedAt);
      lastSuccessAt = checkedAt;
      lastSnapshot = {
        schemaVersion: "1.0",
        connected: true,
        tokenConfigured: configuration.tokenConfigured,
        checkedAt,
        lastSuccessAt,
        trigger,
        sourceUrl: response.sourceUrl,
        baseUrl: response.baseUrl,
        summary,
        heartbeatHistory: historySnapshot(),
        heartbeatThresholds: {
          currentSeconds: WORKER_HEARTBEAT_CURRENT_SECONDS,
          staleSeconds: WORKER_HEARTBEAT_STALE_SECONDS,
        },
        error: null,
        claimBoundary: "A worker is shown as heartbeat-current only when EIOS returns a recorded heartbeat within the configured threshold. Provisioning records and workers without a current heartbeat are not represented as operational.",
      };
      return lastSnapshot;
    } catch (error) {
      const failure = {
        schemaVersion: "1.0",
        connected: false,
        tokenConfigured: configuration.tokenConfigured,
        checkedAt,
        lastSuccessAt,
        trigger,
        sourceUrl: null,
        baseUrl: configuration.baseUrl,
        summary: lastSnapshot?.summary || null,
        heartbeatHistory: historySnapshot(),
        heartbeatThresholds: {
          currentSeconds: WORKER_HEARTBEAT_CURRENT_SECONDS,
          staleSeconds: WORKER_HEARTBEAT_STALE_SECONDS,
        },
        error: safeError(error),
        claimBoundary: "The worker fleet is unavailable because current EIOS telemetry could not be verified. Cached records, when present, remain visibly stale and do not prove current operation.",
      };
      lastSnapshot = failure;
      return failure;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function requireWorkerId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("A valid worker identifier is required.");
  }
  return id;
}

function requireTaskId(value) {
  return requireWorkerId(value);
}

function idempotencyKey(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
}

async function issueWorkerCommand(payload) {
  const workerId = requireWorkerId(payload?.workerId);
  const action = String(payload?.action || "").trim();
  if (!["pause", "resume", "stop", "drain", "restart", "quarantine", "retire"].includes(action)) {
    throw new Error("Unsupported worker command.");
  }
  const reason = String(payload?.reason || "").trim();
  if (reason.length < 3 || reason.length > 2000) {
    throw new Error("Worker commands require an owner reason between 3 and 2000 characters.");
  }
  const response = await workerRequest(`workers/${workerId}/commands`, {
    method: "POST",
    body: {
      action,
      reason,
      idempotency_key: idempotencyKey(`desktop-${action}`),
      payload: { origin: "owner-command-center-desktop" },
    },
  });
  return {
    command: response.payload,
    snapshot: await refreshWorkerFleet(`worker-command-${action}`),
  };
}

async function evaluateWorkerScale(payload) {
  const execute = payload?.execute === true;
  const reason = String(payload?.reason || "").trim();
  if (reason.length < 3 || reason.length > 2000) {
    throw new Error("Worker scaling requires an owner reason between 3 and 2000 characters.");
  }
  const response = await workerRequest("scale/plan", {
    method: "POST",
    body: { execute, reason },
  });
  return {
    plan: response.payload,
    snapshot: await refreshWorkerFleet(execute ? "worker-scale-executed" : "worker-scale-planned"),
  };
}

async function updateWorkerPolicy(payload) {
  const policy = payload?.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("A complete worker policy is required.");
  }
  const response = await workerRequest("policy", {
    method: "PUT",
    body: policy,
  });
  return {
    policy: response.payload,
    snapshot: await refreshWorkerFleet("worker-policy-updated"),
  };
}

async function controlWorkerTask(payload) {
  const taskId = requireTaskId(payload?.taskId);
  const reason = String(payload?.reason || "").trim();
  if (reason.length < 3 || reason.length > 2000) {
    throw new Error("Task changes require an owner reason between 3 and 2000 characters.");
  }
  const body = {
    reason,
    idempotency_key: idempotencyKey("desktop-task-control"),
  };
  if (payload?.targetWorkerId) body.target_worker_id = requireWorkerId(payload.targetWorkerId);
  if (payload?.priority !== undefined && payload?.priority !== null) {
    const priority = Number(payload.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      throw new Error("Task priority must be an integer from 0 through 100.");
    }
    body.priority = priority;
  }
  if (payload?.instructions !== undefined && payload?.instructions !== null) {
    body.instructions = String(payload.instructions).slice(0, 30000);
  }
  if (
    body.target_worker_id === undefined
    && body.priority === undefined
    && body.instructions === undefined
  ) {
    throw new Error("At least one task change is required.");
  }
  const response = await workerRequest(`tasks/${taskId}/control`, {
    method: "PUT",
    body,
  });
  return {
    task: response.payload,
    snapshot: await refreshWorkerFleet("worker-task-controlled"),
  };
}

function registerWorkerFleetHandlers() {
  ipcMain.handle("workerFleet:getSnapshot", async () => (
    lastSnapshot || refreshWorkerFleet("initial-worker-fleet-load")
  ));
  ipcMain.handle(
    "workerFleet:refresh",
    async () => refreshWorkerFleet("owner-requested-worker-refresh"),
  );
  ipcMain.handle(
    "workerFleet:command",
    async (_event, payload) => issueWorkerCommand(payload),
  );
  ipcMain.handle(
    "workerFleet:scale",
    async (_event, payload) => evaluateWorkerScale(payload),
  );
  ipcMain.handle(
    "workerFleet:updatePolicy",
    async (_event, payload) => updateWorkerPolicy(payload),
  );
  ipcMain.handle(
    "workerFleet:controlTask",
    async (_event, payload) => controlWorkerTask(payload),
  );
}

app.whenReady().then(registerWorkerFleetHandlers).catch((error) => {
  lastSnapshot = {
    schemaVersion: "1.0",
    connected: false,
    tokenConfigured: false,
    checkedAt: new Date().toISOString(),
    lastSuccessAt: null,
    trigger: "worker-runtime-initialization",
    sourceUrl: null,
    baseUrl: null,
    summary: null,
    heartbeatHistory: {},
    heartbeatThresholds: {
      currentSeconds: WORKER_HEARTBEAT_CURRENT_SECONDS,
      staleSeconds: WORKER_HEARTBEAT_STALE_SECONDS,
    },
    error: safeError(error),
    claimBoundary: "Worker telemetry is unavailable because the desktop worker runtime did not initialize.",
  };
});

module.exports = {
  heartbeatAgeSeconds,
  heartbeatClass,
  refreshWorkerFleet,
};
