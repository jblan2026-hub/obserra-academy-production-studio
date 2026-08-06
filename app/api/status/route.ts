import { NextResponse } from "next/server";
import { expertPanel, metrics, productionQueue, sourceSystems } from "@/lib/studio-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const queueByStage = productionQueue.reduce<Record<string, number>>((accumulator, course) => {
    accumulator[course.status] = (accumulator[course.status] ?? 0) + 1;
    return accumulator;
  }, {});

  return NextResponse.json({
    service: "obserra-academy-production-studio",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    version: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    generatedAt: new Date().toISOString(),
    metrics,
    queues: {
      total: productionQueue.length,
      byStage: queueByStage,
      items: productionQueue,
    },
    expertPanel: {
      active: expertPanel.length,
      members: expertPanel,
    },
    sourceIntelligence: {
      monitoredSystems: sourceSystems.length,
      systemsRequiringReview: sourceSystems.filter((system) => system.status !== "Healthy").length,
      systems: sourceSystems,
    },
  });
}
