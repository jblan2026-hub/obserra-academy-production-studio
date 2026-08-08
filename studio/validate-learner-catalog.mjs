import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, "catalog", "academy-learner-course-catalog.json");
const expectedReviewCourses = Number(process.env.ACADEMY_EXPECTED_REVIEW_COURSES || 60);
const requiredAuthoringPolicyVersion = "2026.08.07.3";
const allowedClassifications = new Set([
  "binding-requirement",
  "voluntary-guidance",
  "organizational-policy",
  "recommended-practice",
  "documented-public-case",
  "original-obserra-instruction",
  "synthetic-scenario",
]);
const allowedCitationStatuses = new Set([
  "verification-required",
  "verified",
  "not-external-source",
]);
const acceptedVerificationStatuses = new Set([
  "verification-required",
  "verified",
  "not-external-source",
]);

function text(value) {
  return String(value ?? "").trim();
}

function wordCount(value) {
  const normalized = text(value);
  return normalized ? normalized.split(/\s+/).length : 0;
}

function isArray(value, minimum = 0) {
  return Array.isArray(value) && value.length >= minimum;
}

function validStringArray(value, minimum = 1) {
  return isArray(value, minimum) && value.every((item) => text(item));
}

function validIdArray(value, validIds, minimum = 1) {
  return validStringArray(value, minimum) && value.every((item) => validIds.has(item));
}

function addFinding(collection, value) {
  collection.push(value);
}

function validateApplicability(applicability, prefix, findings) {
  if (!applicability || typeof applicability !== "object" || Array.isArray(applicability)) {
    addFinding(findings, `${prefix}:missing-applicability`);
    return;
  }
  for (const field of [
    "appliesTo",
    "appliesWhen",
    "doesNotApplyWhen",
    "roles",
    "industries",
    "geographies",
    "systemsOrProcesses",
    "lifecyclePhases",
  ]) {
    if (!validStringArray(applicability[field], 1)) {
      addFinding(findings, `${prefix}:missing-applicability-${field}`);
    }
  }
}

if (!fs.existsSync(catalogPath)) throw new Error(`Learner catalog not found: ${catalogPath}`);
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const courses = Array.isArray(catalog.courses) ? catalog.courses : [];
const findings = [];
const releaseBlockers = [];
const courseSummaries = [];

if (catalog.schemaVersion !== "1.3") findings.push(`unsupported-learner-catalog-schema-${catalog.schemaVersion ?? "missing"}`);
if (catalog.workerContract?.contractId !== workerPoolContract.contractId
    || catalog.workerContract?.contractHash !== contractHash()) {
  findings.push("learner-catalog-worker-contract-mismatch");
}
if (catalog.productionStandard?.standardId !== commercialProductionStandard.standardId
    || catalog.productionStandard?.standardHash !== commercialProductionStandardHash()
    || catalog.productionStandard?.qualityTier !== commercialProductionStandard.qualityTier
    || catalog.productionStandard?.qualityClaimAllowedOnlyAfterAcceptance !== true) {
  findings.push("learner-catalog-production-standard-mismatch");
}
if (courses.length !== expectedReviewCourses) {
  findings.push(`expected-${expectedReviewCourses}-owner-review-courses-found-${courses.length}`);
}

for (const course of courses) {
  const prefix = course.id || course.title || "unknown-course";
  const experience = course.learnerExperience ?? {};
  const modules = experience.modules ?? [];
  const sourceRegister = experience.sourceRegister ?? [];
  const applicabilityMatrix = experience.referenceApplicabilityMatrix ?? [];
  const frameworkAlignment = experience.frameworkAlignment;
  const blueprint = experience.assessmentBlueprint;
  const courseFindings = [];
  const courseReleaseBlockers = [];

  if (course.access?.ownerReviewEligible !== true) courseFindings.push(`${prefix}:owner-review-not-eligible`);
  if (!course.authoring?.available) courseFindings.push(`${prefix}:missing-authored-package`);
  if (course.authoring?.envelopeSchemaVersion !== "1.3") courseFindings.push(`${prefix}:unsupported-authoring-envelope`);
  if (!course.authoring?.sourceManifestHash) courseFindings.push(`${prefix}:missing-source-manifest-hash`);
  if (course.authoring?.authoringPolicyVersion !== requiredAuthoringPolicyVersion) courseFindings.push(`${prefix}:outdated-authoring-policy`);
  if (course.authoring?.commercialQualityStatus !== commercialProductionStandard.claimPolicy.interimLabel) {
    courseFindings.push(`${prefix}:invalid-commercial-quality-status`);
  }
  if (course.authoring?.workerContract?.contractId !== workerPoolContract.contractId
      || course.authoring?.workerContract?.contractHash !== contractHash()) {
    courseFindings.push(`${prefix}:worker-contract-mismatch`);
  }
  if (course.authoring?.productionStandard?.standardId !== commercialProductionStandard.standardId
      || course.authoring?.productionStandard?.standardHash !== commercialProductionStandardHash()
      || course.authoring?.productionStandard?.qualityTier !== commercialProductionStandard.qualityTier
      || course.authoring?.productionStandard?.qualityClaimAllowed !== false) {
    courseFindings.push(`${prefix}:production-standard-mismatch`);
  }

  if (!experience.courseSummary) courseFindings.push(`${prefix}:missing-course-summary`);
  if (!text(experience.courseSummary?.executiveValue)) courseFindings.push(`${prefix}:missing-executive-value`);
  if (!text(experience.courseSummary?.instructionalStrategy)) courseFindings.push(`${prefix}:missing-instructional-strategy`);
  if (!text(experience.courseSummary?.commercialExperience)) courseFindings.push(`${prefix}:missing-commercial-experience`);

  const bible = experience.courseProductionBible;
  if (!bible) courseFindings.push(`${prefix}:missing-course-production-bible`);
  for (const field of [
    "creativeIntent",
    "audienceExperience",
    "visualLanguage",
    "cinematography",
    "motionGraphicsLanguage",
    "soundAndMusicDirection",
    "sourceCardTreatment",
    "accessibilityTreatment",
    "rightsAndSyntheticMediaTreatment",
  ]) {
    if (!text(bible?.[field])) courseFindings.push(`${prefix}:production-bible-missing-${field}`);
  }
  if (!validStringArray(bible?.narrativeArc, 3)) courseFindings.push(`${prefix}:production-bible-insufficient-narrative-arc`);

  if (!isArray(sourceRegister, 1)) courseFindings.push(`${prefix}:missing-source-register`);
  if (!isArray(applicabilityMatrix, 1)) courseFindings.push(`${prefix}:missing-reference-applicability-matrix`);
  if (!Array.isArray(frameworkAlignment)) courseFindings.push(`${prefix}:missing-framework-alignment-array`);
  if (!blueprint || !isArray(blueprint.coverageByModule, 1)) courseFindings.push(`${prefix}:missing-assessment-blueprint`);
  if (!isArray(blueprint?.coverageByObjective, 1)) courseFindings.push(`${prefix}:missing-assessment-objective-coverage`);
  if (!isArray(blueprint?.cognitiveMix, 1)) courseFindings.push(`${prefix}:missing-assessment-cognitive-mix`);
  if (!validStringArray(blueprint?.integrityNotes, 1)) courseFindings.push(`${prefix}:missing-assessment-integrity-notes`);
  if (!modules.length) courseFindings.push(`${prefix}:missing-learner-modules`);
  if (modules.length !== course.moduleCount) courseFindings.push(`${prefix}:module-count-mismatch`);

  const sourceIds = new Set();
  const sourceById = new Map();
  for (const [index, source] of sourceRegister.entries()) {
    const sourcePrefix = `${prefix}/source-${index + 1}`;
    const sourceId = text(source?.id);
    if (!sourceId) courseFindings.push(`${sourcePrefix}:missing-id`);
    else if (sourceIds.has(sourceId)) courseFindings.push(`${sourcePrefix}:duplicate-id-${sourceId}`);
    else {
      sourceIds.add(sourceId);
      sourceById.set(sourceId, source);
    }
    if (!allowedCitationStatuses.has(source?.citationStatus)) courseFindings.push(`${sourcePrefix}:invalid-citation-status`);
    for (const field of [
      "sourceType",
      "sourceTitle",
      "issuingAuthority",
      "versionOrPublicationDate",
      "urlOrLocator",
      "jurisdictionOrScope",
      "requirementClassification",
      "claimOrTopic",
      "limitations",
      "verificationInstruction",
      "usageBoundary",
    ]) {
      if (!text(source?.[field])) courseFindings.push(`${sourcePrefix}:missing-${field}`);
    }
    if (!allowedClassifications.has(source?.requirementClassification)) {
      courseFindings.push(`${sourcePrefix}:invalid-requirement-classification`);
    }
    if (!isArray(source?.moduleIds, 1)) courseFindings.push(`${sourcePrefix}:missing-module-ids`);
    if (!isArray(source?.claimIds, 1)) courseFindings.push(`${sourcePrefix}:missing-claim-ids`);
    validateApplicability(source?.applicability, sourcePrefix, courseFindings);

    const external = !["original-obserra-instruction", "synthetic-scenario"].includes(source?.requirementClassification);
    if (external && source?.citationStatus !== "verified") {
      courseReleaseBlockers.push(`${sourcePrefix}:external-reference-not-verified`);
    }
    if (external && text(source?.urlOrLocator).toLowerCase() === "to-be-resolved") {
      courseReleaseBlockers.push(`${sourcePrefix}:authoritative-locator-unresolved`);
    }
    if (external && source?.citationStatus === "verified" && !text(source?.retrievalOrVerificationDate)) {
      courseReleaseBlockers.push(`${sourcePrefix}:verification-date-missing`);
    }
  }

  const moduleIds = new Set(modules.map((module) => module.id));
  const objectiveIds = new Set();
  const claimIds = new Set();
  const assessmentIds = new Set();
  const videoSceneIds = new Set();
  const blueprintModuleIds = new Set((blueprint?.coverageByModule ?? []).map((entry) => entry.moduleId));
  for (const moduleId of moduleIds) {
    if (!blueprintModuleIds.has(moduleId)) courseFindings.push(`${prefix}:assessment-blueprint-missing-${moduleId}`);
  }

  for (const module of modules) {
    const modulePrefix = `${prefix}/${module.id || module.sequence || "module"}`;
    const assessmentModule = String(module.format ?? "").toLowerCase() === "assessment";
    const minimumNarrativeWords = assessmentModule ? 300 : 1400;
    if (wordCount(module.lessonNarrative) < minimumNarrativeWords) {
      courseFindings.push(`${modulePrefix}:lesson-narrative-below-${minimumNarrativeWords}-words`);
    }
    if (!isArray(module.learningObjectives, 3)) courseFindings.push(`${modulePrefix}:insufficient-learning-objectives`);
    for (const [index, objective] of (module.learningObjectives ?? []).entries()) {
      const objectivePrefix = `${modulePrefix}/objective-${index + 1}`;
      const id = text(objective?.id);
      if (!id) courseFindings.push(`${objectivePrefix}:missing-id`);
      else if (objectiveIds.has(id)) courseFindings.push(`${objectivePrefix}:duplicate-id-${id}`);
      else objectiveIds.add(id);
      if (!text(objective?.statement)) courseFindings.push(`${objectivePrefix}:missing-statement`);
      if (!text(objective?.evidenceOfLearning)) courseFindings.push(`${objectivePrefix}:missing-evidence-of-learning`);
    }

    const minimumClaims = assessmentModule ? 2 : 6;
    if (!isArray(module.claimRegister, minimumClaims)) courseFindings.push(`${modulePrefix}:insufficient-claim-register`);
    for (const [index, claim] of (module.claimRegister ?? []).entries()) {
      const claimPrefix = `${modulePrefix}/claim-${index + 1}`;
      const id = text(claim?.id);
      if (!id) courseFindings.push(`${claimPrefix}:missing-id`);
      else if (claimIds.has(id)) courseFindings.push(`${claimPrefix}:duplicate-id-${id}`);
      else claimIds.add(id);
      if (!text(claim?.statement)) courseFindings.push(`${claimPrefix}:missing-statement`);
      if (!allowedClassifications.has(claim?.classification)) courseFindings.push(`${claimPrefix}:invalid-classification`);
      if (!acceptedVerificationStatuses.has(claim?.verificationStatus)) courseFindings.push(`${claimPrefix}:invalid-verification-status`);
      if (!validIdArray(claim?.sourceIds, sourceIds, 1)) courseFindings.push(`${claimPrefix}:invalid-or-missing-source-ids`);
      validateApplicability(claim?.applicability, claimPrefix, courseFindings);
      if (!text(claim?.limitations)) courseFindings.push(`${claimPrefix}:missing-limitations`);
    }

    if (!isArray(module.keyConcepts, 5)) courseFindings.push(`${modulePrefix}:insufficient-key-concepts`);
    for (const [index, concept] of (module.keyConcepts ?? []).entries()) {
      const conceptPrefix = `${modulePrefix}/concept-${index + 1}`;
      if (!text(concept?.term) || !text(concept?.explanation)) courseFindings.push(`${conceptPrefix}:missing-content`);
      if (!validIdArray(concept?.claimIds, claimIds, 1)) courseFindings.push(`${conceptPrefix}:invalid-claim-ids`);
      if (!validIdArray(concept?.sourceIds, sourceIds, 1)) courseFindings.push(`${conceptPrefix}:invalid-source-ids`);
    }

    for (const [name, example] of [["executive-example", module.executiveExample], ["operational-example", module.operationalExample]]) {
      if (!text(example?.narrative)) courseFindings.push(`${modulePrefix}:${name}-missing-narrative`);
      if (!validIdArray(example?.claimIds, claimIds, 1)) courseFindings.push(`${modulePrefix}:${name}-invalid-claim-ids`);
      if (!validIdArray(example?.sourceIds, sourceIds, 1)) courseFindings.push(`${modulePrefix}:${name}-invalid-source-ids`);
      if (!text(example?.applicabilityNote)) courseFindings.push(`${modulePrefix}:${name}-missing-applicability-note`);
    }

    if (!module.scenario) courseFindings.push(`${modulePrefix}:missing-scenario`);
    if (module.scenario?.classification !== "synthetic-scenario") courseFindings.push(`${modulePrefix}:scenario-not-labeled-synthetic`);
    for (const field of ["situation", "decisionPrompt", "recommendedApproach", "debrief", "applicabilityNote"]) {
      if (!text(module.scenario?.[field])) courseFindings.push(`${modulePrefix}:scenario-missing-${field}`);
    }
    if (!isArray(module.scenario?.evidence, 2)) courseFindings.push(`${modulePrefix}:scenario-insufficient-evidence`);
    if (!validIdArray(module.scenario?.sourceIds, sourceIds, 1)) courseFindings.push(`${modulePrefix}:scenario-invalid-source-ids`);

    if (!module.exercise) courseFindings.push(`${modulePrefix}:missing-exercise`);
    if (!text(module.exercise?.instructions) || !text(module.exercise?.deliverable)) courseFindings.push(`${modulePrefix}:exercise-incomplete`);
    if (!validStringArray(module.exercise?.rubric, 3)) courseFindings.push(`${modulePrefix}:exercise-insufficient-rubric`);
    if (!validIdArray(module.exercise?.objectiveIds, objectiveIds, 1)) courseFindings.push(`${modulePrefix}:exercise-invalid-objective-ids`);
    if (!validIdArray(module.exercise?.sourceIds, sourceIds, 1)) courseFindings.push(`${modulePrefix}:exercise-invalid-source-ids`);

    if (!isArray(module.knowledgeChecks, 5)) courseFindings.push(`${modulePrefix}:insufficient-knowledge-checks`);
    for (const [index, question] of (module.knowledgeChecks ?? []).entries()) {
      const questionPrefix = `${modulePrefix}/knowledge-check-${index + 1}`;
      if (!text(question?.id) || !text(question?.question) || !text(question?.rationale)) courseFindings.push(`${questionPrefix}:missing-content`);
      if (!isArray(question?.options, 3)) courseFindings.push(`${questionPrefix}:insufficient-options`);
      if (!Number.isInteger(question?.correctIndex) || question.correctIndex < 0 || question.correctIndex >= (question.options?.length ?? 0)) courseFindings.push(`${questionPrefix}:invalid-correct-index`);
      if (!validIdArray(question?.objectiveIds, objectiveIds, 1)) courseFindings.push(`${questionPrefix}:invalid-objective-ids`);
      if (!validIdArray(question?.sourceIds, sourceIds, 1)) courseFindings.push(`${questionPrefix}:invalid-source-ids`);
    }

    const treatment = module.creativeTreatment;
    if (!treatment) courseFindings.push(`${modulePrefix}:missing-creative-treatment`);
    for (const field of [
      "learningArc",
      "cinematicOpening",
      "pacingPlan",
      "scenarioTreatment",
      "sourceCardPlan",
      "closingResolution",
    ]) {
      if (!text(treatment?.[field])) courseFindings.push(`${modulePrefix}:creative-treatment-missing-${field}`);
    }
    if (!validStringArray(treatment?.visualMotifs, 2)) courseFindings.push(`${modulePrefix}:creative-treatment-insufficient-visual-motifs`);

    const productionPlan = module.productionPlan;
    if (!productionPlan) courseFindings.push(`${modulePrefix}:missing-production-plan`);
    if (!isArray(productionPlan?.storyboard, assessmentModule ? 3 : 8)) courseFindings.push(`${modulePrefix}:insufficient-storyboard`);
    for (const [index, scene] of (productionPlan?.storyboard ?? []).entries()) {
      const scenePrefix = `${modulePrefix}/storyboard-${index + 1}`;
      const sceneId = text(scene?.sceneId);
      if (!sceneId) courseFindings.push(`${scenePrefix}:missing-scene-id`);
      else videoSceneIds.add(sceneId);
      for (const field of ["purpose", "picture", "onScreenText", "accessibilityDescription"]) {
        if (!text(scene?.[field])) courseFindings.push(`${scenePrefix}:missing-${field}`);
      }
      if (!Number.isFinite(Number(scene?.durationSeconds)) || Number(scene.durationSeconds) <= 0) courseFindings.push(`${scenePrefix}:invalid-duration`);
      if (!validIdArray(scene?.sourceIds, sourceIds, 1)) courseFindings.push(`${scenePrefix}:invalid-source-ids`);
    }
    if (!isArray(productionPlan?.shotList, assessmentModule ? 3 : 8)) courseFindings.push(`${modulePrefix}:insufficient-shot-list`);
    for (const [index, shot] of (productionPlan?.shotList ?? []).entries()) {
      const shotPrefix = `${modulePrefix}/shot-${index + 1}`;
      for (const field of ["shotId", "sceneId", "shotType", "subject", "movement", "locationOrEnvironment", "rightsNotes"]) {
        if (!text(shot?.[field])) courseFindings.push(`${shotPrefix}:missing-${field}`);
      }
      if (!validStringArray(shot?.assetNeeds, 1)) courseFindings.push(`${shotPrefix}:missing-asset-needs`);
    }
    if (!isArray(productionPlan?.motionGraphicsPlan, assessmentModule ? 1 : 3)) courseFindings.push(`${modulePrefix}:insufficient-motion-graphics-plan`);
    for (const [index, graphic] of (productionPlan?.motionGraphicsPlan ?? []).entries()) {
      const graphicPrefix = `${modulePrefix}/motion-graphic-${index + 1}`;
      if (!text(graphic?.sceneId) || !text(graphic?.graphic) || !text(graphic?.reducedMotionAlternative)) courseFindings.push(`${graphicPrefix}:missing-content`);
      if (!validIdArray(graphic?.sourceIds, sourceIds, 1)) courseFindings.push(`${graphicPrefix}:invalid-source-ids`);
    }
    for (const field of ["narrationStyle", "musicDirection", "soundDesign", "silenceAndEmphasis", "rightsNotes"]) {
      if (!text(productionPlan?.audioPlan?.[field])) courseFindings.push(`${modulePrefix}:audio-plan-missing-${field}`);
    }
    if (!isArray(productionPlan?.assetRequirements, 4)) courseFindings.push(`${modulePrefix}:insufficient-asset-requirements`);
    for (const [index, asset] of (productionPlan?.assetRequirements ?? []).entries()) {
      const assetPrefix = `${modulePrefix}/asset-${index + 1}`;
      if (!text(asset?.assetId) || !text(asset?.description)) courseFindings.push(`${assetPrefix}:missing-content`);
      if (!["original", "licensed", "synthetic-disclosed"].includes(asset?.origin)) courseFindings.push(`${assetPrefix}:invalid-origin`);
      if (asset?.rightsEvidenceRequired !== true) courseFindings.push(`${assetPrefix}:rights-evidence-not-required`);
    }

    if (!isArray(module.slideNarrative, assessmentModule ? 4 : 10)) courseFindings.push(`${modulePrefix}:insufficient-slide-narrative`);
    for (const [index, slide] of (module.slideNarrative ?? []).entries()) {
      const slidePrefix = `${modulePrefix}/slide-${index + 1}`;
      for (const field of ["id", "title", "speakerNotes", "visualDirection"]) {
        if (!text(slide?.[field])) courseFindings.push(`${slidePrefix}:missing-${field}`);
      }
      if (!validStringArray(slide?.content, 1)) courseFindings.push(`${slidePrefix}:missing-content`);
      if (!validIdArray(slide?.claimIds, claimIds, 1)) courseFindings.push(`${slidePrefix}:invalid-claim-ids`);
      if (!validIdArray(slide?.sourceIds, sourceIds, 1)) courseFindings.push(`${slidePrefix}:invalid-source-ids`);
    }

    const video = module.videoScript;
    if (!video) courseFindings.push(`${modulePrefix}:missing-video-script`);
    if (!text(video?.opening) || !text(video?.closing)) courseFindings.push(`${modulePrefix}:video-script-missing-opening-or-closing`);
    if (!isArray(video?.scenes, assessmentModule ? 3 : 8)) courseFindings.push(`${modulePrefix}:insufficient-video-scenes`);
    for (const [index, scene] of (video?.scenes ?? []).entries()) {
      const scenePrefix = `${modulePrefix}/video-scene-${index + 1}`;
      const sceneId = text(scene?.sceneId);
      if (!sceneId) courseFindings.push(`${scenePrefix}:missing-id`);
      else videoSceneIds.add(sceneId);
      for (const field of ["visual", "onScreenText", "narration", "audioCue", "accessibilityDescription"]) {
        if (!text(scene?.[field])) courseFindings.push(`${scenePrefix}:missing-${field}`);
      }
      if (!Number.isFinite(Number(scene?.durationSeconds)) || Number(scene.durationSeconds) <= 0) courseFindings.push(`${scenePrefix}:invalid-duration`);
      if (!validIdArray(scene?.claimIds, claimIds, 1)) courseFindings.push(`${scenePrefix}:invalid-claim-ids`);
      if (!validIdArray(scene?.sourceIds, sourceIds, 1)) courseFindings.push(`${scenePrefix}:invalid-source-ids`);
    }
    if (!Number.isFinite(Number(video?.estimatedNarrationWords)) || Number(video.estimatedNarrationWords) <= 0) courseFindings.push(`${modulePrefix}:invalid-narration-word-estimate`);
    if (!Number.isFinite(Number(video?.estimatedRuntimeMinutes)) || Number(video.estimatedRuntimeMinutes) <= 0) courseFindings.push(`${modulePrefix}:invalid-runtime-estimate`);

    if (!validStringArray(module.accessibilityNotes, 7)) courseFindings.push(`${modulePrefix}:insufficient-accessibility-notes`);
    if (!Array.isArray(module.sourcePlaceholders)) courseFindings.push(`${modulePrefix}:missing-source-placeholders-array`);
    if (!validStringArray(module.referenceApplicationNotes, 2)) courseFindings.push(`${modulePrefix}:insufficient-reference-application-notes`);
    if (!module.workbook) courseFindings.push(`${modulePrefix}:missing-workbook`);
  }

  const blueprintObjectiveIds = new Set((blueprint?.coverageByObjective ?? []).map((entry) => entry.objectiveId));
  for (const objectiveId of objectiveIds) {
    if (!blueprintObjectiveIds.has(objectiveId)) courseFindings.push(`${prefix}:assessment-blueprint-missing-objective-${objectiveId}`);
  }

  for (const source of sourceRegister) {
    const sourceId = text(source?.id);
    if (!sourceId) continue;
    for (const moduleId of source?.moduleIds ?? []) {
      if (!moduleIds.has(moduleId)) courseFindings.push(`${prefix}/${sourceId}:invalid-module-id-${moduleId}`);
    }
    for (const claimId of source?.claimIds ?? []) {
      if (!claimIds.has(claimId)) courseFindings.push(`${prefix}/${sourceId}:invalid-claim-id-${claimId}`);
    }
  }

  const matrixSourceIds = new Set();
  for (const [index, mapping] of applicabilityMatrix.entries()) {
    const mappingPrefix = `${prefix}/reference-matrix-${index + 1}`;
    const sourceId = text(mapping?.sourceId);
    if (!sourceIds.has(sourceId)) courseFindings.push(`${mappingPrefix}:invalid-source-id`);
    else matrixSourceIds.add(sourceId);
    if (!validIdArray(mapping?.claimIds, claimIds, 1)) courseFindings.push(`${mappingPrefix}:invalid-claim-ids`);
    if (!validIdArray(mapping?.moduleIds, moduleIds, 1)) courseFindings.push(`${mappingPrefix}:invalid-module-ids`);
    if (!validIdArray(mapping?.learningObjectiveIds, objectiveIds, 1)) courseFindings.push(`${mappingPrefix}:invalid-objective-ids`);
    if (!Array.isArray(mapping?.assessmentItemIds)) courseFindings.push(`${mappingPrefix}:missing-assessment-item-ids`);
    if (!Array.isArray(mapping?.videoSceneIds)) courseFindings.push(`${mappingPrefix}:missing-video-scene-ids`);
    if (!text(mapping?.applicationSummary)) courseFindings.push(`${mappingPrefix}:missing-application-summary`);
    if (!text(mapping?.exclusionsAndLimitations)) courseFindings.push(`${mappingPrefix}:missing-exclusions-and-limitations`);
  }
  for (const sourceId of sourceIds) {
    if (!matrixSourceIds.has(sourceId)) courseFindings.push(`${prefix}:source-missing-applicability-matrix-${sourceId}`);
  }

  for (const alignment of frameworkAlignment ?? []) {
    if (!text(alignment?.framework)) courseFindings.push(`${prefix}:framework-alignment-missing-framework`);
    if (alignment?.applicability !== "informational-mapping-only") courseFindings.push(`${prefix}:framework-alignment-invalid-applicability`);
    if (alignment?.verificationRequired !== true) courseFindings.push(`${prefix}:framework-alignment-not-verification-gated`);
    if (!validIdArray(alignment?.moduleIds, moduleIds, 1)) courseFindings.push(`${prefix}:framework-alignment-invalid-module-ids`);
    if (!text(alignment?.alignmentNote)) courseFindings.push(`${prefix}:framework-alignment-missing-note`);
    if (!validStringArray(alignment?.appliesTo, 1)) courseFindings.push(`${prefix}:framework-alignment-missing-applies-to`);
    if (!validStringArray(alignment?.appliesWhen, 1)) courseFindings.push(`${prefix}:framework-alignment-missing-applies-when`);
    if (!validStringArray(alignment?.doesNotEstablish, 2)) courseFindings.push(`${prefix}:framework-alignment-missing-does-not-establish`);
  }

  const finalAssessment = experience.finalAssessment ?? [];
  if (!isArray(finalAssessment, 25)) courseFindings.push(`${prefix}:insufficient-final-assessment`);
  for (const [index, question] of finalAssessment.entries()) {
    const questionPrefix = `${prefix}/assessment-${index + 1}`;
    const questionId = text(question?.id);
    if (!questionId) courseFindings.push(`${questionPrefix}:missing-id`);
    else if (assessmentIds.has(questionId)) courseFindings.push(`${questionPrefix}:duplicate-id-${questionId}`);
    else assessmentIds.add(questionId);
    if (!moduleIds.has(question?.moduleId)) courseFindings.push(`${questionPrefix}:invalid-module-id`);
    if (!validIdArray(question?.objectiveIds, objectiveIds, 1)) courseFindings.push(`${questionPrefix}:invalid-objective-ids`);
    if (!text(question?.cognitiveLevel)) courseFindings.push(`${questionPrefix}:missing-cognitive-level`);
    if (!validIdArray(question?.sourceIds, sourceIds, 1)) courseFindings.push(`${questionPrefix}:invalid-source-ids`);
    if (!isArray(question?.options, 3)) courseFindings.push(`${questionPrefix}:insufficient-options`);
    if (!Number.isInteger(question?.correctIndex) || question.correctIndex < 0 || question.correctIndex >= (question.options?.length ?? 0)) courseFindings.push(`${questionPrefix}:invalid-correct-index`);
    if (!text(question?.rationale)) courseFindings.push(`${questionPrefix}:missing-rationale`);
    if (!isArray(question?.distractorRationales, Math.max(2, (question.options?.length ?? 1) - 1))) courseFindings.push(`${questionPrefix}:insufficient-distractor-rationales`);
    if (!text(question?.applicabilityNote)) courseFindings.push(`${questionPrefix}:missing-applicability-note`);
  }

  for (const [index, mapping] of applicabilityMatrix.entries()) {
    const mappingPrefix = `${prefix}/reference-matrix-${index + 1}`;
    for (const assessmentId of mapping?.assessmentItemIds ?? []) {
      if (!assessmentIds.has(assessmentId)) courseFindings.push(`${mappingPrefix}:invalid-assessment-id-${assessmentId}`);
    }
    for (const sceneId of mapping?.videoSceneIds ?? []) {
      if (!videoSceneIds.has(sceneId)) courseFindings.push(`${mappingPrefix}:invalid-video-scene-id-${sceneId}`);
    }
  }

  if (!course.completion?.allLessonsRequired) courseFindings.push(`${prefix}:all-lessons-not-required`);
  if (!course.completion?.assessmentRequired) courseFindings.push(`${prefix}:assessment-not-required`);
  if (!Number.isFinite(Number(course.completion?.passingScore)) || Number(course.completion.passingScore) < 1 || Number(course.completion.passingScore) > 100) courseFindings.push(`${prefix}:invalid-passing-score`);
  if (course.completion?.certificateIssued !== true) courseFindings.push(`${prefix}:certificate-not-enabled`);
  if (course.certificateReview?.ownerReviewSupported !== true) courseFindings.push(`${prefix}:owner-certificate-review-not-supported`);
  if (course.certificateReview?.purchaseRequired !== false) courseFindings.push(`${prefix}:certificate-review-requires-purchase`);
  if (course.access?.ownerReviewBypassSupported !== true) courseFindings.push(`${prefix}:owner-learner-review-not-supported`);
  if (course.access?.purchaseNotRequiredForOwnerReview !== true) courseFindings.push(`${prefix}:owner-review-requires-purchase`);

  findings.push(...courseFindings);
  releaseBlockers.push(...courseReleaseBlockers);
  courseSummaries.push({
    courseId: prefix,
    structuralReady: courseFindings.length === 0,
    commercialReleaseReady: courseFindings.length === 0 && courseReleaseBlockers.length === 0,
    sourceCount: sourceIds.size,
    claimCount: claimIds.size,
    objectiveCount: objectiveIds.size,
    assessmentCount: assessmentIds.size,
    videoSceneCount: videoSceneIds.size,
    unresolvedReferenceCount: courseReleaseBlockers.length,
    findingCount: courseFindings.length,
    findings: courseFindings,
    releaseBlockers: courseReleaseBlockers,
  });
}

const reportPath = path.join(root, "catalog", "learner-catalog-readiness.json");
const report = {
  schemaVersion: "1.3",
  generatedAt: new Date().toISOString(),
  requiredAuthoringPolicyVersion,
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  expectedReviewCourses,
  discoveredCourses: courses.length,
  ready: findings.length === 0,
  commercialReleaseReady: findings.length === 0 && releaseBlockers.length === 0,
  productionPublicationIndependent: true,
  findingCount: findings.length,
  releaseBlockerCount: releaseBlockers.length,
  findings,
  releaseBlockers,
  courses: courseSummaries,
  claimBoundary: "Structural readiness permits protected owner review and continued production only. Commercial release remains blocked until every external reference is verified and all media, accessibility, rights, security, entitlement, certificate, compliance, and owner-acceptance evidence is complete.",
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (findings.length) {
  console.error(`[Academy Studio] Detailed learner owner-review readiness failed with ${findings.length} structural finding(s).`);
  for (const finding of findings.slice(0, 300)) console.error(`- ${finding}`);
  process.exit(2);
}

console.log(`[Academy Studio] Detailed learner owner-review readiness passed for all ${courses.length} course(s) under authoring policy ${requiredAuthoringPolicyVersion}.`);
if (releaseBlockers.length) {
  console.warn(`[Academy Studio] Commercial release remains blocked by ${releaseBlockers.length} unresolved reference verification item(s); protected owner review may continue.`);
} else {
  console.log("[Academy Studio] Reference verification contains no release blockers; media and remaining release gates still apply.");
}
