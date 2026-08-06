import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrandAndTags } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");

function fail(message) {
  console.error(`[Academy Studio] ${message}`);
  process.exitCode = 1;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validateManifest(manifest, file) {
  const errors = [];
  const course = manifest?.course;
  const commerce = manifest?.commerce;
  const completion = manifest?.completion;
  const release = manifest?.release;
  const reviews = manifest?.reviews;

  if (manifest?.schemaVersion !== "1.0") errors.push("schemaVersion must equal 1.0");
  if (!course?.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(course.id)) errors.push("course.id must be a lowercase slug");
  if (!course?.title || course.title.length < 8) errors.push("course.title is required");
  if (!Array.isArray(course?.outcomes) || course.outcomes.length < 3) errors.push("course.outcomes requires at least 3 outcomes");
  if (!Array.isArray(course?.modules) || course.modules.length < 3) errors.push("course.modules requires at least 3 modules");
  if (commerce?.model !== "one-time-payment") errors.push("commerce.model must be one-time-payment");
  if (commerce?.accessPolicy !== "until-completion") errors.push("commerce.accessPolicy must be until-completion");
  if (typeof commerce?.price !== "number" || commerce.price < 0) errors.push("commerce.price must be a non-negative number");
  if (completion?.allLessonsRequired !== true) errors.push("completion.allLessonsRequired must be true");
  if (completion?.assessmentRequired !== true) errors.push("completion.assessmentRequired must be true");
  if (!Number.isInteger(completion?.passingScore) || completion.passingScore < 70 || completion.passingScore > 100) errors.push("completion.passingScore must be 70-100");
  if (completion?.certificateIssued !== true) errors.push("completion.certificateIssued must be true");
  if (!/^\d+\.\d+\.\d+$/.test(release?.version || "")) errors.push("release.version must use semantic versioning");
  if (!["draft", "review", "approved", "published"].includes(release?.status)) errors.push("release.status is invalid");

  const requiredReviews = ["subjectMatter", "technical", "brand", "accessibility"];
  for (const name of requiredReviews) {
    if (!reviews?.[name]) errors.push(`reviews.${name} is required`);
  }

  if (["approved", "published"].includes(release?.status)) {
    for (const [name, review] of Object.entries(reviews || {})) {
      if (review?.required && review.status !== "approved") errors.push(`reviews.${name} must be approved before release`);
    }
  }

  errors.push(...validateBrandAndTags(manifest));

  if (errors.length) {
    for (const error of errors) fail(`${file}: ${error}`);
    return false;
  }
  return true;
}

if (!fs.existsSync(coursesRoot)) {
  fail(`Missing courses directory: ${coursesRoot}`);
} else {
  const manifests = fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(coursesRoot, entry.name, "course-manifest.json"))
    .filter((file) => fs.existsSync(file));

  if (!manifests.length) fail("No course manifests found");
  let valid = 0;
  for (const file of manifests) {
    const manifest = readJson(file);
    if (manifest && validateManifest(manifest, file)) valid += 1;
  }
  if (!process.exitCode) console.log(`[Academy Studio] Validated ${valid} officially branded, tagged, informational-only course manifest(s)`);
}
