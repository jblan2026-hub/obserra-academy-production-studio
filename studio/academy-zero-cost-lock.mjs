import process from "node:process";

export const ACADEMY_ZERO_COST_LOCK_VERSION = "2026.08.08.1";

const LOCKED = true;
const LOCAL_PROVIDER = "local";
const FALSE_VALUES = new Set(["", "0", "false", "no", "off"]);

const providerVariables = [
  "ACADEMY_RESEARCH_PROVIDER",
  "ACADEMY_AUTHORING_PROVIDER",
  "ACADEMY_REVIEW_PROVIDER",
];

const prohibitedCredentialVariables = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "HEYGEN_API_KEY",
  "SYNTHESIA_API_KEY",
  "DID_API_KEY",
  "RUNWAY_API_KEY",
  "REPLICATE_API_TOKEN",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AWS_BEDROCK_API_KEY",
];

const prohibitedEndpointVariables = [
  "OPENAI_API_URL",
  "ANTHROPIC_API_URL",
  "ELEVENLABS_API_URL",
  "HEYGEN_API_URL",
  "SYNTHESIA_API_URL",
  "DID_API_URL",
  "RUNWAY_API_URL",
  "REPLICATE_API_URL",
  "AZURE_OPENAI_ENDPOINT",
  "AWS_BEDROCK_ENDPOINT",
];

const prohibitedProviderVariables = [
  "STUDIO_AI_PROVIDER",
  "STUDIO_RESEARCH_PROVIDER",
  "STUDIO_AUTHORING_PROVIDER",
  "STUDIO_REVIEW_PROVIDER",
  "STUDIO_VIDEO_PROVIDER",
  "STUDIO_TTS_PROVIDER",
  "ACADEMY_MEDIA_PROVIDER",
  "ACADEMY_VIDEO_PROVIDER",
  "ACADEMY_TTS_PROVIDER",
];

const blockedHostSuffixes = [
  "api.openai.com",
  "api.anthropic.com",
  "api.elevenlabs.io",
  "api.heygen.com",
  "api.synthesia.io",
  "api.d-id.com",
  "api.runwayml.com",
  "api.replicate.com",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
  "api.cohere.com",
  "api.groq.com",
  "api.together.xyz",
];

function normalized(value) {
  return String(value ?? "").trim();
}

function isFalse(value) {
  return FALSE_VALUES.has(normalized(value).toLowerCase());
}

function isLoopbackHostname(hostname) {
  const host = normalized(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function validateLocalAiEndpoint() {
  const raw = normalized(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ACADEMY_ZERO_COST_LOCK: LOCAL_AI_BASE_URL is invalid.");
  }
  if (parsed.protocol !== "http:" || !isLoopbackHostname(parsed.hostname)) {
    throw new Error(
      `ACADEMY_ZERO_COST_LOCK: LOCAL_AI_BASE_URL must be an HTTP loopback endpoint; received ${parsed.origin}.`,
    );
  }
  return parsed.origin;
}

function validateProviderConfiguration() {
  for (const name of providerVariables) {
    const value = normalized(process.env[name] || LOCAL_PROVIDER).toLowerCase();
    if (value !== LOCAL_PROVIDER) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: ${name} must remain local; received ${value || "empty"}.`);
    }
  }

  for (const name of prohibitedProviderVariables) {
    const value = normalized(process.env[name]).toLowerCase();
    if (value && !["local", "none", "disabled", "off"].includes(value)) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: ${name} selects a prohibited provider: ${value}.`);
    }
  }

  if (!isFalse(process.env.STUDIO_ALLOW_PAID_AI)) {
    throw new Error("ACADEMY_ZERO_COST_LOCK: STUDIO_ALLOW_PAID_AI must be false.");
  }
}

function validateCommercialCredentialsAbsent() {
  const configuredCredentials = prohibitedCredentialVariables.filter((name) => normalized(process.env[name]));
  if (configuredCredentials.length > 0) {
    throw new Error(
      `ACADEMY_ZERO_COST_LOCK: commercial credentials are prohibited and must be removed: ${configuredCredentials.join(", ")}.`,
    );
  }

  const configuredEndpoints = prohibitedEndpointVariables.filter((name) => normalized(process.env[name]));
  if (configuredEndpoints.length > 0) {
    throw new Error(
      `ACADEMY_ZERO_COST_LOCK: commercial provider endpoints are prohibited and must be removed: ${configuredEndpoints.join(", ")}.`,
    );
  }
}

function requestUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  if (input && typeof input.url === "string") return new URL(input.url);
  throw new Error("ACADEMY_ZERO_COST_LOCK: fetch request URL could not be determined.");
}

function hostIsBlocked(hostname) {
  const host = normalized(hostname).toLowerCase();
  return blockedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function installCommercialNetworkBlock() {
  if (globalThis.__obserraAcademyZeroCostFetchLockInstalled) return;
  const nativeFetch = globalThis.fetch?.bind(globalThis);
  if (typeof nativeFetch !== "function") {
    throw new Error("ACADEMY_ZERO_COST_LOCK: global fetch is unavailable.");
  }

  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (hostIsBlocked(url.hostname)) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: outbound commercial provider request blocked: ${url.hostname}.`);
    }
    return nativeFetch(input, init);
  };
  globalThis.__obserraAcademyZeroCostFetchLockInstalled = true;
}

export function assertAcademyZeroCostLock() {
  if (!LOCKED) throw new Error("ACADEMY_ZERO_COST_LOCK: source lock is unexpectedly disabled.");
  validateProviderConfiguration();
  validateCommercialCredentialsAbsent();
  const localAiOrigin = validateLocalAiEndpoint();
  installCommercialNetworkBlock();
  return {
    locked: true,
    version: ACADEMY_ZERO_COST_LOCK_VERSION,
    localAiOrigin,
    commercialCredentialsAllowed: false,
    commercialEndpointsAllowed: false,
    paidFallbackAllowed: false,
  };
}

const lockEvidence = assertAcademyZeroCostLock();
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(`[Academy Studio] Zero-cost lock ${lockEvidence.version} active. Paid provider paths fail closed.`);
}

export default lockEvidence;
