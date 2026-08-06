import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    service: "obserra-academy-production-studio",
    status: "healthy",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    version: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    timestamp: new Date().toISOString(),
  });
}
