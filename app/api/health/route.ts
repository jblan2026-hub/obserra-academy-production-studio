import { NextResponse } from "next/server";
import { getClerkIdentityReadiness } from "@/lib/identity-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = getClerkIdentityReadiness();
  const ready = identity.configured;

  return NextResponse.json(
    {
      service: "obserra-academy-production-studio",
      status: ready ? "healthy" : "degraded",
      ready,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      dependencies: {
        identity: {
          provider: identity.provider,
          status: ready ? "ready" : "unavailable",
          configured: ready,
        },
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
