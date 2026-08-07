import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const courseArgIndex = process.argv.indexOf("--course");
const courseId = courseArgIndex >= 0 ? process.argv[courseArgIndex + 1] : null;
if (!courseId) {
  console.error("Usage: npm run build:course -- --course <course-id>");
  process.exit(1);
}

const sourceDir = path.join(root, "courses", courseId);
const manifestPath = path.join(sourceDir, "course-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`[Academy Studio] Course manifest not found: ${manifestPath}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function reviewGatePassed(reviews = {}) {
  return Object.values(reviews).every((review) => {
    if (!review || review.required === false) return true;
    return ["approved", "not-applicable"].includes(String(review.status ?? "").toLowerCase());
  });
}

function packageApproved(packagePath) {
  if (!fs.existsSync(packagePath)) return false;
  const status = String(readJson(packagePath).reviewStatus ?? "").toLowerCase();
  return ["approved", "owner-approved", "final"].includes(status);
}

function mediaInventory(mediaManifest) {
  const assets = Array.isArray(mediaManifest?.assets) ? mediaManifest.assets : [];
  return {
    assets,
    videoCount: assets.filter((asset) => asset?.kind === "video").length,
    captionsCount: assets.filter((asset) => asset?.kind === "captions").length,
  };
}

function fileHash(directory, files) {
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort()) {
    const filePath = path.join(directory, file);
    if (!fs.existsSync(filePath)) continue;
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const manifest = readJson(manifestPath);
if (manifest.course?.id !== courseId) {
  console.error(`[Academy Studio] Course directory and manifest ID do not match: ${courseId}`);
  process.exit(1);
}

const releaseDir = path.join(root, "releases", courseId, "FINAL");
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

const copiedFiles = [];
function copyIfPresent(sourceRelativePath, releaseName = path.basename(sourceRelativePath)) {
  const source = path.join(sourceDir, sourceRelativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  fs.copyFileSync(source, path.join(releaseDir, releaseName));
  copiedFiles.push(releaseName);
  return true;
}

for (const file of [
  "course-manifest.json",
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "release-notes.md",
]) copyIfPresent(file);
copyIfPresent(path.join("generated", "authoring", "course-package.json"), "course-package.json");
copyIfPresent("approved-media.json");
copyIfPresent(path.join("generated", "approved-media.json"), "approved-media.json");

const certificateTemplate = {
  schemaVersion: "1.0",
  courseId: manifest.course.id,
  courseTitle: manifest.course.title,
  releaseVersion: manifest.release?.version ?? "0.0.0",
  issuer: manifest.branding?.legalName ?? "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC",
  credentialType: "certificate-of-course-completion-only",
  title: "Certificate of Course Completion",
  requiredStatement: "Certificate of Course Completion Only. Not professional certification, licensure, accreditation, compliance validation, or regulatory approval.",
  logoAsset: manifest.branding?.logoAsset ?? null,
  completion: manifest.completion,
  disclaimer: manifest.disclaimer,
  fields: ["learnerName", "courseTitle", "completionDate", "certificateId", "releaseVersion", "verificationUrl"],
};
fs.writeFileSync(
  path.join(releaseDir, "certificate-template.json"),
  `${JSON.stringify(certificateTemplate, null, 2)}\n`,
);
copiedFiles.push("certificate-template.json");

const releaseStatus = String(manifest.release?.status ?? "draft").toLowerCase();
const publishRequested = manifest.release?.publishToAcademy === true;
const productionRelease = publishRequested && ["approved", "published"].includes(releaseStatus);
const packagePath = path.join(releaseDir, "course-package.json");
const mediaPath = path.join(releaseDir, "approved-media.json");
const assessmentPath = path.join(releaseDir, "assessment-bank.json");
const mediaManifest = fs.existsSync(mediaPath) ? readJson(mediaPath) : null;
const assessmentBank = fs.existsSync(assessmentPath) ? readJson(assessmentPath) : null;
const media = mediaInventory(mediaManifest);
const assessmentCount = Array.isArray(assessmentBank?.questions) ? assessmentBank.questions.length : 0;
const lessonCount = Array.isArray(manifest.course?.modules) ? manifest.course.modules.length : 0;

const requiredReleaseFiles = [
  "course-manifest.json",
  "course-package.json",
  "learner-guide.md",
  "workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "approved-media.json",
  "certificate-template.json",
];
const missingFiles = requiredReleaseFiles.filter((file) => !fs.existsSync(path.join(releaseDir, file)));
const readinessFailures = [];
if (!reviewGatePassed(manifest.reviews)) readinessFailures.push("required-reviews-not-approved");
if (!packageApproved(packagePath)) readinessFailures.push("authored-package-not-approved");
if (mediaManifest?.status !== "approved") readinessFailures.push("media-manifest-not-approved");
if (media.videoCount < lessonCount) readinessFailures.push("one-approved-video-per-lesson-required");
if (media.captionsCount < lessonCount) readinessFailures.push("one-approved-caption-track-per-lesson-required");
if (assessmentCount < 1) readinessFailures.push("final-assessment-missing");
for (const file of missingFiles) readinessFailures.push(`missing:${file}`);

const learnerDeliveryReady = productionRelease && readinessFailures.length === 0;
const releaseRecord = {
  schemaVersion: "2.0",
  courseId: manifest.course.id,
  title: manifest.course.title,
  version: manifest.release?.version ?? "0.0.0",
  releaseStatus,
  publishToAcademy: publishRequested,
  productionRelease,
  learnerDeliveryReady,
  readinessFailures,
  commerce: manifest.commerce,
  completion: manifest.completion,
  inventory: {
    lessonCount,
    assessmentCount,
    videoCount: media.videoCount,
    captionsCount: media.captionsCount,
    materialCount: ["learner-guide.md", "workbook.md"].filter((file) => fs.existsSync(path.join(releaseDir, file))).length,
    certificateTemplateAvailable: true,
  },
  contentHash: fileHash(releaseDir, copiedFiles),
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(releaseDir, "release-record.json"), `${JSON.stringify(releaseRecord, null, 2)}\n`);

if (productionRelease && !learnerDeliveryReady) {
  console.error(`[Academy Studio] Production release blocked for ${courseId}: ${readinessFailures.join(", ")}`);
  process.exit(1);
}

console.log(
  `[Academy Studio] Built FINAL release for ${manifest.course.title}. Learner delivery ready: ${learnerDeliveryReady}.`,
);
