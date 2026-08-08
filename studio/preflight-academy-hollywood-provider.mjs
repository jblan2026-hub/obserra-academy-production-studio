import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProviderAuthoringError,
  providerAuthoringErrorFromHttp,
} from "./authoring-provider-errors.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const evidencePath = path.join(catalogRoot, "academy-hollywood-provider-preflight.json");
const provider = String(process.env.ACADEMY_AUTHORING_PROVIDER || "openai").trim().toLowerCase();
const timeoutMs = boundedNumber(process.env.ACADEMY_AUTHORING_PREFLIGHT_TIMEOUT_MS, 120_000, 10_000, 5 * 60_000);

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function fingerprint(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function providerRequest() {
  if (provider === "openai") {
    const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new ProviderAuthoringError({
        provider,
        category: "provider_authentication_failed",
        retryable: false,
        exitCode: 43,
        providerCode: "missing_api_key",
        message: "OPENAI_API_KEY is required for the Academy cinematic production surge.",
      });
    }
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    const organization = String(process.env.OPENAI_ORGANIZATION ?? "").trim();
    const project = String(process.env.OPENAI_PROJECT ?? "").trim();
    if (organization) headers["OpenAI-Organization"] = organization;
    if (project) headers["OpenAI-Project"] = project;
    return {
      url: process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses",
      headers,
      model: process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
      body: {
        model: process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
        input: "Return the single word READY.",
        max_output_tokens: 16,
        reasoning: { effort: process.env.OPENAI_PREFLIGHT_REASONING_EFFORT || "low" },
        store: false,
      },
    };
  }
  if (provider === "anthropic") {
    const apiKey = String(process.env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new ProviderAuthoringError({
        provider,
        category: "provider_authentication_failed",
        retryable: false,
        exitCode: 43,
        providerCode: "missing_api_key",
        message: "ANTHROPIC_API_KEY is required for the Academy cinematic production surge.",
      });
    }
    return {
      url: process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
      },
      model: process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5",
      body: {
        model: process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5",
        max_tokens: 8,
        temperature: 0,
        messages: [{ role: "user", content: "Return the single word READY." }],
      },
    };
  }
  throw new ProviderAuthoringError({
    provider,
    category: "provider_request_invalid",
    retryable: false,
    exitCode: 44,
    providerCode: "unsupported_provider",
    message: `Unsupported Academy authoring provider: ${provider}`,
  });
}

async function requestWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new ProviderAuthoringError({
        provider,
        category: "provider_transient_failure",
        retryable: true,
        exitCode: 1,
        providerCode: "provider_request_timeout",
        message: `Provider preflight timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function successEvidence(response, request) {
  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    provider,
    model: request.model,
    ready: true,
    httpStatus: response.status,
    organizationFingerprint: fingerprint(response.headers.get("openai-organization") || process.env.OPENAI_ORGANIZATION),
    projectFingerprint: fingerprint(response.headers.get("openai-project") || process.env.OPENAI_PROJECT),
    requestFingerprint: fingerprint(response.headers.get("x-request-id") || response.headers.get("request-id")),
    requestedPortfolioWorkers: 36,
    limitation: "This minimal request proves current authentication, routing, model access, and immediate request capacity only. It does not prove sufficient provider throughput or budget for all course packages and media work.",
  };
}

function failureEvidence(error, request = null) {
  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    provider,
    model: request?.model ?? null,
    ready: false,
    category: error instanceof ProviderAuthoringError ? error.category : "provider_preflight_failure",
    retryable: error instanceof ProviderAuthoringError ? error.retryable : false,
    status: error instanceof ProviderAuthoringError ? error.status : null,
    providerCode: error instanceof ProviderAuthoringError ? error.providerCode : null,
    limitation: "No Academy cinematic authoring workers may launch until provider preflight passes.",
  };
}

fs.mkdirSync(catalogRoot, { recursive: true });
let request;
try {
  request = providerRequest();
  const response = await requestWithTimeout(request);
  if (!response.ok) {
    const body = (await response.text()).slice(0, 4000);
    throw providerAuthoringErrorFromHttp({ provider, status: response.status, body });
  }
  fs.writeFileSync(evidencePath, `${JSON.stringify(successEvidence(response, request), null, 2)}\n`);
  console.log(`[Academy Studio] Cinematic production provider preflight passed for ${provider} model ${request.model}.`);
} catch (error) {
  fs.writeFileSync(evidencePath, `${JSON.stringify(failureEvidence(error, request), null, 2)}\n`);
  if (error instanceof ProviderAuthoringError) {
    const safeMessage = String(error.message || error.category).replace(/\s+/g, " ").slice(0, 1600);
    console.error(`[Academy Studio] HOLLYWOOD_PROVIDER_PREFLIGHT_FAILURE provider=${error.provider} category=${error.category} retryable=${error.retryable} status=${error.status ?? "unknown"} providerCode=${error.providerCode ?? "unknown"}: ${safeMessage}`);
    process.exit(error.exitCode || 2);
  }
  throw error;
}
