import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export type StudioActor = {
  id: string;
  role: string;
  correlationId: string;
};

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizeStudioMutation(request: NextRequest): StudioActor {
  const configuredKey = process.env.STUDIO_API_KEY;
  const suppliedKey = request.headers.get("x-studio-api-key") ?? "";

  if (!configuredKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STUDIO_API_KEY is required for production mutations");
    }
  } else if (!secureEqual(configuredKey, suppliedKey)) {
    throw new Error("Unauthorized Studio mutation");
  }

  return {
    id: request.headers.get("x-studio-actor-id") ?? "system",
    role: request.headers.get("x-studio-actor-role") ?? "studio-admin",
    correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
  };
}
