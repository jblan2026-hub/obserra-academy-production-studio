import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProviderAuthoringError,
  providerAuthoringErrorFromHttp,
} from "./authoring-provider-errors.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUTHORING_POLICY_VERSION = "2026.08.08.1";
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
const provider = (arg("--provider") || process.env.ACADEMY_AUTHORING_PROVIDER || "openai").toLowerCase();
const force = process.argv.includes("--force");
const requestTimeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS,
  20 * 60 * 1000,
  60 * 1000,
  30 * 60 * 1000,
);
const maximumSourceContextChars = boundedNumber(
  process.env.ACADEMY_SOURCE_CONTEXT_MAX_CHARS,
  120_000,
  20_000,
  250_000,
);
const maximumSourceFileChars = boundedNumber(
  process.env.ACADEMY_SOURCE_FILE_MAX_CHARS,
  16_000,
  2_000,
  40_000,
);

if (!courseId) {
  console.error("Usage: node studio/author-course-hollywood.mjs --course <course-id> [--provider openai|anthropic] [--force]");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error("Invalid course identifier.");
}

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
  return stableHash({
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    productionContractVersion: PRODUCTION_CONTRACT_VERSION,
    manifest,
  });
}

function collectSourceContext() {
  const preferredPatterns = [
    /authoritative[-_ ]?sources/i,
    /source[-_ ]?register/i,
    /traceability/i,
    /crosswalk/i,
    /rights[-_ ]?ledger/i,
    /trademark/i,
    /independence/i,
    /production[-_ ]?status/i,
    /course[-_ ]?qa/i,
    /assessment[-_ ]?delivery[-_ ]?policy/i,
    /ai[-_ ]?tutor[-_ ]?profile/i,
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
    records.push({
      file: name,
      sha256: crypto.createHash("sha256").update(raw).digest("hex"),
      truncated: excerpt.length < raw.length,
      content: excerpt,
    });
  }
  return records;
}

const sourceContext = collectSourceContext();

function authoringPrompt() {
  const course = manifest.course;
  return `You are the senior instructional design, research, assessment, and cinematic learning-production engine for ${legalName}.

Create an original, commercially credible, premium professional course package for the course below. The target is Hollywood-grade educational production planning: premium documentary storytelling, disciplined visual direction, scene-level scripts, professional narration, source cards, sound and music direction, captions, transcripts, audio-description planning, reduced-motion alternatives, and rights traceability. This request is for a complete governed learner package and production blueprint. It is not permission to claim that final mastered media exists before actual rendering, quality control, rights clearance, accessibility verification, and owner acceptance.

Do not imitate third-party courseware. Do not claim accreditation, certification, legal advice, regulatory approval, compliance, authorization to operate, or guaranteed outcomes. Use mature professional language, substantive paragraphs, varied scenarios, practical judgment, clear evidence boundaries, realistic executive and operational examples, and source-aware instruction. Every externally verifiable fact, framework statement, legal requirement, statistic, incident detail, technical specification, and regulatory assertion must map to a source record. Never invent a source title, publisher, URL, standard clause, quotation, date, statistic, case fact, or source identifier. When an exact authoritative source is not supplied, create a clearly labeled verification-required source record without a fabricated locator.

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
Access model: one-time purchase, named learner, access until completion
Certificate issuer: ${legalName}
Handling notice: ${proprietaryNotice}
Manifest framework tags: ${JSON.stringify(manifest.tags?.frameworks ?? [])}
Supplied governed source context: ${JSON.stringify(sourceContext)}

Return one valid JSON object only. Use this exact top-level structure:
{
  "courseSummary": {
    "executiveValue": "",
    "instructionalStrategy": "",
    "cinematicPositioning": "premium-documentary-cinematic",
    "learnerTransformation": "",
    "sourceAndReviewNotes": []
  },
  "sourceRegister": [
    {
      "id": "SRC-001",
      "title": "",
      "issuingAuthority": "",
      "sourceType": "law|regulation|standard|official-guidance|government-publication|peer-reviewed-research|documented-public-case|organizational-policy|original-obserra-instruction|verification-required",
      "locator": "exact URL, document identifier, or verification-required",
      "publicationDate": null,
      "observedAt": null,
      "jurisdictions": [],
      "moduleIds": [],
      "claimTopics": [],
      "applicability": "",
      "appliesWhen": [],
      "doesNotApplyWhen": [],
      "limitations": [],
      "verificationStatus": "verified-from-supplied-source|requires-independent-verification",
      "verificationInstruction": "",
      "usageBoundary": ""
    }
  ],
  "applicabilityMatrix": [
    {
      "topic": "",
      "sourceIds": [],
      "moduleIds": [],
      "industries": [],
      "roles": [],
      "jurisdictions": [],
      "organizationConditions": [],
      "appliesWhen": [],
      "doesNotApplyWhen": [],
      "implementationDependencies": [],
      "limitations": [],
      "decisionOwner": ""
    }
  ],
  "frameworkAlignment": [
    {
      "framework": "",
      "applicability": "informational-mapping-only",
      "moduleIds": [],
      "alignmentNote": "",
      "appliesWhen": [],
      "doesNotApplyWhen": [],
      "verificationRequired": true
    }
  ],
  "mediaProductionPlan": {
    "standard": "premium-documentary-cinematic",
    "masteringTarget": "4K or owner-approved equivalent master",
    "aspectRatio": "16:9",
    "audioTarget": "48 kHz mastered narration with loudness verification",
    "visualLanguage": "Official Obserra black, dark navy, gold, white, and restrained holographic blue",
    "openingSequence": "",
    "closingSequence": "",
    "sourceCardRules": [],
    "musicAndSoundBoundaries": [],
    "accessibilityDeliverables": [],
    "rightsDeliverables": [],
    "qualityControlChecks": []
  },
  "assessmentBlueprint": {
    "coverageByModule": [{"moduleId": "", "minimumQuestions": 0}],
    "cognitiveMix": [{"level": "application", "targetPercent": 0}],
    "questionTypeMix": [{"type": "single-choice", "targetPercent": 0}],
    "integrityNotes": [],
    "psychometricReviewRequirements": []
  },
  "modules": [
    {
      "id": "",
      "title": "",
      "duration": "",
      "format": "",
      "learningObjectives": [],
      "openingContext": "",
      "lessonNarrative": "",
      "keyConcepts": [{"term": "", "explanation": "", "sourceIds": [], "applicabilityNote": ""}],
      "executiveExample": "",
      "operationalExample": "",
      "scenario": {"situation": "", "evidence": [], "decisionPrompt": "", "recommendedApproach": "", "debrief": "", "sourceIds": [], "applicabilityContext": ""},
      "exercise": {"instructions": "", "deliverable": "", "rubric": [], "sourceIds": [], "applicabilityContext": ""},
      "knowledgeChecks": [{"question": "", "options": [], "correctIndex": 0, "rationale": "", "sourceIds": [], "applicabilityContext": ""}],
      "slideNarrative": [{"title": "", "content": [], "speakerNotes": "", "visualDirection": "", "sourceIds": []}],
      "referenceApplications": [{"sourceIds": [], "claimOrConcept": "", "appliesWhen": [], "doesNotApplyWhen": [], "limitations": [], "learnerAction": ""}],
      "cinematicTreatment": {
        "creativeIntent": "",
        "coldOpen": "",
        "storyArc": [],
        "visualLanguage": "",
        "scenes": [{"sceneId": "", "title": "", "purpose": "", "estimatedSeconds": 0, "visuals": [], "narrationIntent": "", "onScreenText": [], "sourceIds": [], "rightsNotes": [], "accessibilityAlternative": ""}],
        "shotList": [{"shotId": "", "sceneId": "", "shotType": "", "subject": "", "movement": "", "durationSeconds": 0, "sourceIds": [], "rightsRequirement": "", "alternateDescription": ""}],
        "sourceCards": [{"cardId": "", "sourceIds": [], "displayText": "", "displaySeconds": 0}],
        "soundDesign": [],
        "musicDirection": [],
        "transitionPlan": [],
        "continuityNotes": []
      },
      "videoScript": {
        "estimatedDurationMinutes": 0,
        "opening": "",
        "scenes": [{"sceneId": "", "visual": "", "narration": "", "onScreenText": [], "sourceIds": [], "audioCues": [], "captionText": "", "altDescription": ""}],
        "closing": "",
        "captionPlan": [],
        "transcriptPlan": [],
        "audioDescriptionPlan": [],
        "reducedMotionAlternative": []
      },
      "accessibilityNotes": [],
      "sourcePlaceholders": []
    }
  ],
  "finalAssessment": [{"question": "", "options": [], "correctIndex": 0, "rationale": "", "moduleId": "", "cognitiveLevel": "application", "sourceIds": [], "applicabilityContext": "", "difficulty": "moderate"}],
  "learnerWorkbook": [{"moduleId": "", "reflectionPrompts": [], "decisionWorksheet": [], "sourceApplicationPrompts": []}],
  "instructorGuide": {"facilitationNotes": [], "commonMisconceptions": [], "reviewWarnings": [], "sourceUseGuidance": [], "applicabilityWarnings": []},
  "certificatePackage": {
    "title": "Certificate of Course Completion",
    "issuer": "${legalName}",
    "issuanceCriteria": [],
    "verificationFields": [],
    "transcriptFields": [],
    "revocationConditions": [],
    "disclaimer": "",
    "isProfessionalCertification": false,
    "isComplianceEvidence": false
  },
  "rightsAndLicensingPlan": {"assetInventoryRequirements": [], "prohibitedAssetUses": [], "licenseEvidenceRequired": [], "reenactmentAndSyntheticMediaLabels": [], "releaseBlockers": []},
  "accessibilityPlan": {"captions": [], "transcripts": [], "audioDescription": [], "reducedMotion": [], "keyboardAndNonPointerAlternatives": [], "colorIndependentMeaning": [], "readability": [], "qualityChecks": []},
  "productionGateEvidence": {"publicationBlockedUntilOwnerApproval": true, "requiredReviews": [], "requiredMediaEvidence": [], "requiredReferenceEvidence": [], "requiredAssessmentEvidence": [], "requiredCertificateEvidence": [], "requiredSecurityAndEntitlementEvidence": []},
  "marketing": {"shortDescription": "", "longDescription": "", "buyerOutcomes": [], "seoKeywords": []},
  "brand": {"legalName": "${legalName}", "proprietaryNotice": "${proprietaryNotice}", "visualSystem": "Official Obserra black, dark navy, gold, white, and restrained holographic blue"}
}

Quality requirements:
1. Every manifest module must appear exactly once and preserve its identifier, title, duration, and format.
2. Each lessonNarrative must be substantive, course-specific, written in mature multi-paragraph prose, and contain at least 1,200 words.
3. Each module must include at least 6 learning objectives, 6 key concepts, 1 executive example, 1 operational example, 1 realistic scenario, 1 applied exercise, 4 knowledge checks, and 10 slide narratives.
4. Each module must include at least 3 referenceApplications that explain where cited authority applies, where it does not apply, its limitations, and the learner action it supports.
5. Each cinematicTreatment must include a coherent cold open, story arc, at least 8 scenes, at least 8 planned shots, at least 2 source cards, sound direction, transition planning, rights notes, and accessibility alternatives.
6. Each videoScript must include at least 8 scene-level entries with professional narration, visual direction, on-screen text, source identifiers, caption text, alternate descriptions, audio cues, a caption plan, transcript plan, audio-description plan, and reduced-motion alternative.
7. The media plan must target premium documentary and cinematic educational quality without representing unrendered plans as mastered media.
8. The final assessment must contain at least 30 original questions distributed across every module and mapped to the assessment blueprint.
9. Assessment questions must primarily test application, analysis, prioritization, evidence evaluation, escalation, and defensible judgment rather than trivia or memorization.
10. Every assessment question must include sourceIds, applicabilityContext, rationale, module mapping, cognitive level, and difficulty.
11. Avoid repeated scenarios, explanation patterns, distractor patterns, or phrasing across modules.
12. The sourceRegister must include exact supplied sources when available and clearly marked verification-required entries when an exact source is not available.
13. Never fabricate a locator. Use the literal value verification-required when an exact URL or identifier is unavailable.
14. Each source record must state the issuing authority, source type, applicable jurisdictions, module mapping, claim topics, applicability, when it applies, when it does not apply, limitations, verification status, verification instruction, and usage boundary.
15. The applicabilityMatrix must cover every module and explain industry, role, jurisdiction, organization conditions, decision ownership, dependencies, limitations, applies-when conditions, and does-not-apply conditions.
16. Framework alignment is informational mapping only and must never be presented as certification, attestation, legal sufficiency, or proof of compliance.
17. Every externally verifiable claim must map to a source identifier or an explicit verification-required placeholder.
18. Scenarios must contain sufficient evidence for a reasoned decision, appropriate ambiguity, proportionate recommendations, source mapping, and applicability context.
19. Exercises must produce a reviewable learner artifact, decision record, risk statement, control selection, communication, plan, or other work product.
20. Accessibility content must address captions, transcripts, audio description, reduced motion, keyboard or nonpointer alternatives, readable hierarchy, color-independent meaning, and alternate descriptions.
21. Rights planning must identify asset inventory, licenses, source cards, reenactment labels, synthetic-media labels, and release blockers.
22. The certificate package must remain a certificate of course completion only and include verification, transcript, issuance, and revocation metadata.
23. Marketing must not promise employment, certification, examination success, compliance, risk elimination, or guaranteed results.
24. Preserve secure by design, privacy by design, ethical leadership, human oversight, least privilege, evidence preservation, resilience, and defensible decision making where relevant.
25. Distinguish binding requirements, voluntary guidance, organizational policy, recommended practice, original Obserra instruction, documented public cases, and synthetic scenarios whenever the distinction matters.
26. Include all required SME, technical, legal where applicable, copyright, trademark, psychometric, brand, accessibility, AI-governance, media, commerce, entitlement, privacy, security, and owner review gates.
27. Keep publication blocked until complete source verification, mastered media evidence, rights records, accessibility evidence, assessment validation, certificate verification, entitlement testing, security testing, and owner acceptance exist.
28. Keep all generated material proprietary and review required.
29. The package remains draft AI-generated content until governed reviews and direct production evidence are complete.
30. Return JSON only.`;
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
      throw new ProviderAuthoringError({
        provider: providerName.toLowerCase(),
        category: "provider_transient_failure",
        retryable: true,
        exitCode: 1,
        providerCode: "provider_request_timeout",
        message: `${providerName} authoring request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds`,
      });
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
  const response = await fetchWithAuthoringTimeout(
    "OpenAI",
    process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: providerHeaders("openai", apiKey),
      body: JSON.stringify({
        model: process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
        input: prompt,
        max_output_tokens: boundedNumber(process.env.OPENAI_AUTHORING_MAX_OUTPUT_TOKENS, 64_000, 8_000, 100_000),
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
        max_tokens: boundedNumber(process.env.ANTHROPIC_MAX_TOKENS, 64_000, 8_000, 100_000),
        temperature: 0.2,
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
    console.log(`[Academy Studio] Preserved existing governed course package for ${courseId}. Use --force to regenerate.`);
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const prompt = authoringPrompt();
  fs.writeFileSync(path.join(outputDir, "authoring-prompt.txt"), `${proprietaryNotice}\n\n${prompt}\n`);

  const raw = provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
  const authored = parseJson(raw);
  const envelope = {
    schemaVersion: "2.0",
    courseId,
    provider,
    model: provider === "anthropic"
      ? process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5"
      : process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    productionContractVersion: PRODUCTION_CONTRACT_VERSION,
    productionStandard: "premium-documentary-cinematic",
    generatedAt: new Date().toISOString(),
    sourceManifestHash: sourceManifestHash(),
    sourceContextHash: stableHash(sourceContext),
    sourceContextFiles: sourceContext.map((record) => ({
      file: record.file,
      sha256: record.sha256,
      truncated: record.truncated,
    })),
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
    console.error(
      `[Academy Studio] AUTHORING_PROVIDER_FAILURE provider=${error.provider} category=${error.category} retryable=${error.retryable} status=${error.status ?? "unknown"} providerCode=${error.providerCode ?? "unknown"}: ${safeMessage}`,
    );
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
