import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_POLICY_VERSION,
  PRODUCTION_CONTRACT_VERSION,
  authoringSourceHash,
} from "./academy-hollywood-checkpoints.mjs";
import { assertAcademyWorkerAllocation } from "./academy-worker-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const releasesRoot = path.join(root, "releases");
const catalogRoot = path.join(root, "catalog");
const minimumExpectedCourses = Number(process.env.ACADEMY_MINIMUM_REVIEW_COURSES || 60);
const minimumNarrativeWords = Number(process.env.ACADEMY_MINIMUM_LESSON_WORDS || 1200);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function nonEmpty(value) {
  return String(value ?? "").trim().length > 0;
}

function arrayAtLeast(value, minimum) {
  return Array.isArray(value) && value.length >= minimum;
}

function allRequiredReviewsApproved(manifest) {
  const reviews = Object.values(manifest.reviews ?? {}).filter((review) => review?.required !== false);
  return reviews.length > 0 && reviews.every((review) => ["approved", "complete", "completed"].includes(String(review?.status ?? "").toLowerCase()));
}

function fileInventory(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else output.push(path.relative(directory, absolute).replaceAll(path.sep, "/"));
    }
  }
  return output.sort();
}

function addFinding(list, condition, finding) {
  if (!condition) list.push(finding);
}

const allocation = assertAcademyWorkerAllocation();
const courseReports = [];
const structuralFindings = [];
const publicationBlockers = [];

for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = readJson(manifestPath);
  const courseId = String(manifest.course?.id ?? entry.name);
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  const findings = [];
  const blockers = [];

  if (!fs.existsSync(packagePath)) {
    findings.push("missing-cinematic-course-package");
    courseReports.push({ courseId, title: manifest.course?.title ?? courseId, structuralReady: false, publicationReady: false, findings, publicationBlockers: ["missing-cinematic-course-package"] });
    structuralFindings.push({ courseId, finding: "missing-cinematic-course-package" });
    publicationBlockers.push({ courseId, blocker: "missing-cinematic-course-package" });
    continue;
  }

  let envelope;
  try {
    envelope = readJson(packagePath);
  } catch {
    findings.push("invalid-cinematic-course-package-json");
    courseReports.push({ courseId, title: manifest.course?.title ?? courseId, structuralReady: false, publicationReady: false, findings, publicationBlockers: ["invalid-cinematic-course-package-json"] });
    structuralFindings.push({ courseId, finding: "invalid-cinematic-course-package-json" });
    publicationBlockers.push({ courseId, blocker: "invalid-cinematic-course-package-json" });
    continue;
  }

  const content = envelope.content ?? {};
  const modules = Array.isArray(content.modules) ? content.modules : [];
  const sourceRegister = Array.isArray(content.sourceRegister) ? content.sourceRegister : [];
  const applicabilityMatrix = Array.isArray(content.applicabilityMatrix) ? content.applicabilityMatrix : [];
  const sourceIds = new Set(sourceRegister.map((source) => source?.id).filter(Boolean));
  const manifestModules = Array.isArray(manifest.course?.modules) ? manifest.course.modules : [];
  const moduleIds = new Set(modules.map((module) => module?.id).filter(Boolean));

  addFinding(findings, envelope.schemaVersion === "2.0", "unsupported-cinematic-package-schema");
  addFinding(findings, envelope.authoringPolicyVersion === AUTHORING_POLICY_VERSION, "outdated-cinematic-authoring-policy");
  addFinding(findings, envelope.productionContractVersion === PRODUCTION_CONTRACT_VERSION, "outdated-cinematic-production-contract");
  addFinding(findings, envelope.sourceManifestHash === authoringSourceHash(manifest), "stale-cinematic-course-package");
  addFinding(findings, envelope.productionStandard === "premium-documentary-cinematic", "missing-premium-cinematic-standard");
  addFinding(findings, envelope.reviewStatus === "draft-ai-generated-compliance-staging", "invalid-cinematic-review-status");
  addFinding(findings, envelope.publicationAuthorized === false, "generated-package-grants-publication-authority");
  addFinding(findings, content.courseSummary?.cinematicPositioning === "premium-documentary-cinematic", "missing-cinematic-positioning");
  addFinding(findings, sourceRegister.length >= Math.max(4, manifestModules.length), "insufficient-source-register");
  addFinding(findings, applicabilityMatrix.length >= manifestModules.length, "insufficient-applicability-matrix");
  addFinding(findings, Array.isArray(content.frameworkAlignment), "missing-framework-alignment");
  addFinding(findings, content.mediaProductionPlan?.standard === "premium-documentary-cinematic", "missing-media-production-plan");
  addFinding(findings, nonEmpty(content.mediaProductionPlan?.masteringTarget), "missing-mastering-target");
  addFinding(findings, nonEmpty(content.mediaProductionPlan?.audioTarget), "missing-audio-mastering-target");
  addFinding(findings, arrayAtLeast(content.mediaProductionPlan?.sourceCardRules, 1), "missing-source-card-rules");
  addFinding(findings, arrayAtLeast(content.mediaProductionPlan?.accessibilityDeliverables, 4), "insufficient-media-accessibility-deliverables");
  addFinding(findings, arrayAtLeast(content.mediaProductionPlan?.rightsDeliverables, 3), "insufficient-media-rights-deliverables");
  addFinding(findings, arrayAtLeast(content.mediaProductionPlan?.qualityControlChecks, 4), "insufficient-media-quality-controls");
  addFinding(findings, modules.length === manifestModules.length, "module-count-mismatch");

  for (const source of sourceRegister) {
    const prefix = `source-${source?.id ?? "unknown"}`;
    addFinding(findings, nonEmpty(source?.id), `${prefix}-missing-id`);
    addFinding(findings, nonEmpty(source?.title), `${prefix}-missing-title`);
    addFinding(findings, nonEmpty(source?.issuingAuthority), `${prefix}-missing-issuing-authority`);
    addFinding(findings, nonEmpty(source?.sourceType), `${prefix}-missing-source-type`);
    addFinding(findings, nonEmpty(source?.locator), `${prefix}-missing-locator`);
    addFinding(findings, Array.isArray(source?.moduleIds), `${prefix}-missing-module-ids`);
    addFinding(findings, arrayAtLeast(source?.claimTopics, 1), `${prefix}-missing-claim-topics`);
    addFinding(findings, nonEmpty(source?.applicability), `${prefix}-missing-applicability`);
    addFinding(findings, arrayAtLeast(source?.appliesWhen, 1), `${prefix}-missing-applies-when`);
    addFinding(findings, arrayAtLeast(source?.doesNotApplyWhen, 1), `${prefix}-missing-does-not-apply-when`);
    addFinding(findings, arrayAtLeast(source?.limitations, 1), `${prefix}-missing-limitations`);
    addFinding(findings, ["verified-from-supplied-source", "requires-independent-verification"].includes(source?.verificationStatus), `${prefix}-invalid-verification-status`);
    addFinding(findings, nonEmpty(source?.verificationInstruction), `${prefix}-missing-verification-instruction`);
    addFinding(findings, nonEmpty(source?.usageBoundary), `${prefix}-missing-usage-boundary`);
    if (source?.verificationStatus !== "verified-from-supplied-source") blockers.push(`${prefix}-requires-independent-verification`);
  }

  for (const [index, applicability] of applicabilityMatrix.entries()) {
    const prefix = `applicability-${index + 1}`;
    addFinding(findings, nonEmpty(applicability?.topic), `${prefix}-missing-topic`);
    addFinding(findings, arrayAtLeast(applicability?.sourceIds, 1), `${prefix}-missing-source-ids`);
    addFinding(findings, arrayAtLeast(applicability?.moduleIds, 1), `${prefix}-missing-module-ids`);
    addFinding(findings, arrayAtLeast(applicability?.roles, 1), `${prefix}-missing-roles`);
    addFinding(findings, arrayAtLeast(applicability?.organizationConditions, 1), `${prefix}-missing-organization-conditions`);
    addFinding(findings, arrayAtLeast(applicability?.appliesWhen, 1), `${prefix}-missing-applies-when`);
    addFinding(findings, arrayAtLeast(applicability?.doesNotApplyWhen, 1), `${prefix}-missing-does-not-apply-when`);
    addFinding(findings, arrayAtLeast(applicability?.limitations, 1), `${prefix}-missing-limitations`);
    addFinding(findings, nonEmpty(applicability?.decisionOwner), `${prefix}-missing-decision-owner`);
    for (const sourceId of applicability?.sourceIds ?? []) {
      addFinding(findings, sourceIds.has(sourceId), `${prefix}-unknown-source-${sourceId}`);
    }
  }

  for (const manifestModule of manifestModules) {
    addFinding(findings, moduleIds.has(manifestModule.id), `missing-module-${manifestModule.id}`);
  }

  for (const module of modules) {
    const prefix = `module-${module?.id ?? "unknown"}`;
    addFinding(findings, wordCount(module?.lessonNarrative) >= minimumNarrativeWords, `${prefix}-lesson-narrative-below-${minimumNarrativeWords}-words`);
    addFinding(findings, arrayAtLeast(module?.learningObjectives, 6), `${prefix}-insufficient-learning-objectives`);
    addFinding(findings, arrayAtLeast(module?.keyConcepts, 6), `${prefix}-insufficient-key-concepts`);
    addFinding(findings, nonEmpty(module?.executiveExample), `${prefix}-missing-executive-example`);
    addFinding(findings, nonEmpty(module?.operationalExample), `${prefix}-missing-operational-example`);
    addFinding(findings, Boolean(module?.scenario), `${prefix}-missing-scenario`);
    addFinding(findings, Boolean(module?.exercise), `${prefix}-missing-exercise`);
    addFinding(findings, arrayAtLeast(module?.knowledgeChecks, 4), `${prefix}-insufficient-knowledge-checks`);
    addFinding(findings, arrayAtLeast(module?.slideNarrative, 10), `${prefix}-insufficient-slide-narrative`);
    addFinding(findings, arrayAtLeast(module?.referenceApplications, 3), `${prefix}-insufficient-reference-applications`);
    addFinding(findings, arrayAtLeast(module?.cinematicTreatment?.scenes, 8), `${prefix}-insufficient-cinematic-scenes`);
    addFinding(findings, arrayAtLeast(module?.cinematicTreatment?.shotList, 8), `${prefix}-insufficient-shot-list`);
    addFinding(findings, arrayAtLeast(module?.cinematicTreatment?.sourceCards, 2), `${prefix}-insufficient-source-cards`);
    addFinding(findings, arrayAtLeast(module?.cinematicTreatment?.soundDesign, 1), `${prefix}-missing-sound-design`);
    addFinding(findings, arrayAtLeast(module?.cinematicTreatment?.transitionPlan, 1), `${prefix}-missing-transition-plan`);
    addFinding(findings, arrayAtLeast(module?.videoScript?.scenes, 8), `${prefix}-insufficient-video-scenes`);
    addFinding(findings, arrayAtLeast(module?.videoScript?.captionPlan, 1), `${prefix}-missing-caption-plan`);
    addFinding(findings, arrayAtLeast(module?.videoScript?.transcriptPlan, 1), `${prefix}-missing-transcript-plan`);
    addFinding(findings, arrayAtLeast(module?.videoScript?.audioDescriptionPlan, 1), `${prefix}-missing-audio-description-plan`);
    addFinding(findings, arrayAtLeast(module?.videoScript?.reducedMotionAlternative, 1), `${prefix}-missing-reduced-motion-alternative`);
    addFinding(findings, arrayAtLeast(module?.accessibilityNotes, 6), `${prefix}-insufficient-accessibility-notes`);

    for (const application of module?.referenceApplications ?? []) {
      for (const sourceId of application?.sourceIds ?? []) {
        addFinding(findings, sourceIds.has(sourceId), `${prefix}-unknown-reference-${sourceId}`);
      }
      addFinding(findings, arrayAtLeast(application?.appliesWhen, 1), `${prefix}-reference-application-missing-applies-when`);
      addFinding(findings, arrayAtLeast(application?.doesNotApplyWhen, 1), `${prefix}-reference-application-missing-does-not-apply-when`);
      addFinding(findings, arrayAtLeast(application?.limitations, 1), `${prefix}-reference-application-missing-limitations`);
    }
  }

  const finalAssessment = Array.isArray(content.finalAssessment) ? content.finalAssessment : [];
  addFinding(findings, finalAssessment.length >= 30, "insufficient-final-assessment");
  for (const [index, question] of finalAssessment.entries()) {
    const prefix = `assessment-${index + 1}`;
    addFinding(findings, moduleIds.has(question?.moduleId), `${prefix}-invalid-module-id`);
    addFinding(findings, arrayAtLeast(question?.options, 2), `${prefix}-insufficient-options`);
    addFinding(findings, Number.isInteger(question?.correctIndex) && question.correctIndex >= 0 && question.correctIndex < (question?.options?.length ?? 0), `${prefix}-invalid-correct-index`);
    addFinding(findings, nonEmpty(question?.rationale), `${prefix}-missing-rationale`);
    addFinding(findings, nonEmpty(question?.cognitiveLevel), `${prefix}-missing-cognitive-level`);
    addFinding(findings, nonEmpty(question?.difficulty), `${prefix}-missing-difficulty`);
    addFinding(findings, nonEmpty(question?.applicabilityContext), `${prefix}-missing-applicability-context`);
    addFinding(findings, arrayAtLeast(question?.sourceIds, 1), `${prefix}-missing-source-ids`);
    for (const sourceId of question?.sourceIds ?? []) {
      addFinding(findings, sourceIds.has(sourceId), `${prefix}-unknown-source-${sourceId}`);
    }
  }

  addFinding(findings, nonEmpty(content.certificatePackage?.title), "missing-certificate-title");
  addFinding(findings, content.certificatePackage?.issuer === "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC", "invalid-certificate-issuer");
  addFinding(findings, arrayAtLeast(content.certificatePackage?.issuanceCriteria, 3), "insufficient-certificate-issuance-criteria");
  addFinding(findings, arrayAtLeast(content.certificatePackage?.verificationFields, 3), "insufficient-certificate-verification-fields");
  addFinding(findings, arrayAtLeast(content.certificatePackage?.transcriptFields, 3), "insufficient-certificate-transcript-fields");
  addFinding(findings, arrayAtLeast(content.certificatePackage?.revocationConditions, 1), "missing-certificate-revocation-conditions");
  addFinding(findings, content.certificatePackage?.isProfessionalCertification === false, "certificate-misrepresented-as-professional-certification");
  addFinding(findings, content.certificatePackage?.isComplianceEvidence === false, "certificate-misrepresented-as-compliance-evidence");
  addFinding(findings, arrayAtLeast(content.rightsAndLicensingPlan?.assetInventoryRequirements, 3), "insufficient-rights-asset-inventory");
  addFinding(findings, arrayAtLeast(content.rightsAndLicensingPlan?.licenseEvidenceRequired, 2), "insufficient-license-evidence-requirements");
  addFinding(findings, arrayAtLeast(content.rightsAndLicensingPlan?.releaseBlockers, 2), "insufficient-rights-release-blockers");
  addFinding(findings, arrayAtLeast(content.accessibilityPlan?.captions, 1), "missing-accessibility-caption-plan");
  addFinding(findings, arrayAtLeast(content.accessibilityPlan?.transcripts, 1), "missing-accessibility-transcript-plan");
  addFinding(findings, arrayAtLeast(content.accessibilityPlan?.audioDescription, 1), "missing-accessibility-audio-description-plan");
  addFinding(findings, arrayAtLeast(content.accessibilityPlan?.reducedMotion, 1), "missing-accessibility-reduced-motion-plan");
  addFinding(findings, arrayAtLeast(content.accessibilityPlan?.keyboardAndNonPointerAlternatives, 1), "missing-keyboard-alternative-plan");
  addFinding(findings, content.productionGateEvidence?.publicationBlockedUntilOwnerApproval === true, "publication-not-blocked-until-owner-approval");
  addFinding(findings, arrayAtLeast(content.productionGateEvidence?.requiredReviews, 8), "insufficient-required-review-gates");
  addFinding(findings, arrayAtLeast(content.productionGateEvidence?.requiredMediaEvidence, 4), "insufficient-required-media-evidence");
  addFinding(findings, arrayAtLeast(content.productionGateEvidence?.requiredReferenceEvidence, 2), "insufficient-required-reference-evidence");
  addFinding(findings, arrayAtLeast(content.productionGateEvidence?.requiredAssessmentEvidence, 2), "insufficient-required-assessment-evidence");
  addFinding(findings, arrayAtLeast(content.productionGateEvidence?.requiredCertificateEvidence, 2), "insufficient-required-certificate-evidence");
  addFinding(findings, arrayAtLeast(content.productionGateEvidence?.requiredSecurityAndEntitlementEvidence, 2), "insufficient-required-security-entitlement-evidence");

  const releaseDirectory = path.join(releasesRoot, courseId, "FINAL");
  const releaseFiles = fileInventory(releaseDirectory);
  const videoFiles = releaseFiles.filter((file) => /\.(mp4|mov)$/i.test(file));
  const captionFiles = releaseFiles.filter((file) => /\.(vtt|srt)$/i.test(file));
  const transcriptFiles = releaseFiles.filter((file) => /transcript/i.test(file) && /\.(md|txt|pdf)$/i.test(file));
  const audioDescriptionFiles = releaseFiles.filter((file) => /audio[-_ ]?description|described/i.test(file));
  const rightsFiles = [
    path.join(courseDir, "rights-ledger.json"),
    ...releaseFiles.filter((file) => /rights|license/i.test(file)).map((file) => path.join(releaseDirectory, file)),
  ].filter((file) => fs.existsSync(file));
  const certificateFiles = releaseFiles.filter((file) => /certificate/i.test(file));

  if (videoFiles.length === 0) blockers.push("mastered-video-not-verified");
  if (captionFiles.length === 0) blockers.push("caption-assets-not-verified");
  if (transcriptFiles.length === 0) blockers.push("transcript-assets-not-verified");
  if (audioDescriptionFiles.length === 0) blockers.push("audio-description-assets-not-verified");
  if (rightsFiles.length === 0) blockers.push("rights-ledger-not-verified");
  if (certificateFiles.length === 0) blockers.push("certificate-template-not-verified");
  if (!allRequiredReviewsApproved(manifest)) blockers.push("required-reviews-not-approved");
  if (!manifest.release?.publishToAcademy) blockers.push("publication-not-owner-enabled");
  if (!["approved", "published"].includes(String(manifest.release?.status ?? "").toLowerCase())) blockers.push("release-status-not-approved");

  const uniqueFindings = [...new Set(findings)];
  const uniqueBlockers = [...new Set(blockers)];
  const structuralReady = uniqueFindings.length === 0;
  const publicationReady = structuralReady && uniqueBlockers.length === 0;

  if (!structuralReady && manifest.release?.publishToAcademy === true) {
    uniqueFindings.push("publication-enabled-before-structural-compliance");
  }

  courseReports.push({
    courseId,
    title: manifest.course?.title ?? courseId,
    moduleCount: manifestModules.length,
    sourceCount: sourceRegister.length,
    verifiedSourceCount: sourceRegister.filter((source) => source?.verificationStatus === "verified-from-supplied-source").length,
    assessmentQuestionCount: finalAssessment.length,
    narrativeWordCounts: Object.fromEntries(modules.map((module) => [module.id, wordCount(module.lessonNarrative)])),
    structuralReady,
    readyForComplianceStaging: structuralReady,
    publicationReady,
    findings: uniqueFindings,
    publicationBlockers: uniqueBlockers,
    releaseEvidence: {
      videoFiles: videoFiles.length,
      captionFiles: captionFiles.length,
      transcriptFiles: transcriptFiles.length,
      audioDescriptionFiles: audioDescriptionFiles.length,
      rightsFiles: rightsFiles.length,
      certificateFiles: certificateFiles.length,
    },
  });

  for (const finding of uniqueFindings) structuralFindings.push({ courseId, finding });
  for (const blocker of uniqueBlockers) publicationBlockers.push({ courseId, blocker });
}

if (courseReports.length < minimumExpectedCourses) {
  structuralFindings.push({
    courseId: "academy-catalog",
    finding: `course-count-below-minimum-${courseReports.length}-vs-${minimumExpectedCourses}`,
  });
}

const readyForComplianceStaging = structuralFindings.length === 0;
const publicationReadyCourses = courseReports.filter((course) => course.publicationReady).length;
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  authoringPolicyVersion: AUTHORING_POLICY_VERSION,
  productionContractVersion: PRODUCTION_CONTRACT_VERSION,
  productionStandard: "premium-documentary-cinematic",
  allocation,
  minimumExpectedCourses,
  minimumNarrativeWords,
  discoveredCourses: courseReports.length,
  complianceStagingReadyCourses: courseReports.filter((course) => course.readyForComplianceStaging).length,
  publicationReadyCourses,
  readyForComplianceStaging,
  publicationReady: readyForComplianceStaging && publicationBlockers.length === 0 && publicationReadyCourses === courseReports.length,
  structuralFindingCount: structuralFindings.length,
  publicationBlockerCount: publicationBlockers.length,
  structuralFindings,
  publicationBlockers,
  courses: courseReports,
  claimBoundary: "Compliance staging readiness proves the protected course package satisfies the cinematic planning, instructional, assessment, reference, applicability, accessibility, rights-planning, certificate, and governance schema. It does not prove that references were independently verified, media was mastered, rights were cleared, reviews were approved, LCMS delivery was loaded, checkout was enabled, or learners can purchase the course.",
};

fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-compliance-staging.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log(`[Academy Studio] Cinematic compliance staging: ${report.complianceStagingReadyCourses}/${report.discoveredCourses} structurally ready; ${publicationReadyCourses}/${report.discoveredCourses} publication ready.`);
if (structuralFindings.length > 0) {
  for (const finding of structuralFindings.slice(0, 250)) {
    console.error(`[Academy Studio] ${finding.courseId}: ${finding.finding}`);
  }
  process.exit(2);
}
