import { prisma } from "@/lib/prisma";

function organizationIdentityKey(externalOrganizationId: string, identityProvider?: string): string {
  const provider = String(identityProvider || "external").trim().toLowerCase();
  if (provider === "clerk") return externalOrganizationId;
  return `${provider}:${externalOrganizationId}`;
}

export async function resolveOrganization(externalOrganizationId: string, identityProvider?: string) {
  const normalized = externalOrganizationId.trim();
  if (!normalized) throw new Error("An external organization identifier is required");
  const identityKey = organizationIdentityKey(normalized, identityProvider);
  const providerLabel = String(identityProvider || "external").trim().toLowerCase();

  return prisma.organization.upsert({
    where: { clerkOrganizationId: identityKey },
    update: { active: true },
    create: {
      clerkOrganizationId: identityKey,
      name: providerLabel === "supabase" ? "Obserra Academy" : `${providerLabel} organization ${normalized}`,
      slug: identityKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120),
      active: true,
    },
  });
}

export async function requireOrganization(externalOrganizationId?: string, identityProvider?: string) {
  if (!externalOrganizationId) {
    throw new Error("An active organization is required");
  }

  const organization = await resolveOrganization(externalOrganizationId, identityProvider);
  if (!organization.active) {
    throw new Error("The active organization is disabled");
  }

  return organization;
}
