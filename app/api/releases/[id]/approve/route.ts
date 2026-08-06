import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-service";
import { authorizeStudioRequest } from "@/lib/studio-auth";
import { requireOrganization } from "@/lib/organization-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await authorizeStudioRequest(request, "release:approve");

  if (!authorization.principal) {
    await recordAuditEvent({
      actorType: "service",
      action: "release.approve",
      resourceType: "Release",
      resourceId: id,
      correlationId,
      outcome: "denied",
      metadata: { reason: authorization.reason },
    });
    return NextResponse.json({ error: authorization.reason ?? "Unauthorized", correlationId }, { status: 403 });
  }

  const principal = authorization.principal;

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    const organization = await requireOrganization(principal.organizationId);
    const existing = await prisma.release.findFirst({
      where: { id, course: { organizationId: organization.id } },
      include: { course: { select: { id: true, slug: true, title: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Release not found in the active organization", correlationId }, { status: 404 });
    }
    if (existing.status !== "STAGED") {
      return NextResponse.json({ error: "Only staged releases can be approved", currentStatus: existing.status, correlationId }, { status: 409 });
    }

    const release = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.release.update({
        where: { id },
        data: { status: "APPROVED", approvedBy: principal.actorId, approvedAt: new Date() },
      });
      await transaction.course.update({ where: { id: existing.course.id }, data: { status: "READY" } });
      return updated;
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "release.approve",
      resourceType: "Release",
      resourceId: release.id,
      correlationId,
      outcome: "success",
      metadata: {
        courseId: existing.course.id,
        courseSlug: existing.course.slug,
        version: release.version,
        priorStatus: existing.status,
        newStatus: release.status,
        role: principal.role,
      },
    });

    return NextResponse.json({ release, correlationId });
  } catch (error) {
    await recordAuditEvent({
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "release.approve",
      resourceType: "Release",
      resourceId: id,
      correlationId,
      outcome: "failure",
      metadata: { reason: error instanceof Error ? error.message : "unknown", clerkOrganizationId: principal.organizationId },
    });
    return NextResponse.json({ error: "Release approval failed", correlationId }, { status: 500 });
  }
}
