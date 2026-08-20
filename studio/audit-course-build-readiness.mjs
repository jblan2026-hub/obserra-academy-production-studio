import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { officialBrand } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");
const AUTHORING_POLICY_VERSION = "2026.08.07.2";
const requiredGeneratedFiles = [
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "visual-brief.md",
];
const authoringFindings = [
  "missing-ai-course-package",
  "stale-ai-course-package",
  "untraceable-ai-course-package",
  "outdated-ai-authoring-policy",
];
const draftFindings = ["draft-commerce-price-unset", "draft-branding-not-applied"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function authoringSourceHash(manifest) {
  return stableHash({ authoringPolicyVersion: AUTHORING_POLICY_VERSION, manifest });
}

function parseDurationMinutes(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const hours = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:hour|hours|hr|hrs)/);
  const minutes = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:minute|minutes|min|mins)/);
  if (hours || minutes) return Math.round(Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0));
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.round(numeric) : NaN;
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);

const findings = [];
const courses = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = readJson(manifestPath);
  const course = manifest.course ?? {};
  const courseId = course.id ?? entry.name;
  const modules = Array.isArray(course.modules) ? course.modules : [];
  const nestedLessons = modules.flatMap((module) => Array.isArray(module?.lessons) ? module.lessons : []);
  const releaseStatus = String(manifest.release?.status ?? "draft").toLowerCase();
  const publicationApproved = manifest.release?.publishToAcademy === true && ["approved", "published"].includes(releaseStatus);
  const ownerReviewEligible = !["retired", "archived"].includes(releaseStatus);
  const courseFindings = [];

  if (courseId !== entry.name) courseFindings.push("directory-course-id-mismatch");
  for (const field of ["id", "title", "description", "duration", "department", "level", "track", "audience"]) {
    if (!String(course[field] ?? "").trim()) courseFindings.push(`missing-course-${field}`);
  }
  if (!Array.isArray(course.outcomes) || course.outcomes.length === 0) courseFindings.push("missing-course-outcomes");
  if (modules.length === 0) courseFindings.push("missing-course-modules");

  const moduleIds = new Set();
  let moduleMinutes = 0;
  for (const [index, module] of modules.entries()) {
    for (const field of ["id", "title", "description", "duration", "format"]) {
      if (!String(module?.[field] ?? "").trim()) courseFindings.push(`module-${index + 1}-missing-${field}`);
    }
    if (moduleIds.has(module.id)) courseFindings.push(`module-${index + 1}-duplicate-id`);
    moduleIds.add(module.id);
    const minutes = parseDurationMinutes(module.duration);
    if (!Number.isFinite(minutes) || minutes <= 0) courseFindings.push(`module-${index + 1}-invalid-duration`);
    else moduleMinutes += minutes;
  }

  const assessmentMinutes = parseDurationMinutes(manifest.completion?.assessmentDuration);
  const accountedMinutes = moduleMinutes + (Number.isFinite(assessmentMinutes) && assessmentMinutes > 0 ? assessmentMinutes : 0);
  const advertisedMinutes = parseDurationMinutes(course.duration);
  if (!Number.isFinite(advertisedMinutes) || advertisedMinutes <= 0) courseFindings.push("invalid-course-duration");
  else if (accountedMinutes !== advertisedMinutes) courseFindings.push(`duration-mismatch-${accountedMinutes}-vs-${advertisedMinutes}`);

  const price = Number(manifest.commerce?.price);
  if (!manifest.commerce || !Number.isFinite(price) || price < 0) {
    courseFindings.push("invalid-commerce-price");
  } else if (publicationApproved && price <= 0) {
    courseFindings.push("invalid-commerce-price");
  } else if (!publicationApproved && price <= 0) {
    courseFindings.push("draft-commerce-price-unset");
  }

  if (!manifest.completion?.allLessonsRequired) courseFindings.push("all-lessons-not-required");
  if (!manifest.completion?.assessmentRequired) courseFindings.push("assessment-not-required");
  if (!Number.isFinite(Number(manifest.completion?.passingScore)) || Number(manifest.completion.passingScore) < 1) courseFindings.push("invalid-passing-score");
  if (manifest.completion?.certificateIssued !== true) courseFindings.push("certificate-not-enabled");

  if (manifest.branding?.logoAsset !== officialBrand.officialLogo.assetPath) {
    courseFindings.push(publicationApproved ? "official-logo-mismatch" : "draft-branding-not-applied");
  }

  const missingGenerated = requiredGeneratedFiles.filter((name) => !fs.existsSync(path.join(courseDir, name)));
  if (missingGenerated.length) courseFindings.push(...missingGenerated.map((name) => `missing-generated-${name}`));

  const authoringPath = path.join(courseDir, "generated", "authoring", "course-package.json");
  const authoringMissing = !fs.existsSync(authoringPath);
  if (authoringMissing) courseFindings.push("missing-ai-course-package");

  const manifestHash = authoringSourceHash(manifest);
  let packageManifestHash = null;
  let packageAuthoringPolicyVersion = null;
  if (!authoringMissing) {
    const authored = readJson(authoringPath);
    packageManifestHash = authored.sourceManifestHash ?? authored.manifestHash ?? null;
    packageAuthoringPolicyVersion = authored.authoringPolicyVersion ?? null;
    if (!packageManifestHash) courseFindings.push("untraceable-ai-course-package");
    else if (packageManifestHash !== manifestHash) courseFindings.push("stale-ai-course-package");
    if (packageAuthoringPolicyVersion !== AUTHORING_POLICY_VERSION) courseFindings.push("outdated-ai-authoring-policy");
  }

  const nonBlockingFindings = new Set([
    ...authoringFindings,
    ...draftFindings,
    ...requiredGeneratedFiles.map((name) => `missing-generated-${name}`),
  ]);
  const courseBlockingFindings = courseFindings.filter((finding) => !nonBlockingFindings.has(finding));

  courses.push({
    courseId,
    title: course.title,
    publicationApproved,
    ownerReviewEligible,
    aiNative: course.aiNative === true,
    moduleCount: modules.length,
    lessonCount: nestedLessons.length || modules.length,
    moduleMinutes,
    assessmentMinutes: Number.isFinite(assessmentMinutes) ? assessmentMinutes : 0,
    accountedMinutes,
    advertisedMinutes,
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    manifestHash,
    packageManifestHash,
    packageAuthoringPolicyVersion,
    authoringMissing,
    findings: courseFindings,
    blockingFindings: courseBlockingFindings,
  });
  for (const finding of courseFindings) {
    findings.push({ courseId, finding, blocking: !nonBlockingFindings.has(finding) });
  }
}

const publicationApprovedCourses = courses.filter((course) => course.publicationApproved);
const ownerReviewCourses = courses.filter((course) => course.ownerReviewEligible);
const expectedOwnerReviewCourses = Number(process.env.ACADEMY_EXPECTED_REVIEW_COURSES ?? 0);
if (Number.isInteger(expectedOwnerReviewCourses) && expectedOwnerReviewCourses > 0 && ownerReviewCourses.length !== expectedOwnerReviewCourses) {
  findings.push({
    courseId: "academy-catalog",
    finding: `owner-review-course-count-mismatch-${ownerReviewCourses.length}-vs-${expectedOwnerReviewCourses}`,
    blocking: true,
  });
}

const authoringRequired = ownerReviewCourses.some((course) =>
  authoringFindings.some((finding) => course.findings.includes(finding)),
);
const buildRequired = ownerReviewCourses.some((course) =>
  course.blockingFindings.length > 0
  || course.findings.some((finding) => finding.startsWith("missing-generated-")),
);
const blockingFindings = findings.filter((item) => item.blocking);

fs.mkdirSync(catalogRoot, { recursive: true });
const report = {
  schemaVersion: "1.4",
  generatedAt: new Date().toISOString(),
  policy: {
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    lessonCount: "manifest-defined-per-course-with-nested-lesson-support",
    duration: "module-durations-plus-explicit-final-assessment-duration-must-equal-advertised-course-duration",
    draftCommerce: "draft courses may retain a zero placeholder until owner and commerce approval",
    releaseBranding: "approved and published courses must use the owner-approved official logo",
    authoring: "all owner-review-eligible missing, stale, untraceable, or older-policy packages trigger AI authoring",
    build: "all owner-review-eligible missing assets or blocking findings trigger governed build",
    publication: "only explicitly approved or published courses can enter the public catalog",
    directProductionPublish: false,
  },
  totals: {
    discovered: courses.length,
    ownerReviewEligible: ownerReviewCourses.length,
    expectedOwnerReviewEligible: Number.isInteger(expectedOwnerReviewCourses) && expectedOwnerReviewCourses > 0 ? expectedOwnerReviewCourses : null,
    publicationApproved: publicationApprovedCourses.length,
    findings: findings.length,
    blockingFindings: blockingFindings.length,
  },
  authoringRequired,
  buildRequired,
  courses,
};
fs.writeFileSync(path.join(catalogRoot, "continuous-course-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
writeOutput("authoring_required", String(authoringRequired));
writeOutput("build_required", String(buildRequired));
writeOutput("blocking_findings", String(blockingFindings.length));
writeOutput("owner_review_courses", String(ownerReviewCourses.length));
writeOutput("publication_approved_courses", String(publicationApprovedCourses.length));
writeOutput("approved_courses", String(publicationApprovedCourses.length));

console.log(`[Academy Studio] Audited ${courses.length} course manifests under authoring policy ${AUTHORING_POLICY_VERSION}, including ${ownerReviewCourses.length} owner-review-eligible and ${publicationApprovedCourses.length} publication-approved course(s).`);
console.log(`[Academy Studio] AI authoring required: ${authoringRequired}. Governed build required: ${buildRequired}. Blocking findings: ${blockingFindings.length}.`);
if (blockingFindings.length > 0) {
  for (const item of blockingFindings.slice(0, 100)) console.error(`[Academy Studio] ${item.courseId}: ${item.finding}`);
  process.exitCode = 2;
}
