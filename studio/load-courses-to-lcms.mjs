import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const dryRun = process.argv.includes("--dry-run");
let prisma;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeStatus(status) {
  const value = String(status ?? "draft").toUpperCase().replaceAll("-", "_");
  if (["IDEA", "RESEARCH", "GENERATING", "REVIEW", "MEDIA", "APPROVAL", "READY", "PUBLISHED", "ARCHIVED"].includes(value)) return value;
  return "IDEA";
}

function manifestPaths() {
  if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
  return fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(coursesRoot, entry.name, "course-manifest.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath));
}

function authoredPackage(manifestPath) {
  const courseDir = path.dirname(manifestPath);
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  return fs.existsSync(packagePath) ? readJson(packagePath) : null;
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
  assertBrandAndTags(manifest, manifestPath);
}

async function createPrismaClient() {
  const module = await import("@prisma/client");
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  if (!PrismaClient) throw new Error("PrismaClient is unavailable. Run `npm run db:generate` before a database load.");
  return new PrismaClient();
}

async function resolveOrganization() {
  const clerkOrganizationId = process.env.STUDIO_SEED_CLERK_ORG_ID ?? process.env.STUDIO_OWNER_ORGANIZATION_ID;
  if (!clerkOrganizationId) throw new Error("STUDIO_SEED_CLERK_ORG_ID or STUDIO_OWNER_ORGANIZATION_ID is required to load courses");
  const slug = clerkOrganizationId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return prisma.organization.upsert({
    where: { clerkOrganizationId },
    update: { active: true },
    create: { clerkOrganizationId, name: process.env.STUDIO_OWNER_ORGANIZATION_NAME ?? "Obserra Academy", slug, active: true },
  });
}

async function loadManifest(organizationId, manifest, manifestPath) {
  const course = manifest.course;
  const authored = authoredPackage(manifestPath);
  const authoredContent = authored?.content ?? {};
  const authoredModules = new Map((authoredContent.modules ?? []).map((module) => [module.id, module]));
  const workbookEntries = new Map((authoredContent.learnerWorkbook ?? []).map((entry) => [entry.moduleId, entry]));
  const finalAssessmentByModule = new Map();
  for (const question of authoredContent.finalAssessment ?? []) {
    if (!finalAssessmentByModule.has(question.moduleId)) finalAssessmentByModule.set(question.moduleId, []);
    finalAssessmentByModule.get(question.moduleId).push(question);
  }

  const policyMetadata = {
    branding: manifest.branding,
    tags: manifest.tags,
    disclaimer: manifest.disclaimer,
    credentialType: "certificate-of-course-completion-only",
    isProfessionalCertification: false,
    isComplianceEvidence: false,
    learnerAcknowledgementRequired: true,
    ownerReviewBypassSupported: true,
    purchaseNotRequiredForOwnerReview: true,
  };

  return prisma.$transaction(async (transaction) => {
    const record = await transaction.course.upsert({
      where: { organizationId_slug: { organizationId, slug: course.id } },
      update: {
        title: course.title,
        summary: `${course.description ?? ""}\n\n${officialBrand.disclaimer.shortText}`.trim(),
        status: normalizeStatus(manifest.release?.status),
        version: Math.max(1, Number.parseInt(String(manifest.release?.version ?? "1").split(".")[0], 10) || 1),
        productionOwner: officialBrand.studioName,
      },
      create: {
        organizationId,
        slug: course.id,
        title: course.title,
        summary: `${course.description ?? ""}\n\n${officialBrand.disclaimer.shortText}`.trim(),
        status: normalizeStatus(manifest.release?.status),
        version: Math.max(1, Number.parseInt(String(manifest.release?.version ?? "1").split(".")[0], 10) || 1),
        productionOwner: officialBrand.studioName,
      },
    });

    await transaction.lesson.deleteMany({ where: { courseId: record.id } });

    for (const [index, module] of course.modules.entries()) {
      const authoredModule = authoredModules.get(module.id) ?? null;
      const lesson = await transaction.lesson.create({
        data: {
          courseId: record.id,
          title: module.title,
          position: index + 1,
          objective: module.description ?? null,
          content: {
            manifestModuleId: module.id,
            duration: module.duration ?? null,
            format: module.format ?? null,
            sourceManifest: path.relative(root, manifestPath).replaceAll("\\", "/"),
            sourceManifestHash: authored?.sourceManifestHash ?? null,
            authoringReviewStatus: authored?.reviewStatus ?? "missing",
            learningObjectives: authoredModule?.learningObjectives ?? [],
            openingContext: authoredModule?.openingContext ?? "",
            lessonNarrative: authoredModule?.lessonNarrative ?? "",
            keyConcepts: authoredModule?.keyConcepts ?? [],
            executiveExample: authoredModule?.executiveExample ?? "",
            operationalExample: authoredModule?.operationalExample ?? "",
            scenario: authoredModule?.scenario ?? null,
            exercise: authoredModule?.exercise ?? null,
            slideNarrative: authoredModule?.slideNarrative ?? [],
            videoScript: authoredModule?.videoScript ?? null,
            accessibilityNotes: authoredModule?.accessibilityNotes ?? [],
            sourcePlaceholders: authoredModule?.sourcePlaceholders ?? [],
            workbook: workbookEntries.get(module.id) ?? null,
            ...policyMetadata,
          },
        },
      });

      const knowledgeChecks = authoredModule?.knowledgeChecks ?? [];
      const finalAssessment = finalAssessmentByModule.get(module.id) ?? [];
      for (const question of knowledgeChecks) {
        await transaction.assessment.create({
          data: {
            lessonId: lesson.id,
            kind: "knowledge-check",
            prompt: question.question,
            options: question.options ?? [],
            answerKey: { correctIndex: question.correctIndex },
            rationale: question.rationale ?? null,
          },
        });
      }
      for (const question of finalAssessment) {
        await transaction.assessment.create({
          data: {
            lessonId: lesson.id,
            kind: "final-assessment",
            prompt: question.question,
            options: question.options ?? [],
            answerKey: { correctIndex: question.correctIndex },
            rationale: question.rationale ?? null,
          },
        });
      }
    }

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
          authoringAvailable: Boolean(authored),
          authoredModuleCount: authoredContent.modules?.length ?? 0,
          finalAssessmentQuestionCount: authoredContent.finalAssessment?.length ?? 0,
          releaseVersion: manifest.release?.version ?? null,
          manifestPath: path.relative(root, manifestPath).replaceAll("\\", "/"),
          officialLogo: manifest.branding.logoAsset,
          tags: manifest.tags,
          disclaimerType: manifest.disclaimer.type,
          acknowledgementRequired: true,
          ownerReviewBypassSupported: true,
          credentialType: "certificate-of-course-completion-only",
          isProfessionalCertification: false,
          isComplianceEvidence: false,
        },
      },
    });

    return {
      id: record.id,
      slug: record.slug,
      lessons: course.modules.length,
      authoredModules: authoredContent.modules?.length ?? 0,
      finalAssessmentQuestions: authoredContent.finalAssessment?.length ?? 0,
    };
  });
}

const manifests = manifestPaths().map((manifestPath) => ({ manifestPath, manifest: readJson(manifestPath) }));
for (const item of manifests) validateManifest(item.manifest, item.manifestPath);

if (dryRun) {
  console.log(`[Academy Studio] Governed course load dry-run passed for ${manifests.length} course manifest(s).`);
  for (const { manifestPath, manifest } of manifests) {
    const authored = authoredPackage(manifestPath);
    console.log(`- ${manifest.course.id}: ${manifest.course.modules.length} lesson(s), authored=${Boolean(authored)}, official branding and legal policy verified`);
  }
  process.exit(0);
}

try {
  prisma = await createPrismaClient();
  const organization = await resolveOrganization();
  const results = [];
  for (const item of manifests) results.push(await loadManifest(organization.id, item.manifest, item.manifestPath));
  console.log(`[Academy Studio] Loaded ${results.length} governed course(s) into organization ${organization.clerkOrganizationId}.`);
  for (const result of results) console.log(`- ${result.slug}: ${result.lessons} lesson(s), ${result.authoredModules} authored module(s), ${result.finalAssessmentQuestions} final assessment question(s)`);
} finally {
  if (prisma) await prisma.$disconnect();
}
