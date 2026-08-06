import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-service";
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
    const releases = await prisma.release.findMany({
      where: { course: { organizationId: organization.id } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { course: { select: { slug: true, title: true } } },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: session.userId ?? undefined,
      actorType: "user",
      action: "release.list",
      resourceType: "Release",
      correlationId,
      outcome: "success",
      metadata: { count: releases.length },
    });

    return NextResponse.json({ correlationId, organizationId: session.orgId, releases });
  } catch (error) {
    return NextResponse.json({
      correlationId,
      releases: [],
      warning: error instanceof Error ? error.message : "Release history unavailable",
    });
  }
}
