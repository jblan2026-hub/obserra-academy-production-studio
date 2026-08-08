export const ACADEMY_AUTHORING_POLICY_VERSION = "2026.08.08.2";

const DEFAULT_FINAL_ASSESSMENT_QUESTIONS = 30;
const commandLineCourseIndex = process.argv.indexOf("--course");
const commandLineCourseId =
  commandLineCourseIndex >= 0 ? process.argv[commandLineCourseIndex + 1] : null;
const commandLineAssessmentMinimum =
  commandLineCourseId === "pmp-exam-prep-business-application"
    ? 180
    : DEFAULT_FINAL_ASSESSMENT_QUESTIONS;

export const ACADEMY_AUTHORING_QUALITY_REQUIREMENTS = Object.freeze({
  lessonNarrativeWords: 1200,
  learningObjectives: 6,
  keyConcepts: 6,
  knowledgeChecks: 4,
  slideNarratives: 10,
  videoSegments: 8,
  accessibilityNotes: 4,
  finalAssessmentQuestions: commandLineAssessmentMinimum,
  finalAssessmentOptions: 4,
});

export function countWords(value) {
  if (typeof value !== "string") return 0;
  return (
    value
      .trim()
      .match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? []
  ).length;
}

export function requiredFinalAssessmentQuestions(manifest) {
  const candidates = [
    manifest?.course?.examAlignment?.examQuestionCount,
    manifest?.course?.assessmentQuestionCount,
    manifest?.assessment?.questionCount,
    manifest?.completion?.assessmentQuestionCount,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  return Math.max(DEFAULT_FINAL_ASSESSMENT_QUESTIONS, ...candidates);
}

export function academyAuthoringQualityContract(manifest = null) {
  if (manifest === null) {
    return {
      policyVersion: ACADEMY_AUTHORING_POLICY_VERSION,
      ...ACADEMY_AUTHORING_QUALITY_REQUIREMENTS,
    };
  }
  const requiredQuestions = requiredFinalAssessmentQuestions(manifest);
  return {
    policyVersion: ACADEMY_AUTHORING_POLICY_VERSION,
    ...ACADEMY_AUTHORING_QUALITY_REQUIREMENTS,
    finalAssessmentQuestions: requiredQuestions,
  };
}
