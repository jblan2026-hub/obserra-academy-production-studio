export type FinalReviewBlockerCode =
  | "course-not-in-approval"
  | "quality-score-below-threshold"
  | "required-review-missing"
  | "quality-gate-missing"
  | "release-not-staged"
  | "release-package-missing"
  | "lessons-missing"
  | "final-video-missing"
  | "student-preview-not-ready"
  | "audio-qa-missing"
  | "captions-missing"
  | "transcript-missing"
  | "rights-clearance-missing"
  | "assessment-missing"
  | "ai-tutor-runtime-missing"
  | "entitlement-runtime-missing";

export type FinalReviewBlocker = {
  code: FinalReviewBlockerCode;
  detail: string;
};

export type StudentCourseMaterial = {
  id: string;
  title: string;
  href: string;
  type: string;
};

export type StudentCourseSource = {
  id: string;
  authority: string;
  title: string;
  locator: string | null;
};

export type StudentAssessmentItem = {
  id: string;
  kind: string;
  prompt: string;
  options: string[];
};

export type StudentLessonPreview = {
  id: string;
  title: string;
  position: number;
  objective: string | null;
  overview: string;
  durationSeconds: number | null;
  videoUrl: string;
  captionsUrl: string;
  transcript: string | null;
  transcriptUrl: string | null;
  materials: StudentCourseMaterial[];
  sources: StudentCourseSource[];
  assessments: StudentAssessmentItem[];
};

export type StudentCoursePreview = {
  databaseId: string;
  slug: string;
  title: string;
  summary: string;
  version: number;
  qualityScore: number;
  releaseVersion: string;
  releasePackageUrl: string;
  estimatedDurationMinutes: number | null;
  lessons: StudentLessonPreview[];
  aiTutorEndpoint: string;
  classification: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";
  accessLabel: "Paid learner experience";
};

export type FinalReviewReadiness = {
  ready: boolean;
  blockers: FinalReviewBlocker[];
  preview: StudentCoursePreview | null;
};

export type FinalReviewQueueItem = {
  slug: string;
  title: string;
  releaseVersion: string;
  lessonCount: number;
  qualityScore: number;
  readyAt: string;
};
