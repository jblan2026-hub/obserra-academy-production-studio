import { prisma } from "@/lib/prisma";

export async function resolveOrganization(clerkOrganizationId: string) {
  return prisma.organization.upsert({
    where: { clerkOrganizationId },
    update: { active: true },
    create: {
      clerkOrganizationId,
      name: `Clerk organization ${clerkOrganizationId}`,
      slug: clerkOrganizationId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      active: true,
    },
  });
}

export async function requireOrganization(clerkOrganizationId?: string) {
  if (!clerkOrganizationId) {
    throw new Error("An active organization is required");
  }

  const organization = await resolveOrganization(clerkOrganizationId);
  if (!organization.active) {
    throw new Error("The active organization is disabled");
  }

  return organization;
}
