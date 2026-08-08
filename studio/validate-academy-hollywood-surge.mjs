import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_POLICY_VERSION,
  PRODUCTION_CONTRACT_VERSION,
  authoringSourceHash,
} from "./academy-hollywood-checkpoints.mjs";
import { academySurgePortfolio } from "./academy-course-portfolio.mjs";
import { assertAcademyWorkerAllocation } from "./academy-worker-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const releasesRoot = path.join(root, "releases");
const registryPath = path.join(root, "sources", "authoritative-sources.json");
const minimumNarrativeWords = Number(process.env.ACADEMY_MINIMUM_LESSON_WORDS || 1200);
const minimumExactAuthoritativeSources = Number(process.env.ACADEMY_MINIMUM_EXACT_SOURCES_PER_COURSE || 2);

if (!fs.existsSync(registryPath)) throw new Error(`Authoritative source registry not found: ${registryPath}`);
if (!Number.isInteger(minimumNarrativeWords) || minimumNarrativeWords < 700) throw new Error("ACADEMY_MINIMUM_LESSON_WORDS must be an integer of at least 700.");
if (!Number.isInteger(minimumExactAuthoritativeSources) || minimumExactAuthoritativeSources < 1) throw new Error("ACADEMY_MINIMUM_EXACT_SOURCES_PER_COURSE must be a positive integer.");

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

function addFinding(list, condition, finding) {
  if (!condition) list.push(finding);
}

function fileInventory(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else files.push(path.relative(directory, absolute).replaceAll(path.sep, "/"));
    }
  }
  return files.sort();
}

function reviewsApproved(manifest) {
  const reviews = Object.values(manifest.reviews ?? {}).filter((review) => review?.required !== false);
  return reviews.length > 0 && reviews.every((review) => ["approved", "complete", "completed"].includes(String(review?.status ?? "").toLowerCase()));
}

const allocation = assertAcademyWorkerAllocation();
const portfolio = academySurgePortfolio();
const registry = readJson(registryPath);
const registryById = new Map((registry.sources ?? []).map((source) => [source.id, source]));
const courses = [];
const structuralFindings = [];
const publicationBlockers = [];

for (const item of portfolio.selectedCourses) {
  const manifest = item.manifest;
  const courseId = item.courseId;
  const packagePath = path.join(item.courseDir, "generated", "authoring", "course-package.json");
  const stageDir = path.join(item.courseDir, "generated", "production-stage");
  const findings = [];
  const blockers = [];

  if (!fs.existsSync(packagePath)) {
    findings.push("missing-cinematic-course-package");
  }

  let envelope = null;
  if (fs.existsSync(packagePath)) {
    try {
      envelope = readJson(packagePath);
    } catch {
      findings.push("invalid-cinematic-course-package-json");
    }
  }

  if (!envelope) {
    structuralFindings.push(...findings.map((finding) => ({ courseId, finding })));
    publicationBlockers.push({ courseId, blocker: "missing-valid-cinematic-package" });
    courses.push({ courseId, title: manifest.course?.title ?? courseId, structuralReady: false, complianceStagingReady: false, publicationReady: false, findings, publicationBlockers: ["missing-valid-cinematic-package"] });
    continue;
  }

  const content = envelope.content ?? {};
  const modules = Array.isArray(content.modules) ? content.modules : [];
  const manifestModules = Array.isArray(manifest.course?.modules) ? manifest.course.modules : [];
  const moduleIds = new Set(modules.map((module) => module?.id).filter(Boolean));
  const sourceRegister = Array.isArray(content.sourceRegister) ? content.sourceRegister : [];
  const sourceIds = new Set(sourceRegister.map((source) => source?.id).filter(Boolean));
  const applicabilityMatrix = Array.isArray(content.applicabilityMatrix) ? content.applicabilityMatrix : [];
  const exactRegistrySourceIds = new Set();

  addFinding(findings, envelope.schemaVersion === "2.0", "unsupported-cinematic-package-schema");
  addFinding(findings, envelope.courseId === courseId, "course-package-identity-mismatch");
  addFinding(findings, envelope.authoringPolicyVersion === AUTHORING_POLICY_VERSION, "outdated-cinematic-authoring-policy");
  addFinding(findings, envelope.productionContractVersion === PRODUCTION_CONTRACT_VERSION, "outdated-cinematic-production-contract");
  addFinding(findings, envelope.productionStandard === "premium-documentary-cinematic", "missing-premium-cinematic-standard");
  addFinding(findings, envelope.sourceManifestHash === authoringSourceHash(manifest), "stale-cinematic-course-package");
  addFinding(findings, envelope.reviewStatus === "draft-ai-generated-compliance-staging", "invalid-cinematic-review-status");
  addFinding(findings, envelope.publicationAuthorized === false, "generated-package-grants-publication-authority");
  addFinding(findings, content.courseSummary?.cinematicPositioning === "premium-documentary-cinematic", "missing-cinematic-positioning");
  addFinding(findings, modules.length === manifestModules.length, "module-count-mismatch");
  addFinding(findings, sourceRegister.length >= Math.max(4, manifestModules.length), "insufficient-source-register");
  addFinding(findings, applicabilityMatrix.length >= manifestModules.length, "insufficient-applicability-matrix");
  addFinding(findings, content.mediaProductionPlan?.standard === "premium-documentary-cinematic", "missing-media-production-plan");
  addFinding(findings, nonEmpty(content.mediaProductionPlan?.masteringTarget), "missing-mastering-target");
  addFinding(findings, nonEmpty(content.mediaProductionPlan?.audioTarget), "missing-audio-mastering-target");
  addFinding(findings, arrayAtLeast(content.mediaProductionPlan?.sourceCardRules, 1), "missing-source-card-rules");
  addFinding(findings, arrayAtLeast(content.mediaProductionPlan?.accessibilityDeliverables, 4), "insufficient-media-accessibility-deliverables");
  addFinding(findings, arrayAtLeast(content.mediaProductionPlan?.rightsDeliverables, 3), "insufficient-media-rights-deliverables");
  addFinding(findings, arrayAtLeast(content.mediaProductionPlan?.qualityControlChecks, 4), "insufficient-media-quality-controls");

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

    const registered = registryById.get(source?.id);
    if (registered) {
      const exact = source.title === registered.title
        && source.issuingAuthority === registered.issuer
        && source.locator === registered.canonicalUrl
        && source.sourceType === registered.authorityType;
      addFinding(findings, exact, `${prefix}-does-not-match-authoritative-registry`);
      addFinding(findings, source.verificationStatus === "verified-from-supplied-source", `${prefix}-registry-source-not-marked-supplied`);
      if (exact && source.verificationStatus === "verified-from-supplied-source") exactRegistrySourceIds.add(source.id);
    } else {
      addFinding(findings, source.locator === "verification-required", `${prefix}-unregistered-source-must-use-verification-required-locator`);
      addFinding(findings, source.verificationStatus === "requires-independent-verification", `${prefix}-unregistered-source-must-require-independent-verification`);
      blockers.push(`${prefix}-requires-independent-verification`);
    }
  }
  addFinding(findings, exactRegistrySourceIds.size >= minimumExactAuthoritativeSources, `fewer-than-${minimumExactAuthoritativeSources}-exact-authoritative-sources`);

  const applicabilityCoveredModules = new Set();
  for (const [index, entry] of applicabilityMatrix.entries()) {
    const prefix = `applicability-${index + 1}`;
    addFinding(findings, nonEmpty(entry?.topic), `${prefix}-missing-topic`);
    addFinding(findings, arrayAtLeast(entry?.sourceIds, 1), `${prefix}-missing-source-ids`);
    addFinding(findings, arrayAtLeast(entry?.moduleIds, 1), `${prefix}-missing-module-ids`);
    addFinding(findings, arrayAtLeast(entry?.roles, 1), `${prefix}-missing-roles`);
    addFinding(findings, arrayAtLeast(entry?.organizationConditions, 1), `${prefix}-missing-organization-conditions`);
    addFinding(findings, arrayAtLeast(entry?.appliesWhen, 1), `${prefix}-missing-applies-when`);
    addFinding(findings, arrayAtLeast(entry?.doesNotApplyWhen, 1), `${prefix}-missing-does-not-apply-when`);
    addFinding(findings, arrayAtLeast(entry?.implementationDependencies, 1), `${prefix}-missing-implementation-dependencies`);
    addFinding(findings, arrayAtLeast(entry?.limitations, 1), `${prefix}-missing-limitations`);
    addFinding(findings, nonEmpty(entry?.decisionOwner), `${prefix}-missing-decision-owner`);
    for (const sourceId of entry?.sourceIds ?? []) addFinding(findings, sourceIds.has(sourceId), `${prefix}-unknown-source-${sourceId}`);
    for (const moduleId of entry?.moduleIds ?? []) {
      addFinding(findings, moduleIds.has(moduleId), `${prefix}-unknown-module-${moduleId}`);
      if (moduleIds.has(moduleId)) applicabilityCoveredModules.add(moduleId);
    }
  }

  for (const manifestModule of manifestModules) {
    addFinding(findings, moduleIds.has(manifestModule.id), `missing-module-${manifestModule.id}`);
    addFinding(findings, applicabilityCoveredModules.has(manifestModule.id), `applicability-matrix-missing-module-${manifestModule.id}`);
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

    const moduleExactSources = new Set();
    for (const application of module?.referenceApplications ?? []) {
      addFinding(findings, arrayAtLeast(application?.sourceIds, 1), `${prefix}-reference-application-missing-source-ids`);
      addFinding(findings, arrayAtLeast(application?.appliesWhen, 1), `${prefix}-reference-application-missing-applies-when`);
      addFinding(findings, arrayAtLeast(application?.doesNotApplyWhen, 1), `${prefix}-reference-application-missing-does-not-apply-when`);
      addFinding(findings, arrayAtLeast(application?.limitations, 1), `${prefix}-reference-application-missing-limitations`);
      for (const sourceId of application?.sourceIds ?? []) {
        addFinding(findings, sourceIds.has(sourceId), `${prefix}-unknown-reference-${sourceId}`);
        if (exactRegistrySourceIds.has(sourceId)) moduleExactSources.add(sourceId);
      }
    }
    addFinding(findings, moduleExactSources.size >= 1, `${prefix}-missing-exact-authoritative-reference-application`);
  }

  const finalAssessment = Array.isArray(content.finalAssessment) ? content.finalAssessment : [];
  addFinding(findings, finalAssessment.length >= 30, "insufficient-final-assessment");
  const assessmentModuleCoverage = new Set();
  for (const [index, question] of finalAssessment.entries()) {
    const prefix = `assessment-${index + 1}`;
    addFinding(findings, moduleIds.has(question?.moduleId), `${prefix}-invalid-module-id`);
    if (moduleIds.has(question?.moduleId)) assessmentModuleCoverage.add(question.moduleId);
    addFinding(findings, arrayAtLeast(question?.options, 2), `${prefix}-insufficient-options`);
    addFinding(findings, Number.isInteger(question?.correctIndex) && question.correctIndex >= 0 && question.correctIndex < (question?.options?.length ?? 0), `${prefix}-invalid-correct-index`);
    addFinding(findings, nonEmpty(question?.rationale), `${prefix}-missing-rationale`);
    addFinding(findings, nonEmpty(question?.cognitiveLevel), `${prefix}-missing-cognitive-level`);
    addFinding(findings, nonEmpty(question?.difficulty), `${prefix}-missing-difficulty`);
    addFinding(findings, nonEmpty(question?.applicabilityContext), `${prefix}-missing-applicability-context`);
    addFinding(findings, arrayAtLeast(question?.sourceIds, 1), `${prefix}-missing-source-ids`);
    for (const sourceId of question?.sourceIds ?? []) addFinding(findings, sourceIds.has(sourceId), `${prefix}-unknown-source-${sourceId}`);
  }
  for (const moduleId of moduleIds) addFinding(findings, assessmentModuleCoverage.has(moduleId), `assessment-missing-module-${moduleId}`);

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

  const stageFiles = fileInventory(stageDir);
  const requiredStageFiles = [
    "artifact-manifest.json",
    "instructor-manuscript.md",
    "learner-guide.md",
    "learner-workbook.md",
    "assessment-bank.json",
    "answer-key.json",
    "source-register.json",
    "applicability-matrix.json",
    "framework-alignment.json",
    "media-production-plan.json",
    "accessibility-plan.json",
    "rights-and-licensing-plan.json",
    "certificate/certificate-policy.json",
    "certificate/certificate-template.html",
    "certificate/certificate-template.svg",
    "learner-experience.json",
  ];
  for (const requiredFile of requiredStageFiles) addFinding(findings, stageFiles.includes(requiredFile), `missing-materialized-${requiredFile.replaceAll("/", "-")}`);
  for (const moduleId of moduleIds) {
    for (const requiredFile of [
      `video/${moduleId}/cinematic-treatment.json`,
      `video/${moduleId}/production-script.json`,
      `video/${moduleId}/slide-narrative.json`,
      `video/${moduleId}/caption-script.json`,
      `video/${moduleId}/transcript-plan.json`,
      `video/${moduleId}/audio-description-plan.json`,
      `video/${moduleId}/reduced-motion-alternative.json`,
    ]) addFinding(findings, stageFiles.includes(requiredFile), `missing-materialized-${requiredFile.replaceAll("/", "-")}`);
  }

  const releaseDir = path.join(releasesRoot, courseId, "FINAL");
  const releaseFiles = fileInventory(releaseDir);
  if (!releaseFiles.some((file) => /\.(mp4|mov)$/i.test(file))) blockers.push("mastered-video-not-verified");
  if (!releaseFiles.some((file) => /\.(vtt|srt)$/i.test(file))) blockers.push("caption-assets-not-verified");
  if (!releaseFiles.some((file) => /transcript/i.test(file) && /\.(md|txt|pdf)$/i.test(file))) blockers.push("transcript-assets-not-verified");
  if (!releaseFiles.some((file) => /audio[-_ ]?description|described/i.test(file))) blockers.push("audio-description-assets-not-verified");
  if (!fs.existsSync(path.join(item.courseDir, "rights-ledger.json")) && !releaseFiles.some((file) => /rights|license/i.test(file))) blockers.push("rights-ledger-not-verified");
  if (!releaseFiles.some((file) => /certificate/i.test(file))) blockers.push("certificate-runtime-output-not-verified");
  if (!reviewsApproved(manifest)) blockers.push("required-reviews-not-approved");
  if (manifest.release?.publishToAcademy !== true) blockers.push("publication-not-owner-enabled");
  if (!["approved", "published"].includes(item.releaseStatus)) blockers.push("release-status-not-approved");

  const uniqueFindings = [...new Set(findings)];
  const uniqueBlockers = [...new Set(blockers)];
  const structuralReady = uniqueFindings.length === 0;
  const publicationReady = structuralReady && uniqueBlockers.length === 0;
  for (const finding of uniqueFindings) structuralFindings.push({ courseId, finding });
  for (const blocker of uniqueBlockers) publicationBlockers.push({ courseId, blocker });

  courses.push({
    courseId,
    title: manifest.course?.title ?? courseId,
    moduleCount: manifestModules.length,
    sourceCount: sourceRegister.length,
    exactAuthoritativeSourceCount: exactRegistrySourceIds.size,
    assessmentQuestionCount: finalAssessment.length,
    materializedArtifactCount: stageFiles.length,
    narrativeWordCounts: Object.fromEntries(modules.map((module) => [module.id, wordCount(module.lessonNarrative)])),
    structuralReady,
    complianceStagingReady: structuralReady,
    publicationReady,
    findings: uniqueFindings,
    publicationBlockers: uniqueBlockers,
  });
}

const complianceStagingReadyCourses = courses.filter((course) => course.complianceStagingReady).length;
const publicationReadyCourses = courses.filter((course) => course.publicationReady).length;
const report = {
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  authoringPolicyVersion: AUTHORING_POLICY_VERSION,
  productionContractVersion: PRODUCTION_CONTRACT_VERSION,
  productionStandard: "premium-documentary-cinematic",
  allocation,
  portfolio: {
    expectedCourses: portfolio.expectedCourses,
    selectedCourseIds: portfolio.selectedCourseIds,
    excludedCourseIds: portfolio.excludedCourseIds,
    policy: portfolio.policy,
  },
  minimumNarrativeWords,
  minimumExactAuthoritativeSources,
  discoveredCourses: courses.length,
  complianceStagingReadyCourses,
  publicationReadyCourses,
  readyForComplianceStaging: structuralFindings.length === 0 && complianceStagingReadyCourses === portfolio.expectedCourses,
  publicationReady: structuralFindings.length === 0 && publicationBlockers.length === 0 && publicationReadyCourses === portfolio.expectedCourses,
  structuralFindingCount: structuralFindings.length,
  publicationBlockerCount: publicationBlockers.length,
  structuralFindings,
  publicationBlockers,
  courses,
  claimBoundary: "Compliance staging readiness proves exactly 60 protected course packages satisfy the instructional, assessment, exact-source, applicability, cinematic planning, materialization, accessibility, rights-planning, certificate, and governance contract. It does not prove final mastered media, independent legal applicability review, required approvals, LCMS operation, checkout availability, or publication authorization.",
};

fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-compliance-staging.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Exact 60-course cinematic compliance staging: ${complianceStagingReadyCourses}/${portfolio.expectedCourses} structurally ready; ${publicationReadyCourses}/${portfolio.expectedCourses} publication ready.`);
if (structuralFindings.length > 0) {
  for (const finding of structuralFindings.slice(0, 300)) console.error(`[Academy Studio] ${finding.courseId}: ${finding.finding}`);
  process.exit(2);
}
