import "./academy-zero-cost-lock.mjs";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  countWords,
  requiredFinalAssessmentQuestions,
} from "./academy-authoring-quality-contract.mjs";
import { authoredPackageFindings } from "./validate-authored-package.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course");
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error("Usage: node studio/review-course-quality.mjs --course <course-id>");
}
const provider = String(process.env.ACADEMY_REVIEW_PROVIDER || "local").trim().toLowerCase();
if (provider !== "local") {
  throw new Error(`The zero-cost Academy review route permits only local review; received ${provider}.`);
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
const researchPath = path.join(
  courseDir,
  "generated",
  "research",
  "authoritative-source-research.json",
);
const deterministicGatePath = path.join(
  courseDir,
  "generated",
  "quality",
  "deterministic-local-course-gate.json",
);
for (const filePath of [manifestPath, packagePath, researchPath, deterministicGatePath]) {
  if (!fs.existsSync(filePath)) throw new Error(`Required review input missing: ${filePath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const researchEvidence = JSON.parse(fs.readFileSync(researchPath, "utf8"));
const deterministicGate = JSON.parse(fs.readFileSync(deterministicGatePath, "utf8"));
const authored = envelope.content || {};
const research = researchEvidence.research || {};

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function normalizedTokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4);
}

function sentenceList(value) {
  return clean(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.split(" ").length >= 8);
}

function paragraphList(value) {
  return String(value || "")
    .split(/\n\s*\n/)
    .map(clean)
    .filter(Boolean);
}

function shingleSet(value, size = 5) {
  const tokens = normalizedTokens(value);
  const shingles = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    shingles.add(tokens.slice(index, index + size).join(" "));
  }
  return shingles;
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

function duplicateSentenceRatio(value) {
  const sentences = sentenceList(value);
  if (!sentences.length) return 1;
  return 1 - new Set(sentences).size / sentences.length;
}

function sourceIdsIn(value) {
  const ids = [];
  if (!value || typeof value !== "object") return ids;
  if (Array.isArray(value)) {
    for (const item of value) ids.push(...sourceIdsIn(item));
    return ids;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "sourceIds" && Array.isArray(item)) ids.push(...item.map(String));
    else ids.push(...sourceIdsIn(item));
  }
  return ids;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

const expectedModules = array(manifest.course?.modules);
const authoredModules = array(authored.modules);
const authoredById = new Map(authoredModules.map((module) => [String(module.id), module]));
const researchByModule = new Map(
  array(research.moduleResearch).map((item) => [String(item.moduleId), item]),
);
const researchSources = new Map(
  array(research.authoritativeSources).map((source) => [String(source.id), source]),
);
const researchCases = new Map(
  array(research.documentedCases).map((item) => [String(item.id), item]),
);
const packageSources = new Map(
  array(authored.sourceRegister).map((source) => [String(source.id), source]),
);

const dimensionFindings = {
  factualGrounding: [],
  sourceApplicability: [],
  instructionalDepth: [],
  realWorldExamples: [],
  lessonsLearned: [],
  implementationRecommendations: [],
  assessmentQuality: [],
  learnerMaterialsCoherence: [],
  instructorUsability: [],
  videoScriptSubstance: [],
};
const criticalFindings = [];
const sourceFindings = [];
const requiredCorrections = [];
const moduleReviews = [];

function finding(dimension, code, critical = false) {
  dimensionFindings[dimension].push(code);
  requiredCorrections.push(code);
  if (critical) criticalFindings.push(code);
}

if (researchEvidence.passed !== true || array(researchEvidence.unresolvedTopics).length > 0) {
  finding("factualGrounding", "authoritative-research-not-passed-or-unresolved", true);
}
if (deterministicGate.passed !== true || array(deterministicGate.findings).length > 0) {
  finding("instructionalDepth", "deterministic-production-gate-not-passed", true);
}
for (const code of authoredPackageFindings({ manifest, authored })) {
  finding("instructionalDepth", `authoring-contract:${code}`);
}

if (researchSources.size < Math.max(4, expectedModules.length)) {
  finding(
    "factualGrounding",
    `verified-source-count-${researchSources.size}-minimum-${Math.max(4, expectedModules.length)}`,
  );
}
if (researchCases.size < 2) {
  finding("realWorldExamples", `documented-case-count-${researchCases.size}-minimum-2`);
}
for (const [sourceId, source] of packageSources) {
  const governed = researchSources.get(sourceId);
  if (!governed) {
    const code = `source-${sourceId}-not-in-governed-research`;
    sourceFindings.push(code);
    finding("factualGrounding", code, true);
    continue;
  }
  if (source.locator !== governed.canonicalUrl) {
    const code = `source-${sourceId}-locator-does-not-match-governed-source`;
    sourceFindings.push(code);
    finding("factualGrounding", code, true);
  }
  if (source.title !== governed.title || source.issuingAuthority !== governed.issuingAuthority) {
    const code = `source-${sourceId}-identity-does-not-match-governed-source`;
    sourceFindings.push(code);
    finding("factualGrounding", code, true);
  }
  if (source.verificationStatus !== "verified-from-supplied-source") {
    finding("factualGrounding", `source-${sourceId}-not-verified`);
  }
  if (
    !array(source.appliesWhen).length ||
    !array(source.doesNotApplyWhen).length ||
    !array(source.limitations).length
  ) {
    finding("sourceApplicability", `source-${sourceId}-applicability-boundary-incomplete`);
  }
}

const narrativeShingles = new Map();
for (const manifestModule of expectedModules) {
  const moduleId = String(manifestModule.id);
  const module = authoredById.get(moduleId);
  const moduleIssues = {
    factualIssues: [],
    depthIssues: [],
    exampleIssues: [],
    lessonsLearnedIssues: [],
    implementationIssues: [],
    assessmentIssues: [],
    videoContentIssues: [],
    strengths: [],
  };
  if (!module) {
    const code = `module-${moduleId}-missing`;
    finding("instructionalDepth", code, true);
    moduleIssues.depthIssues.push(code);
    moduleReviews.push({ moduleId, passed: false, ...moduleIssues });
    continue;
  }

  const mapping = researchByModule.get(moduleId);
  if (!mapping) {
    const code = `module-${moduleId}-missing-governed-research-map`;
    finding("factualGrounding", code, true);
    moduleIssues.factualIssues.push(code);
  }
  const allowedSourceIds = new Set(array(mapping?.sourceIds).map(String));
  const allowedCaseIds = new Set(array(mapping?.caseIds).map(String));
  for (const sourceId of sourceIdsIn(module)) {
    if (!researchSources.has(sourceId)) {
      const code = `module-${moduleId}-unknown-source-${sourceId}`;
      finding("factualGrounding", code, true);
      moduleIssues.factualIssues.push(code);
    }
  }

  const narrativeWords = countWords(module.lessonNarrative);
  if (narrativeWords < 1_200) {
    const code = `module-${moduleId}-narrative-${narrativeWords}-minimum-1200`;
    finding("instructionalDepth", code);
    moduleIssues.depthIssues.push(code);
  }
  const paragraphs = paragraphList(module.lessonNarrative);
  if (paragraphs.length < 8) {
    const code = `module-${moduleId}-narrative-paragraphs-${paragraphs.length}-minimum-8`;
    finding("instructionalDepth", code);
    moduleIssues.depthIssues.push(code);
  }
  const repeatedRatio = duplicateSentenceRatio(module.lessonNarrative);
  if (repeatedRatio > 0.08) {
    const code = `module-${moduleId}-repeated-sentence-ratio-${repeatedRatio.toFixed(3)}`;
    finding("instructionalDepth", code);
    moduleIssues.depthIssues.push(code);
  }
  const moduleTerms = new Set(
    normalizedTokens(`${manifestModule.title} ${manifestModule.description}`).filter(
      (token) => !["course", "module", "original", "academy", "instruction"].includes(token),
    ),
  );
  const narrativeTerms = new Set(normalizedTokens(module.lessonNarrative));
  const termOverlap = [...moduleTerms].filter((token) => narrativeTerms.has(token)).length;
  if (moduleTerms.size > 0 && termOverlap < Math.min(3, moduleTerms.size)) {
    const code = `module-${moduleId}-insufficient-topic-specificity-${termOverlap}`;
    finding("instructionalDepth", code);
    moduleIssues.depthIssues.push(code);
  }
  narrativeShingles.set(moduleId, shingleSet(module.lessonNarrative));

  if (countWords(module.executiveExample) < 60 || countWords(module.operationalExample) < 60) {
    const code = `module-${moduleId}-example-depth-deficiency`;
    finding("realWorldExamples", code);
    moduleIssues.exampleIssues.push(code);
  }
  const exampleSimilarity = jaccard(
    shingleSet(module.executiveExample, 4),
    shingleSet(module.operationalExample, 4),
  );
  if (exampleSimilarity > 0.55) {
    const code = `module-${moduleId}-executive-operational-example-similarity-${exampleSimilarity.toFixed(3)}`;
    finding("realWorldExamples", code);
    moduleIssues.exampleIssues.push(code);
  }
  if (
    countWords(module.scenario?.situation) < 80 ||
    countWords(module.scenario?.recommendedApproach) < 80 ||
    countWords(module.scenario?.debrief) < 80
  ) {
    const code = `module-${moduleId}-scenario-depth-deficiency`;
    finding("realWorldExamples", code);
    moduleIssues.exampleIssues.push(code);
  }

  if (!array(mapping?.lessonsLearned).length) {
    const code = `module-${moduleId}-governed-lessons-learned-missing`;
    finding("lessonsLearned", code);
    moduleIssues.lessonsLearnedIssues.push(code);
  }
  if (!array(mapping?.implementationRecommendations).length) {
    const code = `module-${moduleId}-governed-implementation-recommendations-missing`;
    finding("implementationRecommendations", code);
    moduleIssues.implementationIssues.push(code);
  }
  const applications = array(module.referenceApplications);
  if (
    applications.length < 3 ||
    applications.some(
      (item) =>
        countWords(item?.learnerAction) < 10 ||
        !array(item?.appliesWhen).length ||
        !array(item?.doesNotApplyWhen).length ||
        !array(item?.limitations).length ||
        !array(item?.sourceIds).some((id) => allowedSourceIds.has(String(id))),
    )
  ) {
    const code = `module-${moduleId}-reference-application-deficiency`;
    finding("implementationRecommendations", code);
    moduleIssues.implementationIssues.push(code);
  }

  const checks = array(module.knowledgeChecks);
  if (
    checks.length < 4 ||
    checks.some(
      (item) =>
        array(item?.options).length < 4 ||
        !Number.isInteger(item?.correctIndex) ||
        item.correctIndex < 0 ||
        item.correctIndex >= array(item.options).length ||
        countWords(item?.rationale) < 8 ||
        !array(item?.sourceIds).some((id) => allowedSourceIds.has(String(id))),
    )
  ) {
    const code = `module-${moduleId}-knowledge-check-deficiency`;
    finding("assessmentQuality", code);
    moduleIssues.assessmentIssues.push(code);
  }

  const scenes = array(module.videoScript?.scenes);
  if (
    scenes.length < 8 ||
    scenes.some(
      (scene) =>
        countWords(scene?.narration) < 20 ||
        !clean(scene?.visual || scene?.altDescription) ||
        !array(scene?.sourceIds).some((id) => allowedSourceIds.has(String(id))),
    )
  ) {
    const code = `module-${moduleId}-video-scene-substance-deficiency`;
    finding("videoScriptSubstance", code);
    moduleIssues.videoContentIssues.push(code);
  }
  const uniqueSceneNarrations = new Set(scenes.map((scene) => clean(scene?.narration).toLowerCase()));
  if (scenes.length && uniqueSceneNarrations.size !== scenes.length) {
    const code = `module-${moduleId}-duplicate-video-narration`;
    finding("videoScriptSubstance", code);
    moduleIssues.videoContentIssues.push(code);
  }
  if (
    array(module.cinematicTreatment?.shots).length < 8 ||
    array(module.cinematicTreatment?.sourceCards).length < 2
  ) {
    const code = `module-${moduleId}-cinematic-shot-or-source-card-deficiency`;
    finding("videoScriptSubstance", code);
    moduleIssues.videoContentIssues.push(code);
  }

  if (!allowedCaseIds.size && researchCases.size > 0) {
    const code = `module-${moduleId}-no-relevant-documented-case-mapping`;
    finding("realWorldExamples", code);
    moduleIssues.exampleIssues.push(code);
  }

  if (
    !moduleIssues.factualIssues.length &&
    !moduleIssues.depthIssues.length &&
    !moduleIssues.exampleIssues.length &&
    !moduleIssues.lessonsLearnedIssues.length &&
    !moduleIssues.implementationIssues.length &&
    !moduleIssues.assessmentIssues.length &&
    !moduleIssues.videoContentIssues.length
  ) {
    moduleIssues.strengths.push(
      "Passed source, depth, example, implementation, assessment, and video-substance checks.",
    );
  }
  moduleReviews.push({
    moduleId,
    passed:
      !moduleIssues.factualIssues.length &&
      !moduleIssues.depthIssues.length &&
      !moduleIssues.exampleIssues.length &&
      !moduleIssues.lessonsLearnedIssues.length &&
      !moduleIssues.implementationIssues.length &&
      !moduleIssues.assessmentIssues.length &&
      !moduleIssues.videoContentIssues.length,
    ...moduleIssues,
  });
}

for (let leftIndex = 0; leftIndex < expectedModules.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < expectedModules.length; rightIndex += 1) {
    const leftId = String(expectedModules[leftIndex].id);
    const rightId = String(expectedModules[rightIndex].id);
    const similarity = jaccard(
      narrativeShingles.get(leftId) || new Set(),
      narrativeShingles.get(rightId) || new Set(),
    );
    if (similarity > 0.45) {
      finding(
        "instructionalDepth",
        `cross-module-narrative-similarity-${leftId}-${rightId}-${similarity.toFixed(3)}`,
      );
    }
  }
}

const finalAssessment = array(authored.finalAssessment);
const requiredAssessment = requiredFinalAssessmentQuestions(manifest);
if (finalAssessment.length < requiredAssessment) {
  finding(
    "assessmentQuality",
    `final-assessment-${finalAssessment.length}-minimum-${requiredAssessment}`,
  );
}
const assessmentTexts = finalAssessment.map((item) => clean(item?.question).toLowerCase());
if (new Set(assessmentTexts).size !== assessmentTexts.length) {
  finding("assessmentQuality", "duplicate-final-assessment-question-text");
}
const correctIndexCounts = new Map();
for (const item of finalAssessment) {
  const index = Number(item?.correctIndex);
  correctIndexCounts.set(index, (correctIndexCounts.get(index) || 0) + 1);
  if (
    !authoredById.has(String(item?.moduleId)) ||
    array(item?.options).length < 4 ||
    !Number.isInteger(item?.correctIndex) ||
    item.correctIndex < 0 ||
    item.correctIndex >= array(item.options).length ||
    countWords(item?.rationale) < 10 ||
    !array(item?.sourceIds).length ||
    array(item.sourceIds).some((sourceId) => !researchSources.has(String(sourceId)))
  ) {
    finding("assessmentQuality", `assessment-item-${finalAssessment.indexOf(item) + 1}-deficiency`);
  }
}
if (finalAssessment.length) {
  const largestCorrectIndexShare = Math.max(...correctIndexCounts.values()) / finalAssessment.length;
  if (largestCorrectIndexShare > 0.45) {
    finding(
      "assessmentQuality",
      `correct-answer-position-concentration-${largestCorrectIndexShare.toFixed(3)}`,
    );
  }
}
for (const module of expectedModules) {
  const count = finalAssessment.filter((item) => String(item.moduleId) === String(module.id)).length;
  if (count < 1) finding("assessmentQuality", `assessment-missing-module-${module.id}`);
}

const workbook = new Map(
  array(authored.learnerWorkbook).map((item) => [String(item.moduleId), item]),
);
for (const module of expectedModules) {
  const item = workbook.get(String(module.id));
  if (
    !item ||
    array(item.reflectionPrompts).length < 2 ||
    array(item.decisionWorksheet).length < 4 ||
    array(item.sourceApplicationPrompts).length < 1
  ) {
    finding("learnerMaterialsCoherence", `workbook-${module.id}-deficiency`);
  }
}
if (
  array(authored.instructorGuide?.facilitationNotes).length < expectedModules.length ||
  array(authored.instructorGuide?.commonMisconceptions).length < 3 ||
  array(authored.instructorGuide?.reviewWarnings).length < 3
) {
  finding("instructorUsability", "instructor-guide-depth-deficiency");
}
if (
  authored.certificatePackage?.isProfessionalCertification !== false ||
  authored.certificatePackage?.isComplianceEvidence !== false ||
  authored.certificatePackage?.publicationAuthorized !== false
) {
  finding("learnerMaterialsCoherence", "certificate-governance-boundary-deficiency", true);
}
if (!authored.accessibilityPlan || !authored.rightsAndLicensingPlan) {
  finding("learnerMaterialsCoherence", "accessibility-or-rights-plan-missing");
}

function scoreFor(dimension) {
  const count = dimensionFindings[dimension].length;
  return count === 0 ? 100 : Math.max(0, 100 - count * 10);
}

const scores = Object.fromEntries(
  Object.keys(dimensionFindings).map((dimension) => [dimension, scoreFor(dimension)]),
);
const normalizedRequiredCorrections = unique(requiredCorrections);
const normalizedCriticalFindings = unique(criticalFindings);
const passed =
  normalizedRequiredCorrections.length === 0 &&
  normalizedCriticalFindings.length === 0 &&
  moduleReviews.length === expectedModules.length &&
  moduleReviews.every((module) => module.passed) &&
  Object.values(scores).every((score) => Number.isInteger(score) && score >= 90);

const review = {
  courseId,
  scores,
  moduleReviews,
  sourceFindings: unique(sourceFindings),
  criticalFindings: normalizedCriticalFindings,
  requiredCorrections: normalizedRequiredCorrections,
  passed,
};
const evidence = {
  schemaVersion: "1.3",
  generatedAt: new Date().toISOString(),
  courseId,
  provider: "local",
  model: "deterministic-independent-quality-auditor-v1",
  estimatedModelCostUsd: 0,
  webSearchUsed: false,
  localEvidenceOnlyReview: true,
  deterministicProductionGateRequired: true,
  minimumScore: 90,
  findings: normalizedRequiredCorrections,
  passed,
  review,
};
writeJsonAtomic(
  path.join(courseDir, "generated", "quality", "independent-course-quality-review.json"),
  evidence,
);
console.log(
  `[Academy Studio] Independent deterministic quality review ${passed ? "PASSED" : "FAILED"} for ${courseId}: ${normalizedRequiredCorrections.length} correction(s), ${normalizedCriticalFindings.length} critical finding(s).`,
);
if (!passed) {
  for (const correction of normalizedRequiredCorrections.slice(0, 150)) {
    console.error(`[Academy Studio] ${courseId}: ${correction}`);
  }
  process.exit(2);
}
