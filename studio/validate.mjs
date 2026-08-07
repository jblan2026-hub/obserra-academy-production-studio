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

function requiredAssetErrors(courseDir, assetNames) {
  return assetNames
    .filter((name) => !fs.existsSync(path.join(courseDir, name)))
    .map((name) => `AI-native course is missing required asset ${name}`);
}

function validateAiNativeCourse(manifest, file) {
  const errors = [];
  const course = manifest.course;
  const courseDir = path.dirname(file);

  if (typeof course.instructionalHours !== "number" || course.instructionalHours <= 0) {
    errors.push("course.instructionalHours must be a positive number for an AI-native course");
  }
  if (!Number.isInteger(course.lessonCount) || course.lessonCount < 1) {
    errors.push("course.lessonCount must be a positive integer for an AI-native course");
  }
  if (typeof course.sourceOfTruth !== "string" || course.sourceOfTruth.trim().length < 10) {
    errors.push("course.sourceOfTruth is required for an AI-native course");
  }

  const lessons = [];
  for (const module of course.modules ?? []) {
    if (!Array.isArray(module.lessons) || module.lessons.length < 1) {
      errors.push(`module ${module.id ?? "unknown"} requires at least one lesson`);
      continue;
    }
    for (const lesson of module.lessons) lessons.push({ moduleId: module.id, ...lesson });
  }

  if (Number.isInteger(course.lessonCount) && lessons.length !== course.lessonCount) {
    errors.push(`course.lessonCount is ${course.lessonCount} but ${lessons.length} nested lessons were found`);
  }

  const lessonIds = new Set();
  let totalMinutes = 0;
  for (const lesson of lessons) {
    if (!lesson.id || lessonIds.has(lesson.id)) errors.push(`lesson id ${lesson.id ?? "missing"} is missing or duplicated`);
    lessonIds.add(lesson.id);
    if (!Number.isInteger(lesson.durationMinutes) || lesson.durationMinutes < 1) {
      errors.push(`lesson ${lesson.id ?? "unknown"} requires durationMinutes`);
    } else {
      totalMinutes += lesson.durationMinutes;
    }
    if (!Array.isArray(lesson.objectives) || lesson.objectives.length < 1) {
      errors.push(`lesson ${lesson.id ?? "unknown"} requires objectives`);
    }
    if (!Array.isArray(lesson.sourceIds) || lesson.sourceIds.length < 1) {
      errors.push(`lesson ${lesson.id ?? "unknown"} requires at least one authoritative source id`);
    }
  }

  if (typeof course.instructionalHours === "number" && totalMinutes !== course.instructionalHours * 60) {
    errors.push(`nested lesson minutes total ${totalMinutes}, expected ${course.instructionalHours * 60} for ${course.instructionalHours} instructional hours`);
  }

  const requiredAssets = [
    "authoritative-sources.json",
    "ai-tutor-profile.json",
    "video-production-bible.md",
    "lesson-traceability.json",
    "instructor-manuscript.md",
    "learner-guide.md",
    "workbook.md",
    "assessment-bank.json",
    "answer-key.json",
  ];
  errors.push(...requiredAssetErrors(courseDir, requiredAssets));

  const sourcePath = path.join(courseDir, "authoritative-sources.json");
  if (fs.existsSync(sourcePath)) {
    const sourceRegister = readJson(sourcePath);
    const sourceIds = new Set((sourceRegister?.sources ?? []).map((source) => source.id));
    for (const lesson of lessons) {
      for (const sourceId of lesson.sourceIds ?? []) {
        if (!sourceIds.has(sourceId)) errors.push(`lesson ${lesson.id} references unknown source id ${sourceId}`);
      }
    }
  }

  const tutorPath = path.join(courseDir, "ai-tutor-profile.json");
  if (fs.existsSync(tutorPath)) {
    const tutor = readJson(tutorPath);
    if (tutor?.access?.activation !== "after-confirmed-paid-access") {
      errors.push("AI tutor access.activation must be after-confirmed-paid-access");
    }
    if (tutor?.access?.crossCourseAccess !== false) {
      errors.push("AI tutor access.crossCourseAccess must be false");
    }
    if (tutor?.assessmentMode?.answerDisclosure !== false) {
      errors.push("AI tutor assessmentMode.answerDisclosure must be false");
    }
    if (tutor?.adaptiveLearning?.selfModification !== false || tutor?.adaptiveLearning?.policyModification !== false) {
      errors.push("AI tutor must prohibit self-modification and policy modification");
    }
  }

  for (const reviewName of ["assessmentIntegrity", "videoProduction", "aiTutor"]) {
    if (!manifest.reviews?.[reviewName]?.required) errors.push(`reviews.${reviewName} must be required for an AI-native course`);
  }

  if (course.examAlignment) {
    if (manifest.trademarkNotice?.trim().length < 20) errors.push("exam-aligned course requires a trademark and independence notice");
    if (course.examAlignment.examSuccessGuaranteed !== false) errors.push("exam-aligned course must not guarantee exam success");
    if (course.examAlignment.examDumpsProhibited !== true) errors.push("exam-aligned course must prohibit exam dumps");
    if (course.examAlignment.originalPracticeQuestionsRequired !== true) errors.push("exam-aligned course must require original practice questions");
  }

  return errors;
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
  if (!Array.isArray(course?.modules) || course.modules.length < 1) errors.push("course.modules requires at least 1 module");
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

  if (course?.aiNative === true) errors.push(...validateAiNativeCourse(manifest, file));

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
