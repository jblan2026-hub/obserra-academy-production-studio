import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { restoreHollywoodCheckpoints } from "./academy-hollywood-checkpoints.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function bindExactCourseScope() {
  const courseId = String(process.env.ACADEMY_COURSE_ID || "").trim();
  if (!courseId) return null;

  const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(coursesRoot, id, "course-manifest.json")))
    .sort();
  const courseIndex = courseIds.indexOf(courseId);
  if (courseIndex < 0) throw new Error(`ACADEMY_COURSE_ID=${courseId} is not a governed Academy course.`);

  process.env.ACADEMY_SHARD_INDEX = String(courseIndex);
  process.env.ACADEMY_SHARD_COUNT = String(courseIds.length);
  return courseId;
}

const exactCourseId = bindExactCourseScope();
const summary = await restoreHollywoodCheckpoints();
let researchRestored = 0;
let reviewRestored = 0;
for (const courseId of summary.restoredCourseIds || []) {
  const courseRoot = path.join(root, "courses", courseId);
  const packagePath = path.join(courseRoot, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(packagePath)) continue;
  const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (envelope.protectedEvidence?.research) {
    writePrivateJson(
      path.join(courseRoot, "generated", "research", "authoritative-source-research.json"),
      envelope.protectedEvidence.research,
    );
    researchRestored += 1;
  }
  if (envelope.protectedEvidence?.independentReview) {
    writePrivateJson(
      path.join(courseRoot, "generated", "quality", "independent-course-quality-review.json"),
      envelope.protectedEvidence.independentReview,
    );
    reviewRestored += 1;
  }
}
console.log(
  `[Academy Studio] Cinematic checkpoint restore${exactCourseId ? ` for ${exactCourseId}` : ""} evaluated ${summary.evaluated} course(s), restored ${summary.restored} package(s), ${researchRestored} research record(s), and ${reviewRestored} independent review record(s).`,
);
