import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeAcademyDeliveryRequest } from "@/lib/academy-delivery-auth";
import { answerIndex, isJsonRecord } from "@/lib/academy-delivery-contract";

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
  if (authorization.principal.purpose !== "knowledge-check") {
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
  if (!isJsonRecord(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: responseHeaders });
  }

  const lessonPosition = body.lessonPosition;
  const questionId = typeof body.questionId === "string" ? body.questionId.trim() : "";
  const selectedAnswer = body.answerIndex;
  if (
    typeof lessonPosition !== "number" ||
    !Number.isInteger(lessonPosition) ||
    lessonPosition < 1 ||
    !questionId ||
    typeof selectedAnswer !== "number" ||
    !Number.isInteger(selectedAnswer) ||
    selectedAnswer < 0
  ) {
    return NextResponse.json({ error: "Invalid knowledge-check submission" }, { status: 400, headers: responseHeaders });
  }

  try {
    const course = await prisma.course.findFirst({
      where: { slug: courseId, status: "PUBLISHED" },
      select: { id: true, organizationId: true },
    });
    if (!course) {
      return NextResponse.json({ error: "Published course release not found" }, { status: 404, headers: responseHeaders });
    }

    const releaseCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from public.academy_delivery_releases
      where course_id = ${course.id} and status = 'PUBLISHED'
    `;
    if (Number(releaseCount[0]?.count ?? 0) !== 1) {
      return NextResponse.json({ error: "Published learner release not found" }, { status: 404, headers: responseHeaders });
    }

    const lesson = await prisma.lesson.findFirst({
      where: { courseId: course.id, position: lessonPosition },
      select: { id: true },
    });
    if (!lesson) {
      return NextResponse.json({ error: "Course lesson not found" }, { status: 404, headers: responseHeaders });
    }

    const question = await prisma.assessment.findFirst({
      where: { id: questionId, lessonId: lesson.id, kind: "knowledge-check" },
      select: { id: true, answerKey: true, rationale: true },
    });
    if (!question) {
      return NextResponse.json({ error: "Knowledge check not found" }, { status: 404, headers: responseHeaders });
    }

    const expectedAnswer = answerIndex(question.answerKey);
    if (expectedAnswer === null) {
      throw new Error(`Knowledge check ${question.id} has no valid answer key`);
    }
    const correct = selectedAnswer === expectedAnswer;

    await prisma.auditEvent.create({
      data: {
        organizationId: course.organizationId,
        actorId: authorization.principal.actorId,
        actorType: "service",
        action: "academy.knowledge-check.grade",
        resourceType: "Assessment",
        resourceId: question.id,
        outcome: correct ? "success" : "retry",
        metadata: {
          courseSlug: courseId,
          learnerId: authorization.principal.learnerId,
          lessonPosition,
        },
      },
    });

    return NextResponse.json(
      {
        questionId: question.id,
        correct,
        explanation: question.rationale ?? (correct ? "Correct." : "Review the lesson and try again."),
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    console.error("Academy knowledge-check grading failed", error);
    return NextResponse.json(
      { error: "Knowledge-check grading is temporarily unavailable" },
      { status: 503, headers: responseHeaders },
    );
  }
}
