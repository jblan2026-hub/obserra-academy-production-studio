export const portfolioWorkerCount = 36;
export const applicationWorkerAllocation = 0;
export const courseWorkerAllocation = 36;
export const workerMode = "interchangeable-course-production";
export const allocationAuthority = "owner-approved-temporary-academy-surge";

export const interchangeableCourseRoles = Object.freeze([
  "instructional-design",
  "subject-matter-research",
  "reference-verification",
  "applicability-mapping",
  "assessment-development",
  "cinematic-scriptwriting",
  "storyboard-and-shot-planning",
  "narration-caption-and-transcript-production",
  "accessibility-alternatives",
  "rights-and-licensing",
  "certificate-and-completion-design",
  "quality-assurance",
  "compliance-staging",
  "lcms-packaging",
]);

export const mandatoryContractDomains = Object.freeze([
  "original-instructional-content",
  "authoritative-reference-traceability",
  "reference-applicability-and-limitations",
  "assessment-integrity",
  "premium-cinematic-media-planning",
  "caption-transcript-and-audio-description",
  "accessibility",
  "rights-and-licensing",
  "certificate-of-course-completion-only",
  "entitlement-and-learner-isolation",
  "security-and-privacy",
  "owner-review-and-publication-separation",
]);

function parseConfiguredInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

export function assertAcademyWorkerAllocation() {
  const configuredPortfolio = parseConfiguredInteger("OBSERRA_PORTFOLIO_WORKER_COUNT", portfolioWorkerCount);
  const configuredApplication = parseConfiguredInteger("OBSERRA_APPLICATION_WORKER_COUNT", applicationWorkerAllocation);
  const configuredCourse = parseConfiguredInteger("ACADEMY_COURSE_WORKER_COUNT", courseWorkerAllocation);
  const configuredConcurrency = parseConfiguredInteger("ACADEMY_AUTHORING_CONCURRENCY", courseWorkerAllocation);
  const configuredMode = String(process.env.ACADEMY_WORKER_MODE || workerMode).trim();

  if (configuredPortfolio !== portfolioWorkerCount) {
    throw new Error(`The governed portfolio must remain ${portfolioWorkerCount} logical workers.`);
  }
  if (configuredApplication !== applicationWorkerAllocation) {
    throw new Error("Application work is disabled during the owner-approved Academy surge; OBSERRA_APPLICATION_WORKER_COUNT must be 0.");
  }
  if (configuredCourse !== courseWorkerAllocation) {
    throw new Error(`All ${courseWorkerAllocation} logical workers must be allocated to Academy course production during the surge.`);
  }
  if (configuredApplication + configuredCourse !== configuredPortfolio) {
    throw new Error("Worker allocations must reconcile exactly to the governed portfolio total.");
  }
  if (configuredConcurrency < 1 || configuredConcurrency > courseWorkerAllocation) {
    throw new Error(`ACADEMY_AUTHORING_CONCURRENCY must remain between 1 and ${courseWorkerAllocation}.`);
  }
  if (configuredMode !== workerMode) {
    throw new Error(`ACADEMY_WORKER_MODE must be ${workerMode}.`);
  }

  return Object.freeze({
    portfolioWorkerCount: configuredPortfolio,
    applicationWorkerAllocation: configuredApplication,
    courseWorkerAllocation: configuredCourse,
    concurrency: configuredConcurrency,
    workerMode: configuredMode,
    allocationAuthority,
    applicationWorkAllowed: false,
    crossRoleReassignmentAllowed: true,
    publicationAuthorityGranted: false,
    roles: interchangeableCourseRoles,
    mandatoryContractDomains,
  });
}

export function workerDescriptor(workerId, currentRole = "instructional-design") {
  if (!Number.isInteger(workerId) || workerId < 1 || workerId > courseWorkerAllocation) {
    throw new Error(`workerId must be between 1 and ${courseWorkerAllocation}.`);
  }
  if (!interchangeableCourseRoles.includes(currentRole)) {
    throw new Error(`Unsupported Academy worker role: ${currentRole}`);
  }

  return Object.freeze({
    workerId,
    workerName: `academy-course-worker-${String(workerId).padStart(2, "0")}`,
    workerMode,
    currentRole,
    interchangeable: true,
    capabilities: interchangeableCourseRoles,
    applicationWorkAllowed: false,
    publicationAuthorityGranted: false,
  });
}
