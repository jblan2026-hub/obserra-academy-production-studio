import { prisma } from "@/lib/prisma";
import { expertPanel, metrics, productionQueue, sourceSystems } from "@/lib/studio-data";

type StudioMetrics = {
  activeCourses: number;
  averageQuality: number;
  reviewQueue: number;
  expertAgents: number;
  sourceSystems: number;
  releaseReadiness: number;
};

export type StudioStatusSnapshot = {
  source: "database" | "fallback";
  metrics: StudioMetrics;
  queues: {
    total: number;
    byStage: Record<string, number>;
    items: Array<{
      id: string;
      title: string;
      status: string;
      quality: number;
      owner: string;
      updated: string;
    }>;
  };
  expertPanel: {
    active: number;
    members: readonly string[] | string[];
  };
  sourceIntelligence: {
    monitoredSystems: number;
    systemsRequiringReview: number;
    systems: Array<{
      name: string;
      status: string;
      lastCollection: string;
      impactedCourses: number;
    }>;
  };
};

function fallbackSnapshot(): StudioStatusSnapshot {
  const byStage = productionQueue.reduce<Record<string, number>>((accumulator, course) => {
    accumulator[course.status] = (accumulator[course.status] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    source: "fallback",
    metrics: { ...metrics },
    queues: { total: productionQueue.length, byStage, items: productionQueue },
    expertPanel: { active: expertPanel.length, members: expertPanel },
    sourceIntelligence: {
      monitoredSystems: sourceSystems.length,
      systemsRequiringReview: sourceSystems.filter((system) => system.status !== "Healthy").length,
      systems: sourceSystems,
    },
  };
}

export async function getStudioStatusSnapshot(): Promise<StudioStatusSnapshot> {
  if (!process.env.DATABASE_URL) return fallbackSnapshot();

  try {
    const [courses, experts, sources] = await Promise.all([
      prisma.course.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
      prisma.expertAgent.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.sourceDocument.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    ]);

    const byStage = courses.reduce<Record<string, number>>((accumulator, course) => {
      accumulator[course.status] = (accumulator[course.status] ?? 0) + 1;
      return accumulator;
    }, {});
    const averageQuality = courses.length
      ? Math.round(courses.reduce((sum, course) => sum + course.qualityScore, 0) / courses.length)
      : 0;
    const reviewQueue = courses.filter((course) => course.status === "REVIEW" || course.status === "APPROVAL").length;

    return {
      source: "database",
      metrics: {
        activeCourses: courses.length,
        averageQuality,
        reviewQueue,
        expertAgents: experts.length,
        sourceSystems: sources.length,
        releaseReadiness: averageQuality,
      },
      queues: {
        total: courses.length,
        byStage,
        items: courses.map((course) => ({
          id: course.slug,
          title: course.title,
          status: course.status,
          quality: course.qualityScore,
          owner: course.productionOwner ?? "Unassigned",
          updated: course.updatedAt.toISOString(),
        })),
      },
      expertPanel: { active: experts.length, members: experts.map((expert) => expert.name) },
      sourceIntelligence: {
        monitoredSystems: sources.length,
        systemsRequiringReview: sources.filter((source) => source.status !== "HEALTHY").length,
        systems: sources.map((source) => ({
          name: source.authority,
          status: source.status,
          lastCollection: source.lastCollectedAt?.toISOString() ?? "Never",
          impactedCourses: 0,
        })),
      },
    };
  } catch (error) {
    console.error("Studio database snapshot failed; using governed fallback data.", error);
    return fallbackSnapshot();
  }
}
