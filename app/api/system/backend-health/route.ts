import { NextResponse } from "next/server";

import { backendConfig } from "@/lib/backend-config";
import { freeAiHealth } from "@/lib/free-ai-service";
import { prisma } from "@/lib/prisma";
import { storageHealth } from "@/lib/storage-service";
import { authorizeStudioRequest, studioAuthDiagnostics } from "@/lib/studio-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await authorizeStudioRequest(request, "admin:manage");
  if (!authorization.principal) {
    return NextResponse.json({ error: authorization.reason ?? "Unauthorized", correlationId }, { status: 403 });
  }

  const checks: Record<string, unknown> = {};
  let databaseHealthy = false;
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    databaseHealthy = true;
    checks.database = { provider: "postgresql", healthy: true };
  } catch (error) {
    checks.database = { provider: "postgresql", healthy: false, detail: error instanceof Error ? error.message : String(error) };
  }

  let storage;
  try {
    storage = await storageHealth();
  } catch (error) {
    storage = { provider: backendConfig.storageProvider, configured: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const ai = await freeAiHealth();
  const authDiagnostics = studioAuthDiagnostics();
  const authConfigured = backendConfig.authProvider === "machine-only"
    ? authDiagnostics.machineConfigured
    : backendConfig.authProvider === "clerk"
      ? authDiagnostics.clerkConfigured
      : backendConfig.authProvider === "oidc"
        ? authDiagnostics.oidcConfigured
        : authDiagnostics.supabaseConfigured;

  checks.storage = storage;
  checks.ai = ai;
  checks.auth = { ...authDiagnostics, configured: authConfigured };
  checks.costPolicy = {
    mode: backendConfig.mode,
    paidAiAllowed: backendConfig.paidAiAllowed,
    paidAiDailyCallBudget: backendConfig.paidAiDailyCallBudget,
    paidAiPerRunCallBudget: backendConfig.paidAiPerRunCallBudget,
  };

  const healthy = databaseHealthy && Boolean(storage.configured) && authConfigured && (backendConfig.aiProvider === "disabled" || ai.reachable);
  return NextResponse.json({
    correlationId,
    healthy,
    backend: {
      authProvider: backendConfig.authProvider,
      storageProvider: backendConfig.storageProvider,
      queueProvider: backendConfig.queueProvider,
      aiProvider: backendConfig.aiProvider,
      freeFirst: backendConfig.mode === "free-first",
    },
    checks,
  }, { status: healthy ? 200 : 503 });
}
