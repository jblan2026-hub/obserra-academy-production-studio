import { auth } from "@clerk/nextjs/server";
import { timingSafeEqual } from "node:crypto";

export type StudioPermission =
  | "course:create"
  | "build:start"
  | "release:approve"
  | "source:collect"
  | "ai:execute"
  | "prompt:manage"
  | "admin:manage";

export type StudioPrincipal = {
  actorId: string;
  actorType: "user" | "service";
  organizationId?: string;
  role: string;
};

const rolePermissions: Record<string, ReadonlySet<StudioPermission>> = {
  "org:admin": new Set([
    "course:create",
    "build:start",
    "release:approve",
    "source:collect",
    "ai:execute",
    "prompt:manage",
    "admin:manage",
  ]),
  "org:executive": new Set([
    "course:create",
    "build:start",
    "release:approve",
    "source:collect",
    "ai:execute",
  ]),
  "org:publisher": new Set(["build:start", "release:approve"]),
  "org:author": new Set(["course:create", "build:start", "source:collect", "ai:execute"]),
  "org:reviewer": new Set([]),
};

function secureTokenMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function machinePrincipal(request: Request): StudioPrincipal | null {
  const expected = process.env.STUDIO_MACHINE_TOKEN;
  const provided = request.headers.get("x-studio-machine-token");
  if (!expected || !provided || !secureTokenMatch(provided, expected)) return null;

  return {
    actorId: request.headers.get("x-studio-actor-id") ?? "studio-machine",
    actorType: "service",
    organizationId: request.headers.get("x-studio-organization-id") ?? undefined,
    role: "org:admin",
  };
}

export async function authorizeStudioRequest(
  request: Request,
  permission: StudioPermission,
): Promise<{ principal: StudioPrincipal | null; reason?: string }> {
  const machine = machinePrincipal(request);
  if (machine) return { principal: machine };

  const session = await auth();
  if (!session.isAuthenticated || !session.userId) {
    return { principal: null, reason: "Authentication required" };
  }

  const role = session.orgRole ?? "org:reviewer";
  const permissions = rolePermissions[role] ?? new Set<StudioPermission>();
  if (!permissions.has(permission)) {
    return { principal: null, reason: `Role ${role} does not grant ${permission}` };
  }

  if (!session.orgId) {
    return { principal: null, reason: "An active Clerk organization is required" };
  }

  return {
    principal: {
      actorId: session.userId,
      actorType: "user",
      organizationId: session.orgId,
      role,
    },
  };
}
