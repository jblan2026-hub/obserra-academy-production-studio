import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, "catalog", "academy-learner-course-catalog.json");
const expectedReviewCourses = Number(process.env.ACADEMY_EXPECTED_REVIEW_COURSES || 60);
const requiredAuthoringPolicyVersion = "2026.08.07.2";

if (!fs.existsSync(catalogPath)) throw new Error(`Learner catalog not found: ${catalogPath}`);
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const courses = Array.isArray(catalog.courses) ? catalog.courses : [];
const findings = [];

if (catalog.schemaVersion !== "1.2") findings.push(`unsupported-learner-catalog-schema-${catalog.schemaVersion ?? "missing"}`);
if (courses.length !== expectedReviewCourses) {
  findings.push(`expected-${expectedReviewCourses}-owner-review-courses-found-${courses.length}`);
}

for (const course of courses) {
  const prefix = course.id || course.title || "unknown-course";
  const experience = course.learnerExperience ?? {};
  const modules = experience.modules ?? [];
  const sourceRegister = experience.sourceRegister ?? [];
  const frameworkAlignment = experience.frameworkAlignment;
  const blueprint = experience.assessmentBlueprint;

  if (course.access?.ownerReviewEligible !== true) findings.push(`${prefix}:owner-review-not-eligible`);
  if (!course.authoring?.available) findings.push(`${prefix}:missing-authored-package`);
  if (!course.authoring?.sourceManifestHash) findings.push(`${prefix}:missing-source-manifest-hash`);
  if (course.authoring?.authoringPolicyVersion !== requiredAuthoringPolicyVersion) findings.push(`${prefix}:outdated-authoring-policy`);
  if (!experience.courseSummary) findings.push(`${prefix}:missing-course-summary`);
  if (!Array.isArray(sourceRegister) || sourceRegister.length === 0) findings.push(`${prefix}:missing-source-register`);
  if (!Array.isArray(frameworkAlignment)) findings.push(`${prefix}:missing-framework-alignment-array`);
  if (!blueprint || !Array.isArray(blueprint.coverageByModule) || blueprint.coverageByModule.length === 0) findings.push(`${prefix}:missing-assessment-blueprint`);
  if (!Array.isArray(blueprint?.cognitiveMix) || blueprint.cognitiveMix.length === 0) findings.push(`${prefix}:missing-assessment-cognitive-mix`);
  if (!Array.isArray(blueprint?.integrityNotes) || blueprint.integrityNotes.length === 0) findings.push(`${prefix}:missing-assessment-integrity-notes`);
  if (!modules.length) findings.push(`${prefix}:missing-learner-modules`);
  if (modules.length !== course.moduleCount) findings.push(`${prefix}:module-count-mismatch`);

  const moduleIds = new Set(modules.map((module) => module.id));
  const blueprintModuleIds = new Set((blueprint?.coverageByModule ?? []).map((entry) => entry.moduleId));
  for (const moduleId of moduleIds) {
    if (!blueprintModuleIds.has(moduleId)) findings.push(`${prefix}:assessment-blueprint-missing-${moduleId}`);
  }

  for (const source of sourceRegister) {
    if (!String(source?.id ?? "").trim()) findings.push(`${prefix}:source-register-entry-missing-id`);
    if (!String(source?.claimOrTopic ?? "").trim()) findings.push(`${prefix}:source-register-entry-missing-topic`);
    if (!String(source?.verificationInstruction ?? "").trim()) findings.push(`${prefix}:source-register-entry-missing-verification-instruction`);
    if (!Array.isArray(source?.moduleIds)) findings.push(`${prefix}:source-register-entry-missing-module-ids`);
  }

  for (const alignment of frameworkAlignment ?? []) {
    if (!String(alignment?.framework ?? "").trim()) findings.push(`${prefix}:framework-alignment-missing-framework`);
    if (alignment?.verificationRequired !== true) findings.push(`${prefix}:framework-alignment-not-verification-gated`);
    if (!Array.isArray(alignment?.moduleIds)) findings.push(`${prefix}:framework-alignment-missing-module-ids`);
  }

  for (const module of modules) {
    const modulePrefix = `${prefix}/${module.id || module.sequence || "module"}`;
    if (!String(module.lessonNarrative ?? "").trim()) findings.push(`${modulePrefix}:missing-lesson-narrative`);
    if (!Array.isArray(module.learningObjectives) || module.learningObjectives.length === 0) findings.push(`${modulePrefix}:missing-learning-objectives`);
    if (!Array.isArray(module.keyConcepts) || module.keyConcepts.length < 4) findings.push(`${modulePrefix}:insufficient-key-concepts`);
    if (!module.scenario) findings.push(`${modulePrefix}:missing-scenario`);
    if (!module.exercise) findings.push(`${modulePrefix}:missing-exercise`);
    if (!Array.isArray(module.knowledgeChecks) || module.knowledgeChecks.length < 4) findings.push(`${modulePrefix}:insufficient-knowledge-checks`);
    if (!Array.isArray(module.slideNarrative) || module.slideNarrative.length < 8) findings.push(`${modulePrefix}:insufficient-slide-narrative`);
    if (!module.videoScript) findings.push(`${modulePrefix}:missing-video-script`);
    if (!module.workbook) findings.push(`${modulePrefix}:missing-workbook`);
    if (!Array.isArray(module.accessibilityNotes) || module.accessibilityNotes.length < 4) findings.push(`${modulePrefix}:insufficient-accessibility-notes`);
    if (!Array.isArray(module.sourcePlaceholders)) findings.push(`${modulePrefix}:missing-source-placeholders-array`);
  }

  const finalAssessment = experience.finalAssessment ?? [];
  if (!Array.isArray(finalAssessment) || finalAssessment.length < 25) findings.push(`${prefix}:insufficient-final-assessment`);
  for (const [index, question] of finalAssessment.entries()) {
    const questionPrefix = `${prefix}/assessment-${index + 1}`;
    if (!moduleIds.has(question?.moduleId)) findings.push(`${questionPrefix}:invalid-module-id`);
    if (!String(question?.cognitiveLevel ?? "").trim()) findings.push(`${questionPrefix}:missing-cognitive-level`);
    if (!Array.isArray(question?.sourceIds)) findings.push(`${questionPrefix}:missing-source-ids-array`);
    if (!Array.isArray(question?.options) || question.options.length < 2) findings.push(`${questionPrefix}:insufficient-options`);
    if (!Number.isInteger(question?.correctIndex) || question.correctIndex < 0 || question.correctIndex >= (question.options?.length ?? 0)) findings.push(`${questionPrefix}:invalid-correct-index`);
    if (!String(question?.rationale ?? "").trim()) findings.push(`${questionPrefix}:missing-rationale`);
  }

  if (!course.completion?.allLessonsRequired) findings.push(`${prefix}:all-lessons-not-required`);
  if (!course.completion?.assessmentRequired) findings.push(`${prefix}:assessment-not-required`);
  if (!Number.isFinite(Number(course.completion?.passingScore)) || Number(course.completion.passingScore) < 1 || Number(course.completion.passingScore) > 100) findings.push(`${prefix}:invalid-passing-score`);
  if (course.completion?.certificateIssued !== true) findings.push(`${prefix}:certificate-not-enabled`);
  if (course.certificateReview?.ownerReviewSupported !== true) findings.push(`${prefix}:owner-certificate-review-not-supported`);
  if (course.certificateReview?.purchaseRequired !== false) findings.push(`${prefix}:certificate-review-requires-purchase`);
  if (course.access?.ownerReviewBypassSupported !== true) findings.push(`${prefix}:owner-learner-review-not-supported`);
  if (course.access?.purchaseNotRequiredForOwnerReview !== true) findings.push(`${prefix}:owner-review-requires-purchase`);
}

const reportPath = path.join(root, "catalog", "learner-catalog-readiness.json");
fs.writeFileSync(reportPath, `${JSON.stringify({
  schemaVersion: "1.2",
  generatedAt: new Date().toISOString(),
  requiredAuthoringPolicyVersion,
  expectedReviewCourses,
  discoveredCourses: courses.length,
  ready: findings.length === 0,
  productionPublicationIndependent: true,
  findingCount: findings.length,
  findings,
}, null, 2)}\n`);

if (findings.length) {
  console.error(`[Academy Studio] Learner owner-review readiness failed with ${findings.length} finding(s).`);
  for (const finding of findings.slice(0, 250)) console.error(`- ${finding}`);
  process.exit(2);
}

console.log(`[Academy Studio] Learner owner-review readiness passed for all ${courses.length} course(s) under authoring policy ${requiredAuthoringPolicyVersion}.`);
