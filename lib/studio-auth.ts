import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { timingSafeEqual } from "node:crypto";

import { backendConfig } from "@/lib/backend-config";

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
  identityProvider?: "supabase" | "clerk" | "machine";
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
    organizationId: request.headers.get("x-studio-organization-id") ?? process.env.STUDIO_OWNER_ORGANIZATION_ID ?? undefined,
    role: "org:admin",
    identityProvider: "machine",
  };
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function claimRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeRole(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    admin: "org:admin",
    owner: "org:admin",
    executive: "org:executive",
    publisher: "org:publisher",
    author: "org:author",
    reviewer: "org:reviewer",
  };
  if (rolePermissions[raw]) return raw;
  return aliases[raw] || "org:reviewer";
}

function principalFromSupabasePayload(payload: JWTPayload): StudioPrincipal | null {
  const actorId = stringClaim(payload.sub);
  if (!actorId) return null;
  const appMetadata = claimRecord(payload.app_metadata);
  const userMetadata = claimRecord(payload.user_metadata);
  const role = normalizeRole(
    appMetadata.studio_role ??
    appMetadata.role ??
    userMetadata.studio_role ??
    userMetadata.role,
  );
  const organizationId = stringClaim(
    appMetadata.organization_id ??
    appMetadata.org_id ??
    userMetadata.organization_id ??
    userMetadata.org_id,
  ) ?? stringClaim(process.env.STUDIO_AUTH_DEFAULT_ORGANIZATION_ID);
  return {
    actorId,
    actorType: "user",
    organizationId,
    role,
    identityProvider: "supabase",
  };
}

let supabaseJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function supabasePrincipal(request: Request): Promise<StudioPrincipal | null> {
  const token = bearerToken(request);
  if (!token || !backendConfig.supabaseUrl) return null;
  const issuer = `${backendConfig.supabaseUrl}/auth/v1`;
  const audience = String(process.env.SUPABASE_JWT_AUDIENCE || "authenticated").trim();
  const secret = String(process.env.SUPABASE_JWT_SECRET || "").trim();

  try {
    if (secret) {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer,
        ...(audience ? { audience } : {}),
      });
      return principalFromSupabasePayload(payload);
    }

    if (!supabaseJwks) {
      supabaseJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
        cooldownDuration: 60_000,
        cacheMaxAge: 10 * 60_000,
      });
    }
    const { payload } = await jwtVerify(token, supabaseJwks, {
      issuer,
      ...(audience ? { audience } : {}),
    });
    return principalFromSupabasePayload(payload);
  } catch {
    return null;
  }
}

async function clerkPrincipal(): Promise<StudioPrincipal | null> {
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const session = await auth();
    if (!session.isAuthenticated || !session.userId) return null;
    return {
      actorId: session.userId,
      actorType: "user",
      organizationId: session.orgId ?? undefined,
      role: normalizeRole(session.orgRole),
      identityProvider: "clerk",
    };
  } catch {
    return null;
  }
}

async function interactivePrincipal(request: Request): Promise<StudioPrincipal | null> {
  if (backendConfig.authProvider === "machine-only") return null;
  if (backendConfig.authProvider === "clerk") return clerkPrincipal();
  return supabasePrincipal(request);
}

export async function authorizeStudioRequest(
  request: Request,
  permission: StudioPermission,
): Promise<{ principal: StudioPrincipal | null; reason?: string }> {
  const machine = machinePrincipal(request);
  if (machine) return { principal: machine };

  const principal = await interactivePrincipal(request);
  if (!principal) {
    return { principal: null, reason: "Authentication required" };
  }

  const permissions = rolePermissions[principal.role] ?? new Set<StudioPermission>();
  if (!permissions.has(permission)) {
    return { principal: null, reason: `Role ${principal.role} does not grant ${permission}` };
  }

  if (!principal.organizationId) {
    return { principal: null, reason: "An active organization is required" };
  }

  return { principal };
}
