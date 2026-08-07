import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, "catalog", "academy-learner-course-catalog.json");
const expectedReviewCourses = Number(process.env.ACADEMY_EXPECTED_REVIEW_COURSES || 60);

if (!fs.existsSync(catalogPath)) throw new Error(`Learner catalog not found: ${catalogPath}`);
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const courses = Array.isArray(catalog.courses) ? catalog.courses : [];
const findings = [];

if (courses.length !== expectedReviewCourses) {
  findings.push(`expected-${expectedReviewCourses}-owner-review-courses-found-${courses.length}`);
}

for (const course of courses) {
  const prefix = course.id || course.title || "unknown-course";
  const modules = course.learnerExperience?.modules ?? [];
  if (course.access?.ownerReviewEligible !== true) findings.push(`${prefix}:owner-review-not-eligible`);
  if (!course.authoring?.available) findings.push(`${prefix}:missing-authored-package`);
  if (!course.authoring?.sourceManifestHash) findings.push(`${prefix}:missing-source-manifest-hash`);
  if (!modules.length) findings.push(`${prefix}:missing-learner-modules`);
  if (modules.length !== course.moduleCount) findings.push(`${prefix}:module-count-mismatch`);

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
  }

  const finalAssessment = course.learnerExperience?.finalAssessment ?? [];
  if (!Array.isArray(finalAssessment) || finalAssessment.length < 25) findings.push(`${prefix}:insufficient-final-assessment`);
  if (!course.completion?.allLessonsRequired) findings.push(`${prefix}:all-lessons-not-required`);
  if (!course.completion?.assessmentRequired) findings.push(`${prefix}:assessment-not-required`);
  if (!Number.isFinite(Number(course.completion?.passingScore)) || Number(course.completion.passingScore) < 1) findings.push(`${prefix}:invalid-passing-score`);
  if (course.completion?.certificateIssued !== true) findings.push(`${prefix}:certificate-not-enabled`);
  if (course.certificateReview?.ownerReviewSupported !== true) findings.push(`${prefix}:owner-certificate-review-not-supported`);
  if (course.certificateReview?.purchaseRequired !== false) findings.push(`${prefix}:certificate-review-requires-purchase`);
  if (course.access?.ownerReviewBypassSupported !== true) findings.push(`${prefix}:owner-learner-review-not-supported`);
  if (course.access?.purchaseNotRequiredForOwnerReview !== true) findings.push(`${prefix}:owner-review-requires-purchase`);
}

const reportPath = path.join(root, "catalog", "learner-catalog-readiness.json");
fs.writeFileSync(reportPath, `${JSON.stringify({
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  expectedReviewCourses,
  discoveredCourses: courses.length,
  ready: findings.length === 0,
  productionPublicationIndependent: true,
  findingCount: findings.length,
  findings,
}, null, 2)}\n`);

if (findings.length) {
  console.error(`[Academy Studio] Learner owner-review readiness failed with ${findings.length} finding(s).`);
  for (const finding of findings.slice(0, 200)) console.error(`- ${finding}`);
  process.exit(2);
}

console.log(`[Academy Studio] Learner owner-review readiness passed for all ${courses.length} course(s).`);
