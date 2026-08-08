import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ACADEMY_ZERO_COST_LOCK_VERSION = "2026.08.08.2";

const LOCKED = true;
const LOCAL_PROVIDER = "local";
const EXPECTED_REPOSITORY = "jblan2026-hub/obserra-academy-production-studio";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const policyPath = path.join(root, "policy", "academy-execution-route.json");
const workflowsRoot = path.join(root, ".github", "workflows");
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
  "FIREWORKS_API_KEY",
  "PERPLEXITY_API_KEY",
  "XAI_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPINFRA_API_TOKEN",
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
  "FIREWORKS_API_URL",
  "PERPLEXITY_API_URL",
  "XAI_API_URL",
  "CEREBRAS_API_URL",
  "DEEPINFRA_API_URL",
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
  "api.fireworks.ai",
  "api.perplexity.ai",
  "api.x.ai",
  "api.cerebras.ai",
  "api.deepinfra.com",
];

const alternateExecutionMarkers = [
  "run-academy-zero-cost-shard.mjs",
  "research-course-authoritative-sources.mjs",
  "author-course-hollywood.mjs",
  "author-course-hollywood-with-checkpoint.mjs",
  "author-all-61-cinematic-parallel.mjs",
  "author-courses-hollywood-parallel.mjs",
  "review-all-61-courses.mjs",
  "render-all-61-local-media.mjs",
  "submit-all-61-media-jobs.mjs",
  "restore-academy-hollywood-checkpoints.mjs",
  "verify-protected-61-checkpoint-count.mjs",
  "load-academy-hollywood-surge-to-lcms.mjs",
  "load-courses-to-lcms.mjs",
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

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: ${label} is missing or invalid: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: ${label} must be a JSON object.`);
  }
  return value;
}

function readRoutePolicy() {
  const policy = readJson(policyPath, "canonical execution route policy");
  if (policy.status !== "enforced" || policy.failClosed !== true) {
    throw new Error("ACADEMY_ZERO_COST_LOCK: execution route policy must be enforced and fail closed.");
  }
  if (policy.canonicalWorkflow !== ".github/workflows/academy-zero-cost-sharded-completion.yml") {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: unexpected canonical workflow ${policy.canonicalWorkflow || "missing"}.`);
  }
  if (!Array.isArray(policy.allowedWorkflowPaths) || policy.allowedWorkflowPaths.length !== 1 || policy.allowedWorkflowPaths[0] !== policy.canonicalWorkflow) {
    throw new Error("ACADEMY_ZERO_COST_LOCK: exactly one Academy execution workflow must be authorized.");
  }
  if (policy.providerPolicy?.commercialFallbackAllowed !== false) {
    throw new Error("ACADEMY_ZERO_COST_LOCK: commercial fallback must be prohibited by policy.");
  }
  if (policy.backupPolicy?.repository !== "jblan2026-hub/ObserraAI" || policy.backupPolicy?.repositoryVisibilityRequired !== "PRIVATE" || policy.backupPolicy?.publicArtifactsAllowed !== false) {
    throw new Error("ACADEMY_ZERO_COST_LOCK: private backup policy is invalid.");
  }
  if (!Array.isArray(policy.blockedWorkflowPaths) || policy.blockedWorkflowPaths.length < 1) {
    throw new Error("ACADEMY_ZERO_COST_LOCK: blocked legacy workflow inventory is missing.");
  }
  return policy;
}

function validateGitHubWorkflowIdentity(policy) {
  if (normalized(process.env.GITHUB_ACTIONS).toLowerCase() !== "true") return { enforced: false, reason: "not-github-actions" };

  const repository = normalized(process.env.GITHUB_REPOSITORY);
  const workflowRef = normalized(process.env.GITHUB_WORKFLOW_REF);
  const eventName = normalized(process.env.GITHUB_EVENT_NAME);
  if (repository !== EXPECTED_REPOSITORY) {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: unauthorized repository identity ${repository || "missing"}.`);
  }
  const expectedPrefix = `${EXPECTED_REPOSITORY}/${policy.canonicalWorkflow}@`;
  if (!workflowRef.startsWith(expectedPrefix)) {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: unauthorized workflow identity ${workflowRef || "missing"}; only ${policy.canonicalWorkflow} may execute Academy production.`);
  }
  if (!Array.isArray(policy.allowedEvents) || !policy.allowedEvents.includes(eventName)) {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: unauthorized GitHub event ${eventName || "missing"}.`);
  }
  return { enforced: true, workflowRef, eventName };
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
    throw new Error(`ACADEMY_ZERO_COST_LOCK: LOCAL_AI_BASE_URL must be an HTTP loopback endpoint; received ${parsed.origin}.`);
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

  const executionMode = normalized(process.env.ACADEMY_EXECUTION_MODE);
  if (normalized(process.env.GITHUB_ACTIONS).toLowerCase() === "true" && executionMode !== "local-ollama-zero-commercial-api-cost-locked") {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: invalid execution mode ${executionMode || "missing"}.`);
  }
}

function validateCommercialCredentialsAbsent() {
  const configuredCredentials = prohibitedCredentialVariables.filter((name) => normalized(process.env[name]));
  if (configuredCredentials.length > 0) {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: commercial credentials are prohibited and must be removed: ${configuredCredentials.join(", ")}.`);
  }

  const configuredEndpoints = prohibitedEndpointVariables.filter((name) => normalized(process.env[name]));
  if (configuredEndpoints.length > 0) {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: commercial provider endpoints are prohibited and must be removed: ${configuredEndpoints.join(", ")}.`);
  }
}

function validateCanonicalWorkflow(policy) {
  const canonicalPath = path.join(root, policy.canonicalWorkflow);
  const workflow = fs.readFileSync(canonicalPath, "utf8");
  const requiredFragments = [
    "group: academy-zero-cost-resilient-completion",
    "cancel-in-progress: true",
    "ACADEMY_CANARY_COURSE_ID: ai-data-privacy-ip",
    "ACADEMY_EXECUTION_MODE: local-ollama-zero-commercial-api-cost-locked",
    "ACADEMY_AUTHORING_PROVIDER: local",
    "ACADEMY_RESEARCH_PROVIDER: local",
    "ACADEMY_REVIEW_PROVIDER: local",
    "STUDIO_ALLOW_PAID_AI: \"false\"",
    "OPENAI_API_KEY: \"\"",
    "ANTHROPIC_API_KEY: \"\"",
    "needs: prepare-free-runtime",
    "needs: canary-course",
    "max-parallel: 20",
    "node studio/academy-zero-cost-lock.mjs",
    "render-canary-course-local-media.mjs",
    "verify-canary-course-completion.mjs",
    "verify-all-61-course-completion.mjs",
    "backup-61-courses-to-private-github.sh",
  ];
  for (const fragment of requiredFragments) {
    if (!workflow.includes(fragment)) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: canonical workflow contract is missing: ${fragment}`);
    }
  }
  const lockChecks = workflow.match(/node studio\/academy-zero-cost-lock\.mjs/g)?.length ?? 0;
  if (lockChecks < 4) {
    throw new Error(`ACADEMY_ZERO_COST_LOCK: canonical workflow requires at least four explicit lock checks; found ${lockChecks}.`);
  }
}

function validateBlockedWorkflowStubs(policy) {
  for (const relativePath of policy.blockedWorkflowPaths) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: blocked legacy workflow is missing: ${relativePath}`);
    }
    const content = fs.readFileSync(absolutePath, "utf8");
    if (!/^\s{2}workflow_dispatch:\s*$/m.test(content)) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: blocked workflow must retain only manual dispatch: ${relativePath}`);
    }
    if (/^\s{2}(pull_request|pull_request_target|push|schedule|repository_dispatch|workflow_call):/m.test(content)) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: blocked workflow contains an automatic or reusable trigger: ${relativePath}`);
    }
    if (!content.includes(policy.canonicalWorkflow) || !content.includes("exit 1")) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: blocked workflow is not a documented fail-closed stub: ${relativePath}`);
    }
  }
}

function validateNoAlternateExecutionWorkflow(policy) {
  const allowed = new Set([policy.canonicalWorkflow, ...policy.blockedWorkflowPaths]);
  const workflowFiles = fs.readdirSync(workflowsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => `.github/workflows/${entry.name}`)
    .sort();

  for (const relativePath of workflowFiles) {
    if (allowed.has(relativePath)) continue;
    const content = fs.readFileSync(path.join(root, relativePath), "utf8");
    const matchedMarkers = alternateExecutionMarkers.filter((marker) => content.includes(marker));
    if (matchedMarkers.length > 0) {
      throw new Error(`ACADEMY_ZERO_COST_LOCK: alternate Academy execution commands detected in ${relativePath}: ${matchedMarkers.join(", ")}.`);
    }
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
  const routePolicy = readRoutePolicy();
  const workflowIdentity = validateGitHubWorkflowIdentity(routePolicy);
  validateProviderConfiguration();
  validateCommercialCredentialsAbsent();
  validateCanonicalWorkflow(routePolicy);
  validateBlockedWorkflowStubs(routePolicy);
  validateNoAlternateExecutionWorkflow(routePolicy);
  const localAiOrigin = validateLocalAiEndpoint();
  installCommercialNetworkBlock();
  return {
    locked: true,
    version: ACADEMY_ZERO_COST_LOCK_VERSION,
    routePolicyVersion: routePolicy.policyVersion,
    canonicalWorkflow: routePolicy.canonicalWorkflow,
    workflowIdentity,
    localAiOrigin,
    commercialCredentialsAllowed: false,
    commercialEndpointsAllowed: false,
    paidFallbackAllowed: false,
    alternateExecutionRoutesAllowed: false,
  };
}

const lockEvidence = assertAcademyZeroCostLock();
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(`[Academy Studio] Zero-cost lock ${lockEvidence.version} active. Canonical route: ${lockEvidence.canonicalWorkflow}. Paid and alternate execution paths fail closed.`);
}

export default lockEvidence;
