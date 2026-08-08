const fs = require("node:fs");
const path = require("node:path");

const REPORTS = Object.freeze({
  audit: "continuous-course-audit.json",
  authoring: "parallel-authoring-summary.json",
  learner: "learner-catalog-readiness.json",
  implementation: "commercial-implementation-guidance-readiness.json",
  sourceResolution: "authoritative-source-resolution-queue.json",
  staging: "compliance-staging-summary.json",
  release: "commercial-release-readiness.json",
  workerContract: "worker-pool-contract-verification.json",
  productionStandard: "commercial-course-production-standard-verification.json"
});

function readJsonIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      invalid: true,
      error: error instanceof Error ? error.message : String(error),
      path: filePath
    };
  }
}

function textIfPresent(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  } catch {
    return "";
  }
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function workflowInteger(source, name, fallback = 0) {
  const match = source.match(new RegExp(`^\\s*${name}:\\s*(\\d+)\\s*$`, "m"));
  return match ? integer(match[1], fallback) : fallback;
}

function countCourseStageRecords(root, stage) {
  const releasesRoot = path.join(root, "releases");
  if (!fs.existsSync(releasesRoot)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(releasesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(releasesRoot, entry.name, stage, "release-record.json"))) count += 1;
  }
  return count;
}

function reportState(report, fallback = "not-produced") {
  if (!report) return fallback;
  if (report.invalid) return "invalid";
  if (report.ready === true || report.structurallyReadyForComplianceStaging === true) return "passed";
  if (report.ready === false || report.structurallyReadyForComplianceStaging === false) return "blocked";
  if (report.status) return String(report.status);
  return "available";
}

function configuredWorkerAllocation(root, authoringReport) {
  if (authoringReport && !authoringReport.invalid) {
    const academyWorkers = integer(authoringReport.academyWorkerAllocation, 0);
    const commandCenterWorkers = integer(authoringReport.commandCenterWorkerAllocation, 0);
    const applicationWorkers = integer(authoringReport.applicationWorkerAllocation, 0);
    const idleWorkers = integer(authoringReport.idleWorkerAllocation, 0);
    const total = academyWorkers + commandCenterWorkers + idleWorkers;
    if (total === 36 && applicationWorkers === 0) {
      return {
        source: "latest-authoring-evidence",
        totalWorkers: 36,
        academyWorkers,
        commandCenterWorkers,
        applicationWorkers,
        idleWorkers,
        compliant: true
      };
    }
  }

  const workflow = textIfPresent(path.join(root, ".github", "workflows", "continuous-course-ai-audit.yml"));
  const applicationWorkers = workflowInteger(workflow, "OBSERRA_APPLICATION_WORKER_COUNT", 0);
  const commandCenterWorkers = workflowInteger(workflow, "COMMAND_CENTER_WORKER_ALLOCATION", 0);
  const idleWorkers = workflowInteger(workflow, "IDLE_WORKER_ALLOCATION", 0);
  const academyWorkers = workflowInteger(
    workflow,
    "ACADEMY_AUTHORING_CONCURRENCY",
    Math.max(0, 36 - commandCenterWorkers - idleWorkers)
  );
  return {
    source: workflow ? "protected-workflow-configuration" : "contract-only",
    totalWorkers: 36,
    academyWorkers,
    commandCenterWorkers,
    applicationWorkers,
    idleWorkers,
    compliant:
      academyWorkers + commandCenterWorkers + idleWorkers === 36
      && applicationWorkers === 0
  };
}

function getAcademyGovernanceSnapshot(root) {
  const contract = readJsonIfPresent(path.join(root, "policy", "elastic-worker-pool-contract.json"));
  const productionStandard = readJsonIfPresent(
    path.join(root, "policy", "commercial-cinematic-course-production-standard.json")
  );
  const catalogRoot = path.join(root, "catalog");
  const reports = Object.fromEntries(
    Object.entries(REPORTS).map(([key, fileName]) => [key, readJsonIfPresent(path.join(catalogRoot, fileName))])
  );
  const allocation = configuredWorkerAllocation(root, reports.authoring);
  const auditCourses = Array.isArray(reports.audit?.courses) ? reports.audit.courses : [];
  const totalCourses = integer(
    reports.audit?.totals?.ownerReviewEligible,
    auditCourses.filter((course) => course.ownerReviewEligible).length
  );
  const authoredCourses = auditCourses.filter((course) =>
    course.ownerReviewEligible
      && course.authoringMissing !== true
      && !(course.findings || []).some((finding) => [
        "missing-ai-course-package",
        "stale-ai-course-package",
        "untraceable-ai-course-package",
        "outdated-ai-authoring-policy",
        "unsupported-ai-authoring-envelope",
        "worker-contract-mismatch",
        "production-standard-mismatch",
        "missing-detailed-reference-structure",
        "missing-commercial-production-structure"
      ].includes(finding))
  ).length;
  const structurallyReadyCourses = Array.isArray(reports.learner?.courses)
    ? reports.learner.courses.filter((course) => course.structuralReady === true).length
    : reports.learner?.ready === true ? totalCourses : 0;
  const implementationReadyCourses = Array.isArray(reports.implementation?.summaries)
    ? reports.implementation.summaries.filter((course) => course.structuralFindingCount === 0).length
    : reports.implementation?.structurallyReadyForComplianceStaging === true ? totalCourses : 0;
  const stagedCourses = integer(
    reports.staging?.successfulCourses,
    countCourseStageRecords(root, "STAGED")
  );
  const commercialReadyCourses = integer(
    reports.release?.readyCourses,
    countCourseStageRecords(root, "FINAL")
  );
  const publicationApprovedCourses = integer(reports.audit?.totals?.publicationApproved, 0);
  const unresolvedReferences = integer(
    reports.sourceResolution?.unresolvedExternalSources,
    reports.learner?.releaseBlockerCount || 0
  );
  const commercialReleaseBlockers = integer(reports.release?.blockerCount, 0);
  const workerContractReady = reports.workerContract?.ready === true;
  const productionStandardReady = reports.productionStandard?.ready === true;

  const gates = [
    {
      id: "worker-contract",
      label: "36-worker elastic contract",
      state: reportState(reports.workerContract),
      detail: workerContractReady
        ? `${allocation.academyWorkers} Academy / ${allocation.commandCenterWorkers} Command Center / ${allocation.applicationWorkers} unrelated application workers.`
        : "Worker contract verification has not passed."
    },
    {
      id: "production-standard",
      label: "Commercial cinematic production standard",
      state: reportState(reports.productionStandard),
      detail: productionStandardReady
        ? `${productionStandard?.qualityTier || "commercial-hollywood-grade"} controls are source-bound.`
        : "Commercial production standard verification has not passed."
    },
    {
      id: "authoring",
      label: "Detailed protected authoring",
      state: authoredCourses === totalCourses && totalCourses > 0 ? "passed" : "in-progress",
      detail: `${authoredCourses}/${totalCourses} courses have current governed authoring packages.`
    },
    {
      id: "learner-structure",
      label: "Learner materials, assessments, and references",
      state: structurallyReadyCourses === totalCourses && totalCourses > 0 ? "passed" : reportState(reports.learner),
      detail: `${structurallyReadyCourses}/${totalCourses} courses meet structural learner-content requirements.`
    },
    {
      id: "implementation",
      label: "Real-world cases and implementation guidance",
      state: implementationReadyCourses === totalCourses && totalCourses > 0 ? "passed" : reportState(reports.implementation),
      detail: `${implementationReadyCourses}/${totalCourses} courses meet implementation-guidance structure.`
    },
    {
      id: "sources",
      label: "Reference verification and applicability",
      state: unresolvedReferences === 0 && totalCourses > 0 ? "passed" : "blocked",
      detail: `${unresolvedReferences} unresolved external reference item(s).`
    },
    {
      id: "compliance-stage",
      label: "Compliance-staged packages",
      state: stagedCourses === totalCourses && totalCourses > 0 ? "passed" : "in-progress",
      detail: `${stagedCourses}/${totalCourses} courses are staged; publication and checkout remain disabled.`
    },
    {
      id: "commercial-release",
      label: "Mastered media and commercial release",
      state: commercialReadyCourses === totalCourses && totalCourses > 0 ? "passed" : "blocked",
      detail: `${commercialReadyCourses}/${totalCourses} courses passed exact media, accessibility, rights, security, evidence, and owner-acceptance gates; ${commercialReleaseBlockers} blocker(s) reported.`
    }
  ];

  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    contract: {
      available: Boolean(contract && !contract.invalid),
      id: contract?.contractId || null,
      assignmentMode: contract?.assignmentMode || null,
      totalLogicalWorkers: integer(contract?.totalLogicalWorkers, 36),
      applicationWorkerReservation: integer(contract?.allocationRules?.applicationWorkerReservation, 0),
      error: contract?.invalid ? contract.error : null
    },
    productionStandard: {
      available: Boolean(productionStandard && !productionStandard.invalid),
      id: productionStandard?.standardId || null,
      qualityTier: productionStandard?.qualityTier || null,
      interimLabel: productionStandard?.claimPolicy?.interimLabel || null,
      claimBoundary: productionStandard?.claimBoundary || null,
      error: productionStandard?.invalid ? productionStandard.error : null
    },
    workerAllocation: allocation,
    counts: {
      totalCourses,
      authoredCourses,
      structurallyReadyCourses,
      implementationReadyCourses,
      stagedCourses,
      commercialReadyCourses,
      publicationApprovedCourses,
      unresolvedReferences,
      commercialReleaseBlockers
    },
    gates,
    reportStates: Object.fromEntries(
      Object.entries(reports).map(([key, report]) => [key, reportState(report)])
    ),
    reports
  };
}

module.exports = {
  getAcademyGovernanceSnapshot,
  readJsonIfPresent
};
