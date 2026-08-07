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

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const releaseDir = path.join(root, "releases", courseId, "FINAL");
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

const copyPathIfPresent = (name) => {
  const source = path.join(sourceDir, name);
  const destination = path.join(releaseDir, name);
  if (!fs.existsSync(source)) return false;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return true;
};

const standardAssets = [
  "course-manifest.json",
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "release-notes.md",
  "production-queue.json",
];

const aiNativeAssets = [
  "authoritative-sources.json",
  "lesson-traceability.json",
  "ai-tutor-profile.json",
  "video-production-bible.md",
  "video",
];

for (const asset of standardAssets) copyPathIfPresent(asset);
if (manifest.course.aiNative === true) {
  for (const asset of aiNativeAssets) copyPathIfPresent(asset);
}

const required = [
  "course-manifest.json",
  "instructor-manuscript.md",
  "learner-guide.md",
  "assessment-bank.json",
  "answer-key.json",
];
if (manifest.course.aiNative === true) {
  required.push(
    "workbook.md",
    "authoritative-sources.json",
    "lesson-traceability.json",
    "ai-tutor-profile.json",
    "video-production-bible.md",
    "video",
  );
}

const missing = required.filter((asset) => !fs.existsSync(path.join(releaseDir, asset)));
if (missing.length) {
  console.error(`[Academy Studio] Missing required production assets: ${missing.join(", ")}`);
  process.exit(1);
}

const nestedLessons = (manifest.course.modules ?? []).flatMap((module) => module.lessons ?? []);
const releaseRecord = {
  schemaVersion: "1.1",
  courseId: manifest.course.id,
  title: manifest.course.title,
  version: manifest.release.version,
  releaseStatus: manifest.release.status,
  publishToAcademy: manifest.release.publishToAcademy,
  generatedAt: new Date().toISOString(),
  sourceOfTruth: manifest.course.sourceOfTruth ?? null,
  instructionalHours: manifest.course.instructionalHours ?? null,
  lessonCount: manifest.course.lessonCount ?? nestedLessons.length,
  aiNative: manifest.course.aiNative === true,
  examAlignment: manifest.course.examAlignment ?? null,
  trademarkNotice: manifest.trademarkNotice ?? null,
  commerce: manifest.commerce,
  completion: manifest.completion,
  access: manifest.course.aiNative === true
    ? {
        tutorActivation: "after-confirmed-paid-access",
        courseScoped: true,
        assessmentAnswerDisclosure: false,
      }
    : null,
  packagedAssets: [...standardAssets, ...(manifest.course.aiNative === true ? aiNativeAssets : [])]
    .filter((asset) => fs.existsSync(path.join(releaseDir, asset))),
};
fs.writeFileSync(path.join(releaseDir, "release-record.json"), `${JSON.stringify(releaseRecord, null, 2)}\n`);
console.log(`[Academy Studio] Built FINAL release for ${manifest.course.title}`);
