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
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) throw new Error("Usage: node studio/research-course-authoritative-sources-local.mjs --course <course-id>");

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const registryPath = path.join(root, "sources", "authoritative-sources.json");
if (!fs.existsSync(manifestPath)) throw new Error(`Course manifest not found for ${courseId}.`);
if (!fs.existsSync(registryPath)) throw new Error("Governed authoritative source registry is missing.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const course = manifest.course || {};

const allowedPrimaryDomains = [
  ".gov", ".mil", ".int", "nist.gov", "csrc.nist.gov", "sec.gov", "ecfr.gov", "federalregister.gov",
  "fda.gov", "hhs.gov", "cms.gov", "ftc.gov", "dfs.ny.gov", "dol.gov", "osha.gov", "acquisition.gov",
  "defense.gov", "dodcio.defense.gov", "state.gov", "justice.gov", "congress.gov", "uscode.house.gov",
  "iso.org", "iec.ch", "pcisecuritystandards.org", "cisecurity.org", "pmi.org", "owasp.org", "cloudsecurityalliance.org"
];

function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
function hostname(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } }
function primaryDomainAllowed(url) {
  const host = hostname(url);
  return Boolean(host && allowedPrimaryDomains.some((domain) => domain.startsWith(".") ? host.endsWith(domain) : host === domain || host.endsWith(`.${domain}`)));
}
function tokens(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length >= 4));
}
function overlapScore(source, queryTokens) {
  const sourceTokens = tokens([source.title, source.publication, ...(source.topics || [])].join(" "));
  let score = 0;
  for (const word of queryTokens) if (sourceTokens.has(word)) score += 1;
  if (source.binding) score += 0.25;
  if (source.status && source.status !== "draft") score += 0.1;
  return score;
}
function stripHtml(raw) {
  return String(raw || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
async function fetchPrimarySource(source) {
  if (!source?.canonicalUrl || !primaryDomainAllowed(source.canonicalUrl)) return { source, verified: false, error: "invalid-or-non-primary-url" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.ACADEMY_DIRECT_SOURCE_TIMEOUT_MS || 25000));
  try {
    const response = await fetch(source.canonicalUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Obserra-Academy-Source-Verification/1.0 (+primary-source-validation)",
        Accept: "text/html,application/xhtml+xml,application/json,text/plain,application/pdf;q=0.8,*/*;q=0.5",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) return { source, verified: false, status: response.status, finalUrl: response.url, contentType, error: `http-${response.status}` };
    let excerpt = "";
    let sha256 = null;
    if (!contentType.toLowerCase().includes("application/pdf")) {
      const raw = await response.text();
      sha256 = crypto.createHash("sha256").update(raw).digest("hex");
      excerpt = stripHtml(raw).slice(0, Number(process.env.ACADEMY_DIRECT_SOURCE_EXCERPT_CHARS || 14000));
    }
    return {
      source,
      verified: true,
      status: response.status,
      finalUrl: response.url,
      contentType,
      observedAt: new Date().toISOString(),
      sha256,
      excerpt,
    };
  } catch (error) {
    return { source, verified: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Local research model returned no JSON object.");
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function callLocal(prompt) {
  const baseUrl = String(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = String(process.env.LOCAL_RESEARCH_MODEL || process.env.LOCAL_AI_MODEL || "qwen2.5:14b-instruct").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.LOCAL_RESEARCH_TIMEOUT_MS || 900000));
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.05, num_ctx: Number(process.env.LOCAL_AI_NUM_CTX || 65536) },
        messages: [
          { role: "system", content: "Return only valid JSON. Use only supplied verified primary-source metadata and excerpts. Never use model memory to invent current law, clauses, dates, URLs, cases, statistics, quotations, or authority." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Local research model failed with ${response.status}: ${raw.slice(0, 3000)}`);
    const payload = JSON.parse(raw);
    const content = payload?.message?.content;
    if (!content) throw new Error("Local research model returned no message content.");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

const queryTokens = tokens([
  course.title, course.department, course.track, course.description,
  ...(course.outcomes || []), ...(manifest.tags?.frameworks || []),
  ...(course.modules || []).flatMap((module) => [module.title, module.format]),
].join(" "));
const candidates = (registry.sources || [])
  .filter((source) => source.canonicalUrl && primaryDomainAllowed(source.canonicalUrl))
  .map((source) => ({ source, score: overlapScore(source, queryTokens) }))
  .sort((a, b) => b.score - a.score || String(a.source.id).localeCompare(String(b.source.id)))
  .slice(0, Math.max(8, Number(process.env.ACADEMY_DIRECT_SOURCE_CANDIDATES || 10)));

const verificationResults = [];
for (const candidate of candidates) verificationResults.push(await fetchPrimarySource(candidate.source));
const verified = verificationResults.filter((item) => item.verified).slice(0, Math.max(4, Number(process.env.ACADEMY_DIRECT_SOURCE_TARGET || 6)));
if (verified.length < 4) {
  const evidence = {
    schemaVersion: "2.0",
    generatedAt: new Date().toISOString(),
    courseId,
    manifestHash: stableHash(manifest),
    provider: "local",
    model: String(process.env.LOCAL_RESEARCH_MODEL || process.env.LOCAL_AI_MODEL || "qwen2.5:14b-instruct").trim(),
    estimatedModelCostUsd: 0,
    directPrimaryFetchUsed: true,
    webSearchUsed: false,
    sourceCount: verified.length,
    documentedCaseCount: 0,
    unresolvedTopics: [`Only ${verified.length} directly verified governed primary sources were reachable; minimum 4 required.`],
    findings: ["insufficient-directly-verified-primary-sources"],
    passed: false,
    verificationResults: verificationResults.map(({ excerpt, ...item }) => item),
    research: null,
  };
  writeJsonAtomic(path.join(courseDir, "generated", "research", "authoritative-source-research.json"), evidence);
  console.error(`[Academy Studio] Zero-cost local primary-source research FAILED for ${courseId}: only ${verified.length} directly verified sources.`);
  process.exit(2);
}

const sourceContext = verified.map((item) => ({
  id: item.source.id,
  title: item.source.title,
  issuingAuthority: item.source.issuer,
  publication: item.source.publication || "",
  sourceType: item.source.authorityType,
  publicationDate: item.source.published || null,
  status: item.source.status,
  binding: Boolean(item.source.binding),
  canonicalUrl: item.source.canonicalUrl,
  topics: item.source.topics || [],
  observedAt: item.observedAt,
  finalUrl: item.finalUrl,
  contentType: item.contentType,
  contentSha256: item.sha256,
  excerpt: item.excerpt,
}));

const prompt = `Create a conservative authoritative research package for this Obserra Academy course using ONLY the directly retrieved primary-source records below. Do not add sources or URLs. If the source excerpts do not support a detailed claim, keep the claim general and explicitly bounded. Do not create factual real-world cases unless a supplied source excerpt itself documents one; synthetic instructional scenarios belong in authoring, not documentedCases.

Course ID: ${courseId}
Course: ${JSON.stringify(course)}
Framework tags: ${JSON.stringify(manifest.tags?.frameworks || [])}
Verified primary-source records: ${JSON.stringify(sourceContext)}

Return exactly one JSON object:
{"courseId":"${courseId}","researchDate":"YYYY-MM-DD","authoritativeSources":[{"id":"","title":"","issuingAuthority":"","sourceType":"statute|regulation|final-rule|contract-clause|official-guidance|official-advisory|government-publication|consensus-standard|professional-standard","publication":"","publicationDate":null,"status":"final|current-regulation|current-statute|current-clause|current-guidance|draft","binding":false,"canonicalUrl":"https://...","specificReferences":[],"moduleIds":[],"claimTopics":[],"applicability":"","appliesWhen":[],"doesNotApplyWhen":[],"limitations":[],"verificationNotes":""}],"documentedCases":[],"moduleResearch":[{"moduleId":"","sourceIds":[],"caseIds":[],"factualClaimsToTeach":[],"lessonsLearned":[],"implementationRecommendations":[]}],"unresolvedTopics":[]}

Rules: use every manifest module exactly once in moduleResearch. Use at least four of the supplied sources. Preserve source ids, exact titles, authorities, publication identifiers, dates, binding status, status, and canonical URLs from the supplied records. specificReferences must use only supplied publication identifiers, titles, or section/control identifiers visibly present in excerpts; do not invent section numbers. applicability must be conservative. appliesWhen, doesNotApplyWhen, and limitations must be populated. factualClaimsToTeach must be directly supportable by supplied records. lessons learned and implementation recommendations must be practical but framed as instruction derived from the source, not as quoted requirements unless the source clearly establishes them. Leave documentedCases empty unless the supplied excerpt directly documents a case. unresolvedTopics must contain only material course topics that cannot be responsibly supported by the supplied records.`;

const text = await callLocal(prompt);
const research = extractJsonObject(text);
if (!research || typeof research !== "object" || Array.isArray(research)) throw new Error("Local authoritative research output must be one JSON object.");
if (research.courseId !== courseId) throw new Error(`Local authoritative research identity mismatch: expected ${courseId}, received ${research.courseId || "missing"}.`);

const suppliedById = new Map(sourceContext.map((source) => [String(source.id), source]));
const modules = Array.isArray(course.modules) ? course.modules : [];
const moduleIds = new Set(modules.map((module) => String(module.id)));
const findings = [];
const sources = Array.isArray(research.authoritativeSources) ? research.authoritativeSources : [];
const cases = Array.isArray(research.documentedCases) ? research.documentedCases : [];
if (sources.length < 4) findings.push(`authoritative-source-count-${sources.length}-minimum-4`);
for (const [index, source] of sources.entries()) {
  const prefix = `source-${index + 1}`;
  const supplied = suppliedById.get(String(source.id));
  if (!supplied) { findings.push(`${prefix}-not-in-directly-verified-source-set`); continue; }
  if (source.canonicalUrl !== supplied.canonicalUrl) findings.push(`${prefix}-canonical-url-changed`);
  if (source.title !== supplied.title) findings.push(`${prefix}-title-changed`);
  if (Boolean(source.binding) !== Boolean(supplied.binding)) findings.push(`${prefix}-binding-status-changed`);
  if (!Array.isArray(source.moduleIds) || source.moduleIds.length === 0) findings.push(`${prefix}-missing-module-ids`);
  for (const moduleId of source.moduleIds || []) if (!moduleIds.has(String(moduleId))) findings.push(`${prefix}-unknown-module-${moduleId}`);
  if (!Array.isArray(source.specificReferences) || source.specificReferences.length === 0) findings.push(`${prefix}-missing-specific-references`);
  if (!Array.isArray(source.appliesWhen) || source.appliesWhen.length === 0) findings.push(`${prefix}-missing-applies-when`);
  if (!Array.isArray(source.doesNotApplyWhen) || source.doesNotApplyWhen.length === 0) findings.push(`${prefix}-missing-does-not-apply-when`);
  if (!Array.isArray(source.limitations) || source.limitations.length === 0) findings.push(`${prefix}-missing-limitations`);
}
for (const [index, item] of cases.entries()) {
  const prefix = `case-${index + 1}`;
  if (!item.primarySourceUrl || !sourceContext.some((source) => source.canonicalUrl === item.primarySourceUrl || source.finalUrl === item.primarySourceUrl)) findings.push(`${prefix}-case-url-not-in-direct-source-set`);
}
const moduleResearch = Array.isArray(research.moduleResearch) ? research.moduleResearch : [];
const researchByModule = new Map(moduleResearch.map((item) => [String(item.moduleId), item]));
for (const module of modules) {
  const item = researchByModule.get(String(module.id));
  if (!item) { findings.push(`module-${module.id}-missing-research`); continue; }
  if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) findings.push(`module-${module.id}-missing-source-ids`);
  for (const sourceId of item.sourceIds || []) if (!suppliedById.has(String(sourceId))) findings.push(`module-${module.id}-unknown-source-${sourceId}`);
  if (!Array.isArray(item.factualClaimsToTeach) || item.factualClaimsToTeach.length === 0) findings.push(`module-${module.id}-missing-factual-claims`);
  if (!Array.isArray(item.lessonsLearned) || item.lessonsLearned.length === 0) findings.push(`module-${module.id}-missing-lessons-learned`);
  if (!Array.isArray(item.implementationRecommendations) || item.implementationRecommendations.length === 0) findings.push(`module-${module.id}-missing-implementation-recommendations`);
}
const unresolvedTopics = Array.isArray(research.unresolvedTopics) ? research.unresolvedTopics : [];
const evidence = {
  schemaVersion: "2.0",
  generatedAt: new Date().toISOString(),
  courseId,
  manifestHash: stableHash(manifest),
  provider: "local",
  model: String(process.env.LOCAL_RESEARCH_MODEL || process.env.LOCAL_AI_MODEL || "qwen2.5:14b-instruct").trim(),
  estimatedModelCostUsd: 0,
  webSearchUsed: false,
  directPrimaryFetchUsed: true,
  responseMode: "direct-primary-fetch-plus-local-validated-json",
  primarySourcePolicy: allowedPrimaryDomains,
  sourceCount: sources.length,
  documentedCaseCount: cases.length,
  unresolvedTopics,
  findings,
  passed: findings.length === 0 && unresolvedTopics.length === 0,
  sourceVerification: verificationResults.map(({ excerpt, ...item }) => item),
  research,
};
const evidencePath = path.join(courseDir, "generated", "research", "authoritative-source-research.json");
writeJsonAtomic(evidencePath, evidence);
writeJsonAtomic(path.join(courseDir, "authoritative-sources.generated.json"), research);
console.log(`[Academy Studio] Zero-cost direct-primary-source research ${evidence.passed ? "PASSED" : "FAILED"} for ${courseId}: ${sources.length} sources, ${cases.length} documented cases, ${findings.length} finding(s), ${unresolvedTopics.length} unresolved topic(s).`);
if (!evidence.passed) process.exit(2);
