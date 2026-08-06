import assert from "node:assert/strict";
import test from "node:test";
import { assertTenantAccess, requireOrganizationId, tenantWhere } from "../lib/tenant-scope";

test("requireOrganizationId rejects missing organization context", () => {
  assert.throws(() => requireOrganizationId(undefined), /active organization/i);
  assert.throws(() => requireOrganizationId("   "), /active organization/i);
});

test("tenantWhere always injects the active organization", () => {
  assert.deepEqual(tenantWhere("org_obserra", { status: "READY" }), {
    status: "READY",
    organizationId: "org_obserra",
  });
});

test("assertTenantAccess permits records from the active organization", () => {
  assert.doesNotThrow(() => assertTenantAccess("org_obserra", { organizationId: "org_obserra" }));
});

test("assertTenantAccess denies cross organization records", () => {
  assert.throws(
    () => assertTenantAccess("org_obserra", { organizationId: "org_other" }),
    /cross organization access denied/i,
  );
});

test("assertTenantAccess does not reveal whether an absent resource belongs to another tenant", () => {
  assert.throws(() => assertTenantAccess("org_obserra", null), /resource not found/i);
});
