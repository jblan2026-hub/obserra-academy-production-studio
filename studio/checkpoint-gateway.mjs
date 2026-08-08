import crypto from "node:crypto";

const OIDC_AUDIENCE = "obserra-academy-checkpoint";
const GATEWAY_PATH = "/functions/v1/academy-checkpoint-gateway";
const REQUIRED_VALUES = new Set(["1", "true", "yes", "on"]);
const MAX_RESPONSE_BYTES = 10_000_000;
const REQUEST_TIMEOUT_MS = 45_000;
let oidcTokenPromise = null;

function requiredBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return REQUIRED_VALUES.has(String(raw).trim().toLowerCase());
}

export function checkpointGatewayRequired() {
  return requiredBoolean("ACADEMY_CHECKPOINT_GATEWAY_REQUIRED", false);
}

export function checkpointGatewayConfigured() {
  return Boolean(String(process.env.ACADEMY_CHECKPOINT_GATEWAY_URL ?? "").trim());
}

function validatedProjectRef() {
  const value = String(process.env.ACADEMY_SUPABASE_PROJECT_REF ?? "").trim();
  if (!/^[a-z0-9]{20}$/.test(value)) {
    throw new Error("ACADEMY_SUPABASE_PROJECT_REF is required for the protected checkpoint gateway.");
  }
  return value;
}

function validatedGatewayUrl() {
  const raw = String(process.env.ACADEMY_CHECKPOINT_GATEWAY_URL ?? "").trim();
  if (!raw) {
    if (checkpointGatewayRequired()) {
      throw new Error("ACADEMY_CHECKPOINT_GATEWAY_URL is required for protected authoring checkpoints.");
    }
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ACADEMY_CHECKPOINT_GATEWAY_URL is invalid.");
  }

  const expectedHost = `${validatedProjectRef()}.supabase.co`;
  if (parsed.protocol !== "https:"
      || parsed.hostname !== expectedHost
      || parsed.port
      || parsed.username
      || parsed.password
      || parsed.pathname.replace(/\/$/, "") !== GATEWAY_PATH
      || parsed.search
      || parsed.hash) {
    throw new Error("ACADEMY_CHECKPOINT_GATEWAY_URL does not match the protected Supabase checkpoint endpoint.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function validatedOidcRequestUrl() {
  const raw = String(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "").trim();
  if (!raw) throw new Error("GitHub OIDC token request URL is unavailable. Grant id-token: write to the Academy job.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("GitHub OIDC token request URL is invalid.");
  }
  if (parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.port
      || !(parsed.hostname === "actions.githubusercontent.com" || parsed.hostname.endsWith(".actions.githubusercontent.com"))) {
    throw new Error("GitHub OIDC token request URL is not an authorized GitHub Actions endpoint.");
  }
  parsed.searchParams.set("audience", OIDC_AUDIENCE);
  return parsed;
}

async function requestOidcToken() {
  if (oidcTokenPromise) return oidcTokenPromise;
  oidcTokenPromise = (async () => {
    const requestToken = String(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "").trim();
    if (!requestToken || requestToken.length > 20_000) {
      throw new Error("GitHub OIDC request token is unavailable. Grant id-token: write to the Academy job.");
    }
    const response = await fetch(validatedOidcRequestUrl(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${requestToken}`,
        accept: "application/json",
        "user-agent": "Obserra-Academy-Checkpoint-Client/1.0",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub OIDC token request failed with HTTP ${response.status}.`);
    }
    if (text.length > 50_000) throw new Error("GitHub OIDC token response exceeded the permitted size.");
    const payload = JSON.parse(text);
    const token = String(payload?.value ?? "").trim();
    if (!token || token.length > 20_000 || token.split(".").length !== 3) {
      throw new Error("GitHub OIDC token response was invalid.");
    }
    return token;
  })();

  try {
    return await oidcTokenPromise;
  } catch (error) {
    oidcTokenPromise = null;
    throw error;
  }
}

async function boundedJson(response) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Protected checkpoint gateway response exceeded the permitted size.");
  }
  if (!text) return {};
  return JSON.parse(text);
}

async function gatewayRequest(action, payload = {}) {
  const gatewayUrl = validatedGatewayUrl();
  if (!gatewayUrl) return null;
  const requestId = crypto.randomUUID();
  const oidcToken = await requestOidcToken();
  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oidcToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Obserra-Academy-Checkpoint-Client/1.0",
      "x-obserra-request-id": requestId,
    },
    body: JSON.stringify({ action, ...payload }),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await boundedJson(response);
  if (!response.ok) {
    const code = String(body?.code ?? "checkpoint_gateway_error").slice(0, 100);
    throw new Error(`Protected checkpoint gateway rejected ${action} with HTTP ${response.status} (${code}).`);
  }
  return body;
}

export async function preflightCheckpointGateway() {
  const response = await gatewayRequest("health");
  if (!response?.ready || response.transport !== "github-oidc-supabase") {
    throw new Error("Protected checkpoint gateway preflight did not return a ready state.");
  }
  return {
    ready: true,
    transport: response.transport,
    checkpointTable: response.checkpointTable,
  };
}

export async function persistCheckpointThroughGateway({
  organizationKey,
  courseSlug,
  sourceManifestHash,
  authoringPolicyVersion,
  provider,
  model,
  packageHash,
  envelope,
}) {
  const response = await gatewayRequest("upsert", {
    organizationKey,
    courseSlug,
    sourceManifestHash,
    authoringPolicyVersion,
    provider,
    model,
    packageHash,
    package: envelope,
  });
  if (!response?.stored || response.courseSlug !== courseSlug || response.packageHash !== packageHash) {
    throw new Error(`Protected checkpoint gateway did not confirm storage for ${courseSlug}.`);
  }
  return {
    stored: true,
    courseId: courseSlug,
    packageHash,
    transport: "github-oidc-supabase",
  };
}

export async function fetchCheckpointThroughGateway({
  organizationKey,
  courseSlug,
  sourceManifestHash,
  authoringPolicyVersion,
}) {
  const response = await gatewayRequest("fetch", {
    organizationKey,
    courseSlug,
    sourceManifestHash,
    authoringPolicyVersion,
  });
  return response?.checkpoint ?? null;
}

export function checkpointTransportName() {
  return checkpointGatewayConfigured() ? "github-oidc-supabase" : "direct-postgresql";
}
