import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  FinalReviewBlocker,
  FinalReviewQueueItem,
  FinalReviewReadiness,
  StudentAssessmentItem,
  StudentCourseMaterial,
  StudentCoursePreview,
  StudentCourseSource,
  StudentLessonPreview,
} from "@/lib/final-review-types";

const DEFAULT_MINIMUM_QUALITY_SCORE = 95;
const DEFAULT_REQUIRED_REVIEW_ROLES = [
  "SUBJECT_MATTER",
  "TECHNICAL",
  "LEGAL",
  "COPYRIGHT_TRADEMARK",
  "BRAND",
  "ACCESSIBILITY",
  "ASSESSMENT",
  "AI_TUTOR",
  "MEDIA",
  "COMMERCE_ENTITLEMENT",
] as const;
const DEFAULT_REQUIRED_QUALITY_CATEGORIES = [
  "CONTENT_COMPLETE",
  "SOURCE_TRACEABILITY",
  "ASSESSMENT_COMPLETE",
  "VIDEO_FINAL_MASTER",
  "MEDIA_AUDIO",
  "CAPTIONS",
  "TRANSCRIPTS",
  "RIGHTS_CLEARANCE",
  "ACCESSIBILITY",
  "AI_TUTOR_RUNTIME",
  "ENTITLEMENT_RUNTIME",
  "SECURITY",
] as const;
const VIDEO_TYPES = new Set(["video", "lesson-video", "training-video", "final-video"]);
const CAPTION_TYPES = new Set(["caption", "captions", "subtitle", "subtitles", "vtt"]);
const TRANSCRIPT_TYPES = new Set(["transcript", "lesson-transcript"]);

const finalReviewInclude = {
  lessons: {
    orderBy: { position: "asc" },
    include: {
      assessments: { orderBy: { createdAt: "asc" } },
      citations: { include: { source: true }, orderBy: { createdAt: "asc" } },
      mediaAssets: { orderBy: { createdAt: "asc" } },
    },
  },
  qualityAssessments: { orderBy: { evaluatedAt: "desc" } },
  releases: { orderBy: { createdAt: "desc" }, take: 1 },
  reviews: { orderBy: { updatedAt: "desc" } },
} satisfies Prisma.CourseInclude;

type CourseWithFinalReviewData = Prisma.CourseGetPayload<{
  include: typeof finalReviewInclude;
}>;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readString(record: JsonRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readBoolean(record: JsonRecord, keys: readonly string[]): boolean {
  return keys.some((key) => record[key] === true);
}

function readNumber(record: JsonRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizedToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function configuredList(environmentName: string, fallback: readonly string[]): readonly string[] {
  const configured = process.env[environmentName]
    ?.split(",")
    .map(normalizedToken)
    .filter(Boolean);
  return configured?.length ? configured : fallback;
}

function minimumQualityScore(): number {
  const configured = Number(process.env.FINAL_REVIEW_MINIMUM_QUALITY_SCORE);
  return Number.isFinite(configured) && configured >= 0 && configured <= 100
    ? configured
    : DEFAULT_MINIMUM_QUALITY_SCORE;
}

function externalOrLocalUrl(storageKey: string, metadata: JsonRecord): string | null {
  const metadataUrl = readString(metadata, [
    "studentReviewUrl",
    "studentPlaybackUrl",
    "reviewUrl",
    "playbackUrl",
    "downloadUrl",
    "url",
  ]);
  if (metadataUrl) return metadataUrl;
  if (storageKey.startsWith("https://") || storageKey.startsWith("/")) return storageKey;
  return null;
}

function extractTextOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item.trim()] : [];
    const record = asRecord(item);
    const text = readString(record, ["text", "label", "value"]);
    return text ? [text] : [];
  });
}

function lessonOverview(content: unknown, fallback: string | null): string {
  const record = asRecord(content);
  return (
    readString(record, ["overview", "summary", "description", "body", "introduction"]) ??
    fallback ??
    "This lesson is part of the final governed Obserra Academy learner experience."
  );
}

function lessonTranscript(content: unknown): string | null {
  return readString(asRecord(content), ["transcript", "narrationTranscript", "lessonTranscript"]);
}

function lessonMaterials(content: unknown): StudentCourseMaterial[] {
  const materials = asRecord(content).materials;
  if (!Array.isArray(materials)) return [];
  return materials.flatMap((material, index) => {
    const record = asRecord(material);
    const href = readString(record, ["href", "url", "downloadUrl"]);
    const title = readString(record, ["title", "name", "label"]);
    if (!href || !title) return [];
    return [{
      id: readString(record, ["id"]) ?? `content-material-${index + 1}`,
      title,
      href,
      type: readString(record, ["type", "kind"]) ?? "course-material",
    }];
  });
}

function buildLessonPreview(
  courseSlug: string,
  lesson: CourseWithFinalReviewData["lessons"][number],
): { preview: StudentLessonPreview | null; blockers: FinalReviewBlocker[] } {
  const blockers: FinalReviewBlocker[] = [];
  const videoAssets = lesson.mediaAssets.filter((asset) => VIDEO_TYPES.has(asset.type.toLowerCase()));
  const finalVideo = videoAssets.find((asset) => {
    const metadata = asRecord(asset.metadata);
    return readBoolean(metadata, ["finalMaster", "isFinalMaster", "final"]);
  });

  if (!finalVideo) {
    blockers.push({ code: "final-video-missing", detail: `${lesson.title}: final mastered video is missing.` });
    return { preview: null, blockers };
  }

  const videoMetadata = asRecord(finalVideo.metadata);
  const videoUrl = externalOrLocalUrl(finalVideo.storageKey, videoMetadata);
  if (!videoUrl || !readBoolean(videoMetadata, ["studentPreviewReady", "learnerReady"])) {
    blockers.push({ code: "student-preview-not-ready", detail: `${lesson.title}: final video is not approved for the student preview surface.` });
  }
  if (!readBoolean(videoMetadata, ["audioQaPassed", "audioVerified"])) {
    blockers.push({ code: "audio-qa-missing", detail: `${lesson.title}: final audio QA has not passed.` });
  }
  if (!readBoolean(videoMetadata, ["rightsCleared", "rightsReviewPassed"])) {
    blockers.push({ code: "rights-clearance-missing", detail: `${lesson.title}: final media rights clearance is incomplete.` });
  }

  const captionAsset = lesson.mediaAssets.find((asset) => CAPTION_TYPES.has(asset.type.toLowerCase()));
  const captionMetadata = captionAsset ? asRecord(captionAsset.metadata) : {};
  const captionsUrl = captionAsset ? externalOrLocalUrl(captionAsset.storageKey, captionMetadata) : null;
  const captionsComplete = readBoolean(videoMetadata, ["captionsComplete", "captionsVerified"])
    && Boolean(captionsUrl);
  if (!captionsComplete) {
    blockers.push({ code: "captions-missing", detail: `${lesson.title}: verified captions are missing.` });
  }

  const transcriptAsset = lesson.mediaAssets.find((asset) => TRANSCRIPT_TYPES.has(asset.type.toLowerCase()));
  const transcriptMetadata = transcriptAsset ? asRecord(transcriptAsset.metadata) : {};
  const transcriptUrl = transcriptAsset ? externalOrLocalUrl(transcriptAsset.storageKey, transcriptMetadata) : null;
  const transcriptText = readString(transcriptMetadata, ["text", "transcript"]) ?? lessonTranscript(lesson.content);
  const transcriptComplete = readBoolean(videoMetadata, ["transcriptComplete", "transcriptVerified"])
    && Boolean(transcriptText || transcriptUrl);
  if (!transcriptComplete) {
    blockers.push({ code: "transcript-missing", detail: `${lesson.title}: verified transcript is missing.` });
  }

  const mediaMaterials = lesson.mediaAssets.flatMap<StudentCourseMaterial>((asset) => {
    const type = asset.type.toLowerCase();
    if (VIDEO_TYPES.has(type) || CAPTION_TYPES.has(type) || TRANSCRIPT_TYPES.has(type)) return [];
    const metadata = asRecord(asset.metadata);
    const href = externalOrLocalUrl(asset.storageKey, metadata);
    if (!href || readBoolean(metadata, ["internalOnly", "reviewOnly"])) return [];
    return [{ id: asset.id, title: asset.title, href, type: asset.type }];
  });

  const sources: StudentCourseSource[] = lesson.citations.map((citation) => ({
    id: citation.id,
    authority: citation.source.authority,
    title: citation.source.title,
    locator: citation.locator,
  }));

  const assessments: StudentAssessmentItem[] = lesson.assessments.map((assessment) => ({
    id: assessment.id,
    kind: assessment.kind,
    prompt: assessment.prompt,
    options: extractTextOptions(assessment.options),
  }));

  const preview: StudentLessonPreview | null = blockers.length
    ? null
    : {
        id: lesson.id,
        title: lesson.title,
        position: lesson.position,
        objective: lesson.objective,
        overview: lessonOverview(lesson.content, lesson.objective),
        durationSeconds: readNumber(videoMetadata, ["durationSeconds", "duration"]),
        videoUrl: videoUrl as string,
        captionsUrl: captionsUrl as string,
        transcript: transcriptText,
        transcriptUrl,
        materials: [...lessonMaterials(lesson.content), ...mediaMaterials],
        sources,
        assessments,
      };

  return { preview, blockers };
}

function latestReviewStatusByRole(course: CourseWithFinalReviewData): ReadonlyMap<string, string> {
  const statuses = new Map<string, string>();
  for (const review of course.reviews) {
    const role = normalizedToken(review.reviewerRole);
    if (!statuses.has(role)) statuses.set(role, review.status);
  }
  return statuses;
}

function latestQualityStatusByCategory(course: CourseWithFinalReviewData): ReadonlyMap<string, boolean> {
  const statuses = new Map<string, boolean>();
  for (const assessment of course.qualityAssessments) {
    const category = normalizedToken(assessment.category);
    if (!statuses.has(category)) statuses.set(category, assessment.passed);
  }
  return statuses;
}

export function evaluateFinalReviewReadiness(course: CourseWithFinalReviewData): FinalReviewReadiness {
  const blockers: FinalReviewBlocker[] = [];
  const requiredReviewRoles = configuredList("FINAL_REVIEW_REQUIRED_ROLES", DEFAULT_REQUIRED_REVIEW_ROLES);
  const requiredQualityCategories = configuredList(
    "FINAL_REVIEW_REQUIRED_QUALITY_CATEGORIES",
    DEFAULT_REQUIRED_QUALITY_CATEGORIES,
  );

  if (course.status !== "APPROVAL") {
    blockers.push({ code: "course-not-in-approval", detail: "Course must be in APPROVAL before owner final review." });
  }
  if (course.qualityScore < minimumQualityScore()) {
    blockers.push({
      code: "quality-score-below-threshold",
      detail: `Course quality score ${course.qualityScore} is below the final-review threshold.`,
    });
  }

  const reviewStatuses = latestReviewStatusByRole(course);
  for (const role of requiredReviewRoles) {
    if (reviewStatuses.get(role) !== "APPROVED") {
      blockers.push({ code: "required-review-missing", detail: `${role} review is not approved.` });
    }
  }

  const qualityStatuses = latestQualityStatusByCategory(course);
  for (const category of requiredQualityCategories) {
    if (qualityStatuses.get(category) !== true) {
      blockers.push({ code: "quality-gate-missing", detail: `${category} quality gate has not passed.` });
    }
  }

  const release = course.releases[0];
  if (!release || release.status !== "STAGED") {
    blockers.push({ code: "release-not-staged", detail: "A STAGED release is required for final review." });
  }
  if (!release?.packageUrl) {
    blockers.push({ code: "release-package-missing", detail: "The immutable staged release package is missing." });
  }
  if (!course.lessons.length) {
    blockers.push({ code: "lessons-missing", detail: "The final learner course contains no lessons." });
  }

  const lessonPreviews: StudentLessonPreview[] = [];
  for (const lesson of course.lessons) {
    const result = buildLessonPreview(course.slug, lesson);
    blockers.push(...result.blockers);
    if (result.preview) lessonPreviews.push(result.preview);
  }

  if (!course.lessons.some((lesson) => lesson.assessments.length > 0)) {
    blockers.push({ code: "assessment-missing", detail: "The final learner course contains no protected assessment content." });
  }
  if (qualityStatuses.get("AI_TUTOR_RUNTIME") !== true) {
    blockers.push({ code: "ai-tutor-runtime-missing", detail: "The course-specific learner AI tutor runtime is not verified." });
  }
  if (qualityStatuses.get("ENTITLEMENT_RUNTIME") !== true) {
    blockers.push({ code: "entitlement-runtime-missing", detail: "Paid learner entitlement enforcement is not verified." });
  }

  const ready = blockers.length === 0 && lessonPreviews.length === course.lessons.length;
  const estimatedDurationMinutes = lessonPreviews.every((lesson) => lesson.durationSeconds !== null)
    ? Math.round(lessonPreviews.reduce((total, lesson) => total + (lesson.durationSeconds ?? 0), 0) / 60)
    : null;
  const preview: StudentCoursePreview | null = ready && release?.packageUrl
    ? {
        databaseId: course.id,
        slug: course.slug,
        title: course.title,
        summary: course.summary ?? "",
        version: course.version,
        qualityScore: course.qualityScore,
        releaseVersion: release.version,
        releasePackageUrl: release.packageUrl,
        estimatedDurationMinutes,
        lessons: lessonPreviews,
        aiTutorEndpoint: `/api/learner/courses/${encodeURIComponent(course.slug)}/tutor`,
        classification: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.",
        accessLabel: "Paid learner experience",
      }
    : null;

  return { ready, blockers, preview };
}

async function findCourseForFinalReview(
  clerkOrganizationId: string,
  courseSlug: string,
): Promise<CourseWithFinalReviewData | null> {
  if (!process.env.DATABASE_URL) return null;
  return prisma.course.findFirst({
    where: {
      slug: courseSlug,
      organization: { clerkOrganizationId },
    },
    include: finalReviewInclude,
  });
}

export async function getFinalReviewReadiness(
  clerkOrganizationId: string,
  courseSlug: string,
): Promise<FinalReviewReadiness | null> {
  const course = await findCourseForFinalReview(clerkOrganizationId, courseSlug);
  return course ? evaluateFinalReviewReadiness(course) : null;
}

export async function getFinalReviewQueue(
  clerkOrganizationId: string,
): Promise<FinalReviewQueueItem[]> {
  if (!process.env.DATABASE_URL) return [];
  const courses = await prisma.course.findMany({
    where: {
      organization: { clerkOrganizationId },
      status: "APPROVAL",
    },
    include: finalReviewInclude,
    orderBy: { updatedAt: "desc" },
  });

  return courses.flatMap((course) => {
    const readiness = evaluateFinalReviewReadiness(course);
    const release = course.releases[0];
    if (!readiness.ready || !readiness.preview || !release) return [];
    return [{
      slug: course.slug,
      title: course.title,
      releaseVersion: release.version,
      lessonCount: readiness.preview.lessons.length,
      qualityScore: course.qualityScore,
      readyAt: release.updatedAt.toISOString(),
    }];
  });
}
