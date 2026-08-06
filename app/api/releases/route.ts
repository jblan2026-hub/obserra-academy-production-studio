import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

    const releases = await prisma.release.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { course: { select: { slug: true, title: true } } },
    });

    await recordAuditEvent({
      actorType: "service",
      action: "release.list",
      resourceType: "Release",
      correlationId,
      outcome: "success",
      metadata: { count: releases.length },
    });

    return NextResponse.json({ correlationId, releases });
  } catch (error) {
    return NextResponse.json({
      correlationId,
      releases: [],
      warning: error instanceof Error ? error.message : "Release history unavailable",
    });
  }
}
