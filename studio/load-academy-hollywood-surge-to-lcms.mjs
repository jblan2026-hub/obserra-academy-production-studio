import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const compliancePath = path.join(catalogRoot, "academy-hollywood-compliance-staging.json");
const registryPath = path.join(root, "sources", "authoritative-sources.json");
const dryRun = process.argv.includes("--dry-run");
const legalName = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function versionMajor(value) {
  return Math.max(1, Number.parseInt(String(value ?? "1").split(".")[0], 10) || 1);
}

function reviewRoleName(value) {
  return String(value ?? "reviewer").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

if (!fs.existsSync(compliancePath)) throw new Error(`Compliance staging report not found: ${compliancePath}`);
if (!fs.existsSync(registryPath)) throw new Error(`Authoritative source registry not found: ${registryPath}`);
const compliance = readJson(compliancePath);
const portfolio = academySurgePortfolio();
const registry = readJson(registryPath);
const registryById = new Map((registry.sources ?? []).map((source) => [source.id, source]));

if (compliance.readyForComplianceStaging !== true) {
  throw new Error("Exactly 60 courses must pass the cinematic compliance staging contract before LCMS staging.");
}
if (compliance.discoveredCourses !== portfolio.expectedCourses || compliance.complianceStagingReadyCourses !== portfolio.expectedCourses) {
  throw new Error(`LCMS staging requires ${portfolio.expectedCourses}/${portfolio.expectedCourses} structurally ready courses.`);
}
if ((compliance.courses ?? []).some((course) => course.findings?.length)) {
  throw new Error("LCMS staging is blocked because one or more course packages retain structural findings.");
}

const loadPlan = portfolio.selectedCourses.map((item) => {
  const packagePath = path.join(item.courseDir, "generated", "authoring", "course-package.json");
  const stageManifestPath = path.join(item.courseDir, "generated", "production-stage", "artifact-manifest.json");
  if (!fs.existsSync(packagePath) || !fs.existsSync(stageManifestPath)) {
    throw new Error(`Protected package or artifact manifest is missing for ${item.courseId}.`);
  }
  const envelope = readJson(packagePath);
  const artifactManifest = readJson(stageManifestPath);
  if (envelope.publicationAuthorized !== false || artifactManifest.publicationAuthorized !== false) {
    throw new Error(`Protected staging package must not authorize publication for ${item.courseId}.`);
  }
  return { item, envelope, artifactManifest };
});

const planReport = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  dryRun,
  expectedCourses: portfolio.expectedCourses,
  plannedCourses: loadPlan.length,
  organizationKey: process.env.STUDIO_OWNER_ORGANIZATION_ID ?? null,
  courseStatus: "REVIEW",
  releaseStatus: "STAGED",
  publicationAuthorized: false,
  courses: loadPlan.map(({ item, envelope, artifactManifest }) => ({
    courseId: item.courseId,
    title: item.manifest.course?.title,
    moduleCount: envelope.content?.modules?.length ?? 0,
    assessmentQuestionCount: envelope.content?.finalAssessment?.length ?? 0,
    sourceCount: envelope.content?.sourceRegister?.length ?? 0,
    artifactCount: artifactManifest.artifactCount,
    sourceManifestHash: envelope.sourceManifestHash,
    productionContractVersion: envelope.productionContractVersion,
  })),
  claimBoundary: "This plan stages protected course data in REVIEW and STAGED states. It does not grant publication, checkout, learner entitlement, final certificate issuance, or production acceptance.",
};
fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-lcms-load-plan.json"), `${JSON.stringify(planReport, null, 2)}\n`);

if (dryRun) {
  console.log(`[Academy Studio] Protected LCMS dry-run passed for exactly ${loadPlan.length} cinematic course packages.`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to stage protected Academy content in the LCMS.");
if (!process.env.STUDIO_OWNER_ORGANIZATION_ID) throw new Error("STUDIO_OWNER_ORGANIZATION_ID is required for protected LCMS staging.");

const prismaModule = await import("@prisma/client");
const PrismaClient = prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
if (!PrismaClient) throw new Error("PrismaClient is unavailable. Run npm run db:generate first.");
const prisma = new PrismaClient();

async function resolveOrganization() {
  const clerkOrganizationId = process.env.STUDIO_OWNER_ORGANIZATION_ID;
  const slug = clerkOrganizationId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return prisma.organization.upsert({
    where: { clerkOrganizationId },
    update: { active: true, name: process.env.STUDIO_OWNER_ORGANIZATION_NAME ?? "Obserra Academy" },
    create: {
      clerkOrganizationId,
      name: process.env.STUDIO_OWNER_ORGANIZATION_NAME ?? "Obserra Academy",
      slug,
      active: true,
    },
  });
}

async function upsertRegisteredSource(transaction, sourceId) {
  const source = registryById.get(sourceId);
  if (!source) return null;
  const effectiveDate = source.effective || source.amended || source.published;
  return transaction.sourceDocument.upsert({
    where: { canonicalUrl: source.canonicalUrl },
    update: {
      authority: source.issuer,
      title: source.title,
      version: source.publication ?? null,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      status: ["draft", "initial-public-draft"].includes(source.status) ? "REVIEW_REQUIRED" : "HEALTHY",
      contentHash: null,
      lastCollectedAt: new Date(),
    },
    create: {
      authority: source.issuer,
      title: source.title,
      canonicalUrl: source.canonicalUrl,
      version: source.publication ?? null,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      status: ["draft", "initial-public-draft"].includes(source.status) ? "REVIEW_REQUIRED" : "HEALTHY",
      lastCollectedAt: new Date(),
    },
  });
}

async function stageCourse(organizationId, load) {
  const { item, envelope, artifactManifest } = load;
  const manifest = item.manifest;
  const content = envelope.content ?? {};
  const modules = content.modules ?? [];
  const sourceRegister = content.sourceRegister ?? [];
  const registeredSourceRecords = new Map();

  return prisma.$transaction(async (transaction) => {
    const record = await transaction.course.upsert({
      where: { organizationId_slug: { organizationId, slug: item.courseId } },
      update: {
        title: manifest.course.title,
        summary: `${manifest.course.description}\n\nCompliance staging only. Publication is not authorized.`,
        status: "REVIEW",
        version: versionMajor(manifest.release?.version),
        qualityScore: 60,
        productionOwner: legalName,
      },
      create: {
        organizationId,
        slug: item.courseId,
        title: manifest.course.title,
        summary: `${manifest.course.description}\n\nCompliance staging only. Publication is not authorized.`,
        status: "REVIEW",
        version: versionMajor(manifest.release?.version),
        qualityScore: 60,
        productionOwner: legalName,
      },
    });

    await transaction.lesson.deleteMany({ where: { courseId: record.id } });
    await transaction.courseSource.deleteMany({ where: { courseId: record.id } });
    await transaction.courseReview.deleteMany({ where: { courseId: record.id, status: { not: "APPROVED" } } });
    await transaction.qualityScore.deleteMany({ where: { courseId: record.id } });

    for (const source of sourceRegister) {
      if (!registryById.has(source.id)) continue;
      const sourceRecord = await upsertRegisteredSource(transaction, source.id);
      registeredSourceRecords.set(source.id, sourceRecord);
      await transaction.courseSource.upsert({
        where: { courseId_sourceId: { courseId: record.id, sourceId: sourceRecord.id } },
        update: {
          applicability: `${source.applicability}. Applies when ${(source.appliesWhen ?? []).join("; ")}. Does not apply when ${(source.doesNotApplyWhen ?? []).join("; ")}. Limitations: ${(source.limitations ?? []).join("; ")}.`,
          binding: registryById.get(source.id).binding === true,
        },
        create: {
          courseId: record.id,
          sourceId: sourceRecord.id,
          applicability: `${source.applicability}. Applies when ${(source.appliesWhen ?? []).join("; ")}. Does not apply when ${(source.doesNotApplyWhen ?? []).join("; ")}. Limitations: ${(source.limitations ?? []).join("; ")}.`,
          binding: registryById.get(source.id).binding === true,
        },
      });
    }

    for (const [index, module] of modules.entries()) {
      const lesson = await transaction.lesson.create({
        data: {
          courseId: record.id,
          title: module.title,
          position: index + 1,
          objective: (module.learningObjectives ?? []).join(" ").slice(0, 2000) || null,
          content: {
            schemaVersion: "2.0",
            manifestModuleId: module.id,
            duration: module.duration,
            format: module.format,
            sourceManifestHash: envelope.sourceManifestHash,
            authoringPolicyVersion: envelope.authoringPolicyVersion,
            productionContractVersion: envelope.productionContractVersion,
            productionStandard: envelope.productionStandard,
            reviewStatus: envelope.reviewStatus,
            publicationAuthorized: false,
            learningObjectives: module.learningObjectives,
            openingContext: module.openingContext,
            lessonNarrative: module.lessonNarrative,
            keyConcepts: module.keyConcepts,
            executiveExample: module.executiveExample,
            operationalExample: module.operationalExample,
            scenario: module.scenario,
            exercise: module.exercise,
            referenceApplications: module.referenceApplications,
            applicabilityMatrix: (content.applicabilityMatrix ?? []).filter((entry) => entry.moduleIds?.includes(module.id)),
            slideNarrative: module.slideNarrative,
            cinematicTreatment: module.cinematicTreatment,
            videoScript: module.videoScript,
            accessibilityNotes: module.accessibilityNotes,
            workbook: (content.learnerWorkbook ?? []).find((entry) => entry.moduleId === module.id) ?? null,
            certificatePolicy: content.certificatePackage,
            rightsAndLicensingPlan: content.rightsAndLicensingPlan,
            accessibilityPlan: content.accessibilityPlan,
            protectedArtifactManifest: artifactManifest,
          },
        },
      });

      for (const sourceId of new Set([
        ...(module.referenceApplications ?? []).flatMap((entry) => entry.sourceIds ?? []),
        ...(module.keyConcepts ?? []).flatMap((entry) => entry.sourceIds ?? []),
      ])) {
        const sourceRecord = registeredSourceRecords.get(sourceId);
        if (!sourceRecord) continue;
        await transaction.citation.create({
          data: {
            lessonId: lesson.id,
            sourceId: sourceRecord.id,
            locator: registryById.get(sourceId)?.publication ?? sourceId,
          },
        });
      }

      for (const question of module.knowledgeChecks ?? []) {
        await transaction.assessment.create({
          data: {
            lessonId: lesson.id,
            kind: "knowledge-check",
            prompt: question.question,
            options: question.options ?? [],
            answerKey: {
              correctIndex: question.correctIndex,
              sourceIds: question.sourceIds ?? [],
              applicabilityContext: question.applicabilityContext ?? null,
            },
            rationale: question.rationale ?? null,
          },
        });
      }

      for (const question of (content.finalAssessment ?? []).filter((question) => question.moduleId === module.id)) {
        await transaction.assessment.create({
          data: {
            lessonId: lesson.id,
            kind: "final-assessment",
            prompt: question.question,
            options: question.options ?? [],
            answerKey: {
              correctIndex: question.correctIndex,
              sourceIds: question.sourceIds ?? [],
              applicabilityContext: question.applicabilityContext,
              cognitiveLevel: question.cognitiveLevel,
              difficulty: question.difficulty,
            },
            rationale: question.rationale ?? null,
          },
        });
      }

      await transaction.mediaAsset.create({
        data: {
          lessonId: lesson.id,
          type: "cinematic-production-plan",
          title: `${module.title} cinematic production plan`,
          storageKey: `protected-stage://${item.courseId}/video/${module.id}/production-script.json`,
          mimeType: "application/json",
          metadata: {
            status: "planned-not-mastered",
            publicationAuthorized: false,
            cinematicTreatment: module.cinematicTreatment,
            accessibilityPlan: {
              captionPlan: module.videoScript?.captionPlan ?? [],
              transcriptPlan: module.videoScript?.transcriptPlan ?? [],
              audioDescriptionPlan: module.videoScript?.audioDescriptionPlan ?? [],
              reducedMotionAlternative: module.videoScript?.reducedMotionAlternative ?? [],
            },
          },
        },
      });
    }

    const requiredReviews = [...new Set(content.productionGateEvidence?.requiredReviews ?? [
      "subject-matter",
      "technical",
      "legal-where-applicable",
      "copyright-and-trademark",
      "psychometric",
      "brand",
      "accessibility",
      "ai-governance",
      "media",
      "commerce-and-entitlement",
      "privacy-and-security",
      "owner-acceptance",
    ])];
    for (const role of requiredReviews) {
      await transaction.courseReview.create({
        data: {
          courseId: record.id,
          reviewerRole: reviewRoleName(role),
          status: "PENDING",
          notes: "Required before publication. Compliance staging does not authorize release.",
        },
      });
    }

    const qualityCategories = [
      ["instructional-depth", 100, true],
      ["authoritative-source-traceability", 100, true],
      ["applicability-mapping", 100, true],
      ["assessment-contract", 100, true],
      ["cinematic-production-planning", 100, true],
      ["protected-artifact-materialization", 100, true],
      ["mastered-media", 0, false],
      ["final-accessibility-assets", 0, false],
      ["rights-clearance", 0, false],
      ["owner-release-approval", 0, false],
    ];
    for (const [category, score, passed] of qualityCategories) {
      await transaction.qualityScore.create({
        data: {
          courseId: record.id,
          category,
          score,
          threshold: 95,
          passed,
          evidence: {
            sourceManifestHash: envelope.sourceManifestHash,
            productionContractVersion: envelope.productionContractVersion,
            publicationAuthorized: false,
          },
        },
      });
    }

    await transaction.release.upsert({
      where: { courseId_version: { courseId: record.id, version: `compliance-stage-${manifest.release?.version ?? "0.1.0"}` } },
      update: {
        status: "STAGED",
        packageUrl: null,
        approvedBy: null,
        approvedAt: null,
        publishedAt: null,
      },
      create: {
        courseId: record.id,
        version: `compliance-stage-${manifest.release?.version ?? "0.1.0"}`,
        status: "STAGED",
      },
    });

    const build = await transaction.build.create({
      data: {
        courseId: record.id,
        buildType: "academy-hollywood-compliance-stage",
        status: "SUCCEEDED",
        commitSha: process.env.GITHUB_SHA ?? null,
        logs: {
          artifactCount: artifactManifest.artifactCount,
          moduleCount: modules.length,
          assessmentQuestionCount: content.finalAssessment?.length ?? 0,
          exactSourceCount: sourceRegister.filter((source) => registryById.has(source.id)).length,
          publicationAuthorized: false,
        },
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId,
        actorType: "service",
        actorId: "academy-36-worker-hollywood-surge",
        action: "academy.course.compliance_stage.load",
        resourceType: "Course",
        resourceId: record.id,
        correlationId: process.env.GITHUB_RUN_ID ?? null,
        outcome: "success",
        metadata: {
          courseId: item.courseId,
          buildId: build.id,
          status: "REVIEW",
          releaseStatus: "STAGED",
          publicationAuthorized: false,
          sourceManifestHash: envelope.sourceManifestHash,
          authoringPolicyVersion: envelope.authoringPolicyVersion,
          productionContractVersion: envelope.productionContractVersion,
          artifactCount: artifactManifest.artifactCount,
        },
      },
    });

    return {
      courseId: item.courseId,
      databaseCourseId: record.id,
      lessons: modules.length,
      assessments: (content.finalAssessment?.length ?? 0) + modules.reduce((count, module) => count + (module.knowledgeChecks?.length ?? 0), 0),
      registeredSources: registeredSourceRecords.size,
      pendingReviews: requiredReviews.length,
      status: "REVIEW",
      releaseStatus: "STAGED",
      publicationAuthorized: false,
    };
  });
}

try {
  const organization = await resolveOrganization();
  const results = [];
  for (const load of loadPlan) results.push(await stageCourse(organization.id, load));
  const report = {
    schemaVersion: "1.0",
    completedAt: new Date().toISOString(),
    organizationId: organization.clerkOrganizationId,
    stagedCourses: results.length,
    expectedCourses: portfolio.expectedCourses,
    publicationAuthorized: false,
    results,
  };
  fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-lcms-load-result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[Academy Studio] Staged exactly ${results.length} cinematic course(s) in the protected LCMS as REVIEW/STAGED with publication disabled.`);
} finally {
  await prisma.$disconnect();
}
