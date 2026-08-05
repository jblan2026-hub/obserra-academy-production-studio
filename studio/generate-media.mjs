import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateWithSynthesia } from "./providers/synthesia.mjs";
import { generateWithHeyGen } from "./providers/heygen.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const courseId = arg("--course");
const providerName = arg("--provider") || process.env.ACADEMY_VIDEO_PROVIDER || "synthesia";
if (!courseId) {
  console.error("Usage: node studio/generate-media.mjs --course <course-id> [--provider synthesia|heygen]");
  process.exit(1);
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const manuscriptPath = path.join(courseDir, "instructor-manuscript.md");
if (!fs.existsSync(manifestPath) || !fs.existsSync(manuscriptPath)) {
  console.error(`[Academy Studio] Missing manifest or instructor manuscript for ${courseId}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const manuscript = fs.readFileSync(manuscriptPath, "utf8");
const outputDirectory = path.join(courseDir, "generated", "video-jobs");
const provider = providerName === "heygen" ? generateWithHeyGen : generateWithSynthesia;
const results = [];

for (const module of manifest.course.modules.filter((item) => item.format !== "Assessment")) {
  const heading = `## ${module.title}`;
  const start = manuscript.indexOf(heading);
  const remainder = start >= 0 ? manuscript.slice(start + heading.length) : manuscript;
  const nextHeading = remainder.indexOf("\n## ");
  const script = (nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder).trim();

  const result = await provider({
    courseId,
    courseTitle: manifest.course.title,
    lessonId: module.id,
    lessonTitle: module.title,
    artifactKind: "training-video",
    script,
    outputDirectory,
  });
  results.push({ lessonId: module.id, ...result });
}

fs.mkdirSync(outputDirectory, { recursive: true });
const batchPath = path.join(outputDirectory, "batch-summary.json");
fs.writeFileSync(batchPath, `${JSON.stringify({ courseId, provider: providerName, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(`[Academy Studio] Submitted ${results.length} lesson video job(s) through ${providerName}`);
