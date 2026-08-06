import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const dryRun = process.argv.includes("--dry-run");
const prisma = dryRun ? null : new PrismaClient();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeStatus(status) {
  const value = String(status ?? "draft").toUpperCase().replaceAll("-", "_");
  if (["IDEA", "RESEARCH", "GENERATING", "REVIEW", "MEDIA", "APPROVAL", "READY", "PUBLISHED", "ARCHIVED"].includes(value)) {
    return value;
  }
  return value === "DRAFT" ? "IDEA" : "IDEA";
}

function manifestPaths() {
  if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
  return fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(coursesRoot, entry.name, "course-manifest.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath));
}

function validateManifest(manifest, manifestPath) {
  const errors = [];
  if (!manifest?.course?.id) errors.push("course.id is required");
  if (!manifest?.course?.title) errors.push("course.title is required");
  if (!Array.isArray(manifest?.course?.modules) || manifest.course.modules.length === 0) errors.push("course.modules must contain at least one module");
  for (const [index, module] of (manifest?.course?.modules ?? []).entries()) {
    if (!module.id) errors.push(`course.modules[${index}].id is required`);
    if (!module.title) errors.push(`course.modules[${index}].title is required`);
  }
  if (errors.length) throw new Error(`${manifestPath}: ${errors.join("; ")}`);
}

async function resolveOrganization() {
  const clerkOrganizationId = process.env.STUDIO_SEED_CLERK_ORG_ID ?? process.env.STUDIO_OWNER_ORGANIZATION_ID;
  if (!clerkOrganizationId) {
    throw new Error("STUDIO_SEED_CLERK_ORG_ID or STUDIO_OWNER_ORGANIZATION_ID is required to load courses");
  }

  const slug = clerkOrganizationId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return prisma.organization.upsert({
    where: { clerkOrganizationId },
    update: { active: true },
    create: {
      clerkOrganizationId,
      name: process.env.STUDIO_OWNER_ORGANIZATION_NAME ?? "Obserra Academy",
      slug,
      active: true,
    },
  });
}

async function loadManifest(organizationId, manifest, manifestPath) {
  const course = manifest.course;
  const loaded = await prisma.$transaction(async (transaction) => {
    const record = await transaction.course.upsert({
      where: { organizationId_slug: { organizationId, slug: course.id } },
      update: {
        title: course.title,
        summary: course.description ?? null,
        status: normalizeStatus(manifest.release?.status),
        version: Math.max(1, Number.parseInt(String(manifest.release?.version ?? "1").split(".")[0], 10) || 1),
        productionOwner: "Obserra Academy Production Studio",
      },
      create: {
        organizationId,
        slug: course.id,
        title: course.title,
        summary: course.description ?? null,
        status: normalizeStatus(manifest.release?.status),
        version: Math.max(1, Number.parseInt(String(manifest.release?.version ?? "1").split(".")[0], 10) || 1),
        productionOwner: "Obserra Academy Production Studio",
      },
    });

    await transaction.lesson.deleteMany({ where: { courseId: record.id } });
    await transaction.lesson.createMany({
      data: course.modules.map((module, index) => ({
        courseId: record.id,
        title: module.title,
        position: index + 1,
        objective: module.description ?? null,
        content: {
          manifestModuleId: module.id,
          duration: module.duration ?? null,
          format: module.format ?? null,
          sourceManifest: path.relative(root, manifestPath).replaceAll("\\", "/"),
        },
      })),
    });

    await transaction.auditEvent.create({
      data: {
        organizationId,
        actorType: "service",
        actorId: "course-loader",
        action: "course.load",
        resourceType: "Course",
        resourceId: record.id,
        outcome: "success",
        metadata: {
          slug: course.id,
          lessonCount: course.modules.length,
          releaseVersion: manifest.release?.version ?? null,
          manifestPath: path.relative(root, manifestPath).replaceAll("\\", "/"),
        },
      },
    });

    return { id: record.id, slug: record.slug, lessons: course.modules.length };
  });

  return loaded;
}

const manifests = manifestPaths().map((manifestPath) => ({ manifestPath, manifest: readJson(manifestPath) }));
for (const item of manifests) validateManifest(item.manifest, item.manifestPath);

if (dryRun) {
  console.log(`[Academy Studio] Course load dry-run passed for ${manifests.length} course manifest(s)`);
  for (const { manifest } of manifests) console.log(`- ${manifest.course.id}: ${manifest.course.modules.length} lesson(s)`);
  process.exit(0);
}

try {
  const organization = await resolveOrganization();
  const results = [];
  for (const item of manifests) results.push(await loadManifest(organization.id, item.manifest, item.manifestPath));
  console.log(`[Academy Studio] Loaded ${results.length} course(s) into organization ${organization.clerkOrganizationId}`);
  for (const result of results) console.log(`- ${result.slug}: ${result.lessons} lesson(s)`);
} finally {
  await prisma.$disconnect();
}
