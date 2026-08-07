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

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const releaseDir = path.join(root, "releases", courseId, "FINAL");
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

function copyPathIfPresent(relativePath) {
  const source = path.join(sourceDir, relativePath);
  const destination = path.join(releaseDir, relativePath);
  if (!fs.existsSync(source)) return false;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) fs.cpSync(source, destination, { recursive: true });
  else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return true;
}

function firstExisting(...relativePaths) {
  return relativePaths.find((relativePath) => fs.existsSync(path.join(sourceDir, relativePath))) ?? null;
}

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

const enhancedAssets = [
  "authoritative-source-register.json",
  "authoritative-sources.json",
  "eco-traceability.json",
  "lesson-traceability.json",
  "ai-tutor-profile.json",
  "video-production-bible.md",
  "visual-brief.md",
  "rights-ledger.json",
  "trademark-and-independence-notice.md",
  "course-qa.json",
  "video-scripts",
  "storyboards",
  "assessment-sections",
  "case-studies",
  "source-cards",
  "video",
  "media",
  "captions",
  "transcripts",
];

for (const asset of standardAssets) copyPathIfPresent(asset);
for (const asset of enhancedAssets) copyPathIfPresent(asset);

const aiNative = manifest.course.aiNative === true
  || fs.existsSync(path.join(sourceDir, "ai-tutor-profile.json"))
  || fs.existsSync(path.join(sourceDir, "video-production-bible.md"));

const required = [
  "course-manifest.json",
  "instructor-manuscript.md",
  "learner-guide.md",
  "assessment-bank.json",
  "answer-key.json",
];

if (aiNative) {
  required.push("workbook.md", "ai-tutor-profile.json", "video-production-bible.md");
  const authoritativeSourceAsset = firstExisting(
    "authoritative-source-register.json",
    "authoritative-sources.json",
  );
  const traceabilityAsset = firstExisting("eco-traceability.json", "lesson-traceability.json");
  if (!authoritativeSourceAsset) required.push("authoritative-source-register.json or authoritative-sources.json");
  if (!traceabilityAsset) required.push("eco-traceability.json or lesson-traceability.json");
}

const missing = required.filter((asset) => {
  if (asset.includes(" or ")) return true;
  return !fs.existsSync(path.join(releaseDir, asset));
});
if (missing.length) {
  console.error(`[Academy Studio] Missing required production assets: ${missing.join(", ")}`);
  process.exit(1);
}

const releaseRequiresRenderedVideo = ["approved", "published"].includes(manifest.release.status)
  && manifest.release.publishToAcademy === true
  && aiNative;
if (releaseRequiresRenderedVideo) {
  const requiredReleaseAssets = ["video", "captions", "transcripts", "rights-ledger.json"];
  const missingReleaseAssets = requiredReleaseAssets.filter(
    (asset) => !fs.existsSync(path.join(releaseDir, asset)),
  );
  if (missingReleaseAssets.length) {
    console.error(
      `[Academy Studio] AI-native public release is blocked until rendered and governed media assets exist: ${missingReleaseAssets.join(", ")}`,
    );
    process.exit(1);
  }
}

function listFiles(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, base));
    else files.push(path.relative(base, fullPath).replaceAll(path.sep, "/"));
  }
  return files.sort();
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const nestedLessons = (manifest.course.modules ?? []).flatMap((module) => module.lessons ?? []);
const assetInventory = listFiles(releaseDir).map((relativePath) => {
  const filePath = path.join(releaseDir, relativePath);
  return {
    path: relativePath,
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  };
});

const productionCapabilities = {
  authoritativeSources: Boolean(firstExisting(
    "authoritative-source-register.json",
    "authoritative-sources.json",
  )),
  curriculumTraceability: Boolean(firstExisting(
    "eco-traceability.json",
    "lesson-traceability.json",
  )),
  aiTutorProfile: fs.existsSync(path.join(releaseDir, "ai-tutor-profile.json")),
  videoProductionBible: fs.existsSync(path.join(releaseDir, "video-production-bible.md")),
  videoScripts: fs.existsSync(path.join(releaseDir, "video-scripts")),
  storyboards: fs.existsSync(path.join(releaseDir, "storyboards")),
  renderedVideo: fs.existsSync(path.join(releaseDir, "video"))
    || fs.existsSync(path.join(releaseDir, "media")),
  captions: fs.existsSync(path.join(releaseDir, "captions")),
  transcripts: fs.existsSync(path.join(releaseDir, "transcripts")),
  rightsLedger: fs.existsSync(path.join(releaseDir, "rights-ledger.json")),
  productionQueue: fs.existsSync(path.join(releaseDir, "production-queue.json")),
};

const releaseRecord = {
  schemaVersion: "1.2",
  courseId: manifest.course.id,
  title: manifest.course.title,
  version: manifest.release.version,
  releaseStatus: manifest.release.status,
  publishToAcademy: manifest.release.publishToAcademy,
  generatedAt: new Date().toISOString(),
  sourceOfTruth: manifest.course.sourceOfTruth ?? null,
  instructionalHours: manifest.course.instructionalHours ?? manifest.course.duration ?? null,
  lessonCount: manifest.course.lessonCount ?? manifest.course.modules?.length ?? nestedLessons.length,
  aiNative,
  examAlignment: manifest.course.examAlignment ?? null,
  trademarkNotice: manifest.trademarkNotice ?? null,
  commerce: manifest.commerce,
  completion: manifest.completion,
  access: aiNative
    ? {
        tutorActivation: "after-confirmed-paid-access",
        courseScoped: true,
        assessmentAnswerDisclosure: false,
      }
    : null,
  productionCapabilities,
  assetInventory,
};
fs.writeFileSync(
  path.join(releaseDir, "release-record.json"),
  `${JSON.stringify(releaseRecord, null, 2)}\n`,
);
console.log(
  `[Academy Studio] Built FINAL release for ${manifest.course.title} with ${assetInventory.length} packaged asset(s)`,
);
