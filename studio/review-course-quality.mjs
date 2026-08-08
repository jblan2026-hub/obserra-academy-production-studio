import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course");
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) throw new Error("Usage: node studio/review-course-quality.mjs --course <course-id>");
const provider = String(process.env.ACADEMY_REVIEW_PROVIDER || "local").trim().toLowerCase();
if (!["local", "openai", "anthropic"].includes(provider)) throw new Error(`Unsupported Academy review provider: ${provider}`);

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
const researchPath = path.join(courseDir, "generated", "research", "authoritative-source-research.json");
for (const filePath of [manifestPath, packagePath, researchPath]) if (!fs.existsSync(filePath)) throw new Error(`Required review input missing: ${filePath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const authored = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const research = JSON.parse(fs.readFileSync(researchPath, "utf8"));

function openAiOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) chunks.push(content.text);
  }
  return chunks.join("\n").trim();
}

function anthropicOutputText(payload) {
  return (payload.content || []).filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n").trim();
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Independent course review returned no output text.");
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(unfenced); } catch {}
  const start = unfenced.indexOf("{");
  if (start < 0) throw new Error("Independent course review returned no JSON object.");
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
  throw new Error("Independent course review returned an unterminated JSON object.");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

async function callLocal(prompt) {
  const baseUrl = String(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = String(process.env.LOCAL_REVIEW_MODEL || process.env.LOCAL_AI_MODEL || "qwen2.5:14b-instruct").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.LOCAL_REVIEW_TIMEOUT_MS || 900000));
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
          { role: "system", content: "You are an independent quality auditor. Return only valid JSON. Fail rather than invent or excuse unsupported factual claims." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Local independent course review failed with ${response.status}: ${raw.slice(0, 3000)}`);
    const payload = JSON.parse(raw);
    const text = payload?.message?.content;
    if (!text) throw new Error("Local independent course review returned no message content.");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAI(prompt) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI independent course quality review.");
  const response = await fetch(process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...(process.env.OPENAI_ORGANIZATION ? { "OpenAI-Organization": String(process.env.OPENAI_ORGANIZATION).trim() } : {}), ...(process.env.OPENAI_PROJECT ? { "OpenAI-Project": String(process.env.OPENAI_PROJECT).trim() } : {}) },
    body: JSON.stringify({ model: process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_AUTHORING_MODEL || "gpt-5", tools: [{ type: "web_search" }], input: prompt, max_output_tokens: Number(process.env.OPENAI_REVIEW_MAX_OUTPUT_TOKENS || 16000), reasoning: { effort: process.env.OPENAI_REVIEW_REASONING_EFFORT || "high" }, store: false })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI independent course review failed with ${response.status}: ${raw.slice(0, 3000)}`);
  const payload = JSON.parse(raw);
  if (payload.status === "incomplete") throw new Error(`OpenAI independent course review response incomplete: ${JSON.stringify(payload.incomplete_details || {})}`);
  return openAiOutputText(payload);
}

async function callAnthropic(prompt) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for Anthropic independent course quality review.");
  const model = process.env.ANTHROPIC_REVIEW_MODEL || process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5";
  const maxTokens = Number(process.env.ANTHROPIC_REVIEW_MAX_TOKENS || 16000);
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }];
  const messages = [{ role: "user", content: prompt }];
  let lastText = "";
  for (let turn = 0; turn < 4; turn += 1) {
    const response = await fetch(process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.1, tools, messages })
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Anthropic independent course review failed with ${response.status}: ${raw.slice(0, 3000)}`);
    const payload = JSON.parse(raw);
    const text = anthropicOutputText(payload);
    if (text) lastText = text;
    if (payload.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: payload.content || [] }); continue; }
    return text || lastText;
  }
  if (!lastText) throw new Error("Anthropic independent course review did not produce final text after web-search continuation.");
  return lastText;
}

const verificationInstruction = provider === "local"
  ? "Use only the supplied manifest, authoritative research evidence, direct-source verification metadata, and authored package. Treat any claim not supported there as a finding. Do not infer current law or case facts from model memory."
  : "Use web search to validate cited primary authorities and documented cases where necessary.";

const prompt = `Act as an independent senior instructional quality reviewer, subject matter reviewer, and factual-reference reviewer for an Obserra Academy course. Review the entire supplied package. ${verificationInstruction} Do not reward verbosity by itself. Do not infer quality from file presence. Identify unsupported, inaccurate, outdated, misleading, generic, repetitive, shallow, or non-implementable content.

Course manifest:\n${JSON.stringify(manifest)}

Authoritative research evidence:\n${JSON.stringify(research)}

Authored course package:\n${JSON.stringify(authored)}

Return exactly one valid JSON object and nothing else:
{"courseId":"${courseId}","scores":{"factualGrounding":0,"sourceApplicability":0,"instructionalDepth":0,"realWorldExamples":0,"lessonsLearned":0,"implementationRecommendations":0,"assessmentQuality":0,"learnerMaterialsCoherence":0,"instructorUsability":0,"videoScriptSubstance":0},"moduleReviews":[{"moduleId":"","passed":false,"factualIssues":[],"depthIssues":[],"exampleIssues":[],"lessonsLearnedIssues":[],"implementationIssues":[],"assessmentIssues":[],"videoContentIssues":[],"strengths":[]}],"sourceFindings":[],"criticalFindings":[],"requiredCorrections":[],"passed":false}

Scoring rules: Scores are integers 0-100. factualGrounding requires externally verifiable claims to be tied to current verified primary sources and correctly characterized. sourceApplicability requires accurate applicability boundaries. instructionalDepth requires substantive explanation and decision logic. realWorldExamples must be source-supported cases or clearly labeled synthetic scenarios. lessonsLearned must be defensible. implementationRecommendations must be actionable and role-aware. assessmentQuality must test application and analysis. learnerMaterialsCoherence must align workbook, exercises, concepts, objectives, and assessments. instructorUsability must provide real facilitation value. videoScriptSubstance must actually teach. Review every manifest module. Any materially false legal/regulatory claim, fabricated citation/case, unresolved source presented as fact, or misleading compliance/certification claim is critical. Pass only when every score is at least 90, every module passes, criticalFindings is empty, and requiredCorrections is empty. Do not lower the bar to make the course pass.`;

const text = provider === "local" ? await callLocal(prompt) : provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
const review = extractJsonObject(text);
if (!review || typeof review !== "object" || Array.isArray(review)) throw new Error("Independent course review output must be one JSON object.");
if (review.courseId !== courseId) throw new Error(`Independent course review identity mismatch: expected ${courseId}, received ${review.courseId || "missing"}.`);

const expectedModules = new Set((manifest.course?.modules || []).map((module) => String(module.id)));
const reviewedModules = new Set((review.moduleReviews || []).map((module) => String(module.moduleId)));
const findings = [];
for (const moduleId of expectedModules) if (!reviewedModules.has(moduleId)) findings.push(`missing-module-review-${moduleId}`);
for (const [name, value] of Object.entries(review.scores || {})) if (!Number.isInteger(value) || value < 90 || value > 100) findings.push(`score-${name}-${value}-minimum-90`);
if (Object.keys(review.scores || {}).length !== 10) findings.push("expected-10-quality-scores");
if ((review.moduleReviews || []).some((module) => module.passed !== true)) findings.push("one-or-more-module-reviews-failed");
if ((review.criticalFindings || []).length > 0) findings.push("critical-findings-present");
if ((review.requiredCorrections || []).length > 0) findings.push("required-corrections-present");
if (review.passed !== true) findings.push("reviewer-did-not-pass-course");

const model = provider === "local"
  ? String(process.env.LOCAL_REVIEW_MODEL || process.env.LOCAL_AI_MODEL || "qwen2.5:14b-instruct").trim()
  : provider === "anthropic"
    ? process.env.ANTHROPIC_REVIEW_MODEL || process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5"
    : process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_AUTHORING_MODEL || "gpt-5";
const evidence = {
  schemaVersion: "1.2",
  generatedAt: new Date().toISOString(),
  courseId,
  provider,
  model,
  estimatedModelCostUsd: provider === "local" ? 0 : null,
  webSearchUsed: provider !== "local",
  localEvidenceOnlyReview: provider === "local",
  minimumScore: 90,
  findings,
  passed: findings.length === 0,
  review
};
writeJsonAtomic(path.join(courseDir, "generated", "quality", "independent-course-quality-review.json"), evidence);
console.log(`[Academy Studio] Independent quality review ${evidence.passed ? "PASSED" : "FAILED"} for ${courseId} through ${provider}.`);
if (!evidence.passed) process.exit(2);
