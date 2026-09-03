import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeAcademyDeliveryRequest } from "@/lib/academy-delivery-auth";
import {
  artifactMetadata,
  isJsonRecord,
  sanitizeAssessment,
  sanitizeLessonContent,
  stringArray,
  type DeliveryArtifactRow,
  type LearnerArtifact,
  type LearnerCourseRelease,
} from "@/lib/academy-delivery-contract";
import { signAcademyStorageObject } from "@/lib/academy-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

type DeliveryReleaseRow = {
  version: string;
  manifest: unknown;
  content_hash: string;
  published_at: Date | string;
};

type AssessmentRecord = {
  id: string;
  lessonId: string;
  kind: string;
  prompt: string;
  options: unknown;
};

function courseSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : null;
}

function text(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function numberValue(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function learnerArtifact(row: DeliveryArtifactRow): Promise<LearnerArtifact> {
  return {
    id: row.artifact_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    mimeType: row.mime_type,
    downloadable: row.downloadable,
    checksumSha256: row.checksum_sha256,
    metadata: artifactMetadata(row.metadata),
    url: await signAcademyStorageObject(row.bucket, row.storage_key),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const authorization = authorizeAcademyDeliveryRequest(request);
  if (!authorization.principal) {
    return NextResponse.json(
      { error: authorization.reason ?? "Unauthorized" },
      { status: 403, headers: responseHeaders },
    );
  }
  if (authorization.principal.purpose !== "learner-content") {
    return NextResponse.json({ error: "Invalid delivery purpose" }, { status: 403, headers: responseHeaders });
  }

  const requested = courseSlug((await params).courseId);
  if (!requested) {
    return NextResponse.json({ error: "Invalid course identifier" }, { status: 400, headers: responseHeaders });
  }

  try {
    const course = await prisma.course.findFirst({
      where: { slug: requested, status: "PUBLISHED" },
      include: {
        lessons: { orderBy: { position: "asc" } },
      },
    });
    if (!course) {
      return NextResponse.json({ error: "Published course release not found" }, { status: 404, headers: responseHeaders });
    }

    const [release] = await prisma.$queryRaw<DeliveryReleaseRow[]>`
      select version, manifest, content_hash, published_at
      from public.academy_delivery_releases
      where course_id = ${course.id}
        and course_slug = ${requested}
        and status = 'PUBLISHED'
      limit 1
    `;
    if (!release) {
      return NextResponse.json({ error: "Published learner release not found" }, { status: 404, headers: responseHeaders });
    }

    const assessments = await prisma.assessment.findMany({
      where: { lesson: { courseId: course.id } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, lessonId: true, kind: true, prompt: true, options: true },
    }) as AssessmentRecord[];

    const artifactRows = await prisma.$queryRaw<DeliveryArtifactRow[]>`
      select
        artifact_id,
        lesson_id,
        kind,
        title,
        body,
        bucket,
        storage_key,
        mime_type,
        downloadable,
        checksum_sha256,
        metadata
      from public.academy_course_artifacts
      where course_id = ${course.id}
        and visibility = 'LEARNER'
      order by lesson_id nulls first, kind, title
    `;

    const signedArtifacts = await Promise.all(
      artifactRows.map(async (row) => ({ row, artifact: await learnerArtifact(row) })),
    );
    const manifest = isJsonRecord(release.manifest) ? release.manifest : {};
    const manifestCourse = isJsonRecord(manifest.course) ? manifest.course : {};
    const completion = isJsonRecord(manifest.completion) ? manifest.completion : {};

    const lessons = course.lessons.map((lesson) => {
      const lessonRecord = isJsonRecord(lesson.content) ? lesson.content : {};
      const moduleId = text(lessonRecord, "manifestModuleId", lesson.id);
      const knowledgeCheck = assessments.find(
        (item) => item.lessonId === lesson.id && item.kind === "knowledge-check",
      );
      const artifacts = signedArtifacts
        .filter((item) => item.row.lesson_id === lesson.id)
        .map((item) => item.artifact);

      return {
        id: lesson.id,
        moduleId,
        position: lesson.position,
        title: lesson.title,
        duration: text(lessonRecord, "duration"),
        format: text(lessonRecord, "format", "Interactive lesson"),
        content: sanitizeLessonContent(lesson.content),
        knowledgeCheck: knowledgeCheck ? sanitizeAssessment(knowledgeCheck) : null,
        artifacts,
      };
    });

    const courseMaterials = signedArtifacts
      .filter((item) => item.row.lesson_id === null && item.row.kind !== "certificate-template")
      .map((item) => item.artifact);
    const certificateTemplate = signedArtifacts.find(
      (item) => item.row.lesson_id === null && item.row.kind === "certificate-template",
    )?.artifact ?? null;
    const finalAssessment = assessments
      .filter((item) => item.kind === "final")
      .map(sanitizeAssessment);

    const payload: LearnerCourseRelease = {
      schemaVersion: "1.0",
      course: {
        id: requested,
        title: text(manifestCourse, "title", course.title),
        description: text(manifestCourse, "description", course.summary ?? ""),
        department: text(manifestCourse, "department"),
        level: text(manifestCourse, "level"),
        track: text(manifestCourse, "track"),
        duration: text(manifestCourse, "duration"),
        audience: text(manifestCourse, "audience"),
        outcomes: stringArray(manifestCourse.outcomes),
        version: release.version,
        passingScore: numberValue(completion, "passingScore", 80),
      },
      release: {
        version: release.version,
        publishedAt: new Date(release.published_at).toISOString(),
        contentHash: release.content_hash,
      },
      lessons,
      courseMaterials,
      finalAssessment,
      certificateTemplate,
    };

    await prisma.auditEvent.create({
      data: {
        organizationId: course.organizationId,
        actorId: authorization.principal.actorId,
        actorType: "service",
        action: "academy.delivery.read",
        resourceType: "Course",
        resourceId: course.id,
        outcome: "success",
        metadata: {
          courseSlug: requested,
          learnerId: authorization.principal.learnerId,
          releaseVersion: release.version,
          lessonCount: lessons.length,
          artifactCount: signedArtifacts.length,
        },
      },
    });

    return NextResponse.json(payload, { headers: responseHeaders });
  } catch (error) {
    console.error("Academy learner delivery failed", error);
    return NextResponse.json(
      { error: "Academy learner delivery is temporarily unavailable" },
      { status: 503, headers: responseHeaders },
    );
  }
}
