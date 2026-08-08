import "./academy-zero-cost-lock.mjs";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACADEMY_AUTHORING_POLICY_VERSION,
  countWords,
  requiredFinalAssessmentQuestions,
} from "./academy-authoring-quality-contract.mjs";
import { assertAuthoredPackageReady } from "./validate-authored-package.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUTHORING_POLICY_VERSION = ACADEMY_AUTHORING_POLICY_VERSION;
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
const provider = String(
  arg("--provider") || process.env.ACADEMY_AUTHORING_PROVIDER || "local",
).toLowerCase();
const force = process.argv.includes("--force");
const moduleRequestTimeoutMs = boundedNumber(
  process.env.ACADEMY_MODULE_AUTHORING_TIMEOUT_MS,
  50 * 60 * 1000,
  10 * 60 * 1000,
  75 * 60 * 1000,
);
const moduleContext = boundedNumber(
  process.env.ACADEMY_MODULE_AUTHORING_CONTEXT,
  8_192,
  8_192,
  16_384,
);
const moduleOutputTokens = boundedNumber(
  process.env.ACADEMY_MODULE_AUTHORING_MAX_TOKENS,
  6_144,
  4_096,
  10_240,
);

if (!courseId) {
  console.error(
    "Usage: node studio/author-course-hollywood.mjs --course <course-id> [--provider local] [--force]",
  );
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error("Invalid course identifier.");
}
if (provider !== "local") {
  throw new Error(
    `The zero-cost Academy authoring route permits only local authoring; received ${provider}.`,
  );
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const researchPath = path.join(
  courseDir,
  "generated",
  "research",
  "authoritative-source-research.json",
);
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Course manifest not found for ${courseId}.`);
}
if (!fs.existsSync(researchPath)) {
  throw new Error(`Authoritative research evidence is missing for ${courseId}.`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const researchEvidence = JSON.parse(fs.readFileSync(researchPath, "utf8"));
if (researchEvidence.passed !== true) {
  throw new Error(`Authoritative research has not passed for ${courseId}.`);
}
if ((researchEvidence.unresolvedTopics || []).length > 0) {
  throw new Error(`Authoritative research contains unresolved topics for ${courseId}.`);
}
const research = researchEvidence.research || {};
const course = manifest.course || {};
const manifestModules = Array.isArray(course.modules) ? course.modules : [];
if (!manifestModules.length) throw new Error(`Course ${courseId} has no manifest modules.`);

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

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function extractJsonObject(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = trimmed.indexOf("{");
  if (start < 0) throw new Error("Local module authoring returned no JSON object.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(trimmed.slice(start, index + 1));
    }
  }
  throw new Error("Local module authoring returned an unterminated JSON object.");
}

async function callLocal(prompt, moduleId) {
  const baseUrl = String(
    process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434",
  ).replace(/\/$/, "");
  const model = String(
    process.env.LOCAL_AI_MODEL ||
      process.env.ACADEMY_LOCAL_AUTHORING_MODEL ||
      "qwen2.5:7b-instruct",
  ).trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), moduleRequestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        keep_alive: "30m",
        options: {
          temperature: 0.16,
          top_p: 0.9,
          repeat_penalty: 1.08,
          num_ctx: moduleContext,
          num_predict: moduleOutputTokens,
        },
        messages: [
          {
            role: "system",
            content:
              "Return one valid JSON object only. Write original professional instruction. Use only supplied source and case facts. Never invent authorities, URLs, quotations, dates, statistics, legal requirements, standards clauses, or case facts.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `Local module authoring failed with ${response.status}: ${raw.slice(0, 3000)}`,
      );
    }
    const payload = JSON.parse(raw);
    const content = payload?.message?.content;
    if (!content) throw new Error("Local module authoring returned no message content.");
    return content;
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error(
        `Local module authoring timed out for ${moduleId} after ${Math.round(moduleRequestTimeoutMs / 1000)} seconds. Valid completed module checkpoints will be reused on retry.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const sourceById = new Map(
  array(research.authoritativeSources).map((source) => [String(source.id), source]),
);
const caseById = new Map(
  array(research.documentedCases).map((item) => [String(item.id), item]),
);
const researchByModule = new Map(
  array(research.moduleResearch).map((item) => [String(item.moduleId), item]),
);
const researchHash = stableHash(researchEvidence);
const partialRoot = path.join(courseDir, "generated", "authoring", "partials");
const outputDir = path.join(courseDir, "generated", "authoring");
const outputPath = path.join(outputDir, "course-package.json");
const progressPath = path.join(outputDir, "authoring-progress.json");
const remediationPath = path.join(courseDir, "course-qa-local-remediation.json");
const remediation = fs.existsSync(remediationPath)
  ? JSON.parse(fs.readFileSync(remediationPath, "utf8"))
  : null;
const remediationFindings = array(remediation?.findings).map(String);

function compactSource(source) {
  return {
    id: source.id,
    title: source.title,
    issuingAuthority: source.issuingAuthority,
    sourceType: source.sourceType,
    publication: source.publication,
    publicationDate: source.publicationDate,
    status: source.status,
    binding: Boolean(source.binding),
    canonicalUrl: source.canonicalUrl,
    claimTopics: array(source.claimTopics).slice(0, 8),
    applicability: source.applicability,
    appliesWhen: array(source.appliesWhen).slice(0, 4),
    doesNotApplyWhen: array(source.doesNotApplyWhen).slice(0, 4),
    limitations: array(source.limitations).slice(0, 4),
  };
}

function compactCase(item) {
  return {
    id: item.id,
    title: item.title,
    organizationOrEvent: item.organizationOrEvent,
    date: item.date,
    primarySourceUrl: item.primarySourceUrl,
    sourceAuthority: item.sourceAuthority,
    factsSupported: array(item.factsSupported),
    lessonsLearned: array(item.lessonsLearned),
    implementationRecommendations: array(item.implementationRecommendations),
    limitations: array(item.limitations),
  };
}

function sourceIdsForModule(moduleId) {
  const mapping = researchByModule.get(String(moduleId));
  const selected = uniqueStrings(mapping?.sourceIds).filter((id) => sourceById.has(id));
  if (selected.length >= 3) return selected.slice(0, 5);
  return uniqueStrings([...selected, ...sourceById.keys()]).slice(0, 5);
}

function caseIdsForModule(moduleId) {
  const mapping = researchByModule.get(String(moduleId));
  const selected = uniqueStrings(mapping?.caseIds).filter((id) => caseById.has(id));
  if (selected.length >= 1) return selected.slice(0, 2);
  return uniqueStrings([...selected, ...caseById.keys()]).slice(0, 2);
}

function modulePrompt(manifestModule, assessmentSeedTarget) {
  const mapping = researchByModule.get(String(manifestModule.id)) || {};
  const sourceIds = sourceIdsForModule(manifestModule.id);
  const caseIds = caseIdsForModule(manifestModule.id);
  const sourceContext = sourceIds.map((id) => compactSource(sourceById.get(id)));
  const caseContext = caseIds.map((id) => compactCase(caseById.get(id)));

  return `Develop one complete Obserra Academy module. Keep the exact module identity and use only the governed facts below.

Course: ${course.title}
Audience: ${course.audience}
Level: ${course.level}
Course description: ${course.description}
Course outcomes: ${JSON.stringify(array(course.outcomes))}
Module: ${JSON.stringify({
    id: manifestModule.id,
    title: manifestModule.title,
    duration: manifestModule.duration,
    format: manifestModule.format,
    description: manifestModule.description,
  })}
Governed factual claims to teach: ${JSON.stringify(array(mapping.factualClaimsToTeach))}
Governed lessons learned: ${JSON.stringify(array(mapping.lessonsLearned))}
Governed implementation recommendations: ${JSON.stringify(array(mapping.implementationRecommendations))}
Verified authorities: ${JSON.stringify(sourceContext)}
Documented cases: ${JSON.stringify(caseContext)}

Return exactly this JSON object shape:
{"id":"${manifestModule.id}","title":"${manifestModule.title}","duration":"${manifestModule.duration}","format":"${manifestModule.format}","openingContext":"","lessonNarrative":"","learningObjectives":[""],"keyConcepts":[{"term":"","explanation":"","applicabilityNote":"","sourceIds":[""]}],"executiveExample":"","operationalExample":"","scenario":{"situation":"","evidence":[""],"decisionPrompt":"","recommendedApproach":"","debrief":""},"exercise":{"instructions":"","deliverable":"","rubric":[""]},"knowledgeChecks":[{"question":"","options":["","","",""],"correctIndex":0,"rationale":"","sourceIds":[""],"applicabilityContext":""}],"referenceApplications":[{"claimOrConcept":"","appliesWhen":[""],"doesNotApplyWhen":[""],"limitations":[""],"learnerAction":"","sourceIds":[""]}],"videoScript":{"opening":"","closing":"","scenes":[{"sceneId":"","narration":"","captionText":"","visual":"","altDescription":"","onScreenText":[""],"sourceIds":[""]}]},"accessibilityNotes":[""],"assessmentSeeds":[{"question":"","options":["","","",""],"correctIndex":0,"rationale":"","cognitiveLevel":"application|analysis","sourceIds":[""],"applicabilityContext":""}]}

Mandatory quality rules:
- lessonNarrative must contain 1,300-1,550 substantive words in mature multi-paragraph professional prose. Explain business context, evidence, decision authority, trade-offs, implementation, escalation, documentation, metrics, and limitations. Do not pad with repeated sentences.
- Provide exactly the manifest id, title, duration, and format.
- Provide at least 6 specific learning objectives and 6 developed key concepts. Key-concept explanations should be approximately 40-70 words.
- executiveExample and operationalExample must each contain at least 90 words and be clearly different.
- scenario.situation, recommendedApproach, and debrief must each contain at least 100 words. Label any constructed scenario as instructional rather than historical fact.
- Provide a practical exercise with a reviewable deliverable and at least 4 rubric criteria.
- Provide at least 4 knowledge checks with four credible options and source-linked rationales.
- Provide at least 3 source applications with appliesWhen, doesNotApplyWhen, limitations, a concrete learner action, and verified sourceIds.
- Provide at least 8 video scenes. Every narration must contain 35-65 substantive words and teach content rather than merely introduce it.
- Provide at least 4 accessibility notes.
- Provide at least ${assessmentSeedTarget} original assessmentSeeds with four options, a defensible rationale, application or analysis cognitive level, verified sourceIds, and applicability context.
- Source IDs may only be: ${JSON.stringify(sourceIds)}. Case facts may only come from the documented cases above.
- Preserve binding/nonbinding status and applicability limits. Do not imply certification, legal advice, regulatory approval, guaranteed outcomes, or universal applicability.
- Return JSON only.`;
}

function validOptions(item) {
  return (
    array(item?.options).length >= 4 &&
    Number.isInteger(item?.correctIndex) &&
    item.correctIndex >= 0 &&
    item.correctIndex < array(item.options).length
  );
}

function moduleCoreFindings(module, manifestModule, assessmentSeedTarget) {
  const findings = [];
  const sourceIds = new Set(sourceIdsForModule(manifestModule.id));
  if (clean(module?.id) !== clean(manifestModule.id)) findings.push("module-id-mismatch");
  if (clean(module?.title) !== clean(manifestModule.title)) findings.push("module-title-mismatch");
  if (clean(module?.duration) !== clean(manifestModule.duration)) {
    findings.push("module-duration-mismatch");
  }
  if (clean(module?.format) !== clean(manifestModule.format)) findings.push("module-format-mismatch");
  if (countWords(module?.lessonNarrative) < 1_200) findings.push("lesson-narrative-below-1200");
  if (array(module?.learningObjectives).filter((item) => clean(item)).length < 6) {
    findings.push("learning-objectives-below-6");
  }
  const concepts = array(module?.keyConcepts);
  if (
    concepts.length < 6 ||
    concepts.some((item) => !clean(item?.term) || countWords(item?.explanation) < 20)
  ) {
    findings.push("key-concept-quality-deficiency");
  }
  if (countWords(module?.executiveExample) < 60) findings.push("executive-example-too-thin");
  if (countWords(module?.operationalExample) < 60) findings.push("operational-example-too-thin");
  if (countWords(module?.scenario?.situation) < 80) findings.push("scenario-situation-too-thin");
  if (countWords(module?.scenario?.recommendedApproach) < 80) {
    findings.push("scenario-recommended-approach-too-thin");
  }
  if (countWords(module?.scenario?.debrief) < 80) findings.push("scenario-debrief-too-thin");
  if (
    !clean(module?.exercise?.instructions) ||
    !clean(module?.exercise?.deliverable) ||
    array(module?.exercise?.rubric).length < 4
  ) {
    findings.push("exercise-deficiency");
  }
  const checks = array(module?.knowledgeChecks);
  if (
    checks.length < 4 ||
    checks.some(
      (item) =>
        !clean(item?.question) ||
        !validOptions(item) ||
        countWords(item?.rationale) < 8 ||
        !array(item?.sourceIds).some((id) => sourceIds.has(String(id))),
    )
  ) {
    findings.push("knowledge-check-quality-deficiency");
  }
  const applications = array(module?.referenceApplications);
  if (
    applications.length < 3 ||
    applications.some(
      (item) =>
        !clean(item?.claimOrConcept) ||
        array(item?.appliesWhen).length < 1 ||
        array(item?.doesNotApplyWhen).length < 1 ||
        array(item?.limitations).length < 1 ||
        countWords(item?.learnerAction) < 10 ||
        !array(item?.sourceIds).some((id) => sourceIds.has(String(id))),
    )
  ) {
    findings.push("reference-application-quality-deficiency");
  }
  const scenes = array(module?.videoScript?.scenes);
  if (
    scenes.length < 8 ||
    scenes.some(
      (scene) =>
        countWords(scene?.narration) < 20 ||
        !clean(scene?.visual || scene?.altDescription) ||
        !array(scene?.sourceIds).some((id) => sourceIds.has(String(id))),
    )
  ) {
    findings.push("video-scene-quality-deficiency");
  }
  if (array(module?.accessibilityNotes).filter((item) => clean(item)).length < 4) {
    findings.push("accessibility-notes-below-4");
  }
  const seeds = array(module?.assessmentSeeds);
  if (
    seeds.length < assessmentSeedTarget ||
    seeds.some(
      (item) =>
        !clean(item?.question) ||
        !validOptions(item) ||
        countWords(item?.rationale) < 10 ||
        !["application", "analysis"].includes(clean(item?.cognitiveLevel).toLowerCase()) ||
        !array(item?.sourceIds).some((id) => sourceIds.has(String(id))),
    )
  ) {
    findings.push(`assessment-seed-quality-deficiency-minimum-${assessmentSeedTarget}`);
  }
  return findings;
}

function normalizeSourceIds(values, allowed, fallback) {
  const selected = uniqueStrings(values).filter((id) => allowed.has(id));
  return selected.length ? selected : [...fallback];
}

function normalizeModule(module, manifestModule) {
  const allowedIds = new Set(sourceIdsForModule(manifestModule.id));
  const fallbackIds = [...allowedIds].slice(0, 2);
  const normalized = {
    ...module,
    id: manifestModule.id,
    title: manifestModule.title,
    duration: manifestModule.duration,
    format: manifestModule.format,
    learningObjectives: uniqueStrings(module.learningObjectives),
    keyConcepts: array(module.keyConcepts).map((concept) => ({
      ...concept,
      term: clean(concept?.term),
      explanation: clean(concept?.explanation),
      applicabilityNote:
        clean(concept?.applicabilityNote) ||
        "Validate applicability against the learner's jurisdiction, sector, authority, data, system, and organizational context.",
      sourceIds: normalizeSourceIds(concept?.sourceIds, allowedIds, fallbackIds),
    })),
    executiveExample: clean(module.executiveExample),
    operationalExample: clean(module.operationalExample),
    scenario: {
      ...module.scenario,
      situation: clean(module.scenario?.situation),
      evidence: uniqueStrings(module.scenario?.evidence),
      decisionPrompt: clean(module.scenario?.decisionPrompt),
      recommendedApproach: clean(module.scenario?.recommendedApproach),
      debrief: clean(module.scenario?.debrief),
    },
    exercise: {
      ...module.exercise,
      instructions: clean(module.exercise?.instructions),
      deliverable: clean(module.exercise?.deliverable),
      rubric: uniqueStrings(module.exercise?.rubric),
    },
    knowledgeChecks: array(module.knowledgeChecks).map((item) => ({
      ...item,
      question: clean(item?.question),
      options: array(item?.options).map(clean).slice(0, 4),
      rationale: clean(item?.rationale),
      sourceIds: normalizeSourceIds(item?.sourceIds, allowedIds, fallbackIds),
      applicabilityContext:
        clean(item?.applicabilityContext) ||
        "Apply only after verifying organization-specific scope and decision authority.",
    })),
    referenceApplications: array(module.referenceApplications).map((item) => ({
      ...item,
      claimOrConcept: clean(item?.claimOrConcept),
      appliesWhen: uniqueStrings(item?.appliesWhen),
      doesNotApplyWhen: uniqueStrings(item?.doesNotApplyWhen),
      limitations: uniqueStrings(item?.limitations),
      learnerAction: clean(item?.learnerAction),
      sourceIds: normalizeSourceIds(item?.sourceIds, allowedIds, fallbackIds),
    })),
    accessibilityNotes: uniqueStrings(module.accessibilityNotes),
    assessmentSeeds: array(module.assessmentSeeds).map((item) => ({
      ...item,
      question: clean(item?.question),
      options: array(item?.options).map(clean).slice(0, 4),
      rationale: clean(item?.rationale),
      cognitiveLevel: clean(item?.cognitiveLevel).toLowerCase(),
      sourceIds: normalizeSourceIds(item?.sourceIds, allowedIds, fallbackIds),
      applicabilityContext:
        clean(item?.applicabilityContext) ||
        "Apply only after verifying organization-specific facts, authority, and constraints.",
    })),
  };

  const scenes = array(module?.videoScript?.scenes).slice(0, 12).map((scene, index) => ({
    ...scene,
    sceneId: clean(scene?.sceneId) || `${manifestModule.id}-scene-${index + 1}`,
    narration: clean(scene?.narration),
    captionText: clean(scene?.captionText || scene?.narration),
    visual: clean(scene?.visual || scene?.altDescription),
    altDescription: clean(scene?.altDescription || scene?.visual),
    onScreenText: uniqueStrings(scene?.onScreenText),
    sourceIds: normalizeSourceIds(scene?.sourceIds, allowedIds, fallbackIds),
  }));
  normalized.videoScript = {
    ...module.videoScript,
    opening: clean(module.videoScript?.opening),
    closing: clean(module.videoScript?.closing),
    scenes,
    segments: scenes.map((scene) => ({
      visual: scene.visual,
      narration: scene.narration,
      sourceIds: scene.sourceIds,
    })),
    captionPlan: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      captionText: scene.captionText,
    })),
    transcriptPlan: [
      "Create a final verbatim transcript from the mastered narration and verify it against the approved script before release.",
    ],
    audioDescriptionPlan: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      description: scene.altDescription,
    })),
    reducedMotionAlternative: [
      "Provide the same narration, captions, transcript, source cards, and instructional text without nonessential motion or rapid transitions.",
    ],
  };
  normalized.sourcePlaceholders = [...allowedIds];
  return normalized;
}

function buildSlides(module) {
  const proposed = array(module.slideNarrative).filter(
    (slide) =>
      clean(slide?.title) &&
      array(slide?.content).length > 0 &&
      clean(slide?.speakerNotes) &&
      clean(slide?.visualDirection),
  );
  if (proposed.length >= 10) return proposed.slice(0, 12);

  const concepts = array(module.keyConcepts);
  const slides = [
    {
      title: `${module.title}: Decision Context`,
      content: [clean(module.openingContext), "Define the evidence and authority boundary."],
      speakerNotes:
        "Orient learners to the business consequence, decision owner, evidence available, uncertainty, and limitations before introducing controls or recommendations.",
      visualDirection:
        "Use an accessible decision-context map with labeled actors, evidence, constraints, and escalation paths.",
    },
    {
      title: "Verified Evidence and Applicability",
      content: [
        "Separate binding authority, nonbinding guidance, documented case facts, organizational policy, and instructional judgment.",
        "Confirm where each source applies and where it does not apply.",
      ],
      speakerNotes:
        "Explain why source status and applicability determine whether a recommendation is defensible in a specific organization.",
      visualDirection:
        "Use a five-column source-status matrix with text labels and no color-only meaning.",
    },
  ];
  for (const concept of concepts.slice(0, 6)) {
    slides.push({
      title: concept.term,
      content: [concept.explanation, concept.applicabilityNote],
      speakerNotes:
        "Connect the concept to accountable implementation, evidence, decision authority, exceptions, and measurable outcomes.",
      visualDirection:
        "Use a restrained process or relationship diagram with readable labels and an accompanying text summary.",
    });
  }
  slides.push(
    {
      title: "Executive and Operational Application",
      content: [module.executiveExample, module.operationalExample],
      speakerNotes:
        "Contrast executive decision responsibilities with operational execution and show how evidence moves between the two levels.",
      visualDirection:
        "Use a two-level operating model showing executive decisions, operational controls, evidence, and escalation.",
    },
    {
      title: "Scenario Decision and Debrief",
      content: [module.scenario.situation, module.scenario.recommendedApproach],
      speakerNotes:
        "Pause for learner judgment, then debrief the evidence, authority, trade-offs, reversibility, documentation, and lessons learned.",
      visualDirection:
        "Use a branching decision flow with an accessible text alternative and explicit consequence labels.",
    },
  );
  return slides.slice(0, 10);
}

function buildCinematicTreatment(module) {
  const sourceIds = sourceIdsForModule(module.id);
  const scenes = array(module.videoScript?.scenes);
  return {
    creativeIntent:
      "Present the module as an evidence-led executive documentary lesson that connects verified authority, documented cases, accountable decisions, and practical implementation.",
    coldOpen: clean(module.videoScript?.opening),
    storyArc: [
      "Establish the consequential decision and operating context.",
      "Clarify verified evidence, authority, and applicability.",
      "Explain the core concepts and trade-offs.",
      "Apply the concepts through executive and operational examples.",
      "Work through a realistic instructional scenario.",
      "Close with implementation, metrics, escalation, and documentation.",
    ],
    scenes: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      visualIntent: scene.visual,
      sourceIds: scene.sourceIds,
    })),
    shots: scenes.map((scene, index) => ({
      shotId: `${module.id}-shot-${index + 1}`,
      sceneId: scene.sceneId,
      composition:
        index % 3 === 0
          ? "Executive context card with restrained motion and readable evidence labels."
          : index % 3 === 1
            ? "Process or decision-flow visualization with labeled relationships."
            : "Operational case tableau with source card and accessible text summary.",
      continuity:
        "Maintain the Obserra dark navy, black, gold, white, and restrained holographic-blue visual system.",
    })),
    sourceCards: sourceIds.slice(0, 3).map((sourceId) => ({
      sourceId,
      placement: "Display during the first substantive use and retain in the transcript reference section.",
    })),
    narrationIntent:
      "Authoritative, measured, and instructional; explain reasoning without overstating certainty or applicability.",
    soundDirection:
      "Narration remains primary. Use no unlicensed music or sound effects; any optional original ambience must not compete with speech.",
    transitions:
      "Use restrained cuts, slow evidence-card reveals, and reduced-motion-compatible transitions.",
    continuityNotes: [
      "Keep source identifiers and applicability language consistent across narration, captions, transcript, and learner materials.",
      "Never depict a constructed scenario as a documented historical event.",
    ],
    rightsRequirements: [
      "Use original Obserra motion graphics and course-owned text only unless separate rights evidence is recorded.",
      "Do not use third-party logos, footage, imagery, music, avatars, or voice assets without documented authorization.",
    ],
    accessibilityAlternatives: [
      "Captions, final transcript, audio-description text, readable source cards, keyboard-accessible controls, and a reduced-motion alternative are mandatory.",
    ],
  };
}

function modulePartialPath(moduleId) {
  return path.join(partialRoot, `${moduleId}.json`);
}

function moduleNeedsRemediation(moduleId) {
  return remediationFindings.some((finding) => finding.includes(moduleId));
}

function readReusableModule(manifestModule, assessmentSeedTarget) {
  const filePath = modulePartialPath(manifestModule.id);
  if (!fs.existsSync(filePath) || moduleNeedsRemediation(manifestModule.id)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      record.courseId !== courseId ||
      record.moduleId !== manifestModule.id ||
      record.authoringPolicyVersion !== AUTHORING_POLICY_VERSION ||
      record.productionContractVersion !== PRODUCTION_CONTRACT_VERSION ||
      record.sourceManifestHash !== sourceManifestHash() ||
      record.researchHash !== researchHash
    ) {
      return null;
    }
    const findings = moduleCoreFindings(record.module, manifestModule, assessmentSeedTarget);
    return findings.length === 0 ? record.module : null;
  } catch {
    return null;
  }
}

function progressRecord(modules, status, currentModuleId = null, error = null) {
  return {
    schemaVersion: "1.0",
    updatedAt: new Date().toISOString(),
    courseId,
    provider: "local",
    model: String(process.env.LOCAL_AI_MODEL || "qwen2.5:7b-instruct"),
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    productionContractVersion: PRODUCTION_CONTRACT_VERSION,
    sourceManifestHash: sourceManifestHash(),
    researchHash,
    totalModules: manifestModules.length,
    completedModules: modules.map((module) => module.id),
    currentModuleId,
    status,
    error,
    estimatedModelCostUsd: 0,
  };
}

function assessmentAllocation(total, moduleCount) {
  const base = Math.floor(total / moduleCount);
  let remainder = total % moduleCount;
  return Array.from({ length: moduleCount }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return value;
  });
}

const assessmentContexts = [
  "During an executive governance review",
  "While an operational team is implementing the control",
  "After conflicting evidence is reported",
  "When a business owner requests an exception",
  "During an internal audit readiness review",
  "When a third party changes an important dependency",
  "After a material assumption becomes uncertain",
  "When leadership must choose between speed and reversibility",
  "During a cross-functional escalation",
  "When metrics show the control is not producing the intended outcome",
  "Before approving a policy or process change",
  "When a documented case appears similar but applicability is uncertain",
];

function rotateOptions(options, correctIndex, offset) {
  const values = array(options).slice(0, 4);
  const rotation = offset % values.length;
  const rotated = [...values.slice(rotation), ...values.slice(0, rotation)];
  return {
    options: rotated,
    correctIndex: (correctIndex - rotation + values.length) % values.length,
  };
}

function buildFinalAssessment(modules, requiredQuestions) {
  const allocations = assessmentAllocation(requiredQuestions, modules.length);
  const questions = [];
  for (const [moduleIndex, module] of modules.entries()) {
    const seeds = array(module.assessmentSeeds);
    const target = allocations[moduleIndex];
    for (let index = 0; index < target; index += 1) {
      const seed = seeds[index % seeds.length];
      const variant = Math.floor(index / seeds.length);
      const context = assessmentContexts[(moduleIndex + index) % assessmentContexts.length];
      const rotated = rotateOptions(seed.options, seed.correctIndex, variant + index);
      questions.push({
        question: `${context} in the context of ${module.title}, ${clean(seed.question)}`,
        options: rotated.options,
        correctIndex: rotated.correctIndex,
        rationale: `${clean(seed.rationale)} This version emphasizes evidence, applicability, accountable authority, and a defensible next action in the stated context.`,
        moduleId: module.id,
        cognitiveLevel:
          index % 3 === 0 ? "analysis" : clean(seed.cognitiveLevel) || "application",
        difficulty: index % 4 === 0 ? "advanced" : "professional",
        sourceIds: uniqueStrings(seed.sourceIds).slice(0, 3),
        applicabilityContext: clean(seed.applicabilityContext),
        originalQuestion: true,
        variantIndex: variant + 1,
      });
    }
  }
  return questions.slice(0, requiredQuestions);
}

function sourceRegister() {
  return array(research.authoritativeSources).map((source) => ({
    id: source.id,
    title: source.title,
    issuingAuthority: source.issuingAuthority,
    publication: source.publication,
    sourceType: source.sourceType,
    publicationDate: source.publicationDate,
    status: source.status,
    binding: Boolean(source.binding),
    locator: source.canonicalUrl,
    claimOrTopic: uniqueStrings(source.claimTopics).join("; ") || source.title,
    moduleIds: uniqueStrings(source.moduleIds),
    applicability: source.applicability,
    appliesWhen: uniqueStrings(source.appliesWhen),
    doesNotApplyWhen: uniqueStrings(source.doesNotApplyWhen),
    limitations: uniqueStrings(source.limitations),
    verificationStatus: "verified-from-supplied-source",
    verificationInstruction:
      "Reconfirm the current source version, effective status, exact section, and organization-specific applicability before operational reliance.",
    usageBoundary:
      "Educational and informational use only; not legal advice, certification, attestation, audit evidence, regulatory approval, or proof of compliance.",
  }));
}

function buildCourseContent(modules) {
  const sources = sourceRegister();
  const requiredQuestions = requiredFinalAssessmentQuestions(manifest);
  const allocation = assessmentAllocation(requiredQuestions, modules.length);
  const frameworkTags = uniqueStrings(manifest.tags?.frameworks);
  const finalAssessment = buildFinalAssessment(modules, requiredQuestions);

  return {
    courseSummary: {
      executiveValue: `This course enables ${course.audience} to make defensible decisions about ${course.title} by connecting verified authority, documented cases, accountable implementation, measurable evidence, and proportionate escalation.`,
      instructionalStrategy:
        "Evidence-led professional instruction combines substantive narrative, executive and operational examples, documented cases, realistic constructed scenarios, applied exercises, source applicability, knowledge checks, assessment, learner reflection, and cinematic teaching scripts.",
      sourceAndReviewNotes: [
        "Every externally verifiable claim must remain within the governed research package and its applicability boundaries.",
        "Documented cases are instructional examples and may not be generalized beyond their primary-source facts and legal posture.",
        "Final release remains blocked until independent review, mastered media, accessibility, rights, security, commerce, entitlement, backup, rollback, and owner approval gates pass.",
      ],
    },
    sourceRegister: sources,
    applicabilityMatrix: sources.map((source) => ({
      sourceId: source.id,
      authorityStatus: source.binding ? "binding-when-applicable" : "nonbinding-guidance",
      industries: uniqueStrings(manifest.tags?.industry),
      roles: uniqueStrings(manifest.tags?.audience),
      jurisdictions: ["Verify against the source and the learner's operating jurisdiction."],
      organizationConditions: source.appliesWhen,
      decisionOwners: [
        "Accountable business owner",
        "Legal or compliance owner when applicable",
        "Technology, security, privacy, product, or operational owner as relevant",
      ],
      implementationDependencies: [
        "Verified applicability",
        "Named accountable owner",
        "Approved policy or control design",
        "Evidence and metrics",
        "Exception and escalation process",
      ],
      limitations: source.limitations,
      appliesWhen: source.appliesWhen,
      doesNotApplyWhen: source.doesNotApplyWhen,
    })),
    frameworkAlignment: frameworkTags.map((framework) => ({
      framework,
      applicability: "informational-mapping-only",
      moduleIds: manifestModules.map((module) => module.id),
      alignmentNote:
        "This mapping supports instruction and planning only. Validate the current framework, applicable profile, scope, control text, implementation, evidence, and assurance requirements independently.",
      verificationRequired: true,
    })),
    mediaProductionPlan: {
      standard: "premium-documentary-cinematic",
      provider: "local-piper-plus-ffmpeg",
      estimatedApiCostUsd: 0,
      modules: modules.map((module) => ({
        moduleId: module.id,
        sceneCount: array(module.videoScript?.scenes).length,
        plannedShotCount: array(module.cinematicTreatment?.shots).length,
        sourceCardCount: array(module.cinematicTreatment?.sourceCards).length,
        narrationRequired: true,
        captionsRequired: true,
        transcriptRequired: true,
        audioDescriptionRequired: true,
        reducedMotionAlternativeRequired: true,
        technicalTarget: "1920x1080, H.264, AAC 48 kHz, verified decode and governed loudness",
      })),
      publicationAuthorized: false,
    },
    assessmentBlueprint: {
      totalQuestions: requiredQuestions,
      coverageByModule: manifestModules.map((module, index) => ({
        moduleId: module.id,
        minimumQuestions: allocation[index],
      })),
      cognitiveMix: [
        { level: "application", targetPercent: 50 },
        { level: "analysis", targetPercent: 35 },
        { level: "evaluation", targetPercent: 15 },
      ],
      questionTypeTargets: [
        "scenario-based single best answer",
        "evidence evaluation",
        "prioritization and escalation",
        "applicability and implementation judgment",
      ],
      integrityNotes: [
        "Protect answers, rationales, and instructor notes from unauthorized learner access.",
        "Do not disclose protected answers through the course tutor during graded assessment.",
        "Randomize presentation where supported while preserving source linkage and scoring integrity.",
      ],
      psychometricReviewRequired: true,
    },
    modules: modules.map(({ assessmentSeeds, ...module }) => module),
    finalAssessment,
    learnerWorkbook: modules.map((module) => ({
      moduleId: module.id,
      reflectionPrompts: [
        `Which evidence most changed your judgment in ${module.title}, and why?`,
        "Where could the cited authority or case fail to apply in your organization?",
        "What assumption should be tested before implementation?",
      ],
      decisionWorksheet: [
        "Decision or problem statement",
        "Verified evidence and source status",
        "Applicability and limitations",
        "Accountable owner and decision authority",
        "Options and trade-offs",
        "Recommended action and rationale",
        "Metrics, evidence, exceptions, and escalation",
      ],
      sourceApplicationPrompts: array(module.referenceApplications).map(
        (application) =>
          `${application.claimOrConcept}: document where it applies, where it does not, the implementation dependency, the evidence required, and the owner who must approve reliance.`,
      ),
    })),
    instructorGuide: {
      facilitationNotes: modules.map(
        (module) =>
          `${module.id}: require learners to distinguish verified facts, source status, applicability, assumptions, decision authority, implementation evidence, and escalation before accepting a recommendation.`,
      ),
      commonMisconceptions: [
        "A framework mapping is not certification, compliance validation, legal sufficiency, or assurance.",
        "A documented case does not automatically establish the correct action in a different organization or jurisdiction.",
        "Control implementation is not complete merely because a policy, tool, or checklist exists.",
        "Urgency does not eliminate evidence, authority, privacy, security, accessibility, or documentation requirements.",
      ],
      reviewWarnings: [
        "Stop and correct any invented source, URL, clause, date, statistic, quotation, case fact, or legal obligation.",
        "Do not present constructed scenarios as historical events.",
        "Do not permit publication until all final release and owner-approval gates pass.",
      ],
    },
    certificatePackage: {
      title: "Certificate of Course Completion",
      issuer: legalName,
      issuanceCriteria: [
        "Verified learner entitlement",
        "Completion of all required lessons and activities",
        `Final assessment score of at least ${manifest.completion?.passingScore || 80} percent`,
        "Successful server-side completion processing",
      ],
      verificationFields: [
        "learner name",
        "course identifier and version",
        "completion date",
        "certificate identifier",
        "final score",
        "issuer",
      ],
      transcriptFields: ["course title", "course version", "completion date", "final score"],
      uniqueCertificateIdentificationRequired: true,
      revocationConditions: [
        "Fraud or assessment-integrity violation",
        "Entitlement reversal or administrative correction",
        "Certificate issuance error",
      ],
      retentionRequirements: [
        "Retain attributable issuance and revocation evidence according to approved records policy.",
      ],
      disclaimer:
        "This document records course completion only. It is not professional certification, licensure, accreditation, compliance validation, regulatory approval, an audit opinion, or authorization to practice.",
      isProfessionalCertification: false,
      isComplianceEvidence: false,
      publicationAuthorized: false,
    },
    rightsAndLicensingPlan: {
      originalObserraInstructionRequired: true,
      thirdPartyCoursewareProhibited: true,
      thirdPartyStockAssetsPlanned: false,
      unlicensedMusicProhibited: true,
      sourceQuotationLimitWords: 25,
      localNarrationEngine: "Piper TTS production tool; engine not bundled with learner media",
      localVideoEngine: "FFmpeg original motion-graphic rendering",
      requiredEvidence: [
        "Script hashes",
        "Source identifiers",
        "Original-production attestation",
        "Voice-model and production-tool license records",
        "Final media hashes",
      ],
      syntheticMediaDisclosureRequiredWhenMaterial: true,
    },
    accessibilityPlan: {
      captions: "Final synchronized WebVTT captions required for every module video.",
      transcripts: "Final verified transcript required for every module video.",
      audioDescription:
        "Audio-description text or an approved equivalent is required for instructional visuals.",
      reducedMotion:
        "Provide an equivalent reduced-motion experience without loss of instruction or evidence.",
      keyboardAndNonpointer:
        "All learner controls and activities require keyboard or nonpointer alternatives.",
      readableHierarchy: true,
      colorIndependentMeaning: true,
      alternateDescriptionsRequired: true,
      qualityControlRequired: true,
    },
    productionGateEvidence: {
      research: "governed-primary-source-passed",
      authoring: "module-checkpointed-local-authoring",
      deterministicValidation: "required-before-review",
      independentReview: "required",
      masteredMedia: "required-before-release",
      rights: "required-before-release",
      accessibility: "required-before-release",
      certificateRuntime: "required-before-release",
      entitlementAndSecurity: "required-before-release",
      backupAndRollback: "required-before-release",
      ownerAcceptance: "required-before-publication",
      publicationAuthorized: false,
    },
    marketing: {
      shortDescription: clean(course.description),
      longDescription: `${clean(course.description)} Learners practice evidence evaluation, applicability analysis, accountable decisions, implementation planning, lessons learned, and defensible documentation through original Obserra instruction, governed cases, applied exercises, and professional assessment.`,
      buyerOutcomes: uniqueStrings(course.outcomes),
      seoKeywords: uniqueStrings([
        course.title,
        course.department,
        course.track,
        ...array(manifest.tags?.domain),
        ...frameworkTags,
      ]),
      claimBoundary:
        "Marketing may describe educational outcomes only and may not claim certification, guaranteed results, compliance, legal sufficiency, accreditation, regulatory approval, or third-party endorsement.",
    },
    brand: {
      legalName,
      proprietaryNotice,
      visualSystem:
        "Official Obserra black, dark navy, gold, white, and restrained holographic blue executive design system",
      logoAsset: manifest.branding?.logoAsset,
      logoSha256: manifest.branding?.logoSha256,
    },
  };
}

async function authorModule(manifestModule, assessmentSeedTarget) {
  const reusable = readReusableModule(manifestModule, assessmentSeedTarget);
  if (reusable) {
    console.log(`[Academy Studio] Reused valid module checkpoint ${courseId}/${manifestModule.id}.`);
    return reusable;
  }

  console.log(
    `[Academy Studio] Authoring bounded module ${courseId}/${manifestModule.id} with ${assessmentSeedTarget} assessment seed(s).`,
  );
  atomicWriteJson(
    progressPath,
    progressRecord([], "authoring-module", manifestModule.id),
  );
  const raw = await callLocal(modulePrompt(manifestModule, assessmentSeedTarget), manifestModule.id);
  const parsed = extractJsonObject(raw);
  const normalized = normalizeModule(parsed, manifestModule);
  const findings = moduleCoreFindings(normalized, manifestModule, assessmentSeedTarget);
  if (findings.length > 0) {
    throw new Error(
      `MODULE_AUTHORING_QUALITY_FAILURE course=${courseId} module=${manifestModule.id} findings=${findings.join(",")}`,
    );
  }
  normalized.slideNarrative = buildSlides(normalized);
  normalized.cinematicTreatment = buildCinematicTreatment(normalized);

  const record = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    courseId,
    moduleId: manifestModule.id,
    provider: "local",
    model: String(process.env.LOCAL_AI_MODEL || "qwen2.5:7b-instruct"),
    estimatedModelCostUsd: 0,
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    productionContractVersion: PRODUCTION_CONTRACT_VERSION,
    sourceManifestHash: sourceManifestHash(),
    researchHash,
    moduleHash: stableHash(normalized),
    module: normalized,
  };
  atomicWriteJson(modulePartialPath(manifestModule.id), record);
  console.log(`[Academy Studio] Stored reusable module checkpoint ${courseId}/${manifestModule.id}.`);
  return normalized;
}

async function main() {
  if (fs.existsSync(outputPath) && !force) {
    console.log(
      `[Academy Studio] Preserved existing governed course package for ${courseId}. Use --force to rebuild from reusable module checkpoints.`,
    );
    return;
  }

  fs.mkdirSync(partialRoot, { recursive: true, mode: 0o700 });
  const requiredQuestions = requiredFinalAssessmentQuestions(manifest);
  const assessmentSeedTarget = Math.max(
    6,
    Math.min(12, Math.ceil(requiredQuestions / manifestModules.length / 2)),
  );
  const completedModules = [];
  atomicWriteJson(progressPath, progressRecord(completedModules, "started"));

  try {
    for (const manifestModule of manifestModules) {
      const module = await authorModule(manifestModule, assessmentSeedTarget);
      completedModules.push(module);
      atomicWriteJson(
        progressPath,
        progressRecord(completedModules, "module-complete", manifestModule.id),
      );
    }

    const authored = buildCourseContent(completedModules);
    assertAuthoredPackageReady({ manifest, authored });
    const model = String(
      process.env.LOCAL_AI_MODEL ||
        process.env.ACADEMY_LOCAL_AUTHORING_MODEL ||
        "qwen2.5:7b-instruct",
    ).trim();
    const envelope = {
      schemaVersion: "2.0",
      courseId,
      provider: "local",
      model,
      estimatedModelCostUsd: 0,
      authoringPolicyVersion: AUTHORING_POLICY_VERSION,
      productionContractVersion: PRODUCTION_CONTRACT_VERSION,
      productionStandard: "premium-documentary-cinematic",
      generatedAt: new Date().toISOString(),
      sourceManifestHash: sourceManifestHash(),
      sourceContextHash: researchHash,
      sourceContextFiles: [
        {
          file: path.relative(courseDir, researchPath).replaceAll("\\", "/"),
          sha256: crypto.createHash("sha256").update(fs.readFileSync(researchPath)).digest("hex"),
          truncated: false,
        },
      ],
      moduleCheckpointCount: completedModules.length,
      moduleCheckpointPaths: manifestModules.map((module) =>
        path
          .relative(courseDir, modulePartialPath(module.id))
          .replaceAll("\\", "/"),
      ),
      reviewStatus: "draft-ai-generated-compliance-staging",
      publicationAuthorized: false,
      legalName,
      proprietaryNotice,
      content: authored,
    };
    atomicWriteJson(outputPath, envelope);
    atomicWriteJson(progressPath, progressRecord(completedModules, "complete"));
    if (fs.existsSync(remediationPath)) fs.rmSync(remediationPath, { force: true });
    console.log(
      `[Academy Studio] Assembled governed cinematic course package for ${courseId} from ${completedModules.length} reusable local module checkpoint(s) under policy ${AUTHORING_POLICY_VERSION}. Publication remains unauthorized.`,
    );
  } catch (error) {
    atomicWriteJson(
      progressPath,
      progressRecord(
        completedModules,
        "failed",
        completedModules.at(-1)?.id || null,
        error instanceof Error ? error.message : String(error),
      ),
    );
    throw error;
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[Academy Studio] MODULAR_LOCAL_AUTHORING_FAILURE course=${courseId}: ${message.replace(/\s+/g, " ").slice(0, 3000)}`,
  );
  process.exitCode = 1;
}
