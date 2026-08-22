import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeAcademyDeliveryRequest } from "@/lib/academy-delivery-auth";
import {
  answerIndex,
  isJsonRecord,
  normalizeSelectedAnswers,
} from "@/lib/academy-delivery-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function validSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : null;
}

export async function POST(
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
  if (authorization.principal.purpose !== "assessment-grade") {
    return NextResponse.json({ error: "Invalid delivery purpose" }, { status: 403, headers: responseHeaders });
  }

  const courseId = validSlug((await params).courseId);
  if (!courseId) {
    return NextResponse.json({ error: "Invalid course identifier" }, { status: 400, headers: responseHeaders });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: responseHeaders });
  }
  const answers = isJsonRecord(body) ? normalizeSelectedAnswers(body.answers) : null;
  if (!answers || answers.length === 0) {
    return NextResponse.json({ error: "Answer every assessment question" }, { status: 400, headers: responseHeaders });
  }
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) {
    return NextResponse.json({ error: "Duplicate assessment answers are not permitted" }, { status: 400, headers: responseHeaders });
  }

  try {
    const course = await prisma.course.findFirst({
      where: { slug: courseId, status: "PUBLISHED" },
      select: { id: true, organizationId: true },
    });
    if (!course) {
      return NextResponse.json({ error: "Published course release not found" }, { status: 404, headers: responseHeaders });
    }

    const [release] = await prisma.$queryRaw<Array<{ assessment_count: number; manifest: unknown; version: string }>>`
      select assessment_count, manifest, version
      from public.academy_delivery_releases
      where course_id = ${course.id} and status = 'PUBLISHED'
      limit 1
    `;
    if (!release) {
      return NextResponse.json({ error: "Published learner release not found" }, { status: 404, headers: responseHeaders });
    }

    const questions = await prisma.assessment.findMany({
      where: { lesson: { courseId: course.id }, kind: "final" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, answerKey: true },
    });
    if (questions.length !== release.assessment_count || answers.length !== questions.length) {
      return NextResponse.json({ error: "Answer every published assessment question" }, { status: 400, headers: responseHeaders });
    }

    const submittedById = new Map(answers.map((answer) => [answer.questionId, answer.answerIndex]));
    let correct = 0;
    for (const question of questions) {
      const submitted = submittedById.get(question.id);
      if (submitted === undefined) {
        return NextResponse.json({ error: "Assessment submission does not match the published release" }, { status: 400, headers: responseHeaders });
      }
      const expected = answerIndex(question.answerKey);
      if (expected === null) throw new Error(`Assessment ${question.id} has no valid answer key`);
      if (submitted === expected) correct += 1;
    }

    const score = Math.round((correct / questions.length) * 100);
    const manifest = isJsonRecord(release.manifest) ? release.manifest : {};
    const completion = isJsonRecord(manifest.completion) ? manifest.completion : {};
    const passingScore = typeof completion.passingScore === "number" ? completion.passingScore : 80;
    const passed = score >= passingScore;

    await prisma.auditEvent.create({
      data: {
        organizationId: course.organizationId,
        actorId: authorization.principal.actorId,
        actorType: "service",
        action: "academy.final-assessment.grade",
        resourceType: "Course",
        resourceId: course.id,
        outcome: passed ? "success" : "retry",
        metadata: {
          courseSlug: courseId,
          learnerId: authorization.principal.learnerId,
          releaseVersion: release.version,
          questionCount: questions.length,
          score,
          passingScore,
        },
      },
    });

    return NextResponse.json(
      { courseId, releaseVersion: release.version, score, passingScore, passed },
      { headers: responseHeaders },
    );
  } catch (error) {
    console.error("Academy final assessment grading failed", error);
    return NextResponse.json(
      { error: "Assessment grading is temporarily unavailable" },
      { status: 503, headers: responseHeaders },
    );
  }
}
