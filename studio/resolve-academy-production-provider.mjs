import fs from "node:fs";

const candidates = String(process.env.ACADEMY_PROVIDER_PREFERENCE || "anthropic,openai")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter((value, index, values) => value && values.indexOf(value) === index);

const supported = new Set(["openai", "anthropic"]);
for (const provider of candidates) {
  if (!supported.has(provider)) throw new Error(`Unsupported Academy provider in preference list: ${provider}`);
}

function boundedMessage(value) {
  return String(value || "unknown provider failure").replace(/\s+/g, " ").slice(0, 800);
}

async function probeOpenAI() {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { provider: "openai", usable: false, category: "credential_missing", detail: "OPENAI_API_KEY is not configured" };
  const response = await fetch(process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(process.env.OPENAI_ORGANIZATION ? { "OpenAI-Organization": String(process.env.OPENAI_ORGANIZATION).trim() } : {}),
      ...(process.env.OPENAI_PROJECT ? { "OpenAI-Project": String(process.env.OPENAI_PROJECT).trim() } : {}),
    },
    body: JSON.stringify({
      model: process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
      input: "Reply with exactly: OK",
      max_output_tokens: 16,
      store: false,
    }),
  });
  const body = await response.text();
  if (response.ok) return { provider: "openai", usable: true, category: "healthy", detail: `HTTP ${response.status}` };
  let parsed = {};
  try { parsed = JSON.parse(body); } catch {}
  const error = parsed?.error || parsed;
  const code = String(error?.code || error?.type || "").toLowerCase();
  const message = boundedMessage(error?.message || body);
  const exhausted = response.status === 429 && (code.includes("quota") || code.includes("credit") || message.toLowerCase().includes("credit") || message.toLowerCase().includes("quota"));
  return {
    provider: "openai",
    usable: false,
    category: exhausted ? "quota_exhausted" : ([401, 403].includes(response.status) ? "authentication_failed" : "provider_unhealthy"),
    detail: `HTTP ${response.status}: ${message}`,
  };
}

async function probeAnthropic() {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return { provider: "anthropic", usable: false, category: "credential_missing", detail: "ANTHROPIC_API_KEY is not configured" };
  const response = await fetch(process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_RESEARCH_MODEL || process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5",
      max_tokens: 8,
      temperature: 0,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    }),
  });
  const body = await response.text();
  if (response.ok) return { provider: "anthropic", usable: true, category: "healthy", detail: `HTTP ${response.status}` };
  let parsed = {};
  try { parsed = JSON.parse(body); } catch {}
  const error = parsed?.error || parsed;
  const code = String(error?.type || error?.code || "").toLowerCase();
  const message = boundedMessage(error?.message || body);
  const exhausted = response.status === 429 && (code.includes("rate_limit") || message.toLowerCase().includes("credit") || message.toLowerCase().includes("billing"));
  return {
    provider: "anthropic",
    usable: false,
    category: exhausted ? "quota_or_rate_limited" : ([401, 403].includes(response.status) ? "authentication_failed" : "provider_unhealthy"),
    detail: `HTTP ${response.status}: ${message}`,
  };
}

const probes = [];
for (const provider of candidates) {
  const result = provider === "anthropic" ? await probeAnthropic() : await probeOpenAI();
  probes.push(result);
  console.log(`[Academy Studio] Provider preflight ${provider}: ${result.usable ? "HEALTHY" : "UNAVAILABLE"} (${result.category}).`);
  if (!result.usable) continue;

  const lines = [
    `ACADEMY_RESEARCH_PROVIDER=${provider}`,
    `ACADEMY_AUTHORING_PROVIDER=${provider}`,
    `ACADEMY_REVIEW_PROVIDER=${provider}`,
    `ACADEMY_RESOLVED_PROVIDER=${provider}`,
  ];
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`, "utf8");
  console.log(`[Academy Studio] Resolved production provider: ${provider}.`);
  process.exit(0);
}

console.error("[Academy Studio] No funded and authenticated production provider is available.");
for (const result of probes) console.error(`[Academy Studio] ${result.provider}: ${result.category} - ${result.detail}`);
process.exit(42);
