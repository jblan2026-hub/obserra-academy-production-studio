export type JsonRecord = Record<string, unknown>;

export type DeliveryArtifactRow = {
  artifact_id: string;
  lesson_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  bucket: string | null;
  storage_key: string | null;
  mime_type: string | null;
  downloadable: boolean;
  checksum_sha256: string | null;
  metadata: unknown;
};

export type LearnerArtifact = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  mimeType: string | null;
  downloadable: boolean;
  checksumSha256: string | null;
  metadata: JsonRecord;
  url: string | null;
};

export type LearnerAssessmentQuestion = {
  id: string;
  kind: string;
  question: string;
  options: string[];
};

export type LearnerCourseRelease = {
  schemaVersion: "1.0";
  course: {
    id: string;
    title: string;
    description: string;
    department: string;
    level: string;
    track: string;
    duration: string;
    audience: string;
    outcomes: string[];
    version: string;
    passingScore: number;
  };
  release: {
    version: string;
    publishedAt: string;
    contentHash: string;
  };
  lessons: Array<{
    id: string;
    moduleId: string;
    position: number;
    title: string;
    duration: string;
    format: string;
    content: JsonRecord;
    knowledgeCheck: LearnerAssessmentQuestion | null;
    artifacts: LearnerArtifact[];
  }>;
  courseMaterials: LearnerArtifact[];
  finalAssessment: LearnerAssessmentQuestion[];
  certificateTemplate: LearnerArtifact | null;
};

const forbiddenLearnerKeys = new Set([
  "answer",
  "answerKey",
  "correctAnswer",
  "correctIndex",
  "correctOption",
  "correctOptionIndex",
  "instructor",
  "instructorGuide",
  "recommendedApproach",
  "rationale",
  "reviewWarnings",
  "speakerNotes",
]);

export function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function redactLearnerValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLearnerValue);
  if (!isJsonRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbiddenLearnerKeys.has(key))
      .map(([key, nested]) => [key, redactLearnerValue(nested)]),
  );
}

export function sanitizeLessonContent(content: unknown): JsonRecord {
  if (!isJsonRecord(content)) return {};
  const learnerSource = isJsonRecord(content.learner) ? content.learner : content;
  const redacted = redactLearnerValue(learnerSource);
  return isJsonRecord(redacted) ? redacted : {};
}

export function assessmentOptions(value: unknown): string[] {
  if (Array.isArray(value)) return stringArray(value);
  if (!isJsonRecord(value)) return [];
  return stringArray(value.options);
}

export function sanitizeAssessment(input: {
  id: string;
  kind: string;
  prompt: string;
  options: unknown;
}): LearnerAssessmentQuestion {
  return {
    id: input.id,
    kind: input.kind,
    question: input.prompt,
    options: assessmentOptions(input.options),
  };
}

export function answerIndex(answerKey: unknown): number | null {
  if (typeof answerKey === "number" && Number.isInteger(answerKey)) return answerKey;
  if (!isJsonRecord(answerKey)) return null;

  for (const key of ["correctIndex", "correctOption", "answer", "index"]) {
    const value = answerKey[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return null;
}

export function artifactMetadata(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function normalizeSelectedAnswers(
  value: unknown,
): Array<{ questionId: string; answerIndex: number }> | null {
  if (!Array.isArray(value)) return null;
  const normalized: Array<{ questionId: string; answerIndex: number }> = [];

  for (const item of value) {
    if (!isJsonRecord(item)) return null;
    const questionId = typeof item.questionId === "string" ? item.questionId.trim() : "";
    const selected = item.answerIndex;
    if (!questionId || typeof selected !== "number" || !Number.isInteger(selected) || selected < 0) {
      return null;
    }
    normalized.push({ questionId, answerIndex: selected });
  }

  return normalized;
}

export function deliveryReadiness(input: {
  status: string;
  lessonCount: number;
  assessmentCount: number;
  videoCount: number;
  materialCount: number;
  certificateTemplateAvailable: boolean;
}): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.status !== "PUBLISHED") reasons.push("release-not-published");
  if (input.lessonCount < 1) reasons.push("lessons-missing");
  if (input.assessmentCount < 1) reasons.push("assessment-missing");
  if (input.videoCount < input.lessonCount) reasons.push("lesson-video-missing");
  if (input.materialCount < 1) reasons.push("learner-materials-missing");
  if (!input.certificateTemplateAvailable) reasons.push("certificate-template-missing");
  return { ready: reasons.length === 0, reasons };
}
