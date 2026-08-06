import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { productionQueue } from "@/lib/studio-data";
import { recordAuditEvent } from "@/lib/audit-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

    const courses = await prisma.course.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { lessons: true, reviews: true, releases: true, builds: true },
        },
      },
    });

    await recordAuditEvent({
      actorType: "service",
      action: "course.list",
      resourceType: "Course",
      correlationId,
      outcome: "success",
      metadata: { count: courses.length, source: "database" },
    });

    return NextResponse.json({ source: "database", correlationId, courses });
  } catch (error) {
    await recordAuditEvent({
      actorType: "service",
      action: "course.list",
      resourceType: "Course",
      correlationId,
      outcome: "failure",
      metadata: { reason: error instanceof Error ? error.message : "unknown" },
    });

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
    });
  }
}
