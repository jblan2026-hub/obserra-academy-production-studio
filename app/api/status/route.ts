import { NextResponse } from "next/server";
import { getStudioStatusSnapshot } from "@/lib/repositories/studio-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getStudioStatusSnapshot();

  return NextResponse.json({
    service: "obserra-academy-production-studio",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    version: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    generatedAt: new Date().toISOString(),
    ...snapshot,
  });
}
