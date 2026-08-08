import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";
import {
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const outputDir = path.join(root, "catalog");
const publicCatalogPath = path.join(outputDir, "academy-course-catalog.json");
const learnerCatalogPath = path.join(outputDir, "academy-learner-course-catalog.json");

fs.mkdirSync(outputDir, { recursive: true });

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function authoredPackage(courseDir) {
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(packagePath)) return null;
  return readJson(packagePath);
}

function publicCourse(manifest) {
  return {
    id: manifest.course.id,
    title: manifest.course.title,
    department: manifest.course.department,
    level: manifest.course.level,
    track: manifest.course.track,
    audience: manifest.course.audience,
    description: manifest.course.description,
    duration: manifest.course.duration,
    prerequisites: manifest.course.prerequisites || [],
    outcomes: manifest.course.outcomes,
    modules: manifest.course.modules.map((module, index) => ({
      id: module.id,
      sequence: index + 1,
      title: module.title,
      duration: module.duration,
      format: module.format,
      description: module.description,
    })),
    moduleCount: manifest.course.modules.length,
    tags: manifest.tags,
    commerce: {
      model: manifest.commerce.model,
      price: manifest.commerce.price,
      currency: manifest.commerce.currency,
      paymentLink: manifest.commerce.paymentLink ?? null,
      stripePriceId: manifest.commerce.stripePriceId ?? null,
    },
    licensing: {
      entitlementType: "course-enrollment",
      entitlementCode: `ACADEMY_${manifest.course.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      accessPolicy: manifest.commerce.accessPolicy,
      recurring: false,
      seatScope: "named-learner",
      transferable: false,
      expiresAtCompletion: true,
      completionRecordRetained: true,
    },
    completion: {
      allLessonsRequired: manifest.completion.allLessonsRequired,
      assessmentRequired: manifest.completion.assessmentRequired,
      assessmentDuration: manifest.completion.assessmentDuration ?? null,
      passingScore: manifest.completion.passingScore,
      certificateIssued: manifest.completion.certificateIssued,
      credentialType: "certificate-of-course-completion-only",
      credentialDisclaimer:
        "This completion record is not certification, licensure, accreditation, compliance validation, regulatory approval, or professional qualification.",
    },
    certificate: {
      issuer: officialBrand.legalName,
      templateId: "obserra-academy-course-completion-v1",
      title: "Certificate of Course Completion",
      certificateIdPattern:
        `OBS-${manifest.course.id.toUpperCase().replace(/[^A-Z0-9]+/g, "")}-{UNIQUE}`,
      verificationRequired: true,
      transcriptRetained: true,
      isProfessionalCertification: false,
      isComplianceEvidence: false,
    },
    branding: manifest.branding,
    disclaimer: manifest.disclaimer,
    acknowledgementRequired: true,
    version: manifest.release.version,
    releaseStatus: manifest.release.status,
  };
}

function learnerCourse(manifest, authored) {
  const authoredContent = authored?.content ?? {};
  const authoredModules = new Map(
    (authoredContent.modules ?? []).map((module) => [module.id, module]),
  );
  const workbook = new Map(
    (authoredContent.learnerWorkbook ?? []).map((entry) => [entry.moduleId, entry]),
  );

  return {
    ...publicCourse(manifest),
    publication: {
      approved:
        manifest.release?.publishToAcademy === true
        && ["approved", "published"].includes(manifest.release?.status),
      status: manifest.release?.status ?? "draft",
    },
    access: {
      surface: "post-purchase-learner",
      requiresEntitlement: true,
      ownerReviewEligible: manifest.release?.status !== "archived",
      ownerReviewBypassSupported: true,
      purchaseNotRequiredForOwnerReview: true,
    },
    learnerExperience: {
      courseSummary: authoredContent.courseSummary ?? null,
      courseProductionBible: authoredContent.courseProductionBible ?? null,
      courseImplementationStrategy: authoredContent.courseImplementationStrategy ?? null,
      sourceRegister: authoredContent.sourceRegister ?? [],
      referenceApplicabilityMatrix: authoredContent.referenceApplicabilityMatrix ?? [],
      documentedRealWorldCaseRegister:
        authoredContent.documentedRealWorldCaseRegister ?? [],
      standardsImplementationMap: authoredContent.standardsImplementationMap ?? [],
      prioritizedRecommendations: authoredContent.prioritizedRecommendations ?? [],
      frameworkAlignment: authoredContent.frameworkAlignment ?? [],
      assessmentBlueprint: authoredContent.assessmentBlueprint ?? null,
      modules: manifest.course.modules.map((module, index) => {
        const lesson = authoredModules.get(module.id) ?? {};
        const learnerWorkbook = workbook.get(module.id) ?? null;
        return {
          id: module.id,
          sequence: index + 1,
          title: module.title,
          duration: module.duration,
          format: module.format,
          description: module.description,
          learningObjectives: lesson.learningObjectives ?? [],
          openingContext: lesson.openingContext ?? "",
          lessonNarrative: lesson.lessonNarrative ?? "",
          claimRegister: lesson.claimRegister ?? [],
          keyConcepts: lesson.keyConcepts ?? [],
          executiveExample: lesson.executiveExample ?? null,
          operationalExample: lesson.operationalExample ?? null,
          documentedRealWorldCases: lesson.documentedRealWorldCases ?? [],
          scenario: lesson.scenario ?? null,
          exercise: lesson.exercise ?? null,
          implementationPlaybook: lesson.implementationPlaybook ?? null,
          recommendations: lesson.recommendations ?? [],
          standardImplementationGuidance:
            lesson.standardImplementationGuidance ?? [],
          evidenceAndMetricsPlan: lesson.evidenceAndMetricsPlan ?? null,
          knowledgeChecks: lesson.knowledgeChecks ?? [],
          creativeTreatment: lesson.creativeTreatment ?? null,
          productionPlan: lesson.productionPlan ?? null,
          slideNarrative: lesson.slideNarrative ?? [],
          videoScript: lesson.videoScript ?? null,
          accessibilityNotes: lesson.accessibilityNotes ?? [],
          sourcePlaceholders: lesson.sourcePlaceholders ?? [],
          referenceApplicationNotes: lesson.referenceApplicationNotes ?? [],
          workbook: learnerWorkbook,
        };
      }),
      finalAssessment: authoredContent.finalAssessment ?? [],
      learnerWorkbook: authoredContent.learnerWorkbook ?? [],
      instructorGuide: authoredContent.instructorGuide ?? null,
    },
    authoring: {
      available: Boolean(authored),
      envelopeSchemaVersion: authored?.schemaVersion ?? null,
      reviewStatus: authored?.reviewStatus ?? "missing",
      commercialQualityStatus: authored?.commercialQualityStatus ?? "missing",
      implementationGuidanceStatus:
        authored?.implementationGuidanceStatus ?? "missing",
      implementationGuidanceGeneratedAt:
        authored?.implementationGuidanceGeneratedAt ?? null,
      implementationGuidanceProvider:
        authored?.implementationGuidanceProvider ?? null,
      provider: authored?.provider ?? null,
      model: authored?.model ?? null,
      authoringPolicyVersion: authored?.authoringPolicyVersion ?? null,
      generatedAt: authored?.generatedAt ?? null,
      sourceManifestHash: authored?.sourceManifestHash ?? null,
      workerContract: authored?.workerContract ?? null,
      productionStandard: authored?.productionStandard ?? null,
    },
    certificateReview: {
      enabled: manifest.completion.certificateIssued === true,
      purchaseRequired: false,
      ownerReviewSupported: true,
      templateId: "obserra-academy-course-completion-v1",
      issuer: officialBrand.legalName,
      title: "Certificate of Course Completion",
    },
  };
}

const publicCourses = [];
const learnerCourses = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  assertBrandAndTags(manifest, manifestPath);

  const publicationApproved =
    manifest.release.publishToAcademy === true
    && ["approved", "published"].includes(manifest.release.status);
  const ownerReviewEligible = manifest.release?.status !== "archived";
  const authored = authoredPackage(courseDir);

  if (publicationApproved) publicCourses.push(publicCourse(manifest));
  if (ownerReviewEligible) learnerCourses.push(learnerCourse(manifest, authored));
}

publicCourses.sort((a, b) => a.title.localeCompare(b.title));
learnerCourses.sort((a, b) => a.title.localeCompare(b.title));

const shared = {
  generatedAt: new Date().toISOString(),
  publisher: officialBrand.legalName,
  officialLogo: officialBrand.officialLogo,
  visualSystem: officialBrand.visualSystem,
  disclaimer: officialBrand.disclaimer,
};

fs.writeFileSync(
  publicCatalogPath,
  `${JSON.stringify({
    schemaVersion: "1.4",
    ...shared,
    courses: publicCourses,
  }, null, 2)}\n`,
);
fs.writeFileSync(
  learnerCatalogPath,
  `${JSON.stringify({
    schemaVersion: "1.3",
    ...shared,
    workerContract: {
      contractId: workerPoolContract.contractId,
      contractHash: contractHash(),
      assignmentMode: workerPoolContract.assignmentMode,
    },
    productionStandard: {
      standardId: commercialProductionStandard.standardId,
      standardHash: commercialProductionStandardHash(),
      qualityTier: commercialProductionStandard.qualityTier,
      qualityClaimAllowedOnlyAfterAcceptance:
        commercialProductionStandard.claimPolicy
          .qualityClaimAllowedOnlyAfterAcceptance,
    },
    accessClassification: "protected-owner-review-and-learner-content",
    ownerReviewSupported: true,
    productionPublicationIndependent: true,
    courses: learnerCourses,
  }, null, 2)}\n`,
);

const learnerReady = learnerCourses.filter((course) => {
  const experience = course.learnerExperience;
  return course.authoring.available
    && course.authoring.envelopeSchemaVersion === "1.3"
    && course.authoring.authoringPolicyVersion === "2026.08.07.3"
    && course.authoring.implementationGuidanceStatus
      === "draft-ai-generated-verification-required"
    && course.authoring.productionStandard?.standardId
      === commercialProductionStandard.standardId
    && experience.courseProductionBible
    && experience.courseImplementationStrategy
    && experience.assessmentBlueprint
    && Array.isArray(experience.sourceRegister)
    && experience.sourceRegister.length > 0
    && Array.isArray(experience.referenceApplicabilityMatrix)
    && experience.referenceApplicabilityMatrix.length > 0
    && Array.isArray(experience.documentedRealWorldCaseRegister)
    && experience.documentedRealWorldCaseRegister.length > 0
    && Array.isArray(experience.standardsImplementationMap)
    && experience.standardsImplementationMap.length > 0
    && Array.isArray(experience.prioritizedRecommendations)
    && experience.prioritizedRecommendations.length >= 3
    && experience.modules.every((module) =>
      module.lessonNarrative
      && module.claimRegister.length >= 6
      && module.knowledgeChecks.length >= 5
      && module.creativeTreatment
      && module.productionPlan
      && module.videoScript
      && module.documentedRealWorldCases.length > 0
      && module.implementationPlaybook
      && module.recommendations.length >= 3
      && module.standardImplementationGuidance.length > 0
      && module.evidenceAndMetricsPlan
    );
}).length;

console.log(
  `[Academy Studio] Generated governed public catalog with ${publicCourses.length} publication-approved course(s).`,
);
console.log(
  `[Academy Studio] Generated protected commercial cinematic owner-review catalog with ${learnerCourses.length} course(s), ${learnerReady} structurally learner-content-ready with sourced cases and implementation guidance under production standard ${commercialProductionStandard.standardId}.`,
);
