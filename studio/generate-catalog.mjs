import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";

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
      credentialDisclaimer: "This completion record is not certification, licensure, accreditation, compliance validation, regulatory approval, or professional qualification.",
    },
    certificate: {
      issuer: officialBrand.legalName,
      templateId: "obserra-academy-course-completion-v1",
      title: "Certificate of Course Completion",
      certificateIdPattern: `OBS-${manifest.course.id.toUpperCase().replace(/[^A-Z0-9]+/g, "")}-{UNIQUE}`,
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
  const authoredModules = new Map((authoredContent.modules ?? []).map((module) => [module.id, module]));
  const workbook = new Map((authoredContent.learnerWorkbook ?? []).map((entry) => [entry.moduleId, entry]));

  return {
    ...publicCourse(manifest),
    publication: {
      approved: manifest.release?.publishToAcademy === true && ["approved", "published"].includes(manifest.release?.status),
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
      sourceRegister: authoredContent.sourceRegister ?? [],
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
          keyConcepts: lesson.keyConcepts ?? [],
          executiveExample: lesson.executiveExample ?? "",
          operationalExample: lesson.operationalExample ?? "",
          scenario: lesson.scenario ?? null,
          exercise: lesson.exercise ?? null,
          knowledgeChecks: lesson.knowledgeChecks ?? [],
          slideNarrative: lesson.slideNarrative ?? [],
          videoScript: lesson.videoScript ?? null,
          accessibilityNotes: lesson.accessibilityNotes ?? [],
          sourcePlaceholders: lesson.sourcePlaceholders ?? [],
          workbook: learnerWorkbook,
        };
      }),
      finalAssessment: authoredContent.finalAssessment ?? [],
      learnerWorkbook: authoredContent.learnerWorkbook ?? [],
      instructorGuide: authoredContent.instructorGuide ?? null,
    },
    authoring: {
      available: Boolean(authored),
      reviewStatus: authored?.reviewStatus ?? "missing",
      provider: authored?.provider ?? null,
      model: authored?.model ?? null,
      authoringPolicyVersion: authored?.authoringPolicyVersion ?? null,
      generatedAt: authored?.generatedAt ?? null,
      sourceManifestHash: authored?.sourceManifestHash ?? null,
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

  const publicationApproved = manifest.release.publishToAcademy === true && ["approved", "published"].includes(manifest.release.status);
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

fs.writeFileSync(publicCatalogPath, `${JSON.stringify({ schemaVersion: "1.4", ...shared, courses: publicCourses }, null, 2)}\n`);
fs.writeFileSync(learnerCatalogPath, `${JSON.stringify({
  schemaVersion: "1.2",
  ...shared,
  accessClassification: "protected-owner-review-and-learner-content",
  ownerReviewSupported: true,
  productionPublicationIndependent: true,
  courses: learnerCourses,
}, null, 2)}\n`);

const learnerReady = learnerCourses.filter((course) =>
  course.authoring.available &&
  course.learnerExperience.assessmentBlueprint &&
  Array.isArray(course.learnerExperience.sourceRegister) &&
  course.learnerExperience.modules.every((module) => module.lessonNarrative && module.knowledgeChecks.length > 0),
).length;
console.log(`[Academy Studio] Generated governed public catalog with ${publicCourses.length} publication-approved course(s).`);
console.log(`[Academy Studio] Generated protected owner-review learner catalog with ${learnerCourses.length} course(s), ${learnerReady} learner-content-ready.`);
