import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-service";

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
    return NextResponse.json(
      {
        correlationId,
        builds: [],
        warning: error instanceof Error ? error.message : "Build history unavailable",
      },
      { status: 200 },
    );
  }
}
