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

const copyIfPresent = (name) => {
  const source = path.join(sourceDir, name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(releaseDir, name));
};

for (const file of [
  "course-manifest.json",
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "release-notes.md",
]) copyIfPresent(file);

const required = ["course-manifest.json", "instructor-manuscript.md", "learner-guide.md", "assessment-bank.json", "answer-key.json"];
const missing = required.filter((file) => !fs.existsSync(path.join(releaseDir, file)));
if (missing.length) {
  console.error(`[Academy Studio] Missing required production assets: ${missing.join(", ")}`);
  process.exit(1);
}

const releaseRecord = {
  schemaVersion: "1.0",
  courseId: manifest.course.id,
  title: manifest.course.title,
  version: manifest.release.version,
  releaseStatus: manifest.release.status,
  publishToAcademy: manifest.release.publishToAcademy,
  commerce: manifest.commerce,
  completion: manifest.completion,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(releaseDir, "release-record.json"), `${JSON.stringify(releaseRecord, null, 2)}\n`);
console.log(`[Academy Studio] Built FINAL release for ${manifest.course.title}`);
