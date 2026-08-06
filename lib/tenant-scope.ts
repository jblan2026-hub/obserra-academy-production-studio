export type TenantScopedRecord = {
  organizationId: string;
};

export function requireOrganizationId(organizationId: string | null | undefined): string {
  const normalized = organizationId?.trim();
  if (!normalized) {
    throw new Error("An active organization is required");
  }
  return normalized;
}

export function tenantWhere<T extends Record<string, unknown>>(
  organizationId: string | null | undefined,
  where?: T,
): T & { organizationId: string } {
  return {
    ...(where ?? ({} as T)),
    organizationId: requireOrganizationId(organizationId),
  };
}

export function assertTenantAccess(
  organizationId: string | null | undefined,
  record: TenantScopedRecord | null | undefined,
): asserts record is TenantScopedRecord {
  const tenantId = requireOrganizationId(organizationId);
  if (!record) {
    throw new Error("Resource not found");
  }
  if (record.organizationId !== tenantId) {
    throw new Error("Cross organization access denied");
  }
}
