import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total,
           COUNT(DISTINCT "courseSlug")::int AS distinct_courses,
           MAX("updatedAt") AS latest_update
    FROM public."AuthoringCheckpoint"
  `);
  const result = rows?.[0] ?? {};
  const total = Number(result.total ?? 0);
  const distinctCourses = Number(result.distinct_courses ?? 0);
  console.log(`[Academy Studio] Protected authoring checkpoints: total=${total} distinctCourses=${distinctCourses} latestUpdate=${result.latest_update ?? "none"}`);
  if (distinctCourses !== 61) {
    throw new Error(`Expected exactly 61 distinct protected course checkpoints, found ${distinctCourses}.`);
  }
} finally {
  await prisma.$disconnect();
}
