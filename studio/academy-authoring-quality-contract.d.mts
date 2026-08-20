export const ACADEMY_AUTHORING_POLICY_VERSION: string;

export type AcademyAuthoringQualityRequirements = Readonly<{
  lessonNarrativeWords: number;
  learningObjectives: number;
  keyConcepts: number;
  knowledgeChecks: number;
  slideNarratives: number;
  videoSegments: number;
  accessibilityNotes: number;
  finalAssessmentQuestions: number;
  finalAssessmentOptions: number;
}>;

export const ACADEMY_AUTHORING_QUALITY_REQUIREMENTS: AcademyAuthoringQualityRequirements;

export function countWords(value: unknown): number;
export function requiredFinalAssessmentQuestions(manifest: unknown): number;
export function academyAuthoringQualityContract(
  manifest?: unknown,
): { policyVersion: string } & AcademyAuthoringQualityRequirements;
