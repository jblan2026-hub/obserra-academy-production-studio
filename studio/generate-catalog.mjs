import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const outputDir = path.join(root, "catalog");
const publicCatalogPath = path.join(outputDir, "academy-course-catalog.json");
const learnerCatalogPath = path.join(outputDir, "academy-learner-course-catalog.json");
const pricingPolicyPath = path.join(root, "policy", "academy-pricing-policy.json");

fs.mkdirSync(outputDir, { recursive: true });

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const pricingPolicy = readJson(pricingPolicyPath);

function governedPrice(level) {
  const tier = pricingPolicy?.tiers?.[level];
  if (!tier || !Number.isFinite(Number(tier.price)) || Number(tier.price) <= 0) {
    throw new Error(`Academy pricing policy has no valid price for level: ${level}`);
  }
  return Number(tier.price);
}

function authoredPackage(courseDir) {
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(packagePath)) return null;
  return readJson(packagePath);
}

function tutorProfile(courseDir) {
  const tutorPath = path.join(courseDir, "ai-tutor-profile.json");
  if (!fs.existsSync(tutorPath)) return null;
  return readJson(tutorPath);
}

function publicCourse(manifest, courseDir) {
  const modules = Array.isArray(manifest.course.modules) ? manifest.course.modules : [];
  const nestedLessons = modules.flatMap((module) => Array.isArray(module.lessons) ? module.lessons : []);
  const tutor = tutorProfile(courseDir);
  const price = governedPrice(manifest.course.level);

  return {
    id: manifest.course.id,
    title: manifest.course.title,
    department: manifest.course.department,
    level: manifest.course.level,
    track: manifest.course.track,
    audience: manifest.course.audience,
    description: manifest.course.description,
    duration: manifest.course.duration,
    instructionalHours: manifest.course.instructionalHours ?? null,
    lessonCount: manifest.course.lessonCount ?? (nestedLessons.length || modules.length),
    aiNative: manifest.course.aiNative === true,
    sourceOfTruth: manifest.course.sourceOfTruth ?? null,
    sourceVerifiedAt: manifest.course.examAlignment?.currentAsOf ?? null,
    prerequisites: manifest.course.prerequisites || [],
    outcomes: manifest.course.outcomes,
    examAlignment: manifest.course.examAlignment ?? null,
    trademarkNotice: manifest.trademarkNotice ?? null,
    modules: modules.map((module, index) => ({
      id: module.id,
      sequence: index + 1,
      title: module.title,
      duration: module.duration,
      format: module.format,
      description: module.description,
      lessonCount: Array.isArray(module.lessons) ? module.lessons.length : null,
      lessons: Array.isArray(module.lessons)
        ? module.lessons.map((lesson, lessonIndex) => ({
            id: lesson.id,
            sequence: lessonIndex + 1,
            title: lesson.title,
            durationMinutes: lesson.durationMinutes,
            format: lesson.format,
            description: lesson.description,
            objectives: lesson.objectives ?? [],
            sourceIds: lesson.sourceIds ?? [],
            videoPackage: lesson.videoPackage ?? null,
          }))
        : [],
    })),
    moduleCount: modules.length,
    tags: manifest.tags,
    commerce: {
      model: pricingPolicy.model,
      price,
      currency: pricingPolicy.currency,
      paymentLink: manifest.commerce.paymentLink ?? null,
      stripePriceId: manifest.commerce.stripePriceId ?? null,
      pricingPolicyId: pricingPolicy.policyId,
      pricingPolicyEffectiveDate: pricingPolicy.effectiveDate,
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
    aiTutor: tutor
      ? {
          assistantId: tutor.assistantId,
          displayName: tutor.displayName,
          entitlementCode: tutor.access?.entitlementCode ?? null,
          activation: tutor.access?.activation ?? null,
          courseScoped: tutor.access?.crossCourseAccess === false,
          assessmentAnswerDisclosure: tutor.assessmentMode?.answerDisclosure === true,
          adaptiveLearning: tutor.adaptiveLearning?.enabled === true,
          disclaimer: tutor.disclaimer ?? null,
        }
      : null,
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

function learnerCourse(manifest, authored, courseDir) {
  const authoredContent = authored?.content ?? {};
  const authoredModules = new Map((authoredContent.modules ?? []).map((module) => [module.id, module]));
  const workbook = new Map((authoredContent.learnerWorkbook ?? []).map((entry) => [entry.moduleId, entry]));

  return {
    ...publicCourse(manifest, courseDir),
    publication: {
      approved: manifest.release?.publishToAcademy === true && ["approved", "published"].includes(String(manifest.release?.status ?? "").toLowerCase()),
      status: manifest.release?.status ?? "draft",
    },
    access: {
      surface: "post-purchase-learner",
      requiresEntitlement: true,
      ownerReviewEligible: !["archived", "retired"].includes(String(manifest.release?.status ?? "draft").toLowerCase()),
      ownerReviewBypassSupported: true,
      purchaseNotRequiredForOwnerReview: true,
    },
    learnerExperience: {
      courseSummary: authoredContent.courseSummary ?? null,
      sourceRegister: authoredContent.sourceRegister ?? [],
      frameworkAlignment: authoredContent.frameworkAlignment ?? [],
      assessmentBlueprint: authoredContent.assessmentBlueprint ?? null,
      modules: manifest.course.modules.map((module, index) => {
        const authoredModule = authoredModules.get(module.id) ?? {};
        const learnerWorkbook = workbook.get(module.id) ?? null;
        return {
          id: module.id,
          sequence: index + 1,
          title: module.title,
          duration: module.duration,
          format: module.format,
          description: module.description,
          manifestLessons: Array.isArray(module.lessons) ? module.lessons : [],
          learningObjectives: authoredModule.learningObjectives ?? [],
          openingContext: authoredModule.openingContext ?? "",
          lessonNarrative: authoredModule.lessonNarrative ?? "",
          keyConcepts: authoredModule.keyConcepts ?? [],
          executiveExample: authoredModule.executiveExample ?? "",
          operationalExample: authoredModule.operationalExample ?? "",
          scenario: authoredModule.scenario ?? null,
          exercise: authoredModule.exercise ?? null,
          knowledgeChecks: authoredModule.knowledgeChecks ?? [],
          slideNarrative: authoredModule.slideNarrative ?? [],
          videoScript: authoredModule.videoScript ?? null,
          accessibilityNotes: authoredModule.accessibilityNotes ?? [],
          sourcePlaceholders: authoredModule.sourcePlaceholders ?? [],
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

  const releaseStatus = String(manifest.release?.status ?? "draft").toLowerCase();
  const publicationApproved = manifest.release?.publishToAcademy === true && ["approved", "published"].includes(releaseStatus);
  const ownerReviewEligible = !["archived", "retired"].includes(releaseStatus);
  const authored = authoredPackage(courseDir);

  if (publicationApproved) publicCourses.push(publicCourse(manifest, courseDir));
  if (ownerReviewEligible) learnerCourses.push(learnerCourse(manifest, authored, courseDir));
}

publicCourses.sort((a, b) => a.title.localeCompare(b.title));
learnerCourses.sort((a, b) => a.title.localeCompare(b.title));

const shared = {
  generatedAt: new Date().toISOString(),
  publisher: officialBrand.legalName,
  officialLogo: officialBrand.officialLogo,
  visualSystem: officialBrand.visualSystem,
  disclaimer: officialBrand.disclaimer,
  pricing: {
    policyId: pricingPolicy.policyId,
    effectiveDate: pricingPolicy.effectiveDate,
    currency: pricingPolicy.currency,
    tiers: pricingPolicy.tiers,
  },
};

fs.writeFileSync(publicCatalogPath, `${JSON.stringify({ schemaVersion: "1.5", ...shared, courses: publicCourses }, null, 2)}\n`);
fs.writeFileSync(learnerCatalogPath, `${JSON.stringify({
  schemaVersion: "1.3",
  ...shared,
  accessClassification: "protected-owner-review-and-learner-content",
  ownerReviewSupported: true,
  productionPublicationIndependent: true,
  courses: learnerCourses,
}, null, 2)}\n`);

const learnerReady = learnerCourses.filter((course) =>
  course.authoring.available
  && course.learnerExperience.assessmentBlueprint
  && Array.isArray(course.learnerExperience.sourceRegister)
  && course.learnerExperience.modules.every((module) => module.lessonNarrative && module.knowledgeChecks.length > 0),
).length;
console.log(`[Academy Studio] Generated governed public catalog with ${publicCourses.length} publication-approved course(s).`);
console.log(`[Academy Studio] Generated protected owner-review learner catalog with ${learnerCourses.length} course(s), ${learnerReady} learner-content-ready.`);
console.log(`[Academy Studio] Applied governed pricing policy ${pricingPolicy.policyId} (${pricingPolicy.effectiveDate}).`);
