export const ACADEMY_AUTHORING_POLICY_VERSION = "2026.08.08.1";

export const ACADEMY_AUTHORING_QUALITY_REQUIREMENTS = Object.freeze({
  lessonNarrativeWords: 1200,
  learningObjectives: 6,
  keyConcepts: 6,
  knowledgeChecks: 4,
  slideNarratives: 10,
  videoSegments: 8,
  accessibilityNotes: 4,
  finalAssessmentQuestions: 30,
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

export function academyAuthoringQualityContract() {
  return {
    policyVersion: ACADEMY_AUTHORING_POLICY_VERSION,
    ...ACADEMY_AUTHORING_QUALITY_REQUIREMENTS,
  };
}
