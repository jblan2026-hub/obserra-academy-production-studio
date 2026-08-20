import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputPath = path.join(root, "catalog", "accelerated-provider-preflight.json");
const endpoint = process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
const organization = String(process.env.OPENAI_ORGANIZATION || "").trim();
const project = String(process.env.OPENAI_PROJECT || "").trim();
const reasoningEffort = process.env.OPENAI_PREFLIGHT_REASONING_EFFORT || "low";
const attemptsPerModel = Math.max(
  1,
  Math.min(4, Number(process.env.ACADEMY_PREFLIGHT_MAX_ATTEMPTS || 2)),
);
const timeoutMs = Math.max(
  10_000,
  Math.min(120_000, Number(process.env.ACADEMY_PREFLIGHT_TIMEOUT_MS || 60_000)),
);
const baseDelayMs = Math.max(
  1_000,
  Math.min(30_000, Number(process.env.ACADEMY_PREFLIGHT_RETRY_BASE_MS || 2_000)),
);
const primaryModel = String(
  process.env.OPENAI_AUTHORING_MODEL || "gpt-5.6-terra",
).trim();
const fallbackModels = String(
  process.env.OPENAI_AUTHORING_FALLBACK_MODELS || "gpt-5.6-luna,gpt-5.6",
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const candidateModels = [...new Set([primaryModel, ...fallbackModels].filter(Boolean))];

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required for authoring provider preflight.");
}
if (candidateModels.length === 0) {
  throw new Error("At least one OpenAI authoring model must be configured.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return status === null
    || status === 408
    || status === 409
    || status === 425
    || status === 429
    || status >= 500;
}

function authenticationFailure(status) {
  return status === 401 || status === 403;
}

function requestHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(organization ? { "OpenAI-Organization": organization } : {}),
    ...(project ? { "OpenAI-Project": project } : {}),
  };
}

async function requestOnce(model, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: requestHeaders(),
      body: JSON.stringify({
        model,
        input: "Return the single word READY.",
        max_output_tokens: 16,
        reasoning: { effort: reasoningEffort },
        store: false,
      }),
    });

    const requestId =
      response.headers.get("x-request-id")
      || response.headers.get("request-id")
      || null;
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      await response.arrayBuffer();
      return {
        ok: true,
        model,
        attempt,
        status: response.status,
        requestId,
        latencyMs,
      };
    }

    const text = (await response.text()).slice(0, 1200);
    return {
      ok: false,
      model,
      attempt,
      status: response.status,
      requestId,
      latencyMs,
      retryable: retryableStatus(response.status),
      authenticationFailure: authenticationFailure(response.status),
      error: text,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    return {
      ok: false,
      model,
      attempt,
      status: null,
      requestId: null,
      latencyMs: Date.now() - startedAt,
      retryable: true,
      authenticationFailure: false,
      timedOut,
      error: timedOut
        ? `provider preflight timed out after ${timeoutMs} ms`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const attemptHistory = [];
let finalResult = null;
let selectedModel = null;
let stopAllModels = false;

for (const model of candidateModels) {
  for (let attempt = 1; attempt <= attemptsPerModel; attempt += 1) {
    const result = await requestOnce(model, attempt);
    attemptHistory.push({
      model,
      attempt,
      status: result.status,
      requestId: result.requestId,
      latencyMs: result.latencyMs,
      ready: result.ok,
      timedOut: result.timedOut === true,
    });
    finalResult = result;

    if (result.ok) {
      selectedModel = model;
      break;
    }
    if (result.authenticationFailure) {
      stopAllModels = true;
      break;
    }
    if (!result.retryable || attempt === attemptsPerModel) {
      break;
    }

    const retryAfterMs = baseDelayMs * 2 ** (attempt - 1);
    console.warn(
      `[Academy Studio] Provider preflight model=${model} attempt=${attempt}/${attemptsPerModel} failed with ${result.status ?? "transport error"}; retrying in ${retryAfterMs} ms.`,
    );
    await delay(retryAfterMs);
  }

  if (selectedModel || stopAllModels) break;
  console.warn(
    `[Academy Studio] Provider preflight is moving from ${model} to the next governed fallback model.`,
  );
}

const evidence = {
  schemaVersion: "2.0",
  checkedAt: new Date().toISOString(),
  provider: "openai",
  selectedModel,
  primaryModel,
  candidateModels,
  endpointHost: new URL(endpoint).hostname,
  reasoningEffort,
  store: false,
  organizationHeaderConfigured: Boolean(organization),
  projectHeaderConfigured: Boolean(project),
  attemptsPerModel,
  totalAttemptsUsed: attemptHistory.length,
  attemptHistory,
  ready: Boolean(selectedModel),
  finalHttpStatus: finalResult?.status ?? null,
  requestId: finalResult?.requestId || null,
  timedOut: finalResult?.timedOut === true,
  limitation:
    "This minimal request proves current authentication, routing, selected-model access, and immediate request capacity only. It does not prove sufficient throughput or budget for the full Academy portfolio.",
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

if (!selectedModel) {
  const status = finalResult?.status ?? "transport error";
  const detail = String(finalResult?.error || "unknown provider failure").slice(0, 1200);
  throw new Error(
    `Authoring provider preflight failed across ${candidateModels.length} governed model candidate(s) after ${attemptHistory.length} request(s) with ${status}: ${detail}`,
  );
}

if (process.env.GITHUB_ENV) {
  fs.appendFileSync(
    process.env.GITHUB_ENV,
    `OPENAI_AUTHORING_MODEL=${selectedModel}\n`,
  );
}

console.log(
  `[Academy Studio] Provider preflight passed with ${selectedModel} after ${attemptHistory.length} request(s); projectHeaderConfigured=${Boolean(project)} organizationHeaderConfigured=${Boolean(organization)}.`,
);
