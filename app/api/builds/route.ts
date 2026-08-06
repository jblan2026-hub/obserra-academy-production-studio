import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-service";
import { authorizeStudioRequest } from "@/lib/studio-auth";
import { requireOrganization } from "@/lib/organization-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    const session = await auth();
    if (!session.isAuthenticated || !session.orgId) {
      return NextResponse.json({ error: "An authenticated organization session is required", correlationId }, { status: 401 });
    }

    const organization = await requireOrganization(session.orgId);
    const builds = await prisma.build.findMany({
      where: { course: { organizationId: organization.id } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { course: { select: { slug: true, title: true } } },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: session.userId ?? undefined,
      actorType: "user",
      action: "build.list",
      resourceType: "Build",
      correlationId,
      outcome: "success",
      metadata: { count: builds.length },
    });

    return NextResponse.json({ correlationId, organizationId: session.orgId, builds });
  } catch (error) {
    return NextResponse.json({ correlationId, builds: [], warning: error instanceof Error ? error.message : "Build history unavailable" });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await authorizeStudioRequest(request, "build:start");

  if (!authorization.principal) {
    await recordAuditEvent({
      actorType: "service",
      action: "build.start",
      resourceType: "Build",
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
    const body = await request.json() as { courseId?: string; buildType?: string; commitSha?: string };
    const buildType = body.buildType?.trim();

    if (!buildType) {
      return NextResponse.json({ error: "buildType is required", correlationId }, { status: 400 });
    }
    if (!body.courseId) {
      return NextResponse.json({ error: "courseId is required for tenant scoped builds", correlationId }, { status: 400 });
    }

    const course = await prisma.course.findFirst({
      where: { id: body.courseId, organizationId: organization.id },
      select: { id: true, slug: true },
    });
    if (!course) {
      return NextResponse.json({ error: "Course not found in the active organization", correlationId }, { status: 404 });
    }

    const build = await prisma.build.create({
      data: {
        courseId: course.id,
        buildType,
        commitSha: body.commitSha?.trim(),
        status: "QUEUED",
      },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "build.start",
      resourceType: "Build",
      resourceId: build.id,
      correlationId,
      outcome: "success",
      metadata: { buildType, courseId: course.id, courseSlug: course.slug, role: principal.role },
    });

    return NextResponse.json({ build, correlationId }, { status: 202 });
  } catch (error) {
    await recordAuditEvent({
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "build.start",
      resourceType: "Build",
      correlationId,
      outcome: "failure",
      metadata: { reason: error instanceof Error ? error.message : "unknown", clerkOrganizationId: principal.organizationId },
    });
    return NextResponse.json({ error: "Build initiation failed", correlationId }, { status: 500 });
  }
}
