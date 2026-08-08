import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_POLICY_VERSION,
  validateAuthoringEnvelope,
} from "./authoring-checkpoints.mjs";
import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";
import {
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const dryRun = process.argv.includes("--dry-run");
let prisma;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeStatus(status, publicationEnabled) {
  const value = String(status ?? "draft").toUpperCase().replaceAll("-", "_");
  if (value === "PUBLISHED" && publicationEnabled !== true) return "APPROVAL";
  if (value === "APPROVED") return "READY";
  if (value === "IN_REVIEW") return "REVIEW";
  if ([
    "IDEA",
    "RESEARCH",
    "GENERATING",
    "REVIEW",
    "MEDIA",
    "APPROVAL",
    "READY",
    "PUBLISHED",
    "ARCHIVED",
  ].includes(value)) return value;
  return "IDEA";
}

function manifestPaths() {
  if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
  return fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(coursesRoot, entry.name, "course-manifest.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath));
}

function authoredPackage(manifestPath, manifest) {
  const courseDir = path.dirname(manifestPath);
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(packagePath)) return null;
  const envelope = readJson(packagePath);
  const identity = validateAuthoringEnvelope({
    courseId: manifest.course.id,
    envelope,
    manifest,
  });
  return { envelope, identity, packagePath };
}

function validateManifest(manifest, manifestPath) {
  const errors = [];
  if (!manifest?.course?.id) errors.push("course.id is required");
  if (!manifest?.course?.title) errors.push("course.title is required");
  if (!Array.isArray(manifest?.course?.modules) || manifest.course.modules.length === 0) {
    errors.push("course.modules must contain at least one module");
  }
  for (const [index, module] of (manifest?.course?.modules ?? []).entries()) {
    if (!module.id) errors.push(`course.modules[${index}].id is required`);
    if (!module.title) errors.push(`course.modules[${index}].title is required`);
  }
  if (errors.length) throw new Error(`${manifestPath}: ${errors.join("; ")}`);
  assertBrandAndTags(manifest, manifestPath);
}

function validateDetailedContent(manifest, authored, manifestPath) {
  if (!authored) throw new Error(`${manifestPath}: governed detailed authoring package is missing`);
  const { envelope } = authored;
  const content = envelope.content ?? {};
  const modules = Array.isArray(content.modules) ? content.modules : [];
  const moduleIds = new Set(modules.map((module) => module.id));
  const expectedModuleIds = manifest.course.modules.map((module) => module.id);
  if (modules.length !== expectedModuleIds.length) {
    throw new Error(`${manifestPath}: authored module count does not match the manifest`);
  }
  for (const moduleId of expectedModuleIds) {
    if (!moduleIds.has(moduleId)) throw new Error(`${manifestPath}: authored module ${moduleId} is missing`);
  }
  if (!content.courseSummary
      || !content.courseProductionBible
      || !content.courseImplementationStrategy
      || !Array.isArray(content.sourceRegister)
      || content.sourceRegister.length === 0
      || !Array.isArray(content.referenceApplicabilityMatrix)
      || content.referenceApplicabilityMatrix.length === 0
      || !Array.isArray(content.documentedRealWorldCaseRegister)
      || content.documentedRealWorldCaseRegister.length === 0
      || !Array.isArray(content.standardsImplementationMap)
      || content.standardsImplementationMap.length === 0
      || !Array.isArray(content.prioritizedRecommendations)
      || content.prioritizedRecommendations.length < 3
      || !content.assessmentBlueprint
      || !Array.isArray(content.finalAssessment)
      || content.finalAssessment.length < 25) {
    throw new Error(`${manifestPath}: detailed course, implementation, reference, or assessment structure is incomplete`);
  }
  if (envelope.implementationGuidanceStatus !== "draft-ai-generated-verification-required") {
    throw new Error(`${manifestPath}: implementation guidance status is missing or stale`);
  }
  return content;
}

async function createPrismaClient() {
  const module = await import("@prisma/client");
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  if (!PrismaClient) {
    throw new Error("PrismaClient is unavailable. Run `npm run db:generate` before a database load.");
  }
  return new PrismaClient();
}

async function resolveOrganization() {
  const clerkOrganizationId = process.env.STUDIO_SEED_CLERK_ORG_ID
    ?? process.env.STUDIO_OWNER_ORGANIZATION_ID;
  if (!clerkOrganizationId) {
    throw new Error("STUDIO_SEED_CLERK_ORG_ID or STUDIO_OWNER_ORGANIZATION_ID is required to load courses");
  }
  const slug = clerkOrganizationId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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

function moduleSources(content, moduleId) {
  return (content.sourceRegister ?? []).filter((source) =>
    Array.isArray(source.moduleIds) && source.moduleIds.includes(moduleId)
  );
}

function moduleApplicability(content, moduleId) {
  return (content.referenceApplicabilityMatrix ?? []).filter((entry) =>
    Array.isArray(entry.moduleIds) && entry.moduleIds.includes(moduleId)
  );
}

function moduleCases(content, moduleId, authoredModule) {
  const moduleCases = Array.isArray(authoredModule?.documentedRealWorldCases)
    ? authoredModule.documentedRealWorldCases
    : [];
  if (moduleCases.length > 0) return moduleCases;
  return (content.documentedRealWorldCaseRegister ?? []).filter((entry) =>
    Array.isArray(entry.moduleIds) && entry.moduleIds.includes(moduleId)
  );
}

async function loadManifest(organizationId, manifest, manifestPath, authored) {
  const course = manifest.course;
  const { envelope, identity } = authored;
  const authoredContent = validateDetailedContent(manifest, authored, manifestPath);
  const authoredModules = new Map(
    (authoredContent.modules ?? []).map((module) => [module.id, module]),
  );
  const workbookEntries = new Map(
    (authoredContent.learnerWorkbook ?? []).map((entry) => [entry.moduleId, entry]),
  );
  const finalAssessmentByModule = new Map();
  for (const question of authoredContent.finalAssessment ?? []) {
    if (!finalAssessmentByModule.has(question.moduleId)) {
      finalAssessmentByModule.set(question.moduleId, []);
    }
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
    workerContract: {
      contractId: workerPoolContract.contractId,
      contractHash: contractHash(),
      assignmentMode: workerPoolContract.assignmentMode,
      totalLogicalWorkers: workerPoolContract.totalLogicalWorkers,
    },
    productionStandard: {
      standardId: commercialProductionStandard.standardId,
      standardHash: commercialProductionStandardHash(),
      qualityTier: commercialProductionStandard.qualityTier,
      status: envelope.commercialQualityStatus,
      qualityClaimAllowed: false,
    },
    authoring: {
      schemaVersion: envelope.schemaVersion,
      policyVersion: envelope.authoringPolicyVersion,
      packageHash: identity.packageHash,
      sourceManifestHash: envelope.sourceManifestHash,
      reviewStatus: envelope.reviewStatus,
      implementationGuidanceStatus: envelope.implementationGuidanceStatus,
      provider: envelope.provider,
      model: envelope.model,
      generatedAt: envelope.generatedAt,
    },
  };

  return prisma.$transaction(async (transaction) => {
    const record = await transaction.course.upsert({
      where: {
        organizationId_slug: {
          organizationId,
          slug: course.id,
        },
      },
      update: {
        title: course.title,
        summary: `${course.description ?? ""}\n\n${officialBrand.disclaimer.shortText}`.trim(),
        status: normalizeStatus(
          manifest.release?.status,
          manifest.release?.publishToAcademy === true,
        ),
        version: Math.max(
          1,
          Number.parseInt(String(manifest.release?.version ?? "1").split(".")[0], 10) || 1,
        ),
        productionOwner: officialBrand.studioName,
      },
      create: {
        organizationId,
        slug: course.id,
        title: course.title,
        summary: `${course.description ?? ""}\n\n${officialBrand.disclaimer.shortText}`.trim(),
        status: normalizeStatus(
          manifest.release?.status,
          manifest.release?.publishToAcademy === true,
        ),
        version: Math.max(
          1,
          Number.parseInt(String(manifest.release?.version ?? "1").split(".")[0], 10) || 1,
        ),
        productionOwner: officialBrand.studioName,
      },
    });

    await transaction.lesson.deleteMany({ where: { courseId: record.id } });

    for (const [index, module] of course.modules.entries()) {
      const authoredModule = authoredModules.get(module.id);
      if (!authoredModule) throw new Error(`Authored module ${module.id} is missing during LCMS load.`);
      const firstModule = index === 0;
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
            ...policyMetadata,
            courseContext: {
              courseSummary: authoredContent.courseSummary,
              frameworkAlignment: authoredContent.frameworkAlignment ?? [],
              assessmentBlueprint: authoredContent.assessmentBlueprint,
              courseProductionBible: firstModule
                ? authoredContent.courseProductionBible
                : { reference: "course-module-1" },
              courseImplementationStrategy: firstModule
                ? authoredContent.courseImplementationStrategy
                : { reference: "course-module-1" },
              documentedRealWorldCaseRegister: firstModule
                ? authoredContent.documentedRealWorldCaseRegister
                : [],
              standardsImplementationMap: firstModule
                ? authoredContent.standardsImplementationMap
                : [],
              prioritizedRecommendations: firstModule
                ? authoredContent.prioritizedRecommendations
                : [],
            },
            learningObjectives: authoredModule.learningObjectives ?? [],
            openingContext: authoredModule.openingContext ?? "",
            lessonNarrative: authoredModule.lessonNarrative ?? "",
            claimRegister: authoredModule.claimRegister ?? [],
            keyConcepts: authoredModule.keyConcepts ?? [],
            executiveExample: authoredModule.executiveExample ?? null,
            operationalExample: authoredModule.operationalExample ?? null,
            documentedRealWorldCases: moduleCases(
              authoredContent,
              module.id,
              authoredModule,
            ),
            scenario: authoredModule.scenario ?? null,
            exercise: authoredModule.exercise ?? null,
            implementationPlaybook: authoredModule.implementationPlaybook ?? null,
            recommendations: authoredModule.recommendations ?? [],
            standardImplementationGuidance:
              authoredModule.standardImplementationGuidance ?? [],
            evidenceAndMetricsPlan: authoredModule.evidenceAndMetricsPlan ?? null,
            creativeTreatment: authoredModule.creativeTreatment ?? null,
            productionPlan: authoredModule.productionPlan ?? null,
            slideNarrative: authoredModule.slideNarrative ?? [],
            videoScript: authoredModule.videoScript ?? null,
            accessibilityNotes: authoredModule.accessibilityNotes ?? [],
            sourcePlaceholders: authoredModule.sourcePlaceholders ?? [],
            referenceApplicationNotes:
              authoredModule.referenceApplicationNotes ?? [],
            sourceRegister: moduleSources(authoredContent, module.id),
            referenceApplicabilityMatrix:
              moduleApplicability(authoredContent, module.id),
            workbook: workbookEntries.get(module.id) ?? null,
          },
        },
      });

      const knowledgeChecks = authoredModule.knowledgeChecks ?? [];
      const finalAssessment = finalAssessmentByModule.get(module.id) ?? [];
      for (const question of knowledgeChecks) {
        await transaction.assessment.create({
          data: {
            lessonId: lesson.id,
            kind: "knowledge-check",
            prompt: question.question,
            options: question.options ?? [],
            answerKey: {
              correctIndex: question.correctIndex,
              objectiveIds: question.objectiveIds ?? [],
              sourceIds: question.sourceIds ?? [],
            },
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
            answerKey: {
              correctIndex: question.correctIndex,
              distractorRationales: question.distractorRationales ?? [],
              objectiveIds: question.objectiveIds ?? [],
              sourceIds: question.sourceIds ?? [],
              applicabilityNote: question.applicabilityNote ?? "",
              cognitiveLevel: question.cognitiveLevel ?? null,
            },
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
        action: "course.load.protected-detailed-package",
        resourceType: "Course",
        resourceId: record.id,
        outcome: "success",
        metadata: {
          slug: course.id,
          lessonCount: course.modules.length,
          authoredModuleCount: authoredContent.modules.length,
          finalAssessmentQuestionCount: authoredContent.finalAssessment.length,
          sourceCount: authoredContent.sourceRegister.length,
          referenceApplicabilityCount:
            authoredContent.referenceApplicabilityMatrix.length,
          documentedRealWorldCaseCount:
            authoredContent.documentedRealWorldCaseRegister.length,
          standardsImplementationMapCount:
            authoredContent.standardsImplementationMap.length,
          prioritizedRecommendationCount:
            authoredContent.prioritizedRecommendations.length,
          releaseVersion: manifest.release?.version ?? null,
          publicationEnabled: manifest.release?.publishToAcademy === true,
          manifestPath: path.relative(root, manifestPath).replaceAll("\\", "/"),
          authoringPackagePath:
            path.relative(root, authored.packagePath).replaceAll("\\", "/"),
          authoringPackageHash: identity.packageHash,
          authoringPolicyVersion: AUTHORING_POLICY_VERSION,
          workerContractId: workerPoolContract.contractId,
          workerContractHash: contractHash(),
          productionStandardId: commercialProductionStandard.standardId,
          productionStandardHash: commercialProductionStandardHash(),
          qualityTier: commercialProductionStandard.qualityTier,
          commercialQualityStatus: envelope.commercialQualityStatus,
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
      authoredModules: authoredContent.modules.length,
      finalAssessmentQuestions: authoredContent.finalAssessment.length,
      sources: authoredContent.sourceRegister.length,
      realWorldCases: authoredContent.documentedRealWorldCaseRegister.length,
      standardsMappings: authoredContent.standardsImplementationMap.length,
      recommendations: authoredContent.prioritizedRecommendations.length,
      packageHash: identity.packageHash,
    };
  });
}

const manifests = manifestPaths().map((manifestPath) => {
  const manifest = readJson(manifestPath);
  validateManifest(manifest, manifestPath);
  const authored = authoredPackage(manifestPath, manifest);
  validateDetailedContent(manifest, authored, manifestPath);
  return { manifestPath, manifest, authored };
});

if (dryRun) {
  console.log(
    `[Academy Studio] Governed detailed course load dry-run passed for ${manifests.length} course manifest(s).`,
  );
  for (const { manifestPath, manifest, authored } of manifests) {
    const content = authored.envelope.content;
    console.log(
      `- ${manifest.course.id}: ${manifest.course.modules.length} lesson(s), ${content.finalAssessment.length} assessment item(s), ${content.sourceRegister.length} source record(s), ${content.documentedRealWorldCaseRegister.length} case record(s), ${content.standardsImplementationMap.length} standards mapping(s), packageHash=${authored.identity.packageHash}`,
    );
    if (!manifestPath) throw new Error("Unreachable manifest path state.");
  }
  process.exit(0);
}

try {
  prisma = await createPrismaClient();
  const organization = await resolveOrganization();
  const results = [];
  for (const item of manifests) {
    results.push(await loadManifest(
      organization.id,
      item.manifest,
      item.manifestPath,
      item.authored,
    ));
  }
  console.log(
    `[Academy Studio] Loaded ${results.length} governed detailed course(s) into protected organization ${organization.clerkOrganizationId}.`,
  );
  for (const result of results) {
    console.log(
      `- ${result.slug}: ${result.lessons} lesson(s), ${result.authoredModules} authored module(s), ${result.finalAssessmentQuestions} final assessment item(s), ${result.sources} source record(s), ${result.realWorldCases} case record(s), ${result.standardsMappings} standards mapping(s), ${result.recommendations} recommendation(s), packageHash=${result.packageHash}`,
    );
  }
} finally {
  if (prisma) await prisma.$disconnect();
}
