import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const courseArgIndex = process.argv.indexOf("--course");
const courseId = courseArgIndex >= 0 ? process.argv[courseArgIndex + 1] : null;
if (!courseId) {
  console.error("Usage: node studio/validate-ai-native-course.mjs --course <course-id>");
  process.exit(1);
}

const courseDir = path.join(root, "courses", courseId);
const errors = [];
const warnings = [];

function requiredFile(relativePath) {
  const filePath = path.join(courseDir, relativePath);
  if (!fs.existsSync(filePath)) errors.push(`Missing required file: ${relativePath}`);
  return filePath;
}

function optionalFile(...relativePaths) {
  return relativePaths.find((relativePath) => fs.existsSync(path.join(courseDir, relativePath))) ?? null;
}

function readJson(relativePath) {
  const filePath = requiredFile(relativePath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parseMinutes(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const minuteMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:min|minute|minutes)$/);
  if (minuteMatch) return Number(minuteMatch[1]);
  const hourMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:hour|hours|training hours)$/);
  if (hourMatch) return Number(hourMatch[1]) * 60;
  return null;
}

function listFiles(relativeDirectory) {
  const directory = path.join(courseDir, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else files.push(path.relative(courseDir, fullPath).replaceAll(path.sep, "/"));
    }
  };
  visit(directory);
  return files.sort();
}

const manifest = readJson("course-manifest.json");
requiredFile("instructor-manuscript.md");
requiredFile("learner-guide.md");
requiredFile("workbook.md");
requiredFile("assessment-bank.json");
requiredFile("answer-key.json");
requiredFile("ai-tutor-profile.json");
requiredFile("video-production-bible.md");
requiredFile("production-queue.json");

const sourceAsset = optionalFile("authoritative-source-register.json", "authoritative-sources.json");
if (!sourceAsset) errors.push("Missing authoritative source register");
const traceabilityAsset = optionalFile("eco-traceability.json", "lesson-traceability.json");
if (!traceabilityAsset) errors.push("Missing lesson or ECO traceability record");

const sourceRegister = sourceAsset ? readJson(sourceAsset) : null;
const traceability = traceabilityAsset ? readJson(traceabilityAsset) : null;
const tutor = readJson("ai-tutor-profile.json");
const assessment = readJson("assessment-bank.json");
const answerKey = readJson("answer-key.json");
const queue = readJson("production-queue.json");

if (manifest) {
  if (manifest.course?.id !== courseId) errors.push("Manifest course.id does not match --course");
  if (!Array.isArray(manifest.course?.modules) || manifest.course.modules.length === 0) {
    errors.push("Manifest requires a non-empty course.modules array");
  } else {
    const ids = manifest.course.modules.map((module) => module.id);
    if (new Set(ids).size !== ids.length) errors.push("Module identifiers must be unique");
    const durations = manifest.course.modules.map((module) => parseMinutes(module.duration));
    durations.forEach((duration, index) => {
      if (duration === null || !Number.isFinite(duration) || duration <= 0) {
        errors.push(`Module ${index + 1} has an invalid duration: ${manifest.course.modules[index].duration}`);
      }
    });
    if (!durations.includes(null)) {
      const totalMinutes = durations.reduce((sum, duration) => sum + duration, 0);
      const declaredMinutes = parseMinutes(manifest.course.duration);
      if (declaredMinutes !== null && totalMinutes !== declaredMinutes) {
        errors.push(
          `Module duration total ${totalMinutes} minutes does not equal declared duration ${declaredMinutes} minutes`,
        );
      }
      if (courseId === "pmp-exam-preparation-business-application" && totalMinutes !== 2100) {
        errors.push(`PMP course must total exactly 2,100 instructional minutes; found ${totalMinutes}`);
      }
    }
  }

  if (manifest.release?.publishToAcademy === true && !["approved", "published"].includes(manifest.release?.status)) {
    errors.push("publishToAcademy requires an approved or published release status");
  }
}

if (sourceRegister) {
  const sourceIds = new Set((sourceRegister.sources ?? []).map((source) => source.id));
  for (const requiredId of [
    "PMI-ECO-2026",
    "PMI-PMP-CERTIFICATION",
    "PMI-PMP-NEW-EXAM-2026",
    "PMI-ETHICS-2025",
  ]) {
    if (!sourceIds.has(requiredId)) errors.push(`Source register is missing ${requiredId}`);
  }
  for (const source of sourceRegister.sources ?? []) {
    if (!source.owner || !source.title || !source.sourceType || !source.retrievedDate || !source.url) {
      errors.push(`Source ${source.id ?? "unknown"} lacks required provenance fields`);
    }
    if (!Array.isArray(source.courseUse) || source.courseUse.length === 0) {
      errors.push(`Source ${source.id ?? "unknown"} lacks courseUse mappings`);
    }
    if (!source.limitations) errors.push(`Source ${source.id ?? "unknown"} lacks a limitations statement`);
  }
}

if (traceability) {
  const mappings = traceability.taskMappings ?? [];
  const taskIds = new Set(mappings.map((mapping) => mapping.taskId));
  if (taskIds.size !== 26) errors.push(`PMP ECO traceability requires 26 unique task mappings; found ${taskIds.size}`);
  for (const mapping of mappings) {
    if (!mapping.domain || !mapping.task || !Array.isArray(mapping.primaryModules) || mapping.primaryModules.length === 0) {
      errors.push(`Task mapping ${mapping.taskId ?? "unknown"} is incomplete`);
    }
    if (!Array.isArray(mapping.artifacts) || mapping.artifacts.length === 0) {
      errors.push(`Task mapping ${mapping.taskId ?? "unknown"} has no business artifact`);
    }
    if (!Array.isArray(mapping.assessmentModes) || mapping.assessmentModes.length === 0) {
      errors.push(`Task mapping ${mapping.taskId ?? "unknown"} has no assessment mode`);
    }
  }
}

if (tutor) {
  if (tutor.access?.entitlementRequired !== true) errors.push("AI tutor must require a valid course entitlement");
  if (tutor.access?.availableBeforePurchase !== false) errors.push("AI tutor must remain unavailable before purchase");
  if (tutor.access?.contentScope !== "this-course-only") errors.push("AI tutor must be course scoped");
  if (tutor.assessmentIntegrity?.duringProtectedAssessment?.tutorStatus !== "locked") {
    errors.push("AI tutor must be locked during protected assessments");
  }
  if (tutor.assessmentIntegrity?.duringProtectedAssessment?.answerAssistance !== "prohibited") {
    errors.push("Protected-assessment answer assistance must be prohibited");
  }
  if (tutor.continuousLearning?.selfModification !== false) {
    errors.push("Continuous personalization must not permit uncontrolled self-modification");
  }
  if (tutor.grounding?.requireSourceIdForFactualClaims !== true) {
    errors.push("AI tutor factual claims must require approved source identifiers");
  }
}

if (assessment && answerKey) {
  const questions = assessment.questions ?? [];
  const questionIds = questions.map((question) => question.id);
  if (new Set(questionIds).size !== questionIds.length) errors.push("Assessment question identifiers must be unique");
  if (assessment.currentQuestionCount !== questions.length) {
    errors.push(
      `assessment.currentQuestionCount ${assessment.currentQuestionCount} does not equal questions.length ${questions.length}`,
    );
  }
  const answerMap = new Map((answerKey.answers ?? []).map((answer) => [answer.questionId, answer]));
  for (const question of questions) {
    if (!answerMap.has(question.id)) errors.push(`Answer key is missing ${question.id}`);
    if (!question.rationale) errors.push(`Question ${question.id} lacks a rationale`);
    if (!Array.isArray(question.sourceIds) || question.sourceIds.length === 0) {
      errors.push(`Question ${question.id} lacks a source mapping`);
    }
    if (!question.originalityAttestation) errors.push(`Question ${question.id} lacks an originality attestation`);
  }

  const blockedQuestions = questions.filter((question) => question.qualityFlag).map((question) => question.id);
  const targetQuestionCount = assessment.targetQuestionCount ?? questions.length;
  const publicRelease = manifest?.release?.publishToAcademy === true
    && ["approved", "published"].includes(manifest?.release?.status);
  if (publicRelease && questions.length !== targetQuestionCount) {
    errors.push(`Public release requires ${targetQuestionCount} assessment questions; found ${questions.length}`);
  }
  if (publicRelease && blockedQuestions.length > 0) {
    errors.push(`Public release contains blocked assessment items: ${blockedQuestions.join(", ")}`);
  }
  if (!publicRelease && questions.length < targetQuestionCount) {
    warnings.push(`Assessment bank remains in development: ${questions.length}/${targetQuestionCount} questions`);
  }
  if (!publicRelease && blockedQuestions.length > 0) {
    warnings.push(`Assessment items blocked for correction: ${blockedQuestions.join(", ")}`);
  }
}

const videoScripts = listFiles("video-scripts").filter((file) => file.endsWith(".md"));
const renderedVideo = [
  ...listFiles("video"),
  ...listFiles("media"),
].filter((file) => /\.(mp4|mov|m4v|webm)$/i.test(file));
const captions = listFiles("captions").filter((file) => /\.(vtt|srt)$/i.test(file));
const transcripts = listFiles("transcripts").filter((file) => /\.(md|txt|html|pdf)$/i.test(file));
const publicRelease = manifest?.release?.publishToAcademy === true
  && ["approved", "published"].includes(manifest?.release?.status);

if (publicRelease) {
  const instructionalVideoCount = (manifest.course?.modules ?? []).filter(
    (module) => module.format !== "Assessment",
  ).length;
  if (videoScripts.length < instructionalVideoCount) {
    errors.push(`Public release requires at least ${instructionalVideoCount} video scripts; found ${videoScripts.length}`);
  }
  if (renderedVideo.length < instructionalVideoCount) {
    errors.push(`Public release requires at least ${instructionalVideoCount} rendered videos; found ${renderedVideo.length}`);
  }
  if (captions.length < instructionalVideoCount) {
    errors.push(`Public release requires at least ${instructionalVideoCount} caption files; found ${captions.length}`);
  }
  if (transcripts.length < instructionalVideoCount) {
    errors.push(`Public release requires at least ${instructionalVideoCount} transcripts; found ${transcripts.length}`);
  }
  requiredFile("rights-ledger.json");
} else {
  warnings.push(`Video production remains in development: ${videoScripts.length} scripts, ${renderedVideo.length} renders, ${captions.length} captions, ${transcripts.length} transcripts`);
}

if (queue?.releaseStatus !== "not-ready" && !publicRelease) {
  warnings.push("Production queue releaseStatus should remain not-ready until all release gates pass");
}

if (warnings.length) {
  for (const warning of warnings) console.warn(`[Academy Studio] WARNING: ${warning}`);
}
if (errors.length) {
  for (const error of errors) console.error(`[Academy Studio] ERROR: ${error}`);
  process.exit(1);
}

console.log(
  `[Academy Studio] AI-native course structure validated for ${courseId}. Draft-production warnings may remain until release assets are complete.`,
);
