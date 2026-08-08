import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProviderAuthoringError,
  providerAuthoringErrorFromHttp,
} from "./authoring-provider-errors.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUTHORING_POLICY_VERSION = "2026.08.08.2";
const PRODUCTION_CONTRACT_VERSION = "academy-hollywood-production-contract-1.0";
const proprietaryNotice = "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";
const legalName = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

const courseId = arg("--course");
const provider = (arg("--provider") || process.env.ACADEMY_AUTHORING_PROVIDER || "local").toLowerCase();
const force = process.argv.includes("--force");
const requestTimeoutMs = boundedNumber(process.env.ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS, 20 * 60 * 1000, 60 * 1000, 30 * 60 * 1000);
const maximumSourceContextChars = boundedNumber(process.env.ACADEMY_SOURCE_CONTEXT_MAX_CHARS, 120_000, 20_000, 250_000);
const maximumSourceFileChars = boundedNumber(process.env.ACADEMY_SOURCE_FILE_MAX_CHARS, 16_000, 2_000, 40_000);

if (!courseId) {
  console.error("Usage: node studio/author-course-hollywood.mjs --course <course-id> [--provider local|openai|anthropic] [--force]");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) throw new Error("Invalid course identifier.");
if (!["local", "openai", "anthropic"].includes(provider)) throw new Error(`Unsupported Academy authoring provider: ${provider}`);

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`[Academy Studio] Course manifest not found for ${courseId}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceManifestHash() {
  return stableHash({ authoringPolicyVersion: AUTHORING_POLICY_VERSION, productionContractVersion: PRODUCTION_CONTRACT_VERSION, manifest });
}

function collectSourceContext() {
  const preferredPatterns = [
    /authoritative[-_ ]?sources/i, /source[-_ ]?register/i, /traceability/i, /crosswalk/i,
    /rights[-_ ]?ledger/i, /trademark/i, /independence/i, /production[-_ ]?status/i,
    /course[-_ ]?qa/i, /assessment[-_ ]?delivery[-_ ]?policy/i, /ai[-_ ]?tutor[-_ ]?profile/i,
    /video[-_ ]?production[-_ ]?bible/i,
  ];
  const acceptedExtensions = new Set([".json", ".md", ".txt"]);
  const files = fs.readdirSync(courseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => acceptedExtensions.has(path.extname(name).toLowerCase()))
    .filter((name) => preferredPatterns.some((pattern) => pattern.test(name)))
    .sort();
  const records = [];
  let remaining = maximumSourceContextChars;
  for (const name of files) {
    if (remaining <= 0) break;
    const filePath = path.join(courseDir, name);
    const raw = fs.readFileSync(filePath, "utf8");
    const excerpt = raw.slice(0, Math.min(maximumSourceFileChars, remaining));
    remaining -= excerpt.length;
    records.push({ file: name, sha256: crypto.createHash("sha256").update(raw).digest("hex"), truncated: excerpt.length < raw.length, content: excerpt });
  }
  return records;
}

const sourceContext = collectSourceContext();

function authoringPrompt() {
  const course = manifest.course;
  return `You are the senior instructional design, research, assessment, and cinematic learning-production engine for ${legalName}.

Create an original, commercially credible, premium professional course package for the course below. The target is premium documentary educational production planning with disciplined visual direction, scene-level scripts, professional narration, source cards, sound and music direction, captions, transcripts, audio-description planning, reduced-motion alternatives, and rights traceability. This request is for a complete governed learner package and production blueprint. It is not permission to claim that final mastered media exists before actual rendering, quality control, rights clearance, accessibility verification, and owner acceptance.

Do not imitate third-party courseware. Do not claim accreditation, certification, legal advice, regulatory approval, compliance, authorization to operate, or guaranteed outcomes. Every externally verifiable fact, framework statement, legal requirement, statistic, incident detail, technical specification, and regulatory assertion must map to a supplied source record. Never invent a source title, publisher, URL, standard clause, quotation, date, statistic, case fact, or source identifier. When an exact authoritative source is not supplied, create a clearly labeled verification-required source record without a fabricated locator.

Authoring policy version: ${AUTHORING_POLICY_VERSION}
Production contract version: ${PRODUCTION_CONTRACT_VERSION}
Course title: ${course.title}
Department: ${course.department}
Track: ${course.track}
Level: ${course.level}
Audience: ${course.audience}
Course length: ${course.duration}
Description: ${course.description}
Learning outcomes: ${JSON.stringify(course.outcomes)}
Modules: ${JSON.stringify(course.modules)}
Passing score: ${manifest.completion.passingScore}
Certificate issuer: ${legalName}
Handling notice: ${proprietaryNotice}
Manifest framework tags: ${JSON.stringify(manifest.tags?.frameworks ?? [])}
Supplied governed source context: ${JSON.stringify(sourceContext)}

Return one valid JSON object only with these top-level keys: courseSummary, sourceRegister, applicabilityMatrix, frameworkAlignment, mediaProductionPlan, assessmentBlueprint, modules, finalAssessment, learnerWorkbook, instructorGuide, certificatePackage, rightsAndLicensingPlan, accessibilityPlan, productionGateEvidence, marketing, brand.

Each manifest module must appear exactly once with its exact id, title, duration, and format. Each module must contain at least 1,200 substantive words in lessonNarrative, at least 6 learning objectives, 6 developed key concepts, executive and operational examples, an evidence-rich scenario with decisionPrompt/recommendedApproach/debrief, an applied exercise that creates a reviewable artifact, at least 4 knowledge checks with answer rationales, at least 10 slide narratives with speaker notes and visual direction, at least 3 reference applications, at least 8 cinematic scenes, at least 8 planned shots, at least 2 source cards, at least 8 video-script scenes, caption/transcript/audio-description/reduced-motion plans, and at least 4 accessibility notes. The final assessment must contain at least 30 application/analysis questions across all modules unless the manifest requires more. PMP exam-prep content must satisfy any larger manifest assessment count. Include complete source applicability and limitations, practical implementation recommendations, realistic lessons learned, instructor guidance, learner workbook content, certificate completion-only controls, rights requirements, accessibility requirements, and publication blockers. Distinguish binding requirements, nonbinding guidance, drafts, voluntary standards, organizational policy, original Obserra instruction, documented public cases, and synthetic scenarios. Return JSON only.`;
}

function providerHeaders(providerName, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (providerName === "openai") {
    headers.Authorization = `Bearer ${apiKey}`;
    const organization = String(process.env.OPENAI_ORGANIZATION ?? "").trim();
    const project = String(process.env.OPENAI_PROJECT ?? "").trim();
    if (organization) headers["OpenAI-Organization"] = organization;
    if (project) headers["OpenAI-Project"] = project;
  }
  return headers;
}

async function fetchWithAuthoringTimeout(providerName, url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new ProviderAuthoringError({ provider: providerName.toLowerCase(), category: "provider_transient_failure", retryable: true, exitCode: 1, providerCode: "provider_request_timeout", message: `${providerName} authoring request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds` });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedErrorText(response) {
  const text = await response.text();
  return text.length > 4000 ? `${text.slice(0, 4000)}...[truncated]` : text;
}

async function providerHttpError(providerName, response) {
  const body = await boundedErrorText(response);
  return providerAuthoringErrorFromHttp({ provider: providerName, status: response.status, body });
}

async function callLocal(prompt) {
  const baseUrl = String(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = String(process.env.LOCAL_AI_MODEL || process.env.ACADEMY_LOCAL_AUTHORING_MODEL || "qwen2.5:14b-instruct").trim();
  const response = await fetchWithAuthoringTimeout("Local", `${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0.15, num_ctx: boundedNumber(process.env.LOCAL_AI_NUM_CTX, 65536, 8192, 131072) },
      messages: [
        { role: "system", content: "Return only valid JSON. Preserve source boundaries. Never fabricate authorities, URLs, quotations, dates, statistics, legal requirements, or case facts." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw await providerHttpError("local", response);
  const payload = await response.json();
  const text = payload?.message?.content;
  if (!text) throw new Error("Local Ollama response did not contain message content");
  return text;
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  const response = await fetchWithAuthoringTimeout("OpenAI", process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: providerHeaders("openai", apiKey),
    body: JSON.stringify({ model: process.env.OPENAI_AUTHORING_MODEL || "gpt-5", input: prompt, max_output_tokens: boundedNumber(process.env.OPENAI_AUTHORING_MAX_OUTPUT_TOKENS, 64_000, 8_000, 100_000), text: { format: { type: "json_object" } }, reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "high" }, store: false }),
  });
  if (!response.ok) throw await providerHttpError("openai", response);
  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI response did not contain output text");
  return text;
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  const response = await fetchWithAuthoringTimeout("Anthropic", process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5", max_tokens: boundedNumber(process.env.ANTHROPIC_MAX_TOKENS, 64_000, 8_000, 100_000), temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) throw await providerHttpError("anthropic", response);
  const payload = await response.json();
  const text = payload.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Anthropic response did not contain text");
  return text;
}

function parseJson(text) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(trimmed);
}

async function main() {
  const outputDir = path.join(courseDir, "generated", "authoring");
  const outputPath = path.join(outputDir, "course-package.json");
  if (fs.existsSync(outputPath) && !force) {
    console.log(`[Academy Studio] Preserved existing governed course package for ${courseId}. Use --force to regenerate.`);
    return;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const prompt = authoringPrompt();
  fs.writeFileSync(path.join(outputDir, "authoring-prompt.txt"), `${proprietaryNotice}\n\n${prompt}\n`);
  const raw = provider === "local" ? await callLocal(prompt) : provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
  const authored = parseJson(raw);
  const model = provider === "local"
    ? String(process.env.LOCAL_AI_MODEL || process.env.ACADEMY_LOCAL_AUTHORING_MODEL || "qwen2.5:14b-instruct").trim()
    : provider === "anthropic"
      ? process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5"
      : process.env.OPENAI_AUTHORING_MODEL || "gpt-5";
  const envelope = {
    schemaVersion: "2.0",
    courseId,
    provider,
    model,
    estimatedModelCostUsd: provider === "local" ? 0 : null,
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    productionContractVersion: PRODUCTION_CONTRACT_VERSION,
    productionStandard: "premium-documentary-cinematic",
    generatedAt: new Date().toISOString(),
    sourceManifestHash: sourceManifestHash(),
    sourceContextHash: stableHash(sourceContext),
    sourceContextFiles: sourceContext.map((record) => ({ file: record.file, sha256: record.sha256, truncated: record.truncated })),
    reviewStatus: "draft-ai-generated-compliance-staging",
    publicationAuthorized: false,
    legalName,
    proprietaryNotice,
    content: authored,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(`[Academy Studio] Generated governed cinematic course package for ${courseId} through ${provider} under policy ${AUTHORING_POLICY_VERSION}. Publication remains unauthorized.`);
}

try {
  await main();
} catch (error) {
  if (error instanceof ProviderAuthoringError) {
    const safeMessage = String(error.message || error.category).replace(/\s+/g, " ").slice(0, 1600);
    console.error(`[Academy Studio] AUTHORING_PROVIDER_FAILURE provider=${error.provider} category=${error.category} retryable=${error.retryable} status=${error.status ?? "unknown"} providerCode=${error.providerCode ?? "unknown"}: ${safeMessage}`);
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
