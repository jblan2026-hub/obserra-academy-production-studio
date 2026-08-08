import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProviderAuthoringError,
  providerAuthoringErrorFromHttp,
} from "./authoring-provider-errors.mjs";
import {
  ProviderTransportError,
  providerHttpRequest,
} from "./provider-http.mjs";
import {
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  taskContract,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUTHORING_POLICY_VERSION = "2026.08.07.3";
const governedTask = taskContract("protected-authoring");
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

function assertWorkerContext() {
  const expected = {
    OBSERRA_WORKER_CONTRACT_ID: workerPoolContract.contractId,
    OBSERRA_WORKER_CONTRACT_HASH: contractHash(),
    OBSERRA_WORKER_ROLE: governedTask.role,
    OBSERRA_WORKER_TASK_TYPE: governedTask.taskType,
    OBSERRA_WORKER_WORKSTREAM: governedTask.workstream,
    OBSERRA_PRODUCTION_STANDARD_ID: commercialProductionStandard.standardId,
    OBSERRA_PRODUCTION_STANDARD_HASH: commercialProductionStandardHash(),
    OBSERRA_PRODUCTION_QUALITY_TIER: commercialProductionStandard.qualityTier,
  };
  for (const [name, expectedValue] of Object.entries(expected)) {
    const configured = String(process.env[name] ?? "").trim();
    if (configured && configured !== expectedValue) {
      throw new Error(`${name} does not match the governed Academy authoring contract.`);
    }
  }
  return expected;
}

function authoringPrompt() {
  const course = manifest.course;
  return `You are the senior instructional design, subject matter, creative development, and commercial course-production authoring engine for ${legalName}.

Create an original, detailed, commercially credible professional course package designed for premium cinematic production under the internal Obserra quality target ${commercialProductionStandard.qualityTier}. This is a production target, not an external certification or film-studio affiliation. Do not imitate third-party courseware. Do not claim accreditation, certification, legal advice, regulatory approval, compliance, or guaranteed outcomes.

Use mature professional language, substantive multi-paragraph instruction, clear conceptual progression, realistic executive and operational cases, practical judgment, concrete learner work products, detailed cinematic direction, and explicit evidence boundaries. Every externally verifiable claim must be traceable to a source need or verified source record and must state where it applies, when it applies, when it does not apply, and its limitations.

Authoring policy version: ${AUTHORING_POLICY_VERSION}
Worker contract: ${workerPoolContract.contractId}
Worker contract hash: ${contractHash()}
Production standard: ${commercialProductionStandard.standardId}
Production standard hash: ${commercialProductionStandardHash()}
Quality tier: ${commercialProductionStandard.qualityTier}
Applied worker rules: ${JSON.stringify(governedTask.appliedRules)}
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

REFERENCE AND APPLICABILITY RULES
1. Never invent a citation, URL, publication, standard clause, case fact, statistic, issuing authority, or source identifier.
2. When an authoritative source has not been supplied, create an explicit verification-required source record. Use a descriptive source need, set citationStatus to verification-required, set urlOrLocator to to-be-resolved, and provide a precise verification instruction. Do not disguise a source need as a verified citation.
3. Original Obserra instruction and synthetic scenarios must be labeled as such and must not be presented as external authority.
4. Every substantive external claim must have a unique claim ID and at least one source ID. Each claim must state classification, applicability, limitations, and verification status.
5. Applicability must identify affected audiences or entities, roles, industries, geographies or jurisdictions, systems or processes, lifecycle phases, triggering conditions, exclusions, and limitations. Do not say merely applicable or generally applicable.
6. Distinguish binding requirement, voluntary guidance, organizational policy, recommended practice, documented public case, original Obserra instruction, and synthetic scenario.
7. A source may support several claims, but every relationship must be explicit in sourceRegister, referenceApplicabilityMatrix, module claimRegister, assessments, and factual video scenes.
8. Source cards and narration may summarize verified material, but they may not overstate scope, applicability, legal effect, or certainty.

Return one valid JSON object only. Use this exact top-level structure:
{
  "courseSummary": {
    "executiveValue": "",
    "instructionalStrategy": "",
    "commercialExperience": "",
    "sourceAndReviewNotes": []
  },
  "courseProductionBible": {
    "creativeIntent": "",
    "audienceExperience": "",
    "narrativeArc": [],
    "visualLanguage": "",
    "cinematography": "",
    "motionGraphicsLanguage": "",
    "soundAndMusicDirection": "",
    "sourceCardTreatment": "",
    "accessibilityTreatment": "",
    "rightsAndSyntheticMediaTreatment": ""
  },
  "sourceRegister": [
    {
      "id": "SRC-001",
      "citationStatus": "verification-required",
      "sourceType": "authoritative-source-needed",
      "sourceTitle": "",
      "issuingAuthority": "",
      "versionOrPublicationDate": "",
      "urlOrLocator": "to-be-resolved",
      "retrievalOrVerificationDate": null,
      "jurisdictionOrScope": "",
      "requirementClassification": "binding-requirement|voluntary-guidance|organizational-policy|recommended-practice|documented-public-case|original-obserra-instruction|synthetic-scenario",
      "claimOrTopic": "",
      "moduleIds": [],
      "claimIds": [],
      "applicability": {
        "appliesTo": [],
        "appliesWhen": [],
        "doesNotApplyWhen": [],
        "roles": [],
        "industries": [],
        "geographies": [],
        "systemsOrProcesses": [],
        "lifecyclePhases": []
      },
      "limitations": "",
      "verificationInstruction": "",
      "usageBoundary": ""
    }
  ],
  "referenceApplicabilityMatrix": [
    {
      "sourceId": "SRC-001",
      "claimIds": [],
      "moduleIds": [],
      "learningObjectiveIds": [],
      "assessmentItemIds": [],
      "videoSceneIds": [],
      "applicationSummary": "",
      "exclusionsAndLimitations": ""
    }
  ],
  "frameworkAlignment": [
    {
      "framework": "",
      "applicability": "informational-mapping-only",
      "moduleIds": [],
      "alignmentNote": "",
      "appliesTo": [],
      "appliesWhen": [],
      "doesNotEstablish": [],
      "verificationRequired": true
    }
  ],
  "assessmentBlueprint": {
    "coverageByModule": [{"moduleId": "", "minimumQuestions": 0}],
    "coverageByObjective": [{"objectiveId": "", "minimumQuestions": 0}],
    "cognitiveMix": [{"level": "application", "targetPercent": 0}],
    "integrityNotes": []
  },
  "modules": [
    {
      "id": "",
      "title": "",
      "duration": "",
      "format": "",
      "learningObjectives": [{"id": "", "statement": "", "evidenceOfLearning": ""}],
      "openingContext": "",
      "lessonNarrative": "",
      "claimRegister": [
        {
          "id": "CLAIM-001",
          "statement": "",
          "sourceIds": [],
          "classification": "binding-requirement|voluntary-guidance|organizational-policy|recommended-practice|documented-public-case|original-obserra-instruction|synthetic-scenario",
          "verificationStatus": "verification-required|not-external-source",
          "applicability": {
            "appliesTo": [],
            "appliesWhen": [],
            "doesNotApplyWhen": [],
            "roles": [],
            "industries": [],
            "geographies": [],
            "systemsOrProcesses": [],
            "lifecyclePhases": []
          },
          "limitations": ""
        }
      ],
      "keyConcepts": [{"term": "", "explanation": "", "claimIds": [], "sourceIds": []}],
      "executiveExample": {"narrative": "", "claimIds": [], "sourceIds": [], "applicabilityNote": ""},
      "operationalExample": {"narrative": "", "claimIds": [], "sourceIds": [], "applicabilityNote": ""},
      "scenario": {
        "classification": "synthetic-scenario",
        "situation": "",
        "evidence": [],
        "decisionPrompt": "",
        "recommendedApproach": "",
        "debrief": "",
        "sourceIds": [],
        "applicabilityNote": ""
      },
      "exercise": {"instructions": "", "deliverable": "", "rubric": [], "objectiveIds": [], "sourceIds": []},
      "knowledgeChecks": [{"id": "", "question": "", "options": [], "correctIndex": 0, "rationale": "", "objectiveIds": [], "sourceIds": []}],
      "creativeTreatment": {
        "learningArc": "",
        "cinematicOpening": "",
        "visualMotifs": [],
        "pacingPlan": "",
        "scenarioTreatment": "",
        "sourceCardPlan": "",
        "closingResolution": ""
      },
      "productionPlan": {
        "storyboard": [{"sceneId": "", "purpose": "", "picture": "", "onScreenText": "", "durationSeconds": 0, "sourceIds": [], "accessibilityDescription": ""}],
        "shotList": [{"shotId": "", "sceneId": "", "shotType": "", "subject": "", "movement": "", "locationOrEnvironment": "", "assetNeeds": [], "rightsNotes": ""}],
        "motionGraphicsPlan": [{"sceneId": "", "graphic": "", "dataOrClaimIds": [], "sourceIds": [], "reducedMotionAlternative": ""}],
        "audioPlan": {"narrationStyle": "", "musicDirection": "", "soundDesign": "", "silenceAndEmphasis": "", "rightsNotes": ""},
        "assetRequirements": [{"assetId": "", "description": "", "origin": "original|licensed|synthetic-disclosed", "rightsEvidenceRequired": true}]
      },
      "slideNarrative": [{"id": "", "title": "", "content": [], "speakerNotes": "", "visualDirection": "", "claimIds": [], "sourceIds": []}],
      "videoScript": {
        "opening": "",
        "scenes": [{"sceneId": "", "durationSeconds": 0, "visual": "", "onScreenText": "", "narration": "", "audioCue": "", "claimIds": [], "sourceIds": [], "accessibilityDescription": ""}],
        "closing": "",
        "estimatedNarrationWords": 0,
        "estimatedRuntimeMinutes": 0
      },
      "accessibilityNotes": [],
      "sourcePlaceholders": [],
      "referenceApplicationNotes": []
    }
  ],
  "finalAssessment": [
    {
      "id": "ASSESS-001",
      "question": "",
      "options": [],
      "correctIndex": 0,
      "rationale": "",
      "distractorRationales": [],
      "moduleId": "",
      "objectiveIds": [],
      "cognitiveLevel": "application",
      "sourceIds": [],
      "applicabilityNote": ""
    }
  ],
  "learnerWorkbook": [{"moduleId": "", "reflectionPrompts": [], "decisionWorksheet": [], "referenceApplicationPrompts": [], "sourceIds": []}],
  "instructorGuide": {"facilitationNotes": [], "commonMisconceptions": [], "applicabilityWarnings": [], "sourceVerificationWarnings": [], "reviewWarnings": []},
  "marketing": {"shortDescription": "", "longDescription": "", "buyerOutcomes": [], "seoKeywords": []},
  "brand": {"legalName": "${legalName}", "proprietaryNotice": "${proprietaryNotice}", "visualSystem": "Official Obserra black, dark navy, gold, white, and restrained holographic blue"}
}

DETAILED COURSE QUALITY REQUIREMENTS
1. Every manifest module must appear exactly once and preserve its ID, title, duration, and format.
2. Each non-assessment lessonNarrative must contain at least 1,400 words of original, topic-specific instruction. It must be organized into connected substantive paragraphs, not outline fragments, filler, or repeated definitions.
3. Instruction and narration must account credibly for the full module duration through teaching, examples, scenario analysis, visual explanation, reflection, practice, and intentional pauses. Target approximately 105 to 135 spoken words per minute for narrated segments rather than filling the entire duration with uninterrupted voiceover.
4. Every module must contain at least 6 substantive claims in claimRegister, 5 key concepts, 1 executive example, 1 operational example, 1 realistic scenario, 1 applied exercise, 5 knowledge checks, 10 slide narratives, a complete creative treatment, a storyboard, a shot list, motion-graphics direction, audio direction, asset requirements, and a scene-level video script.
5. Every factual video scene, source card, slide, example, assessment item, and key concept must carry applicable claim IDs and source IDs. Purely connective narration may use empty source arrays only when it makes no externally verifiable claim.
6. Every claim and source must state where it applies: affected entity or audience, roles, industries, geography or jurisdiction, systems or processes, lifecycle phase, triggering conditions, exclusions, and limitations.
7. The final assessment must contain at least 25 original questions distributed across all modules and learning objectives. Questions must primarily test application, analysis, prioritization, evidence evaluation, escalation, and defensible judgment rather than trivia.
8. Each assessment item must include a correct-answer rationale, distractor rationales, objective IDs, source IDs, and an applicability note. The answer key remains protected.
9. Build a sourceRegister that identifies every authoritative source or source need required before publication. Never invent source details. Unresolved records must remain citationStatus verification-required and must block commercial release until independently resolved.
10. The referenceApplicabilityMatrix must map every source to its claims, modules, learning objectives, assessment items, and video scenes. Orphan sources and orphan factual claims are prohibited.
11. Framework alignment is informational mapping only. Applicability must be conditional and precise. Course completion must never be represented as compliance, certification, attestation, authorization, accreditation, legal sufficiency, or independent validation.
12. Each scenario must contain enough evidence for a reasoned decision, include ambiguity appropriate to the learner level, and explain why the recommended approach is proportionate. Synthetic scenarios must be labeled.
13. Exercises must produce a concrete learner artifact such as a decision record, risk statement, control selection, analysis, communication, plan, worksheet, or evidence package.
14. The production bible and module production plans must support premium commercial filmmaking: coherent narrative arc, purposeful cinematic opening and closing, visual continuity, original or licensed assets, scene-level source cards, intentional pacing, professional narration, motion graphics, music and sound design, color review, and learner-focused visual clarity.
15. Video direction must target a 3840x2160 master or expressly approved equivalent, a mezzanine master and web derivative, 48 kHz minimum 24-bit audio, -16 LUFS integrated loudness target with +/-1 LU tolerance, and -1 dBTP true-peak maximum. Do not claim those masters exist at authoring time.
16. Provider previews, test renders, watermarked outputs, silent videos, static slides, storyboards, scripts, and unreviewed AI output may not be described as final commercial media.
17. Video scripts must be designed for professional audible narration, human-reviewed captions, verbatim transcripts, audio description or approved equivalent, reduced-motion alternatives, readable on-screen text, and visuals that do not rely on color alone.
18. Every asset requirement must identify original, licensed, or disclosed synthetic origin and require a rights record. Music, voice, likeness, stock, imagery, data graphics, trademarks, and third-party materials require explicit clearance.
19. Accessibility notes must cover caption and transcript equivalence, keyboard and nonpointer alternatives, screen-reader usability, readable visual hierarchy, audio description, reduced motion, and non-video instructional alternatives.
20. Preserve secure by design, privacy by design, ethical leadership, human oversight, least privilege, evidence preservation, resilience, and defensible decision making where relevant.
21. Marketing must accurately describe learning outcomes without promising employment, certification, examination success, compliance, risk elimination, or guaranteed results.
22. All content remains ${proprietaryNotice} and draft AI-generated content until source verification, SME, technical, legal where applicable, brand, accessibility, rights, psychometric where applicable, media, security, compliance, and owner review gates pass.
23. The terms commercial and Hollywood-grade may not appear as a completed quality claim inside the generated course package. The package may state only commercial cinematic production in progress until exact released assets pass every acceptance gate.`;
}

function providerHeaders(providerName, apiKey) {
  const headers = {
    "Content-Type": "application/json",
  };
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
  try {
    return await providerHttpRequest({
      provider: providerName,
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
      timeoutMs: requestTimeoutMs,
    });
  } catch (error) {
    if (error instanceof ProviderTransportError) {
      throw new ProviderAuthoringError({
        provider: providerName.toLowerCase(),
        category: "provider_transient_failure",
        retryable: true,
        exitCode: 1,
        providerCode: error.category,
        message: error.message,
      });
    }
    throw error;
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
        text: { format: { type: "json_object" } },
        reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "high" },
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
        temperature: 0.25,
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

  const workerContext = assertWorkerContext();
  fs.mkdirSync(outputDir, { recursive: true });
  const prompt = authoringPrompt();
  fs.writeFileSync(path.join(outputDir, "authoring-prompt.txt"), `${proprietaryNotice}\n\n${prompt}\n`);

  const raw = provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
  const authored = parseJson(raw);
  const envelope = {
    schemaVersion: "1.3",
    courseId,
    provider,
    model: provider === "anthropic" ? process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5" : process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    sourceManifestHash: sourceManifestHash(),
    reviewStatus: "draft-ai-generated",
    commercialQualityStatus: commercialProductionStandard.claimPolicy.interimLabel,
    legalName,
    proprietaryNotice,
    workerContract: {
      contractId: workerPoolContract.contractId,
      contractHash: contractHash(),
      taskType: governedTask.taskType,
      role: governedTask.role,
      workstream: governedTask.workstream,
      appliedRules: governedTask.appliedRules,
      runtimeContext: workerContext,
    },
    productionStandard: {
      standardId: commercialProductionStandard.standardId,
      standardHash: commercialProductionStandardHash(),
      qualityTier: commercialProductionStandard.qualityTier,
      qualityClaimAllowed: false,
      claimBoundary: commercialProductionStandard.claimBoundary,
    },
    content: authored,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(`[Academy Studio] Generated governed detailed cinematic course package for ${courseId} through ${provider} under policy ${AUTHORING_POLICY_VERSION}; references remain subject to independent verification.`);
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
