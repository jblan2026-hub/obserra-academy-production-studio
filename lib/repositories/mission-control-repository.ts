import { prisma } from "@/lib/prisma";
import { requireOrganization } from "@/lib/organization-service";

export type MissionControlOperations = {
  source: "database" | "fallback";
  builds: Array<{
    id: string;
    course: string;
    type: string;
    status: string;
    createdAt: string;
  }>;
  releases: Array<{
    id: string;
    course: string;
    version: string;
    status: string;
    createdAt: string;
  }>;
  activity: Array<{
    id: string;
    action: string;
    resource: string;
    outcome: string;
    actor: string;
    createdAt: string;
  }>;
};

function fallbackOperations(): MissionControlOperations {
  return {
    source: "fallback",
    builds: [
      { id: "fallback-build-1", course: "Cybersecurity Foundations", type: "course-package", status: "SUCCEEDED", createdAt: "Awaiting database" },
      { id: "fallback-build-2", course: "Board Oversight of Enterprise AI", type: "validation", status: "QUEUED", createdAt: "Awaiting database" },
    ],
    releases: [
      { id: "fallback-release-1", course: "CMMC Executive Readiness", version: "1.0.0", status: "STAGED", createdAt: "Awaiting database" },
    ],
    activity: [
      { id: "fallback-activity-1", action: "studio.status.read", resource: "Mission Control", outcome: "success", actor: "system", createdAt: "Awaiting database" },
    ],
  };
}

export async function getMissionControlOperations(clerkOrganizationId: string): Promise<MissionControlOperations> {
  if (!process.env.DATABASE_URL) return fallbackOperations();

  try {
    const organization = await requireOrganization(clerkOrganizationId);
    const [builds, releases, activity] = await Promise.all([
      prisma.build.findMany({
        where: { course: { organizationId: organization.id } },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { course: { select: { title: true } } },
      }),
      prisma.release.findMany({
        where: { course: { organizationId: organization.id } },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { course: { select: { title: true } } },
      }),
      prisma.auditEvent.findMany({
        where: { organizationId: organization.id },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

    return {
      source: "database",
      builds: builds.map((build) => ({
        id: build.id,
        course: build.course?.title ?? "Platform build",
        type: build.buildType,
        status: build.status,
        createdAt: build.createdAt.toISOString(),
      })),
      releases: releases.map((release) => ({
        id: release.id,
        course: release.course.title,
        version: release.version,
        status: release.status,
        createdAt: release.createdAt.toISOString(),
      })),
      activity: activity.map((event) => ({
        id: event.id,
        action: event.action,
        resource: event.resourceId ? `${event.resourceType} ${event.resourceId}` : event.resourceType,
        outcome: event.outcome,
        actor: event.actorId ?? event.actorType,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error("Mission Control operational history unavailable; using governed fallback data.", error);
    return fallbackOperations();
  }
}
