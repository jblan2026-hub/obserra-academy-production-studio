import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { productionQueue } from "@/lib/studio-data";
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
    const courses = await prisma.course.findMany({
      where: { organizationId: organization.id },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { lessons: true, reviews: true, releases: true, builds: true } } },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: session.userId ?? undefined,
      actorType: "user",
      action: "course.list",
      resourceType: "Course",
      correlationId,
      outcome: "success",
      metadata: { count: courses.length, source: "database" },
    });

    return NextResponse.json({ source: "database", correlationId, organizationId: session.orgId, courses });
  } catch (error) {
    return NextResponse.json({
      source: "fallback",
      correlationId,
      courses: productionQueue.map((course) => ({
        slug: course.id,
        title: course.title,
        status: course.status,
        qualityScore: course.quality,
        productionOwner: course.owner,
        updatedAt: course.updated,
      })),
      warning: error instanceof Error ? error.message : "Course data unavailable",
    });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await authorizeStudioRequest(request, "course:create");

  if (!authorization.principal) {
    await recordAuditEvent({
      actorType: "service",
      action: "course.create",
      resourceType: "Course",
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
    const body = await request.json() as { slug?: string; title?: string; summary?: string; productionOwner?: string };
    const slug = body.slug?.trim().toLowerCase();
    const title = body.title?.trim();

    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return NextResponse.json({ error: "A valid lowercase course slug is required", correlationId }, { status: 400 });
    }
    if (!title || title.length < 4) {
      return NextResponse.json({ error: "A course title of at least four characters is required", correlationId }, { status: 400 });
    }

    const course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        slug,
        title,
        summary: body.summary?.trim(),
        productionOwner: body.productionOwner?.trim(),
        status: "IDEA",
      },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "course.create",
      resourceType: "Course",
      resourceId: course.id,
      correlationId,
      outcome: "success",
      metadata: { slug: course.slug, role: principal.role, clerkOrganizationId: principal.organizationId },
    });

    return NextResponse.json({ course, correlationId }, { status: 201 });
  } catch (error) {
    await recordAuditEvent({
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "course.create",
      resourceType: "Course",
      correlationId,
      outcome: "failure",
      metadata: { reason: error instanceof Error ? error.message : "unknown", clerkOrganizationId: principal.organizationId },
    });
    return NextResponse.json({ error: "Course creation failed", correlationId }, { status: 500 });
  }
}
