import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACADEMY_AUTHORING_POLICY_VERSION,
  ACADEMY_AUTHORING_QUALITY_REQUIREMENTS as quality,
  academyAuthoringQualityContract,
} from "./academy-authoring-quality-contract.mjs";
import {
  ProviderAuthoringError,
  providerAuthoringErrorFromHttp,
} from "./authoring-provider-errors.mjs";
import { assertAuthoredPackageReady } from "./validate-authored-package.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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
const provider = (
  arg("--provider") ||
  process.env.ACADEMY_AUTHORING_PROVIDER ||
  "openai"
).toLowerCase();
const force = process.argv.includes("--force");
const requestTimeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS,
  15 * 60 * 1000,
  60 * 1000,
  30 * 60 * 1000,
);

if (!courseId) {
  console.error(
    "Usage: node studio/author-course-ai.mjs --course <course-id> [--provider openai|anthropic] [--force]",
  );
  process.exit(1);
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`[Academy Studio] Course manifest not found for ${courseId}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const proprietaryNotice =
  "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";
const legalName = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceManifestHash() {
  return stableHash({
    authoringPolicyVersion: ACADEMY_AUTHORING_POLICY_VERSION,
    manifest,
  });
}

function authoringPrompt() {
  const course = manifest.course;
  return `You are the senior instructional design and subject matter authoring engine for ${legalName}.

Create an original, commercially credible, production-depth professional course package for the course below. Do not imitate third-party courseware. Do not claim accreditation, certification, legal advice, regulatory approval, compliance, or guaranteed outcomes. Use mature professional language, substantive connected paragraphs, varied scenarios, practical judgment, clear evidence boundaries, realistic executive and operational examples, and source-aware instruction. Treat every externally verifiable fact, framework statement, legal requirement, statistic, incident detail, technical specification, and regulatory assertion as requiring later verification unless the supplied manifest itself establishes it.

Authoring policy version: ${ACADEMY_AUTHORING_POLICY_VERSION}
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
Access model: one-time purchase, named learner, access until completion
Certificate issuer: ${legalName}
Handling notice: ${proprietaryNotice}
Manifest framework tags: ${JSON.stringify(manifest.tags?.frameworks ?? [])}

Return one valid JSON object only. Use this exact top-level structure:
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

Mandatory production-quality requirements:
1. Every listed module must appear exactly once and preserve its manifest ID, title, duration, and format.
2. Each lessonNarrative must contain at least ${quality.lessonNarrativeWords} substantive words specific to that module. Use mature multi-paragraph prose that explains business context, operational context, decision authority, escalation, evidence preservation, implementation implications, limitations, and practical application. Do not pad the narrative with repetition, slogans, generic filler, or duplicated passages.
3. Each module must include at least ${quality.learningObjectives} distinct learning objectives, ${quality.keyConcepts} developed key concepts, one substantive executive example, one substantive operational example, one realistic evidence-rich scenario, and one applied exercise that produces a reviewable learner artifact.
4. Each module must include at least ${quality.knowledgeChecks} original knowledge checks. Each knowledge check must contain at least ${quality.finalAssessmentOptions} credible options, one valid correctIndex, and an explanatory rationale.
5. Each module must include at least ${quality.slideNarratives} complete slide narratives. Every slide must include a title, substantive content, speaker notes, and visual direction.
6. Each module videoScript must include an opening, a closing, and at least ${quality.videoSegments} scene-level segments. Every segment must include professional narration and specific visual direction suitable for captions, transcripts, source cards, audio description, reduced-motion treatment, and rights review.
7. Each module must include at least ${quality.accessibilityNotes} specific accessibility notes addressing caption or transcript equivalence, keyboard or nonpointer alternatives, readable hierarchy, color-independent meaning, and alternate descriptions where visuals carry instructional meaning.
8. The finalAssessment must contain at least ${quality.finalAssessmentQuestions} original questions distributed across all modules and mapped to the assessment blueprint. Every question must include at least ${quality.finalAssessmentOptions} credible options, a valid correctIndex, rationale, moduleId, cognitiveLevel, and one or more sourceIds that map to the sourceRegister.
9. Assessment questions must primarily test application, analysis, prioritization, evidence evaluation, escalation, and defensible judgment rather than trivia or memorization. Do not repeat scenarios, stems, distractor patterns, or answer-position patterns mechanically.
10. Build a sourceRegister with unique IDs that identifies every topic requiring authoritative verification before publication. Each record must include sourceType, claimOrTopic, applicable moduleIds, verificationInstruction, and usageBoundary. Do not invent citations, URLs, standards language, statistics, case facts, quotations, document numbers, dates, or source identifiers.
11. frameworkAlignment is informational mapping only. Include only relevant frameworks, identify applicable moduleIds, require verification, and state conditional applicability. Never state that course completion establishes compliance, certification, attestation, authorization, audit sufficiency, or legal sufficiency.
12. Every externally verifiable claim that is not common knowledge must have a source placeholder or sourceRegister reference suitable for later SME verification. Questions must use sourceIds that exist in the sourceRegister.
13. Include an assessment blueprint with coverage across every module, a cognitive mix totaling 100 percent and dominated by application and analysis, and explicit assessment-integrity controls.
14. Each scenario must provide enough evidence for a reasoned decision, include ambiguity appropriate to the learner level, and explain why the recommended approach is proportionate, ethical, and defensible.
15. Exercises must produce a concrete learner artifact, decision record, risk statement, control selection, communication, plan, analysis, or other reviewable work product appropriate to the module.
16. Include a workbook entry for every module with substantive reflection prompts and a decision worksheet. Include a complete instructor guide with facilitation notes, common misconceptions, and review warnings.
17. Include accurate marketing descriptions, buyer outcomes, and SEO keywords without promising employment, certification, examination success, compliance, risk elimination, or guaranteed results.
18. Keep all generated material marked proprietary and review required. Preserve the exact legal name, proprietary notice, and official Obserra visual-system description in the brand object.
19. Do not use unsupported statistics, invented legal requirements, fabricated incidents, fictional quotations presented as real, invented citations, or unsupported claims of authority.
20. Preserve secure by design, privacy by design, ethical leadership, human oversight, least privilege, evidence preservation, resilience, and defensible decision-making where relevant.
21. Distinguish binding requirements, voluntary guidance, organizational policy, recommended practice, original Obserra instruction, and synthetic scenarios whenever the distinction matters.
22. This package remains draft AI-generated content until governed subject-matter, technical, legal where applicable, psychometric, brand, accessibility, rights, media, security, entitlement, commerce, and owner-review gates are satisfied.`;
}

async function fetchWithAuthoringTimeout(providerName, url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error(
        `${providerName} authoring request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds`,
      );
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
  const text =
    payload.output_text ||
    payload.output
      ?.flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")?.text;
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
        "anthropic-version":
          process.env.ANTHROPIC_VERSION || "2023-06-01",
      },
      body: JSON.stringify({
        model:
          process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5",
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
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(trimmed);
}

async function main() {
  const outputDir = path.join(courseDir, "generated", "authoring");
  const outputPath = path.join(outputDir, "course-package.json");
  if (fs.existsSync(outputPath) && !force) {
    console.log(
      `[Academy Studio] Preserved existing AI-authored package for ${courseId}. Use --force to regenerate.`,
    );
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const prompt = authoringPrompt();
  fs.writeFileSync(
    path.join(outputDir, "authoring-prompt.txt"),
    `${proprietaryNotice}\n\n${prompt}\n`,
  );

  const raw =
    provider === "anthropic"
      ? await callAnthropic(prompt)
      : await callOpenAI(prompt);
  const authored = parseJson(raw);
  assertAuthoredPackageReady({ manifest, authored });

  const envelope = {
    schemaVersion: "1.3",
    courseId,
    provider,
    model:
      provider === "anthropic"
        ? process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5"
        : process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
    authoringPolicyVersion: ACADEMY_AUTHORING_POLICY_VERSION,
    authoringQualityContract: academyAuthoringQualityContract(),
    generatedAt: new Date().toISOString(),
    sourceManifestHash: sourceManifestHash(),
    reviewStatus: "draft-ai-generated",
    legalName,
    proprietaryNotice,
    qualityGate: {
      name: "authored-package-production-depth-readiness",
      passed: true,
      findingCount: 0,
    },
    content: authored,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(
    `[Academy Studio] Generated governed production-depth AI course package for ${courseId} through ${provider} under policy ${ACADEMY_AUTHORING_POLICY_VERSION}.`,
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof ProviderAuthoringError) {
    const safeMessage = String(error.message || error.category)
      .replace(/\s+/g, " ")
      .slice(0, 1600);
    console.error(
      `[Academy Studio] AUTHORING_PROVIDER_FAILURE provider=${error.provider} category=${error.category} retryable=${error.retryable} status=${error.status ?? "unknown"} providerCode=${error.providerCode ?? "unknown"}: ${safeMessage}`,
    );
    process.exitCode = error.exitCode;
  } else {
    const safeMessage = String(
      error instanceof Error ? error.message : error,
    )
      .replace(/\s+/g, " ")
      .slice(0, 3000);
    console.error(
      `[Academy Studio] AUTHORING_PACKAGE_FAILURE course=${courseId}: ${safeMessage}`,
    );
    process.exitCode = 1;
  }
}
