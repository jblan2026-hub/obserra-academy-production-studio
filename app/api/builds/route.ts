import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-service";
import { authorizeStudioMutation } from "@/lib/studio-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

    const builds = await prisma.build.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { course: { select: { slug: true, title: true } } },
    });

    await recordAuditEvent({
      actorType: "service",
      action: "build.list",
      resourceType: "Build",
      correlationId,
      outcome: "success",
      metadata: { count: builds.length },
    });

    return NextResponse.json({ correlationId, builds });
  } catch (error) {
    return NextResponse.json({
      correlationId,
      builds: [],
      warning: error instanceof Error ? error.message : "Build history unavailable",
    });
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = authorizeStudioMutation(request);
  } catch (error) {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    await recordAuditEvent({
      actorType: "service",
      action: "build.start",
      resourceType: "Build",
      correlationId,
      outcome: "denied",
      metadata: { reason: error instanceof Error ? error.message : "unauthorized" },
    });
    return NextResponse.json({ error: "Unauthorized", correlationId }, { status: 401 });
  }

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    const body = await request.json() as { courseId?: string; buildType?: string; commitSha?: string };
    const buildType = body.buildType?.trim();
    if (!buildType) {
      return NextResponse.json({ error: "buildType is required", correlationId: actor.correlationId }, { status: 400 });
    }

    if (body.courseId) {
      const course = await prisma.course.findUnique({ where: { id: body.courseId }, select: { id: true } });
      if (!course) {
        return NextResponse.json({ error: "Course not found", correlationId: actor.correlationId }, { status: 404 });
      }
    }

    const build = await prisma.build.create({
      data: {
        courseId: body.courseId,
        buildType,
        commitSha: body.commitSha?.trim(),
        status: "QUEUED",
      },
    });

    await recordAuditEvent({
      actorId: actor.id,
      actorType: "user",
      action: "build.start",
      resourceType: "Build",
      resourceId: build.id,
      correlationId: actor.correlationId,
      outcome: "success",
      metadata: { buildType, courseId: body.courseId, role: actor.role },
    });

    return NextResponse.json({ build, correlationId: actor.correlationId }, { status: 202 });
  } catch (error) {
    await recordAuditEvent({
      actorId: actor.id,
      actorType: "user",
      action: "build.start",
      resourceType: "Build",
      correlationId: actor.correlationId,
      outcome: "failure",
      metadata: { reason: error instanceof Error ? error.message : "unknown" },
    });
    return NextResponse.json({ error: "Build initiation failed", correlationId: actor.correlationId }, { status: 500 });
  }
}
