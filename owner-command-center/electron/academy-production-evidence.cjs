const fs = require("node:fs");
const path = require("node:path");
const { resolveStudioRoot } = require("./academy-studio.cjs");
const { stableHash } = require("./academy-release-approval.cjs");

const EVIDENCE_FILES = Object.freeze({
  audit: "academy-hollywood-course-audit.json",
  workers: "academy-hollywood-parallel-summary.json",
  compliance: "academy-hollywood-compliance-staging.json",
  media: "academy-hollywood-media-submission.json",
  provider: "academy-hollywood-provider-preflight.json",
  checkpoints: "academy-hollywood-checkpoint-restore.json",
  releaseGate: "academy-release-approval-gate.json",
  ownerDecision: "academy-owner-release-decision.json",
  legacyWorkers: "parallel-authoring-summary.json",
  learnerCatalog: "learner-catalog-readiness.json"
});

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return { available: false, path: filePath, value: null, error: null };
  try {
    return { available: true, path: filePath, value: JSON.parse(fs.readFileSync(filePath, "utf8")), error: null };
  } catch (error) {
    return { available: true, path: filePath, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeReleaseStatus(value) {
  return String(value || "draft").trim().toLowerCase();
}

function inventoryCourses(root) {
  const coursesRoot = path.join(root, "courses");
  if (!fs.existsSync(coursesRoot)) {
    return { discovered: 0, ownerReviewEligible: 0, publicationApproved: 0, publicationEnabled: 0, invalidManifests: 0, courses: [] };
  }

  const courses = [];
  let invalidManifests = 0;
  for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const releaseStatus = normalizeReleaseStatus(manifest.release?.status);
      const publicationEnabled = manifest.release?.publishToAcademy === true;
      const publicationApproved = publicationEnabled && ["approved", "published"].includes(releaseStatus);
      courses.push({
        courseId: manifest.course?.id || entry.name,
        title: manifest.course?.title || entry.name,
        releaseStatus,
        publicationEnabled,
        publicationApproved,
        ownerReviewEligible: !["retired", "archived"].includes(releaseStatus)
      });
    } catch {
      invalidManifests += 1;
    }
  }

  return {
    discovered: courses.length,
    ownerReviewEligible: courses.filter((course) => course.ownerReviewEligible).length,
    publicationApproved: courses.filter((course) => course.publicationApproved).length,
    publicationEnabled: courses.filter((course) => course.publicationEnabled).length,
    invalidManifests,
    courses
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function integerOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function firstInteger(...values) {
  for (const value of values) {
    const parsed = integerOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function evidenceStatus(record) {
  if (!record.available) return "missing";
  if (record.error || !record.value) return "invalid";
  return "available";
}

function getAcademyProductionEvidence(rootOverride) {
  const root = rootOverride || resolveStudioRoot();
  if (!root) {
    return {
      available: false,
      source: "unavailable",
      root: null,
      checkedAt: new Date().toISOString(),
      workerTarget: 36,
      workerStatus: { configuredCourseWorkers: null, configuredApplicationWorkers: null, launchedWorkers: 0, activeWorkers: 0, completedAssignments: 0, failedAssignments: 0, interchangeable: null },
      courseStatus: { discovered: 0, ownerReviewEligible: 0, complianceStagingReady: 0, publicationReady: 0, publicationApproved: 0 },
      approvalStatus: { gateAvailable: false, expectedCourses: 0, stagedCourses: 0, blockedCourses: 0, allStagedForOwnerApproval: false, ownerDecisionRequired: false, ownerDecision: null },
      controlPlaneOperational: false,
      productionOperational: false,
      blockers: ["Academy production evidence is unavailable. Configure the GitHub connector or set OBSERRA_ACADEMY_STUDIO_ROOT to a verified repository path."],
      claimBoundary: "No live Academy production state is inferred without authenticated machine-readable evidence."
    };
  }

  const catalogRoot = path.join(root, "catalog");
  const records = Object.fromEntries(
    Object.entries(EVIDENCE_FILES).map(([key, file]) => [key, safeReadJson(path.join(catalogRoot, file))])
  );
  const inventory = inventoryCourses(root);
  const workerEvidence = records.workers.value || records.legacyWorkers.value || null;
  const audit = records.audit.value || {};
  const allocation = workerEvidence?.allocation || audit?.allocation || records.compliance.value?.allocation || records.releaseGate.value?.allocation || null;
  const configuredCourseWorkers = integerOrNull(firstDefined(
    allocation?.courseWorkerAllocation,
    workerEvidence?.courseWorkerAllocation
  ));
  const configuredApplicationWorkers = integerOrNull(firstDefined(
    allocation?.applicationWorkerAllocation,
    workerEvidence?.applicationWorkerAllocation
  ));
  const configuredPortfolioWorkers = integerOrNull(firstDefined(
    allocation?.portfolioWorkerCount,
    workerEvidence?.portfolioWorkerCount
  ));
  const launchedWorkers = integerOrNull(firstDefined(
    workerEvidence?.launchedWorkerCount,
    workerEvidence?.workerRoster?.length,
    workerEvidence?.concurrency
  )) || 0;
  const completedAssignments = integerOrNull(firstDefined(
    workerEvidence?.completedCourses,
    workerEvidence?.completed?.length
  )) || 0;
  const successfulAssignments = integerOrNull(firstDefined(
    workerEvidence?.successfulCourses,
    completedAssignments - (integerOrNull(workerEvidence?.failedCourses) || 0)
  )) || 0;
  const failedAssignments = integerOrNull(workerEvidence?.failedCourses) || 0;
  const activeWorkers = Math.max(0, (integerOrNull(workerEvidence?.startedCourses) || 0) - completedAssignments);
  const workerMode = firstDefined(allocation?.workerMode, workerEvidence?.allocation?.workerMode, null);
  const interchangeable = firstDefined(
    allocation?.crossRoleReassignmentAllowed,
    Array.isArray(workerEvidence?.interchangeableRoles) ? true : null
  );

  const compliance = records.compliance.value || {};
  const media = records.media.value || {};
  const provider = records.provider.value || {};
  const checkpoints = records.checkpoints.value || {};
  const learnerCatalog = records.learnerCatalog.value || {};
  const releaseGate = records.releaseGate.value || {};
  const ownerDecision = records.ownerDecision.value || null;
  const evidenceDiscoveredCourses = firstInteger(
    releaseGate.discoveredCourses,
    releaseGate.expectedCourses,
    compliance.discoveredCourses,
    audit.totals?.ownerReviewEligible,
    audit.totals?.discovered,
  ) || 0;
  const evidenceOwnerReviewCourses = firstInteger(
    releaseGate.expectedCourses,
    compliance.discoveredCourses,
    audit.totals?.ownerReviewEligible,
  ) || evidenceDiscoveredCourses;
  const effectiveDiscoveredCourses = inventory.discovered > 0 ? inventory.discovered : evidenceDiscoveredCourses;
  const effectiveOwnerReviewCourses = inventory.ownerReviewEligible > 0 ? inventory.ownerReviewEligible : evidenceOwnerReviewCourses;
  const complianceStagingReady = integerOrNull(firstDefined(
    compliance.complianceStagingReadyCourses,
    compliance.readyForComplianceStaging ? compliance.discoveredCourses : 0,
    compliance.ready ? compliance.discoveredCourses : 0
  )) || 0;
  const publicationReady = integerOrNull(firstDefined(
    compliance.publicationReadyCourses,
    compliance.publicationReady ? compliance.discoveredCourses : 0
  )) || 0;
  const approvalExpectedCourses = integerOrNull(releaseGate.expectedCourses) || effectiveOwnerReviewCourses;
  const approvalStagedCourses = integerOrNull(releaseGate.stagedCourses) || 0;
  const approvalBlockedCourses = integerOrNull(releaseGate.blockedCourses);
  const releaseGateHash = records.releaseGate.value ? stableHash(records.releaseGate.value) : null;
  const ownerDecisionMatchesGate = Boolean(ownerDecision && releaseGateHash && ownerDecision.gateHash === releaseGateHash);
  const ownerApprovalRecorded = ownerDecisionMatchesGate && ownerDecision?.decision === "approve";

  const blockers = [];
  if (inventory.invalidManifests > 0) blockers.push(`${inventory.invalidManifests} course manifest(s) are unreadable.`);
  if (evidenceStatus(records.audit) !== "available") blockers.push("Cinematic course audit evidence is not available.");
  if (evidenceStatus(records.workers) !== "available") blockers.push("36-worker surge execution evidence is not available.");
  if (evidenceStatus(records.compliance) !== "available") blockers.push("Cinematic compliance staging evidence is not available.");
  if (evidenceStatus(records.provider) !== "available") blockers.push("Protected authoring provider preflight evidence is not available.");
  if (provider.ready !== true) blockers.push("Protected authoring provider is not currently proven ready.");
  if (configuredPortfolioWorkers !== 36) blockers.push(`Configured portfolio worker evidence is ${configuredPortfolioWorkers ?? "unknown"}; required value is 36.`);
  if (configuredCourseWorkers !== 36) blockers.push(`Configured Academy course worker evidence is ${configuredCourseWorkers ?? "unknown"}; required value is 36.`);
  if (configuredApplicationWorkers !== 0) blockers.push(`Configured application worker evidence is ${configuredApplicationWorkers ?? "unknown"}; required surge value is 0.`);
  if (workerMode && workerMode !== "interchangeable-course-production") blockers.push(`Worker mode is ${workerMode}; interchangeable-course-production is required.`);
  if (interchangeable !== true) blockers.push("Worker interchangeability has not been proven by execution evidence.");
  if (complianceStagingReady < effectiveOwnerReviewCourses) blockers.push(`${effectiveOwnerReviewCourses - complianceStagingReady} owner-review course(s) have not reached compliance staging.`);
  if (media.allJobsSubmitted !== true) blockers.push("All required cinematic media jobs have not been submitted successfully.");
  if (publicationReady < effectiveOwnerReviewCourses) blockers.push(`${effectiveOwnerReviewCourses - publicationReady} owner-review course(s) remain blocked from publication.`);
  if (inventory.publicationEnabled > publicationReady) blockers.push("One or more manifests enable publication without matching publication-readiness evidence.");
  if (checkpoints.skipped === true || evidenceStatus(records.checkpoints) !== "available") blockers.push("Protected checkpoint restoration evidence is unavailable or skipped.");
  if (learnerCatalog.ready !== true) blockers.push("Protected learner catalog readiness is not proven.");
  if (evidenceStatus(records.releaseGate) !== "available") blockers.push("Owner release-approval gate evidence is not available.");
  if (releaseGate.portfolioCountMatches !== true) blockers.push("Owner release-approval portfolio count is not reconciled.");
  if (releaseGate.allStagedForOwnerApproval !== true) blockers.push(`${Math.max(0, approvalExpectedCourses - approvalStagedCourses)} course package(s) have not reached the owner release-approval gate.`);
  if (approvalBlockedCourses !== null && approvalBlockedCourses > 0) blockers.push(`${approvalBlockedCourses} course package(s) remain blocked at the owner release-approval gate.`);
  if (ownerDecision && !ownerDecisionMatchesGate) blockers.push("The recorded owner decision does not match the current release-approval gate hash.");

  const evidence = Object.fromEntries(
    Object.entries(records).map(([key, record]) => [key, { status: evidenceStatus(record), file: path.basename(record.path), error: record.error }])
  );
  const gateAvailable = evidenceStatus(records.releaseGate) === "available";
  const controlPlaneOperational = inventory.invalidManifests === 0
    && effectiveDiscoveredCourses > 0
    && gateAvailable;
  const productionOperational = blockers.length === 0;
  const source = inventory.discovered > 0
    ? "authoritative-local-repository-evidence"
    : "authenticated-github-actions-evidence-cache";

  return {
    available: true,
    source,
    root,
    checkedAt: new Date().toISOString(),
    workerTarget: 36,
    workerStatus: {
      configuredPortfolioWorkers,
      configuredCourseWorkers,
      configuredApplicationWorkers,
      launchedWorkers,
      activeWorkers,
      completedAssignments,
      successfulAssignments,
      failedAssignments,
      workerMode,
      interchangeable,
      halted: workerEvidence?.halted === true,
      haltReason: workerEvidence?.haltReason || null
    },
    courseStatus: {
      discovered: effectiveDiscoveredCourses,
      ownerReviewEligible: effectiveOwnerReviewCourses,
      complianceStagingReady,
      publicationReady,
      publicationApproved: inventory.publicationApproved,
      publicationEnabled: inventory.publicationEnabled,
      learnerCatalogReady: learnerCatalog.ready === true
    },
    approvalStatus: {
      gateAvailable,
      gateHash: releaseGateHash,
      gateGeneratedAt: releaseGate.generatedAt || null,
      portfolioDefinition: releaseGate.portfolioDefinition || null,
      expectedCourses: approvalExpectedCourses,
      stagedCourses: approvalStagedCourses,
      blockedCourses: approvalBlockedCourses ?? Math.max(0, approvalExpectedCourses - approvalStagedCourses),
      progressPercent: integerOrNull(releaseGate.progressPercent) || 0,
      allStagedForOwnerApproval: releaseGate.allStagedForOwnerApproval === true,
      ownerDecisionRequired: releaseGate.ownerDecisionRequired === true && !ownerDecisionMatchesGate,
      ownerDecisionMatchesGate,
      ownerApprovalRecorded,
      ownerDecision: ownerDecision
        ? {
            decisionId: ownerDecision.decisionId || null,
            decision: ownerDecision.decision || null,
            decidedAt: ownerDecision.decidedAt || null,
            gateHash: ownerDecision.gateHash || null,
            publicationAuthorized: ownerDecision.publicationAuthorized === true,
            checkoutAuthorized: ownerDecision.checkoutAuthorized === true,
            releaseExecutionRequired: ownerDecision.releaseExecutionRequired === true,
            releaseExecutionCompleted: ownerDecision.releaseExecutionCompleted === true
          }
        : null,
      publicationAuthorized: releaseGate.publicationAuthorized === true,
      checkoutAuthorized: releaseGate.checkoutAuthorized === true
    },
    providerStatus: {
      ready: provider.ready === true,
      provider: provider.provider || null,
      model: provider.model || null,
      checkedAt: provider.checkedAt || null
    },
    checkpointStatus: {
      restored: integerOrNull(checkpoints.restored) || 0,
      evaluated: integerOrNull(checkpoints.evaluated) || 0,
      skipped: checkpoints.skipped === true
    },
    mediaStatus: {
      requestedVideoJobs: integerOrNull(media.requestedVideoJobs) || 0,
      submittedVideoJobs: integerOrNull(media.submittedVideoJobs) || 0,
      configurationRequiredVideoJobs: integerOrNull(media.configurationRequiredVideoJobs) || 0,
      failedVideoJobs: integerOrNull(media.failedVideoJobs) || 0,
      allJobsSubmitted: media.allJobsSubmitted === true
    },
    publicationLocked: true,
    controlPlaneOperational,
    productionOperational,
    evidence,
    blockers: [...new Set(blockers)],
    operational: productionOperational,
    claimBoundary: "This view reports only authenticated machine-readable evidence. A live Command Center may synchronize GitHub production evidence and record a device-bound owner decision while course production remains blocked. Worker configuration is not worker execution, submitted media jobs are not mastered media, compliance staging is not owner approval, and an owner approval is not publication execution."
  };
}

module.exports = { EVIDENCE_FILES, getAcademyProductionEvidence, inventoryCourses, safeReadJson };
