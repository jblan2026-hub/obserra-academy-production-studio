import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProviderAuthoringError,
  providerAuthoringErrorFromHttp,
} from "./authoring-provider-errors.mjs";
import {
  ProviderTransportError,
  providerHttpRequest,
} from "./provider-http.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const evidencePath = path.join(catalogRoot, "authoring-provider-preflight.json");
const provider = String(process.env.ACADEMY_AUTHORING_PROVIDER || "openai").trim().toLowerCase();
const timeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_PREFLIGHT_TIMEOUT_MS,
  120_000,
  10_000,
  5 * 60_000,
);

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

function providerHeaders(providerName, apiKey) {
  if (providerName === "openai") {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    const organization = String(process.env.OPENAI_ORGANIZATION ?? "").trim();
    const project = String(process.env.OPENAI_PROJECT ?? "").trim();
    if (organization) headers["OpenAI-Organization"] = organization;
    if (project) headers["OpenAI-Project"] = project;
    return headers;
  }

  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
  };
}

function preflightRequest() {
  if (provider === "openai") {
    const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new ProviderAuthoringError({
        provider,
        category: "provider_authentication_failed",
        retryable: false,
        exitCode: 43,
        providerCode: "missing_api_key",
        message: "OPENAI_API_KEY is required for protected Academy authoring.",
      });
    }
    return {
      url: process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses",
      headers: providerHeaders(provider, apiKey),
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
        message: "ANTHROPIC_API_KEY is required for protected Academy authoring.",
      });
    }
    return {
      url: process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages",
      headers: providerHeaders(provider, apiKey),
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

function safeProviderEvidence(response, request) {
  const organizationHeader = response.headers["openai-organization"] || response.headers["anthropic-organization-id"];
  const projectHeader = response.headers["openai-project"] || response.headers["anthropic-project-id"];
  const requestId = response.headers["x-request-id"] || response.headers["request-id"];
  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    provider,
    model: request.model,
    ready: true,
    httpStatus: response.status,
    organizationFingerprint: fingerprint(organizationHeader || process.env.OPENAI_ORGANIZATION),
    projectFingerprint: fingerprint(projectHeader || process.env.OPENAI_PROJECT),
    requestFingerprint: fingerprint(requestId),
    limitation: "A successful minimal request proves current authentication, routing, model access, and request capacity only. It does not prove sufficient remaining balance for the full course portfolio.",
  };
}

function failureEvidence(error, request = null) {
  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    provider,
    model: request?.model ?? null,
    ready: false,
    category: error instanceof ProviderAuthoringError
      ? error.category
      : error instanceof ProviderTransportError
        ? "provider_transient_failure"
        : "provider_preflight_failure",
    retryable: error instanceof ProviderAuthoringError
      ? error.retryable
      : error instanceof ProviderTransportError,
    status: error instanceof ProviderAuthoringError ? error.status : null,
    providerCode: error instanceof ProviderAuthoringError
      ? error.providerCode
      : error instanceof ProviderTransportError
        ? error.category
        : null,
    limitation: "No protected authoring workers were launched because the provider preflight did not pass.",
  };
}

async function main() {
  fs.mkdirSync(catalogRoot, { recursive: true });
  let request;
  try {
    request = preflightRequest();
    const response = await providerHttpRequest({
      provider,
      url: request.url,
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      timeoutMs,
      maximumResponseBytes: 2 * 1024 * 1024,
    });

    if (!response.ok) {
      const body = await response.text();
      throw providerAuthoringErrorFromHttp({
        provider,
        status: response.status,
        body: body.slice(0, 4000),
      });
    }

    fs.writeFileSync(evidencePath, `${JSON.stringify(safeProviderEvidence(response, request), null, 2)}\n`);
    console.log(`[Academy Studio] Authoring provider preflight passed for ${provider} model ${request.model}.`);
  } catch (error) {
    fs.writeFileSync(evidencePath, `${JSON.stringify(failureEvidence(error, request), null, 2)}\n`);
    if (error instanceof ProviderAuthoringError) {
      const safeMessage = String(error.message || error.category).replace(/\s+/g, " ").slice(0, 1600);
      console.error(
        `[Academy Studio] AUTHORING_PROVIDER_PREFLIGHT_FAILURE provider=${error.provider} category=${error.category} retryable=${error.retryable} status=${error.status ?? "unknown"} providerCode=${error.providerCode ?? "unknown"}: ${safeMessage}`,
      );
      process.exit(error.exitCode || 2);
    }
    if (error instanceof ProviderTransportError) {
      console.error(
        `[Academy Studio] AUTHORING_PROVIDER_PREFLIGHT_FAILURE provider=${provider} category=provider_transient_failure retryable=true providerCode=${error.category}: ${error.message}`,
      );
      process.exit(1);
    }
    throw error;
  }
}

await main();
