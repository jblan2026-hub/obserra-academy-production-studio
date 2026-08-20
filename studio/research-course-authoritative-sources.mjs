import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const courseId = arg("--course");
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error("Usage: node studio/research-course-authoritative-sources.mjs --course <course-id>");
}

const provider = String(process.env.ACADEMY_RESEARCH_PROVIDER || "local").trim().toLowerCase();
if (!["local", "openai", "anthropic"].includes(provider)) throw new Error(`Unsupported Academy research provider: ${provider}`);

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const freeContextPath = path.join(courseDir, "generated", "research", "free-source-context.json");
if (!fs.existsSync(manifestPath)) throw new Error(`Course manifest not found for ${courseId}.`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const freeContext = fs.existsSync(freeContextPath) ? JSON.parse(fs.readFileSync(freeContextPath, "utf8")) : null;

const allowedPrimaryDomains = [
  ".gov", ".mil", ".int", "nist.gov", "csrc.nist.gov", "sec.gov", "ecfr.gov",
  "federalregister.gov", "fda.gov", "hhs.gov", "cms.gov", "ftc.gov", "dfs.ny.gov",
  "dol.gov", "osha.gov", "acquisition.gov", "defense.gov", "dodcio.defense.gov",
  "state.gov", "justice.gov", "congress.gov", "uscode.house.gov", "iso.org", "iec.ch",
  "pcisecuritystandards.org", "cisecurity.org", "pmi.org", "owasp.org", "cloudsecurityalliance.org"
];

function hostname(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}
function primaryDomainAllowed(url) {
  const host = hostname(url);
  if (!host) return false;
  return allowedPrimaryDomains.some((domain) => domain.startsWith(".") ? host.endsWith(domain) : host === domain || host.endsWith(`.${domain}`));
}
function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Authoritative research response contained no output text.");
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(unfenced); } catch {}
  const start = unfenced.indexOf("{");
  if (start < 0) throw new Error("Authoritative research returned no JSON object.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < unfenced.length; index += 1) {
    const char = unfenced[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(unfenced.slice(start, index + 1));
    }
  }
  throw new Error("Authoritative research returned an unterminated JSON object.");
}
function openAiResponseText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const chunks = [];
  for (const item of payload.output || []) for (const content of item.content || []) {
    if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) chunks.push(content.text);
  }
  return chunks.join("\n").trim();
}
function anthropicResponseText(payload) {
  return (payload.content || []).filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n").trim();
}

async function callLocal(prompt) {
  if (!freeContext || !Array.isArray(freeContext.matchedSources) || freeContext.matchedSources.length < 4) {
    throw new Error(`Local research requires at least four deterministic source matches for ${courseId}.`);
  }
  const base = String(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LOCAL_RESEARCH_MODEL || process.env.LOCAL_AI_MODEL || "qwen2.5:7b-instruct",
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: "You are a factual research synthesizer operating without web access. Use only supplied primary-source records and cached excerpts. Never invent a URL, case, section, date, statistic, quotation, legal requirement, or applicability condition. Put unsupported needs in unresolvedTopics." },
        { role: "user", content: prompt },
      ],
      options: {
        temperature: 0.1,
        num_ctx: Number(process.env.LOCAL_AI_NUM_CTX || process.env.ACADEMY_LOCAL_MODEL_CONTEXT || 32768),
      },
    }),
    signal: AbortSignal.timeout(Number(process.env.LOCAL_AI_TIMEOUT_MS || 3_600_000)),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Local Ollama research failed with ${response.status}: ${body.slice(0, 2000)}`);
  const payload = JSON.parse(body);
  const text = payload?.message?.content;
  if (!text) throw new Error("Local Ollama research returned no content.");
  return text;
}

async function callOpenAI(prompt) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI authoritative course research.");
  const response = await fetch(process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.OPENAI_RESEARCH_MODEL || "gpt-5", tools: [{ type: "web_search" }], input: prompt, max_output_tokens: Number(process.env.OPENAI_RESEARCH_MAX_OUTPUT_TOKENS || 20000), store: false }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`OpenAI authoritative research failed with ${response.status}: ${body.slice(0, 3000)}`);
  return openAiResponseText(JSON.parse(body));
}

async function callAnthropic(prompt) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for Anthropic authoritative course research.");
  const response = await fetch(process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_RESEARCH_MODEL || "claude-sonnet-4-5", max_tokens: Number(process.env.ANTHROPIC_RESEARCH_MAX_TOKENS || 20000), temperature: 0.1, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }], messages: [{ role: "user", content: prompt }] }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Anthropic authoritative research failed with ${response.status}: ${body.slice(0, 3000)}`);
  return anthropicResponseText(JSON.parse(body));
}

const course = manifest.course || {};
const localBoundary = provider === "local"
  ? "You have no web access. Use only the supplied governed source context and cached excerpts. A documented case may be included only when the supplied context contains primary-source facts sufficient to support it. Otherwise identify the missing case evidence under unresolvedTopics."
  : "Use provider web search, prefer current primary authorities, and independently verify every locator.";
const prompt = `You are conducting governed source research for an Obserra Academy professional course.\n\nCourse ID: ${courseId}\nTitle: ${course.title}\nDepartment: ${course.department}\nTrack: ${course.track}\nLevel: ${course.level}\nAudience: ${course.audience}\nDescription: ${course.description}\nLearning outcomes: ${JSON.stringify(course.outcomes || [])}\nModules: ${JSON.stringify(course.modules || [])}\nFramework tags: ${JSON.stringify(manifest.tags?.frameworks || [])}\nResearch date: ${new Date().toISOString().slice(0, 10)}\n\n${localBoundary}\n\nGoverned local primary-source context:\n${JSON.stringify(freeContext || { matchedSources: [] })}\n\nReturn exactly one valid JSON object and nothing else:\n{\n  "courseId": "${courseId}",\n  "researchDate": "YYYY-MM-DD",\n  "authoritativeSources": [{"id":"SRC-...","title":"","issuingAuthority":"","sourceType":"statute|regulation|final-rule|official-guidance|official-advisory|government-publication|consensus-standard|professional-standard","publication":"","publicationDate":null,"status":"final|current-regulation|current-statute|current-clause|current-guidance|draft","binding":false,"canonicalUrl":"https://...","specificReferences":[],"moduleIds":[],"claimTopics":[],"applicability":"","appliesWhen":[],"doesNotApplyWhen":[],"limitations":[],"verificationNotes":""}],\n  "documentedCases": [{"id":"CASE-...","title":"","organizationOrEvent":"","date":null,"primarySourceUrl":"https://...","sourceAuthority":"","moduleIds":[],"factsSupported":[],"lessonsLearned":[],"implementationRecommendations":[],"limitations":[]}],\n  "moduleResearch": [{"moduleId":"","sourceIds":[],"caseIds":[],"factualClaimsToTeach":[],"lessonsLearned":[],"implementationRecommendations":[]}],\n  "unresolvedTopics": []\n}\n\nQuality rules: cover every manifest module; use at least four supplied authoritative sources; require at least two distinct primary-source documented cases when supported; never fabricate missing cases; preserve exact canonical URLs from supplied records; distinguish binding, nonbinding, voluntary, and draft authority; include applicability, nonapplicability, limitations, factual lessons learned, and practical implementation recommendations; put every unsupported need in unresolvedTopics.`;

const text = provider === "local" ? await callLocal(prompt) : provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
const research = extractJsonObject(text);
if (!research || typeof research !== "object" || Array.isArray(research)) throw new Error("Authoritative research output must be one JSON object.");
if (research.courseId !== courseId) throw new Error(`Authoritative research course identity mismatch: expected ${courseId}, received ${research.courseId || "missing"}.`);

const findings = [];
const sources = Array.isArray(research.authoritativeSources) ? research.authoritativeSources : [];
const cases = Array.isArray(research.documentedCases) ? research.documentedCases : [];
const modules = Array.isArray(course.modules) ? course.modules : [];
const moduleIds = new Set(modules.map((module) => String(module.id)));
if (sources.length < 4) findings.push(`authoritative-source-count-${sources.length}-minimum-4`);
for (const [index, source] of sources.entries()) {
  const prefix = `source-${index + 1}`;
  if (!source.id || !source.title || !source.issuingAuthority || !source.sourceType) findings.push(`${prefix}-missing-identity`);
  if (!source.canonicalUrl || !primaryDomainAllowed(source.canonicalUrl)) findings.push(`${prefix}-non-primary-or-invalid-url-${source.canonicalUrl || "missing"}`);
  if (!Array.isArray(source.moduleIds) || source.moduleIds.length === 0) findings.push(`${prefix}-missing-module-ids`);
  for (const moduleId of source.moduleIds || []) if (!moduleIds.has(String(moduleId))) findings.push(`${prefix}-unknown-module-${moduleId}`);
  if (["statute", "regulation", "final-rule"].includes(source.sourceType) && !source.binding) findings.push(`${prefix}-binding-authority-not-marked-binding`);
  if (source.status === "draft" && source.binding) findings.push(`${prefix}-draft-marked-binding`);
  if (!Array.isArray(source.specificReferences) || source.specificReferences.length === 0) findings.push(`${prefix}-missing-specific-references`);
  if (!Array.isArray(source.appliesWhen) || source.appliesWhen.length === 0) findings.push(`${prefix}-missing-applies-when`);
  if (!Array.isArray(source.doesNotApplyWhen) || source.doesNotApplyWhen.length === 0) findings.push(`${prefix}-missing-does-not-apply-when`);
  if (!Array.isArray(source.limitations) || source.limitations.length === 0) findings.push(`${prefix}-missing-limitations`);
}
for (const [index, item] of cases.entries()) {
  const prefix = `case-${index + 1}`;
  if (!item.id || !item.title || !item.organizationOrEvent) findings.push(`${prefix}-missing-identity`);
  if (!item.primarySourceUrl || !primaryDomainAllowed(item.primarySourceUrl)) findings.push(`${prefix}-non-primary-or-invalid-url-${item.primarySourceUrl || "missing"}`);
  if (!Array.isArray(item.factsSupported) || item.factsSupported.length === 0) findings.push(`${prefix}-missing-supported-facts`);
  if (!Array.isArray(item.lessonsLearned) || item.lessonsLearned.length === 0) findings.push(`${prefix}-missing-lessons-learned`);
  if (!Array.isArray(item.implementationRecommendations) || item.implementationRecommendations.length === 0) findings.push(`${prefix}-missing-implementation-recommendations`);
}
const moduleResearch = Array.isArray(research.moduleResearch) ? research.moduleResearch : [];
const researchByModule = new Map(moduleResearch.map((item) => [String(item.moduleId), item]));
for (const module of modules) {
  const item = researchByModule.get(String(module.id));
  if (!item) { findings.push(`module-${module.id}-missing-research`); continue; }
  if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) findings.push(`module-${module.id}-missing-source-ids`);
  if (!Array.isArray(item.factualClaimsToTeach) || item.factualClaimsToTeach.length === 0) findings.push(`module-${module.id}-missing-factual-claims`);
  if (!Array.isArray(item.lessonsLearned) || item.lessonsLearned.length === 0) findings.push(`module-${module.id}-missing-lessons-learned`);
  if (!Array.isArray(item.implementationRecommendations) || item.implementationRecommendations.length === 0) findings.push(`module-${module.id}-missing-implementation-recommendations`);
}
const unresolvedTopics = Array.isArray(research.unresolvedTopics) ? research.unresolvedTopics : [];
const evidence = {
  schemaVersion: "1.3",
  generatedAt: new Date().toISOString(),
  courseId,
  manifestHash: stableHash(manifest),
  provider,
  model: provider === "local" ? process.env.LOCAL_RESEARCH_MODEL || process.env.LOCAL_AI_MODEL || "qwen2.5:7b-instruct" : provider === "anthropic" ? process.env.ANTHROPIC_RESEARCH_MODEL || "claude-sonnet-4-5" : process.env.OPENAI_RESEARCH_MODEL || "gpt-5",
  webSearchUsed: provider !== "local",
  directPrimarySourceCacheUsed: provider === "local",
  responseMode: provider === "local" ? "local-ollama-governed-primary-source-context" : `${provider}-web-search-plus-validated-json-text`,
  primarySourcePolicy: allowedPrimaryDomains,
  sourceContextHash: freeContext ? stableHash(freeContext) : null,
  sourceCount: sources.length,
  documentedCaseCount: cases.length,
  unresolvedTopics,
  findings,
  passed: findings.length === 0 && unresolvedTopics.length === 0,
  research
};
const evidencePath = path.join(courseDir, "generated", "research", "authoritative-source-research.json");
writeJsonAtomic(evidencePath, evidence);
writeJsonAtomic(path.join(courseDir, "authoritative-sources.generated.json"), research);
console.log(`[Academy Studio] Authoritative source research ${evidence.passed ? "PASSED" : "FAILED"} for ${courseId} through ${provider}: ${sources.length} sources, ${cases.length} documented cases, ${findings.length} finding(s), ${unresolvedTopics.length} unresolved topic(s).`);
if (!evidence.passed) process.exit(2);
