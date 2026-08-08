import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const protectedCatalogPath = path.join(catalogRoot, "academy-learner-course-catalog.json");
const readinessPath = path.join(catalogRoot, "learner-catalog-readiness.json");
const coreCompliancePath = path.join(catalogRoot, "academy-core-60-compliance-staging.json");
const fallbackCompliancePath = path.join(catalogRoot, "academy-hollywood-compliance-staging.json");
const pmpCourseId = "pmp-exam-prep-business-application";
const portfolio = academySurgePortfolio();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requiredFile(courseDir, relativePath, findings, prefix) {
  const filePath = path.join(courseDir, relativePath);
  if (!fs.existsSync(filePath)) {
    findings.push(`${prefix}:missing-${relativePath.replaceAll("/", "-")}`);
    return null;
  }
  return filePath;
}

const findings = [];
const compliancePath = fs.existsSync(coreCompliancePath) ? coreCompliancePath : fallbackCompliancePath;
if (!fs.existsSync(compliancePath)) findings.push("academy:missing-core-compliance-report");
const compliance = fs.existsSync(compliancePath) ? readJson(compliancePath) : null;
if (compliance?.discoveredCourses !== 60) findings.push(`academy:expected-60-core-courses-found-${compliance?.discoveredCourses ?? "unknown"}`);
if (compliance?.complianceStagingReadyCourses !== 60 || compliance?.readyForComplianceStaging !== true) {
  findings.push(`academy:core-compliance-staging-not-ready-${compliance?.complianceStagingReadyCourses ?? 0}-of-60`);
}

const courses = [];
for (const item of portfolio.selectedCourses) {
  const prefix = item.courseId;
  const stageDir = path.join(item.courseDir, "generated", "production-stage");
  const learnerPath = requiredFile(stageDir, "learner-experience.json", findings, prefix);
  const assessmentPath = requiredFile(stageDir, "assessment-bank.json", findings, prefix);
  const certificatePolicyPath = requiredFile(stageDir, "certificate/certificate-policy.json", findings, prefix);
  const certificateHtmlPath = requiredFile(stageDir, "certificate/certificate-template.html", findings, prefix);
  const artifactManifestPath = requiredFile(stageDir, "artifact-manifest.json", findings, prefix);
  if (![learnerPath, assessmentPath, certificatePolicyPath, certificateHtmlPath, artifactManifestPath].every(Boolean)) continue;

  const learner = readJson(learnerPath);
  const assessment = readJson(assessmentPath);
  const certificatePolicy = readJson(certificatePolicyPath);
  const artifactManifest = readJson(artifactManifestPath);
  if (learner.publicationAuthorized !== false || artifactManifest.publicationAuthorized !== false) findings.push(`${prefix}:protected-package-grants-publication-authority`);
  if (!Array.isArray(learner.modules) || learner.modules.length !== item.manifest.course.modules.length) findings.push(`${prefix}:learner-module-count-mismatch`);
  if (!Array.isArray(assessment.questions) || assessment.questions.length < 30) findings.push(`${prefix}:protected-assessment-bank-incomplete`);
  if (certificatePolicy.isProfessionalCertification !== false || certificatePolicy.isComplianceEvidence !== false) findings.push(`${prefix}:certificate-policy-misrepresentation`);

  courses.push({
    id: item.courseId,
    title: item.manifest.course.title,
    courseClass: "core",
    department: item.manifest.course.department,
    track: item.manifest.course.track,
    level: item.manifest.course.level,
    audience: item.manifest.course.audience,
    description: item.manifest.course.description,
    duration: item.manifest.course.duration,
    outcomes: item.manifest.course.outcomes,
    moduleCount: learner.modules.length,
    assessmentQuestionCount: assessment.questions.length,
    completion: item.manifest.completion,
    certificatePolicy,
    learnerExperience: learner,
    protectedArtifactManifest: artifactManifest,
    publicationAuthorized: false,
    checkoutAuthorized: false,
  });
}

const pmpDir = path.join(root, "courses", pmpCourseId);
const pmpRequired = [
  "course-manifest.json",
  "learner-guide.md",
  "instructor-manuscript.md",
  "assessment-bank.json",
  "answer-key.json",
  "lesson-traceability.json",
  "authoritative-sources.json",
  "ai-tutor-profile.json",
  "production-queue.json",
  "course-qa.json",
];
const pmpFiles = Object.fromEntries(pmpRequired.map((relativePath) => [relativePath, requiredFile(pmpDir, relativePath, findings, pmpCourseId)]));
if (pmpFiles["course-manifest.json"]) {
  const manifest = readJson(pmpFiles["course-manifest.json"]);
  const assessment = pmpFiles["assessment-bank.json"] ? readJson(pmpFiles["assessment-bank.json"]) : null;
  const queue = pmpFiles["production-queue.json"] ? readJson(pmpFiles["production-queue.json"]) : null;
  courses.push({
    id: pmpCourseId,
    title: manifest.course?.title ?? "PMP Exam Preparation and Business Application",
    courseClass: "supplemental",
    department: manifest.course?.department,
    track: manifest.course?.track,
    level: manifest.course?.level,
    audience: manifest.course?.audience,
    description: manifest.course?.description,
    duration: manifest.course?.duration,
    outcomes: manifest.course?.outcomes ?? [],
    moduleCount: manifest.course?.modules?.length ?? 0,
    assessmentQuestionCount: assessment?.questions?.length ?? 0,
    completion: manifest.completion,
    protectedAssetInventory: pmpRequired,
    productionQueueStatus: queue?.status ?? null,
    publicationAuthorized: false,
    checkoutAuthorized: false,
    courseSpecificContract: true,
  });
}

const uniqueCourseIds = new Set(courses.map((course) => course.id));
if (courses.filter((course) => course.courseClass === "core").length !== 60) findings.push(`academy:protected-core-catalog-count-${courses.filter((course) => course.courseClass === "core").length}-of-60`);
if (courses.filter((course) => course.courseClass === "supplemental").length !== 1) findings.push("academy:protected-supplemental-course-missing");
if (courses.length !== 61 || uniqueCourseIds.size !== 61) findings.push(`academy:protected-portfolio-count-${courses.length}-unique-${uniqueCourseIds.size}-expected-61`);

const ready = findings.length === 0;
fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(protectedCatalogPath, `${JSON.stringify({
  schemaVersion: "2.0",
  generatedAt: new Date().toISOString(),
  accessClassification: "protected-owner-review-and-learner-content",
  portfolioDefinition: "60 core Academy courses plus the supplemental PMP course",
  expectedCourses: 61,
  ownerReviewSupported: true,
  productionPublicationIndependent: true,
  publicationAuthorized: false,
  checkoutAuthorized: false,
  courses,
}, null, 2)}\n`);
fs.writeFileSync(readinessPath, `${JSON.stringify({
  schemaVersion: "2.0",
  generatedAt: new Date().toISOString(),
  expectedCourses: 61,
  discoveredCourses: courses.length,
  uniqueCourses: uniqueCourseIds.size,
  coreCourses: courses.filter((course) => course.courseClass === "core").length,
  supplementalCourses: courses.filter((course) => course.courseClass === "supplemental").length,
  ready,
  publicationAuthorized: false,
  checkoutAuthorized: false,
  findingCount: findings.length,
  findings,
  claimBoundary: "Learner-catalog readiness proves protected learner packages and the supplemental PMP asset inventory are present for owner review. It does not prove final media, entitlement operation, owner acceptance, publication, checkout, certification, or compliance.",
}, null, 2)}\n`);

console.log(`[Academy Studio] Protected learner catalog readiness: ${courses.length}/61 course(s), ready=${ready}.`);
if (!ready) {
  for (const finding of findings.slice(0, 250)) console.error(`[Academy Studio] ${finding}`);
  process.exit(2);
}
