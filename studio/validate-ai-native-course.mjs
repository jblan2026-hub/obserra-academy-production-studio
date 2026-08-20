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

function readJson(relativePath, required = true) {
  const filePath = required ? requiredFile(relativePath) : path.join(courseDir, relativePath);
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
  const hourMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:hour|hours|hr|hrs|training hours)/);
  const minuteMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:min|minute|minutes|mins)/);
  if (!hourMatch && !minuteMatch) return null;
  return Number(hourMatch?.[1] ?? 0) * 60 + Number(minuteMatch?.[1] ?? 0);
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

function unique(values) {
  return new Set(values.filter(Boolean));
}

function normalizedDomain(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(" ", "");
}

function isPublicRelease(manifest) {
  return manifest?.release?.publishToAcademy === true
    && ["approved", "published"].includes(String(manifest?.release?.status ?? "").toLowerCase());
}

const manifest = readJson("course-manifest.json");
for (const file of [
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "assessment-delivery-policy.json",
  "ai-tutor-profile.json",
  "video-production-bible.md",
  "production-queue.json",
  "rights-ledger.json",
]) requiredFile(file);

const sourceFiles = fs.existsSync(courseDir)
  ? fs.readdirSync(courseDir)
    .filter((name) => /^authoritative-(?:source-register|sources.*)\.json$/i.test(name))
    .sort()
  : [];
if (sourceFiles.length === 0) errors.push("Missing authoritative source register");

const sourceDocuments = sourceFiles.map((name) => readJson(name)).filter(Boolean);
const sourceEntries = sourceDocuments.flatMap((document) => Array.isArray(document.sources) ? document.sources : []);
const sourceIds = unique(sourceEntries.map((source) => source.id));

const traceabilityFile = optionalFile("lesson-traceability.json", "eco-traceability.json");
if (!traceabilityFile) errors.push("Missing lesson or ECO traceability record");
const traceability = traceabilityFile ? readJson(traceabilityFile) : null;
const crosswalk = readJson("exam-domain-crosswalk.json", false);
const tutor = readJson("ai-tutor-profile.json");
const assessment = readJson("assessment-bank.json");
const answerKey = readJson("answer-key.json");
const assessmentPolicy = readJson("assessment-delivery-policy.json");
const queue = readJson("production-queue.json");
const rightsLedger = readJson("rights-ledger.json");

let manifestLessons = [];
let manifestModules = [];
if (manifest) {
  if (manifest.course?.id !== courseId) errors.push("Manifest course.id does not match --course");
  if (manifest.course?.aiNative !== true) errors.push("AI-native course manifest must set course.aiNative to true");
  if (!String(manifest.course?.sourceOfTruth ?? "").trim()) errors.push("AI-native course requires course.sourceOfTruth");

  manifestModules = Array.isArray(manifest.course?.modules) ? manifest.course.modules : [];
  if (manifestModules.length === 0) {
    errors.push("Manifest requires a non-empty course.modules array");
  } else {
    const moduleIds = manifestModules.map((module) => module.id);
    if (unique(moduleIds).size !== moduleIds.length) errors.push("Module identifiers must be unique");

    let moduleTotalMinutes = 0;
    for (const [moduleIndex, module] of manifestModules.entries()) {
      const moduleMinutes = parseMinutes(module.duration);
      if (!Number.isFinite(moduleMinutes) || moduleMinutes <= 0) {
        errors.push(`Module ${moduleIndex + 1} has an invalid duration: ${module.duration}`);
        continue;
      }
      moduleTotalMinutes += moduleMinutes;

      const lessons = Array.isArray(module.lessons) ? module.lessons : [];
      manifestLessons.push(...lessons.map((lesson) => ({ ...lesson, moduleId: module.id })));
      if (lessons.length > 0) {
        const lessonTotalMinutes = lessons.reduce((sum, lesson, lessonIndex) => {
          const minutes = Number(lesson.durationMinutes);
          if (!Number.isFinite(minutes) || minutes <= 0) {
            errors.push(`Module ${module.id} lesson ${lessonIndex + 1} has an invalid durationMinutes`);
            return sum;
          }
          return sum + minutes;
        }, 0);
        if (lessonTotalMinutes !== moduleMinutes) {
          errors.push(`Module ${module.id} lesson duration total ${lessonTotalMinutes} does not equal module duration ${moduleMinutes}`);
        }
      }
    }

    const declaredMinutes = parseMinutes(manifest.course.duration);
    if (declaredMinutes !== null && moduleTotalMinutes !== declaredMinutes) {
      errors.push(`Module duration total ${moduleTotalMinutes} minutes does not equal declared duration ${declaredMinutes} minutes`);
    }
    if (courseId === "pmp-exam-prep-business-application" && moduleTotalMinutes !== 2100) {
      errors.push(`PMP course must total exactly 2,100 instructional minutes; found ${moduleTotalMinutes}`);
    }
  }

  const lessonIds = manifestLessons.map((lesson) => lesson.id);
  if (unique(lessonIds).size !== lessonIds.length) errors.push("Lesson identifiers must be unique");
  if (manifest.course?.lessonCount !== undefined && Number(manifest.course.lessonCount) !== manifestLessons.length) {
    errors.push(`course.lessonCount ${manifest.course.lessonCount} does not equal nested lesson count ${manifestLessons.length}`);
  }
  if (courseId === "pmp-exam-prep-business-application" && manifestLessons.length !== 35) {
    errors.push(`PMP course requires exactly 35 defined lessons; found ${manifestLessons.length}`);
  }

  if (manifest.release?.publishToAcademy === true && !["approved", "published"].includes(String(manifest.release?.status ?? "").toLowerCase())) {
    errors.push("publishToAcademy requires an approved or published release status");
  }
}

if (sourceEntries.length > 0) {
  for (const requiredId of [
    "PMI-ECO-2026",
    "PMI-PMP-CERTIFICATION-2026",
    "PMI-PMP-EXAM-UPDATE-2026",
    "PMI-ETHICS-2025",
  ]) {
    if (!sourceIds.has(requiredId)) errors.push(`Source register is missing ${requiredId}`);
  }

  for (const source of sourceEntries) {
    const retrievedAt = source.retrievedAt ?? source.retrievedDate;
    const courseUse = source.authoritativeFor ?? source.courseUse;
    const limitations = source.usageLimitations ?? source.limitations;
    if (!source.id || !source.owner || !source.title || !source.sourceType || !retrievedAt || !source.url) {
      errors.push(`Source ${source.id ?? "unknown"} lacks required provenance fields`);
    }
    if (!Array.isArray(courseUse) || courseUse.length === 0) {
      errors.push(`Source ${source.id ?? "unknown"} lacks course-use mappings`);
    }
    if (!String(limitations ?? "").trim()) errors.push(`Source ${source.id ?? "unknown"} lacks a limitations statement`);
  }
}

const manifestLessonIds = unique(manifestLessons.map((lesson) => lesson.id));
for (const lesson of manifestLessons) {
  if (!Array.isArray(lesson.sourceIds) || lesson.sourceIds.length === 0) {
    errors.push(`Lesson ${lesson.id ?? "unknown"} lacks sourceIds`);
  } else {
    for (const sourceId of lesson.sourceIds) {
      if (!sourceIds.has(sourceId)) errors.push(`Lesson ${lesson.id} maps to unknown source ${sourceId}`);
    }
  }
  if (!Array.isArray(lesson.objectives) || lesson.objectives.length === 0) {
    errors.push(`Lesson ${lesson.id ?? "unknown"} lacks learning objectives`);
  }
}

if (traceability) {
  const records = Array.isArray(traceability.records)
    ? traceability.records
    : Array.isArray(traceability.taskMappings)
      ? traceability.taskMappings
      : [];
  if (records.length === 0) errors.push("Traceability record contains no mappings");

  if (Array.isArray(traceability.records)) {
    const tracedLessonIds = unique(records.map((record) => record.lessonId));
    if (manifestLessons.length > 0 && tracedLessonIds.size !== manifestLessons.length) {
      errors.push(`Lesson traceability requires ${manifestLessons.length} unique lesson records; found ${tracedLessonIds.size}`);
    }
    for (const record of records) {
      if (!record.lessonId || !manifestLessonIds.has(record.lessonId)) errors.push(`Traceability contains unknown lesson ${record.lessonId ?? "missing"}`);
      if (!record.moduleId || !record.domain || !record.businessArtifact || !record.videoPackage || !record.aiTutorMode) {
        errors.push(`Lesson traceability record ${record.lessonId ?? "unknown"} is incomplete`);
      }
      if (!Array.isArray(record.sourceIds) || record.sourceIds.length === 0) {
        errors.push(`Lesson traceability record ${record.lessonId ?? "unknown"} lacks sources`);
      } else {
        for (const sourceId of record.sourceIds) {
          if (!sourceIds.has(sourceId)) errors.push(`Traceability record ${record.lessonId} maps to unknown source ${sourceId}`);
        }
      }
    }
  }
}

if (crosswalk) {
  const tasks = Array.isArray(crosswalk.tasks) ? crosswalk.tasks : [];
  const taskIds = unique(tasks.map((task) => task.taskId));
  if (taskIds.size !== 26) errors.push(`PMP ECO crosswalk requires 26 unique task mappings; found ${taskIds.size}`);

  const domainCounts = tasks.reduce((counts, task) => {
    const domain = normalizedDomain(task.domain);
    counts[domain] = (counts[domain] ?? 0) + 1;
    return counts;
  }, {});
  if (domainCounts.people !== 8) errors.push(`PMP ECO crosswalk requires 8 People tasks; found ${domainCounts.people ?? 0}`);
  if (domainCounts.process !== 10) errors.push(`PMP ECO crosswalk requires 10 Process tasks; found ${domainCounts.process ?? 0}`);
  if (domainCounts.businessenvironment !== 8) errors.push(`PMP ECO crosswalk requires 8 Business Environment tasks; found ${domainCounts.businessenvironment ?? 0}`);

  for (const task of tasks) {
    if (!task.taskId || !task.domain || !task.internalLabel || !Array.isArray(task.coverage) || task.coverage.length === 0) {
      errors.push(`ECO task mapping ${task.taskId ?? "unknown"} is incomplete`);
    }
    if (!Array.isArray(task.applicationSkills) || task.applicationSkills.length === 0) {
      errors.push(`ECO task mapping ${task.taskId ?? "unknown"} has no application skills`);
    }
    if (!Array.isArray(task.examPreparation) || task.examPreparation.length === 0) {
      errors.push(`ECO task mapping ${task.taskId ?? "unknown"} has no exam-preparation mode`);
    }
  }
}

if (tutor) {
  const entitlementRequired = tutor.access?.activation === "after-confirmed-paid-access"
    || tutor.access?.entitlementRequired === true;
  const courseScoped = tutor.access?.scope === "named-learner-and-purchased-course-only"
    || tutor.access?.contentScope === "this-course-only";
  const assessmentLocked = tutor.assessmentMode?.answerDisclosure === false
    && tutor.assessmentMode?.optionEvaluationBeforeSubmission === false;
  const legacyAssessmentLocked = tutor.assessmentIntegrity?.duringProtectedAssessment?.tutorStatus === "locked"
    && tutor.assessmentIntegrity?.duringProtectedAssessment?.answerAssistance === "prohibited";
  const selfModificationBlocked = tutor.adaptiveLearning?.selfModification === false
    || tutor.continuousLearning?.selfModification === false;
  const policyModificationBlocked = tutor.adaptiveLearning?.policyModification === false;
  const sourceModificationBlocked = tutor.adaptiveLearning?.sourceModification === false;
  const sourcesRequired = tutor.knowledgeBoundary?.mustCiteSourceIds === true
    || tutor.grounding?.requireSourceIdForFactualClaims === true;

  if (!entitlementRequired) errors.push("AI tutor must activate only after valid paid course entitlement");
  if (tutor.access?.crossCourseAccess !== false) errors.push("AI tutor must prohibit cross-course access");
  if (!courseScoped) errors.push("AI tutor must be named-learner and purchased-course scoped");
  if (!assessmentLocked && !legacyAssessmentLocked) errors.push("AI tutor must be locked from protected-assessment answer assistance");
  if (!selfModificationBlocked || !policyModificationBlocked || !sourceModificationBlocked) {
    errors.push("Adaptive personalization must not permit uncontrolled model, policy, or source modification");
  }
  if (!sourcesRequired) errors.push("AI tutor factual claims must require approved source identifiers");
}

if (assessment && answerKey) {
  const questions = Array.isArray(assessment.questions) ? assessment.questions : [];
  const questionIds = questions.map((question) => question.id);
  if (unique(questionIds).size !== questionIds.length) errors.push("Assessment question identifiers must be unique");
  if (!String(assessment.originalityAttestation ?? "").trim()) errors.push("Assessment bank requires a top-level originality attestation");

  const answerMap = new Map((answerKey.answers ?? []).map((answer) => [answer.questionId, answer]));
  for (const question of questions) {
    const answer = answerMap.get(question.id);
    if (!answer) {
      errors.push(`Answer key is missing ${question.id}`);
      continue;
    }
    if (!question.question || !Array.isArray(question.options) || question.options.length < 2) {
      errors.push(`Question ${question.id} has an invalid prompt or options`);
    }
    if (!Array.isArray(question.sourceIds) || question.sourceIds.length === 0) {
      errors.push(`Question ${question.id} lacks a source mapping`);
    } else {
      for (const sourceId of question.sourceIds) {
        if (!sourceIds.has(sourceId)) errors.push(`Question ${question.id} maps to unknown source ${sourceId}`);
      }
    }
    if (!String(answer.rationale ?? "").trim()) errors.push(`Answer ${question.id} lacks a rationale`);
    const distractorCount = Math.max(0, question.options.length - 1);
    const distractorRationales = answer.distractorRationales && typeof answer.distractorRationales === "object"
      ? Object.keys(answer.distractorRationales).length
      : 0;
    if (distractorRationales < distractorCount) {
      errors.push(`Answer ${question.id} lacks rationale for one or more distractors`);
    }
  }

  const targetQuestionCount = Number(
    assessmentPolicy?.protectedSimulation?.totalQuestions
      ?? assessmentPolicy?.currentStatus?.questionsRequired
      ?? questions.length,
  );
  const publicRelease = isPublicRelease(manifest);
  if (publicRelease && questions.length !== targetQuestionCount) {
    errors.push(`Public release requires ${targetQuestionCount} assessment questions; found ${questions.length}`);
  }
  if (!publicRelease && questions.length < targetQuestionCount) {
    warnings.push(`Assessment bank remains in development: ${questions.length}/${targetQuestionCount} questions`);
  }
  if (assessmentPolicy?.protectedSimulation?.aiTutorLocked !== true) {
    errors.push("Protected simulation policy must lock the AI tutor");
  }
  if (assessmentPolicy?.integrity?.allItemsMustBeOriginal !== true) {
    errors.push("Protected simulation policy must require original assessment items");
  }
}

const videoFiles = listFiles("video");
const videoScripts = videoFiles.filter((file) => file.endsWith("/production-script.md"));
const renderedVideos = [
  ...videoFiles,
  ...listFiles("media"),
].filter((file) => /\.(mp4|mov|m4v|webm)$/i.test(file));
const captions = [
  ...videoFiles,
  ...listFiles("captions"),
].filter((file) => /\.(vtt|srt)$/i.test(file));
const transcripts = [
  ...videoFiles,
  ...listFiles("transcripts"),
].filter((file) => /(?:transcript.*\.(md|txt|html|pdf)|\.(vtt|srt))$/i.test(file));
const storyboards = videoFiles.filter((file) => /storyboard/i.test(file));
const publicRelease = isPublicRelease(manifest);
const requiredMediaCount = Number(manifest?.course?.lessonCount ?? manifestLessons.length);
const perVideoRights = Array.isArray(rightsLedger?.perVideoRecords) ? rightsLedger.perVideoRecords : [];

if (publicRelease) {
  if (videoScripts.length < requiredMediaCount) errors.push(`Public release requires ${requiredMediaCount} video scripts; found ${videoScripts.length}`);
  if (renderedVideos.length < requiredMediaCount) errors.push(`Public release requires ${requiredMediaCount} rendered videos; found ${renderedVideos.length}`);
  if (captions.length < requiredMediaCount) errors.push(`Public release requires ${requiredMediaCount} caption files; found ${captions.length}`);
  if (transcripts.length < requiredMediaCount) errors.push(`Public release requires ${requiredMediaCount} transcripts; found ${transcripts.length}`);
  if (storyboards.length < requiredMediaCount) errors.push(`Public release requires ${requiredMediaCount} storyboards; found ${storyboards.length}`);
  if (perVideoRights.length < requiredMediaCount || rightsLedger?.releaseGate?.allPerVideoRecordsComplete !== true) {
    errors.push(`Public release requires complete rights records for ${requiredMediaCount} lesson videos`);
  }
} else {
  warnings.push(`Video production remains in development: ${videoScripts.length}/${requiredMediaCount} scripts, ${renderedVideos.length}/${requiredMediaCount} renders, ${captions.length}/${requiredMediaCount} captions, ${transcripts.length}/${requiredMediaCount} transcripts, ${storyboards.length}/${requiredMediaCount} storyboards, ${perVideoRights.length}/${requiredMediaCount} rights records`);
}

const queueProgress = queue?.progress ?? {};
if (Number.isFinite(Number(queueProgress.videoScriptsDrafted)) && Number(queueProgress.videoScriptsDrafted) !== videoScripts.length) {
  errors.push(`Production queue videoScriptsDrafted ${queueProgress.videoScriptsDrafted} does not equal actual script count ${videoScripts.length}`);
}
if (queue?.releaseStatus !== "not-ready" && !publicRelease) {
  errors.push("Production queue releaseStatus must remain not-ready until all release gates pass");
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
