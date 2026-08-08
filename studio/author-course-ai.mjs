import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProviderAuthoringError,
  providerAuthoringErrorFromHttp,
} from "./authoring-provider-errors.mjs";
import { assertAuthoredPackageReady } from "./validate-authored-package.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUTHORING_POLICY_VERSION = "2026.08.07.2";
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const courseId = arg("--course");
const provider = (arg("--provider") || process.env.ACADEMY_AUTHORING_PROVIDER || "openai").toLowerCase();
const force = process.argv.includes("--force");
const requestTimeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS,
  15 * 60 * 1000,
  60 * 1000,
  30 * 60 * 1000,
);

if (!courseId) {
  console.error("Usage: node studio/author-course-ai.mjs --course <course-id> [--provider openai|anthropic] [--force]");
  process.exit(1);
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`[Academy Studio] Course manifest not found for ${courseId}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const proprietaryNotice = "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";
const legalName = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceManifestHash() {
  return stableHash({ authoringPolicyVersion: AUTHORING_POLICY_VERSION, manifest });
}

function authoringPrompt() {
  const course = manifest.course;
  return `You are the senior instructional design and subject matter authoring engine for ${legalName}.

Create an original, commercially credible, high quality professional course package for the course below. Do not imitate third party courseware. Do not claim accreditation, certification, legal advice, regulatory approval, compliance, or guaranteed outcomes. Use mature professional language, substantive paragraphs, varied scenarios, practical judgment, clear evidence boundaries, realistic executive and operational examples, and source aware instruction. Treat every externally verifiable fact, framework statement, legal requirement, statistic, incident detail, technical specification, and regulatory assertion as requiring later verification unless the supplied manifest itself establishes it.

Authoring policy version: ${AUTHORING_POLICY_VERSION}
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
Access model: one time purchase, named learner, access until completion
Certificate issuer: ${legalName}
Handling notice: ${proprietaryNotice}
Manifest framework tags: ${JSON.stringify(manifest.tags?.frameworks ?? [])}

Return one valid JSON object only. Use this exact top level structure:
{
  "courseSummary": {"executiveValue": "", "instructionalStrategy": "", "sourceAndReviewNotes": []},
  "sourceRegister": [{"id": "SRC-001", "sourceType": "authoritative-source-needed", "claimOrTopic": "", "moduleIds": [], "verificationInstruction": "", "usageBoundary": ""}],
  "frameworkAlignment": [{"framework": "", "applicability": "informational-mapping-only", "moduleIds": [], "alignmentNote": "", "verificationRequired": true}],
  "assessmentBlueprint": {"coverageByModule": [{"moduleId": "", "minimumQuestions": 0}], "cognitiveMix": [{"level": "application", "targetPercent": 0}], "integrityNotes": []},
  "modules": [
    {
      "id": "",
      "title": "",
      "duration": "",
      "format": "",
      "learningObjectives": [],
      "openingContext": "",
      "lessonNarrative": "",
      "keyConcepts": [{"term": "", "explanation": ""}],
      "executiveExample": "",
      "operationalExample": "",
      "scenario": {"situation": "", "evidence": [], "decisionPrompt": "", "recommendedApproach": "", "debrief": ""},
      "exercise": {"instructions": "", "deliverable": "", "rubric": []},
      "knowledgeChecks": [{"question": "", "options": [], "correctIndex": 0, "rationale": ""}],
      "slideNarrative": [{"title": "", "content": [], "speakerNotes": "", "visualDirection": ""}],
      "videoScript": {"opening": "", "segments": [{"visual": "", "narration": ""}], "closing": ""},
      "accessibilityNotes": [],
      "sourcePlaceholders": []
    }
  ],
  "finalAssessment": [{"question": "", "options": [], "correctIndex": 0, "rationale": "", "moduleId": "", "cognitiveLevel": "application", "sourceIds": []}],
  "learnerWorkbook": [{"moduleId": "", "reflectionPrompts": [], "decisionWorksheet": []}],
  "instructorGuide": {"facilitationNotes": [], "commonMisconceptions": [], "reviewWarnings": []},
  "marketing": {"shortDescription": "", "longDescription": "", "buyerOutcomes": [], "seoKeywords": []},
  "brand": {"legalName": "${legalName}", "proprietaryNotice": "${proprietaryNotice}", "visualSystem": "Official Obserra black, dark navy, gold, white, and restrained holographic blue"}
}

Quality requirements:
1. Every listed module must appear exactly once and preserve its title, duration, and format.
2. Each lessonNarrative must be substantive, specific to the course, and at least 700 words.
3. Each module must include at least 4 key concepts, 1 executive example, 1 operational example, 1 realistic scenario, 1 applied exercise, 4 knowledge checks, 8 slide narratives, and a complete video script.
4. The final assessment must contain at least 25 original questions distributed across all modules and mapped to the assessment blueprint.
5. Questions must primarily test application, analysis, prioritization, evidence evaluation, escalation, and defensible judgment rather than trivia or memorization.
6. Avoid repeating the same scenario, explanation, distractor pattern, or phrasing between modules.
7. Build a sourceRegister that identifies every topic needing authoritative verification before publication. Do not invent citations, URLs, standards language, statistics, case facts, or source identifiers.
8. frameworkAlignment is informational mapping only. Include only frameworks that are relevant to the manifest or course subject and make applicability conditional. Never state that course completion establishes compliance, certification, attestation, authorization, or legal sufficiency.
9. Every externally verifiable claim that is not common knowledge must have a source placeholder or sourceRegister reference suitable for later SME verification.
10. Include an assessment blueprint with coverage across every module and a cognitive mix dominated by application and analysis.
11. Each scenario must provide enough evidence for a reasoned decision, include ambiguity appropriate to the learner level, and explain why the recommended approach is proportionate.
12. Exercises must produce a concrete learner artifact, decision record, risk statement, control selection, communication, or other reviewable work product where appropriate.
13. Video scripts must be designed for audible professional narration, captions, transcripts, readable on screen text, reduced motion alternatives, and visuals that do not depend on color alone.
14. Accessibility notes must address captions or transcript equivalence, keyboard or nonpointer alternatives for interactions, readable visual hierarchy, and alternate descriptions where visuals carry instructional meaning.
15. Keep all generated material marked proprietary and review required.
16. Do not use unsupported statistics, invented legal requirements, fabricated incidents, fictional quotes presented as real, or invented citations.
17. Preserve secure by design, privacy by design, ethical leadership, human oversight, least privilege, evidence preservation, resilience, and defensible decision making where relevant.
18. Distinguish binding requirements, voluntary guidance, organizational policy, recommended practice, original Obserra instruction, and synthetic scenarios whenever the distinction matters.
19. Marketing language must accurately describe learning outcomes without promising employment, certification, examination success, compliance, risk elimination, or other guaranteed results.
20. The package remains draft AI generated content until governed subject matter, technical, legal where applicable, brand, accessibility, and owner review gates are satisfied.`;
}

async function fetchWithAuthoringTimeout(providerName, url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error(`${providerName} authoring request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds`);
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
  return providerAuthoringErrorFromHttp({
    provider: providerName,
    status: response.status,
    body,
  });
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  const organization = String(process.env.OPENAI_ORGANIZATION || "").trim();
  const project = String(process.env.OPENAI_PROJECT || "").trim();
  const response = await fetchWithAuthoringTimeout(
    "OpenAI",
    process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(organization ? { "OpenAI-Organization": organization } : {}),
        ...(project ? { "OpenAI-Project": project } : {}),
      },
      body: JSON.stringify({
        model: process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
        input: prompt,
        text: { format: { type: "json_object" } },
        reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "high" },
        store: false,
      }),
    },
  );
  if (!response.ok) throw await providerHttpError("openai", response);
  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI response did not contain output text");
  return text;
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  const response = await fetchWithAuthoringTimeout(
    "Anthropic",
    process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5",
        max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 64000),
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    },
  );
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
    console.log(`[Academy Studio] Preserved existing AI authored package for ${courseId}. Use --force to regenerate.`);
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const prompt = authoringPrompt();
  fs.writeFileSync(path.join(outputDir, "authoring-prompt.txt"), `${proprietaryNotice}\n\n${prompt}\n`);

  const raw = provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
  const authored = parseJson(raw);
  assertAuthoredPackageReady({ manifest, authored });

  const envelope = {
    schemaVersion: "1.2",
    courseId,
    provider,
    model: provider === "anthropic" ? process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5" : process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    sourceManifestHash: sourceManifestHash(),
    reviewStatus: "draft-ai-generated",
    legalName,
    proprietaryNotice,
    qualityGate: {
      name: "authored-package-structural-readiness",
      passed: true,
      findingCount: 0,
    },
    content: authored,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(`[Academy Studio] Generated governed AI course package for ${courseId} through ${provider} under policy ${AUTHORING_POLICY_VERSION}`);
}

try {
  await main();
} catch (error) {
  if (error instanceof ProviderAuthoringError) {
    const safeMessage = String(error.message || error.category).replace(/\s+/g, " ").slice(0, 1600);
    console.error(
      `[Academy Studio] AUTHORING_PROVIDER_FAILURE provider=${error.provider} category=${error.category} retryable=${error.retryable} status=${error.status ?? "unknown"} providerCode=${error.providerCode ?? "unknown"}: ${safeMessage}`,
    );
    process.exitCode = error.exitCode;
  } else {
    const safeMessage = String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").slice(0, 3000);
    console.error(`[Academy Studio] AUTHORING_PACKAGE_FAILURE course=${courseId}: ${safeMessage}`);
    process.exitCode = 1;
  }
}
