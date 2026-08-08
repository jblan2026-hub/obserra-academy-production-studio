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
  identityProvider?: "supabase" | "oidc" | "clerk" | "machine";
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

const roleAliases: Record<string, string> = {
  admin: "org:admin",
  owner: "org:admin",
  executive: "org:executive",
  publisher: "org:publisher",
  author: "org:author",
  reviewer: "org:reviewer",
  "academy-admin": "org:admin",
  "academy-executive": "org:executive",
  "academy-publisher": "org:publisher",
  "academy-author": "org:author",
  "academy-reviewer": "org:reviewer",
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

function mappedRole(value: unknown): string | undefined {
  const raw = String(value || "").trim().toLowerCase().replace(/^\/+/, "");
  if (!raw) return undefined;
  if (rolePermissions[raw]) return raw;
  return roleAliases[raw];
}

function normalizeRole(value: unknown): string {
  return mappedRole(value) || "org:reviewer";
}

function firstMappedRole(values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const nested of value) {
        const role = mappedRole(nested);
        if (role) return role;
      }
      continue;
    }
    const role = mappedRole(value);
    if (role) return role;
  }
  return "org:reviewer";
}

function principalFromSupabasePayload(payload: JWTPayload): StudioPrincipal | null {
  const actorId = stringClaim(payload.sub);
  if (!actorId) return null;
  const appMetadata = claimRecord(payload.app_metadata);
  const userMetadata = claimRecord(payload.user_metadata);
  const role = firstMappedRole([
    appMetadata.studio_role,
    appMetadata.role,
    userMetadata.studio_role,
    userMetadata.role,
  ]);
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

function principalFromOidcPayload(payload: JWTPayload): StudioPrincipal | null {
  const actorId = stringClaim(payload.sub);
  if (!actorId) return null;
  const realmAccess = claimRecord(payload.realm_access);
  const role = firstMappedRole([
    payload.studio_role,
    payload.role,
    realmAccess.roles,
    payload.roles,
    payload.groups,
  ]);
  const organizationId = stringClaim(
    payload.organization_id ??
    payload.org_id ??
    payload.tenant_id,
  ) ?? stringClaim(process.env.STUDIO_AUTH_DEFAULT_ORGANIZATION_ID);
  return {
    actorId,
    actorType: "user",
    organizationId,
    role,
    identityProvider: "oidc",
  };
}

let supabaseJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let oidcJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let resolvedOidcJwksUrl: string | null = null;

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

async function oidcJwksSet(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (oidcJwks) return oidcJwks;
  let jwksUrl = backendConfig.oidcJwksUrl;
  if (!jwksUrl) {
    if (!backendConfig.oidcIssuer) throw new Error("OIDC issuer is not configured");
    const discoveryResponse = await fetch(`${backendConfig.oidcIssuer}/.well-known/openid-configuration`, { cache: "no-store" });
    if (!discoveryResponse.ok) throw new Error(`OIDC discovery failed with HTTP ${discoveryResponse.status}`);
    const discovery = await discoveryResponse.json() as { jwks_uri?: string };
    jwksUrl = String(discovery.jwks_uri || "").trim();
    if (!jwksUrl) throw new Error("OIDC discovery did not provide jwks_uri");
  }
  resolvedOidcJwksUrl = jwksUrl;
  oidcJwks = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 60_000, cacheMaxAge: 10 * 60_000 });
  return oidcJwks;
}

async function oidcPrincipal(request: Request): Promise<StudioPrincipal | null> {
  const token = bearerToken(request);
  if (!token || !backendConfig.oidcIssuer) return null;
  try {
    const jwks = await oidcJwksSet();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: backendConfig.oidcIssuer,
      ...(backendConfig.oidcAudience ? { audience: backendConfig.oidcAudience } : {}),
    });
    return principalFromOidcPayload(payload);
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
  if (backendConfig.authProvider === "oidc") return oidcPrincipal(request);
  return supabasePrincipal(request);
}

export async function authenticateStudioRequest(
  request: Request,
): Promise<{ principal: StudioPrincipal | null; reason?: string }> {
  const machine = machinePrincipal(request);
  if (machine) return { principal: machine };

  const principal = await interactivePrincipal(request);
  if (!principal) return { principal: null, reason: "Authentication required" };
  if (!principal.organizationId) return { principal: null, reason: "An active organization is required" };
  return { principal };
}

export async function authorizeStudioRequest(
  request: Request,
  permission: StudioPermission,
): Promise<{ principal: StudioPrincipal | null; reason?: string }> {
  const authentication = await authenticateStudioRequest(request);
  if (!authentication.principal) return authentication;

  const principal = authentication.principal;
  const permissions = rolePermissions[principal.role] ?? new Set<StudioPermission>();
  if (!permissions.has(permission)) {
    return { principal: null, reason: `Role ${principal.role} does not grant ${permission}` };
  }

  return { principal };
}

export function studioAuthDiagnostics() {
  return {
    provider: backendConfig.authProvider,
    supabaseConfigured: Boolean(backendConfig.supabaseUrl),
    oidcConfigured: Boolean(backendConfig.oidcIssuer),
    oidcJwksResolved: resolvedOidcJwksUrl,
    clerkConfigured: Boolean(process.env.CLERK_SECRET_KEY),
    machineConfigured: Boolean(process.env.STUDIO_MACHINE_TOKEN),
  };
}
