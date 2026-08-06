import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-service";
import { authorizeStudioMutation } from "@/lib/studio-auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let actor;

  try {
    actor = authorizeStudioMutation(request);
  } catch (error) {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    await recordAuditEvent({
      actorType: "service",
      action: "release.approve",
      resourceType: "Release",
      resourceId: id,
      correlationId,
      outcome: "denied",
      metadata: { reason: error instanceof Error ? error.message : "unauthorized" },
    });
    return NextResponse.json({ error: "Unauthorized", correlationId }, { status: 401 });
  }

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

    const existing = await prisma.release.findUnique({
      where: { id },
      include: { course: { select: { id: true, slug: true, title: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Release not found", correlationId: actor.correlationId }, { status: 404 });
    }
    if (existing.status !== "STAGED") {
      return NextResponse.json({
        error: "Only staged releases can be approved",
        currentStatus: existing.status,
        correlationId: actor.correlationId,
      }, { status: 409 });
    }

    const release = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.release.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedBy: actor.id,
          approvedAt: new Date(),
        },
      });

      await transaction.course.update({
        where: { id: existing.course.id },
        data: { status: "READY" },
      });

      return updated;
    });

    await recordAuditEvent({
      actorId: actor.id,
      actorType: "user",
      action: "release.approve",
      resourceType: "Release",
      resourceId: release.id,
      correlationId: actor.correlationId,
      outcome: "success",
      metadata: {
        courseId: existing.course.id,
        courseSlug: existing.course.slug,
        version: release.version,
        priorStatus: existing.status,
        newStatus: release.status,
        role: actor.role,
      },
    });

    return NextResponse.json({ release, correlationId: actor.correlationId });
  } catch (error) {
    await recordAuditEvent({
      actorId: actor.id,
      actorType: "user",
      action: "release.approve",
      resourceType: "Release",
      resourceId: id,
      correlationId: actor.correlationId,
      outcome: "failure",
      metadata: { reason: error instanceof Error ? error.message : "unknown" },
    });
    return NextResponse.json({ error: "Release approval failed", correlationId: actor.correlationId }, { status: 500 });
  }
}
