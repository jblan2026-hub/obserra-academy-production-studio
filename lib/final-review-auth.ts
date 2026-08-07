const ADMIN_ROLES = new Set(["org:admin", "org:owner", "admin", "owner"]);

function configuredOwnerIds(): ReadonlySet<string> {
  return new Set(
    (process.env.OBSERRA_OWNER_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function canPerformFinalCourseReview(
  userId: string | null | undefined,
  organizationRole: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (organizationRole && ADMIN_ROLES.has(organizationRole.toLowerCase())) return true;
  return configuredOwnerIds().has(userId);
}
