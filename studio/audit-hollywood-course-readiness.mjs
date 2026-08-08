import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_POLICY_VERSION,
  PRODUCTION_CONTRACT_VERSION,
  authoringSourceHash,
} from "./academy-hollywood-checkpoints.mjs";
import { assertAcademyWorkerAllocation } from "./academy-worker-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");
const minimumExpectedOwnerReviewCourses = Number(process.env.ACADEMY_MINIMUM_REVIEW_COURSES || 60);

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
const allocation = assertAcademyWorkerAllocation();
const courses = [];
const findings = [];

for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = readJson(manifestPath);
  const courseId = String(manifest.course?.id ?? entry.name);
  const releaseStatus = String(manifest.release?.status ?? "draft").toLowerCase();
  const ownerReviewEligible = !["retired", "archived"].includes(releaseStatus);
  const courseFindings = [];
  const blockingFindings = [];

  if (courseId !== entry.name) blockingFindings.push("directory-course-id-mismatch");
  if (!String(manifest.course?.title ?? "").trim()) blockingFindings.push("missing-course-title");
  if (!Array.isArray(manifest.course?.modules) || manifest.course.modules.length === 0) blockingFindings.push("missing-course-modules");
  if (manifest.completion?.allLessonsRequired !== true) blockingFindings.push("all-lessons-not-required");
  if (manifest.completion?.assessmentRequired !== true) blockingFindings.push("assessment-not-required");
  if (manifest.completion?.certificateIssued !== true) blockingFindings.push("certificate-not-enabled");
  if (manifest.release?.publishToAcademy === true && !["approved", "published"].includes(releaseStatus)) {
    blockingFindings.push("publication-enabled-without-approved-status");
  }

  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  const expectedSourceManifestHash = authoringSourceHash(manifest);
  let packageState = "missing";
  let authored = null;
  if (!fs.existsSync(packagePath)) {
    courseFindings.push("missing-hollywood-course-package");
  } else {
    try {
      authored = readJson(packagePath);
      packageState = "available";
      if (authored.schemaVersion !== "2.0") courseFindings.push("unsupported-hollywood-package-schema");
      if (authored.authoringPolicyVersion !== AUTHORING_POLICY_VERSION) courseFindings.push("outdated-hollywood-authoring-policy");
      if (authored.productionContractVersion !== PRODUCTION_CONTRACT_VERSION) courseFindings.push("outdated-hollywood-production-contract");
      if (authored.sourceManifestHash !== expectedSourceManifestHash) courseFindings.push("stale-hollywood-course-package");
      if (authored.publicationAuthorized !== false) blockingFindings.push("generated-package-grants-publication-authority");
      if (authored.reviewStatus !== "draft-ai-generated-compliance-staging") courseFindings.push("invalid-hollywood-review-status");
    } catch (error) {
      packageState = "invalid";
      courseFindings.push("invalid-hollywood-course-package-json");
      courseFindings.push(`package-read-error-${String(error?.message ?? error).slice(0, 120).replace(/[^a-zA-Z0-9-]+/g, "-")}`);
    }
  }

  courses.push({
    courseId,
    title: manifest.course?.title ?? courseId,
    ownerReviewEligible,
    releaseStatus,
    publicationEnabled: manifest.release?.publishToAcademy === true,
    moduleCount: Array.isArray(manifest.course?.modules) ? manifest.course.modules.length : 0,
    expectedSourceManifestHash,
    packageState,
    packageAuthoringPolicyVersion: authored?.authoringPolicyVersion ?? null,
    packageProductionContractVersion: authored?.productionContractVersion ?? null,
    findings: [...blockingFindings, ...courseFindings],
    blockingFindings,
    authoringRequired: courseFindings.length > 0,
  });

  for (const finding of blockingFindings) findings.push({ courseId, finding, blocking: true });
  for (const finding of courseFindings) findings.push({ courseId, finding, blocking: false });
}

const ownerReviewCourses = courses.filter((course) => course.ownerReviewEligible);
if (!Number.isInteger(minimumExpectedOwnerReviewCourses) || minimumExpectedOwnerReviewCourses < 1) {
  throw new Error("ACADEMY_MINIMUM_REVIEW_COURSES must be a positive integer.");
}
if (ownerReviewCourses.length < minimumExpectedOwnerReviewCourses) {
  findings.push({
    courseId: "academy-catalog",
    finding: `owner-review-course-count-below-minimum-${ownerReviewCourses.length}-vs-${minimumExpectedOwnerReviewCourses}`,
    blocking: true,
  });
}

const blockingFindings = findings.filter((finding) => finding.blocking);
const authoringTargets = ownerReviewCourses.filter((course) => course.authoringRequired);
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  authoringPolicyVersion: AUTHORING_POLICY_VERSION,
  productionContractVersion: PRODUCTION_CONTRACT_VERSION,
  allocation,
  minimumExpectedOwnerReviewCourses,
  totals: {
    discovered: courses.length,
    ownerReviewEligible: ownerReviewCourses.length,
    authoringTargets: authoringTargets.length,
    blockingFindings: blockingFindings.length,
    publicationEnabled: courses.filter((course) => course.publicationEnabled).length,
  },
  authoringRequired: authoringTargets.length > 0,
  targetCourseIds: authoringTargets.map((course) => course.courseId),
  findings,
  courses,
  claimBoundary: "This audit identifies structural manifests and protected cinematic authoring requirements. It does not establish source verification, mastered media, review approval, LCMS loading, purchase readiness, or publication authorization.",
};

fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-course-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
writeOutput("authoring_required", String(report.authoringRequired));
writeOutput("authoring_targets", String(authoringTargets.length));
writeOutput("blocking_findings", String(blockingFindings.length));
writeOutput("owner_review_courses", String(ownerReviewCourses.length));

console.log(`[Academy Studio] Cinematic audit evaluated ${courses.length} manifest(s), found ${ownerReviewCourses.length} owner-review course(s), and selected ${authoringTargets.length} authoring target(s).`);
if (blockingFindings.length > 0) {
  for (const finding of blockingFindings.slice(0, 100)) {
    console.error(`[Academy Studio] ${finding.courseId}: ${finding.finding}`);
  }
  process.exitCode = 2;
}
