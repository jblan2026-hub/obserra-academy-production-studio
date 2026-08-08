import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-service";
import { authenticateStudioRequest } from "@/lib/studio-auth";
import { requireOrganization } from "@/lib/organization-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    const authentication = await authenticateStudioRequest(request);
    if (!authentication.principal) {
      return NextResponse.json({ error: authentication.reason ?? "Authentication required", correlationId }, { status: 401 });
    }
    const principal = authentication.principal;
    const organization = await requireOrganization(principal.organizationId, principal.identityProvider);
    const releases = await prisma.release.findMany({
      where: { course: { organizationId: organization.id } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { course: { select: { slug: true, title: true } } },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "release.list",
      resourceType: "Release",
      correlationId,
      outcome: "success",
      metadata: { count: releases.length, identityProvider: principal.identityProvider },
    });

    return NextResponse.json({ correlationId, organizationId: principal.organizationId, releases });
  } catch (error) {
    return NextResponse.json({
      correlationId,
      releases: [],
      warning: error instanceof Error ? error.message : "Release history unavailable",
    });
  }
}
