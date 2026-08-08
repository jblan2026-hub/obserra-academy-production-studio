import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contractPath = path.join(root, "policy", "elastic-worker-pool-contract.json");

const REQUIRED_ALLOWED_WORKSTREAMS = Object.freeze([
  "academy-course-production",
  "command-center-release",
]);
const REQUIRED_PROHIBITED_WORKSTREAMS = Object.freeze([
  "unrelated-application-development",
  "customer-system-mutation",
  "learner-device-mutation",
  "vendor-system-mutation",
  "third-party-system-mutation",
  "unapproved-production-publication",
  "unapproved-commerce-activation",
  "placeholder-media-finalization",
  "unlicensed-media-use",
  "unverified-commercial-quality-claim",
]);
const REQUIRED_UNIVERSAL_RULES = Object.freeze([
  "secure-by-design",
  "secure-by-default",
  "least-privilege",
  "zero-trust",
  "tenant-isolation",
  "no-secret-logging",
  "no-secret-commits",
  "source-traceability",
  "human-oversight",
  "full-auditability",
  "fail-closed",
  "idempotent-execution",
  "checkpoint-before-claim",
  "no-fabricated-evidence",
  "no-false-production-claims",
  "no-automatic-publication",
  "no-automatic-purchase-enablement",
  "no-owner-approval-bypass",
]);
const REQUIRED_ACADEMY_RULES = Object.freeze([
  "commercial-cinematic-quality-gate",
  "original-instructional-content-only",
  "no-placeholder-media-as-final",
  "human-media-qc-required",
  "rights-cleared-assets-only",
  "accessibility-equivalence-required",
  "assessment-integrity-required",
  "release-evidence-required",
]);

const ACADEMY_TASK_ROLES = Object.freeze({
  "protected-authoring": "instructional-author",
  "learner-materials": "learner-materials-producer",
  "assessment-and-answer-key": "assessment-author",
  "creative-treatment-and-production-bible": "creative-director",
  "storyboard-shot-list-and-visual-design": "storyboard-and-visual-design-producer",
  "video-script-and-media-production": "media-producer",
  "narration-music-and-audio-mastering": "narration-and-audio-producer",
  "editorial-color-motion-graphics-and-finishing": "post-production-editor",
  "captions-transcripts-and-accessibility": "accessibility-producer",
  "rights-and-source-records": "rights-record-producer",
  "commercial-media-quality-control": "media-quality-validator",
  "certificate-package": "certificate-packager",
  "compliance-staging": "compliance-validator",
});
const COMMAND_CENTER_TASK_ROLES = Object.freeze({
  "command-center-security": "security-validator",
  "command-center-connectors": "connector-validator",
  "command-center-package": "release-packager",
  "command-center-recovery": "recovery-validator",
  "command-center-installation": "endpoint-installation-preparer",
});

function unique(values) {
  return Array.isArray(values) && new Set(values).size === values.length;
}

function sameMembers(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value) => right.includes(value));
}

function assertBoolean(value, name, expected = true) {
  if (value !== expected) {
    throw new Error(`${name} must be ${expected}.`);
  }
}

function assertString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function assertStringArray(value, name, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${name} must contain at least ${minimum} non-empty string value(s).`);
  }
  if (!unique(value)) throw new Error(`${name} contains duplicates.`);
  return value;
}

function readJson(filePath, name) {
  if (!fs.existsSync(filePath)) throw new Error(`${name} not found: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${name} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveGovernedPath(relativePath, name) {
  const normalized = assertString(relativePath, name);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${name} must remain inside the repository.`);
  }
  return resolved;
}

function readProductionStandard(referencePath) {
  const standardPath = resolveGovernedPath(referencePath, "academy productionStandardPath");
  const standard = readJson(standardPath, "Commercial cinematic production standard");
  if (standard.schemaVersion !== "1.0") {
    throw new Error(`Unsupported commercial production standard schema: ${standard.schemaVersion ?? "missing"}`);
  }
  if (standard.standardId !== "obserra-commercial-cinematic-course-production-v1") {
    throw new Error(`Unexpected commercial production standard identity: ${standard.standardId ?? "missing"}`);
  }
  if (standard.qualityTier !== "commercial-hollywood-grade") {
    throw new Error("The Academy production standard must target commercial-hollywood-grade quality.");
  }
  assertString(standard.claimBoundary, "production standard claimBoundary");
  assertBoolean(
    standard.claimPolicy?.qualityClaimAllowedOnlyAfterAcceptance,
    "production standard qualityClaimAllowedOnlyAfterAcceptance",
  );
  assertStringArray(standard.claimPolicy?.prohibitedInterimClaims, "production standard prohibitedInterimClaims", 5);
  assertStringArray(standard.requiredCourseDeliverables, "production standard requiredCourseDeliverables", 8);
  assertStringArray(
    standard.requiredInstructionalLessonDeliverables,
    "production standard requiredInstructionalLessonDeliverables",
    15,
  );
  if (standard.pictureMaster?.minimumRaster !== "3840x2160") {
    throw new Error("Commercial picture masters must target 3840x2160 or an explicitly approved equivalent.");
  }
  for (const flag of [
    "approvedEquivalentAllowed",
    "mezzanineMasterRequired",
    "webDeliveryDerivativeRequired",
    "consistentFrameRateRequired",
    "colorReviewRequired",
    "titleSafeReviewRequired",
    "motionGraphicsReviewRequired",
    "providerPreviewMayNotBeFinal",
    "placeholderFramesProhibitedInFinal",
    "silentOrStaticMockupMayNotBeFinal",
  ]) {
    assertBoolean(standard.pictureMaster?.[flag], `production standard pictureMaster.${flag}`);
  }
  if (standard.audioMaster?.sampleRateHz !== 48000) {
    throw new Error("Commercial audio masters must use a 48 kHz sample rate.");
  }
  if (!Number.isInteger(standard.audioMaster?.minimumBitDepth) || standard.audioMaster.minimumBitDepth < 24) {
    throw new Error("Commercial audio masters must use a minimum 24-bit depth.");
  }
  if (standard.audioMaster?.integratedLoudnessTargetLufs !== -16
      || standard.audioMaster?.integratedLoudnessToleranceLufs !== 1
      || standard.audioMaster?.truePeakMaximumDbtp !== -1) {
    throw new Error("Commercial audio loudness and true-peak targets do not match the governed digital-learning master specification.");
  }
  for (const flag of [
    "dialogueIntelligibilityReviewRequired",
    "noiseAndArtifactReviewRequired",
    "musicAndEffectsRightsRequired",
    "noSilentMaster",
    "professionalNarrationOrOwnerApprovedEquivalentRequired",
  ]) {
    assertBoolean(standard.audioMaster?.[flag], `production standard audioMaster.${flag}`);
  }
  for (const group of [
    "editorialAndVisualQuality",
    "accessibility",
    "rightsAndProvenance",
    "assessmentQuality",
    "qualityControl",
  ]) {
    const values = standard[group];
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`production standard ${group} must be an object.`);
    }
    for (const [name, value] of Object.entries(values)) {
      assertBoolean(value, `production standard ${group}.${name}`);
    }
  }
  assertStringArray(standard.prohibitedFinalSubstitutes, "production standard prohibitedFinalSubstitutes", 10);
  assertStringArray(standard.requiredReleaseEvidence, "production standard requiredReleaseEvidence", 12);
  return { standard, standardPath };
}

function readContract() {
  const contract = readJson(contractPath, "Worker pool contract");
  if (contract.schemaVersion !== "1.1") {
    throw new Error(`Unsupported worker pool contract schema: ${contract.schemaVersion ?? "missing"}`);
  }
  if (contract.contractId !== "obserra-elastic-production-pool-36") {
    throw new Error(`Unexpected worker pool contract identity: ${contract.contractId ?? "missing"}`);
  }
  if (contract.totalLogicalWorkers !== 36) {
    throw new Error("The governed production pool must contain exactly 36 logical workers.");
  }
  if (contract.assignmentMode !== "interchangeable-task-based") {
    throw new Error("The governed production pool must use interchangeable task-based assignments.");
  }
  if (!sameMembers(contract.allowedWorkstreams ?? [], REQUIRED_ALLOWED_WORKSTREAMS)) {
    throw new Error("The contract must authorize only Academy course production and Command Center release work.");
  }
  for (const prohibited of REQUIRED_PROHIBITED_WORKSTREAMS) {
    if (!(contract.prohibitedWorkstreams ?? []).includes(prohibited)) {
      throw new Error(`The worker pool contract is missing prohibited workstream ${prohibited}.`);
    }
  }
  if (!unique(contract.prohibitedWorkstreams ?? [])) {
    throw new Error("The prohibited workstream list contains duplicates.");
  }
  if (contract.allocationRules?.applicationWorkerReservation !== 0) {
    throw new Error("Unrelated application work must receive zero workers during the governed production surge.");
  }
  assertBoolean(contract.allocationRules?.allWorkersAccountedFor, "allWorkersAccountedFor");
  assertBoolean(
    contract.allocationRules?.crossWorkstreamRoleSwitchingAllowed,
    "crossWorkstreamRoleSwitchingAllowed",
  );
  assertBoolean(
    contract.allocationRules?.academyPriorityUntilSixtyCourseGate,
    "academyPriorityUntilSixtyCourseGate",
  );
  assertBoolean(
    contract.allocationRules?.commandCenterParallelWorkAllowed,
    "commandCenterParallelWorkAllowed",
  );
  assertBoolean(
    contract.allocationRules?.idleWorkersAllowedOnlyWhenBothWorkstreamsHaveNoEligibleTasks,
    "idleWorkersAllowedOnlyWhenBothWorkstreamsHaveNoEligibleTasks",
  );
  if (!Number.isInteger(contract.allocationRules?.minimumWorkersPerActiveWorkstream)
      || contract.allocationRules.minimumWorkersPerActiveWorkstream < 1
      || contract.allocationRules.minimumWorkersPerActiveWorkstream > 18) {
    throw new Error("minimumWorkersPerActiveWorkstream must be an integer from 1 through 18.");
  }

  if (contract.academyContract?.targetOwnerReviewCourses !== 60) {
    throw new Error("The active Academy contract must govern exactly 60 owner review courses.");
  }
  if (!sameMembers(contract.academyContract?.requiredStages ?? [], Object.keys(ACADEMY_TASK_ROLES))) {
    throw new Error("The Academy required stages do not match the enforceable task catalog.");
  }
  if (!sameMembers(contract.academyContract?.allowedRoles ?? [], Object.values(ACADEMY_TASK_ROLES))) {
    throw new Error("The Academy role catalog does not match the enforceable task role mapping.");
  }
  if (!sameMembers(contract.academyContract?.mandatoryRules ?? [], REQUIRED_ACADEMY_RULES)) {
    throw new Error("The Academy commercial production rule catalog is incomplete or contains unapproved rules.");
  }
  assertStringArray(contract.academyContract?.requiredEvidence, "academy requiredEvidence", 15);
  assertBoolean(contract.academyContract?.publicationDefault, "academy publicationDefault", false);
  assertBoolean(contract.academyContract?.checkoutDefault, "academy checkoutDefault", false);
  assertBoolean(
    contract.academyContract?.releaseRequiresOwnerApproval,
    "academy releaseRequiresOwnerApproval",
  );

  const { standard, standardPath } = readProductionStandard(
    contract.academyContract?.productionStandardPath,
  );
  if (contract.academyContract.productionStandardId !== standard.standardId) {
    throw new Error("The Academy contract production standard identity does not match the governed standard file.");
  }
  if (contract.academyContract.qualityTier !== standard.qualityTier) {
    throw new Error("The Academy contract quality tier does not match the governed standard file.");
  }

  if (!sameMembers(
    contract.commandCenterContract?.allowedRoles ?? [],
    Object.values(COMMAND_CENTER_TASK_ROLES),
  )) {
    throw new Error("The Command Center role catalog does not match the enforceable task role mapping.");
  }
  for (const flag of [
    "ownerOnly",
    "localOnly",
    "readOnlyByDefault",
    "firstPartyMutationOnly",
    "ownerApprovalRequiredForMutation",
    "rollbackRequiredForMutation",
    "evidenceRequiredForMutation",
    "endpointInstallationRequiresOwnerExecution",
  ]) {
    assertBoolean(contract.commandCenterContract?.[flag], `commandCenterContract.${flag}`);
  }

  if (!sameMembers(contract.universalRules ?? [], REQUIRED_UNIVERSAL_RULES)) {
    throw new Error("The universal rule catalog is incomplete or contains unapproved rules.");
  }
  if (!unique(contract.universalRules ?? [])) {
    throw new Error("The universal rule catalog contains duplicates.");
  }
  return { contract, standard, standardPath };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const governedSource = readContract();
export const workerPoolContract = deepFreeze(governedSource.contract);
export const commercialProductionStandard = deepFreeze(governedSource.standard);
export const commercialProductionStandardPath = governedSource.standardPath;
export const WORKER_TOTAL = workerPoolContract.totalLogicalWorkers;
export const ACADEMY_WORKSTREAM = "academy-course-production";
export const COMMAND_CENTER_WORKSTREAM = "command-center-release";

const allowedWorkstreams = new Set(workerPoolContract.allowedWorkstreams);
const academyRoles = new Set(workerPoolContract.academyContract.allowedRoles);
const commandCenterRoles = new Set(workerPoolContract.commandCenterContract.allowedRoles);
const universalRules = new Set(workerPoolContract.universalRules);

export function contractHash() {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(workerPoolContract))
    .digest("hex");
}

export function commercialProductionStandardHash() {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(commercialProductionStandard))
    .digest("hex");
}

function strictNonNegativeInteger(value, name, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function assertWorkstream(workstream) {
  if (!allowedWorkstreams.has(workstream)) {
    throw new Error(`Worker assignment rejected for non-contract workstream: ${workstream}`);
  }
}

export function assertUniversalRules(requiredRules = REQUIRED_UNIVERSAL_RULES) {
  for (const rule of requiredRules) {
    if (!universalRules.has(rule)) {
      throw new Error(`Worker assignment omitted required contract rule: ${rule}`);
    }
  }
  return true;
}

function appliedRulesForWorkstream(workstream) {
  if (workstream === ACADEMY_WORKSTREAM) {
    return Object.freeze([
      ...workerPoolContract.universalRules,
      ...workerPoolContract.academyContract.mandatoryRules,
    ]);
  }
  return workerPoolContract.universalRules;
}

export function taskContract(taskType) {
  if (Object.hasOwn(ACADEMY_TASK_ROLES, taskType)) {
    return Object.freeze({
      taskType,
      workstream: ACADEMY_WORKSTREAM,
      role: ACADEMY_TASK_ROLES[taskType],
      appliedRules: appliedRulesForWorkstream(ACADEMY_WORKSTREAM),
      productionStandardId: commercialProductionStandard.standardId,
      productionStandardHash: commercialProductionStandardHash(),
      qualityTier: commercialProductionStandard.qualityTier,
    });
  }
  if (Object.hasOwn(COMMAND_CENTER_TASK_ROLES, taskType)) {
    return Object.freeze({
      taskType,
      workstream: COMMAND_CENTER_WORKSTREAM,
      role: COMMAND_CENTER_TASK_ROLES[taskType],
      appliedRules: appliedRulesForWorkstream(COMMAND_CENTER_WORKSTREAM),
    });
  }
  throw new Error(`No governed role is defined for task type: ${taskType}`);
}

export function roleForTask(taskType) {
  return taskContract(taskType).role;
}

export function assertTaskAssignment({
  workstream,
  taskType,
  role,
  acknowledgedRules,
}) {
  assertWorkstream(workstream);
  const governedTask = taskContract(taskType);
  if (governedTask.workstream !== workstream) {
    throw new Error(`Task ${taskType} is not authorized for workstream ${workstream}.`);
  }
  if (role !== governedTask.role) {
    throw new Error(`Task ${taskType} requires role ${governedTask.role}, received ${role}.`);
  }
  if (workstream === ACADEMY_WORKSTREAM && !academyRoles.has(role)) {
    throw new Error(`Academy role is not authorized by contract: ${role}`);
  }
  if (workstream === COMMAND_CENTER_WORKSTREAM && !commandCenterRoles.has(role)) {
    throw new Error(`Command Center role is not authorized by contract: ${role}`);
  }
  if (!Array.isArray(acknowledgedRules)) {
    throw new Error("Worker assignment must acknowledge every applicable contract rule.");
  }
  const acknowledged = new Set(acknowledgedRules);
  for (const rule of governedTask.appliedRules) {
    if (!acknowledged.has(rule)) {
      throw new Error(`Worker assignment did not acknowledge mandatory rule ${rule}.`);
    }
  }
  if (acknowledged.size !== governedTask.appliedRules.length) {
    throw new Error("Worker assignment includes rules outside the governed task contract.");
  }
  assertUniversalRules();
  return Object.freeze({
    contractId: workerPoolContract.contractId,
    contractHash: contractHash(),
    workstream,
    taskType,
    role,
    appliedRules: governedTask.appliedRules,
    ...(workstream === ACADEMY_WORKSTREAM
      ? {
        productionStandardId: commercialProductionStandard.standardId,
        productionStandardHash: commercialProductionStandardHash(),
        qualityTier: commercialProductionStandard.qualityTier,
      }
      : {}),
  });
}

export function planWorkerAllocation({
  academyPendingTasks,
  commandCenterPendingTasks,
  academyCritical = true,
  commandCenterCritical = false,
}) {
  const academyPending = strictNonNegativeInteger(
    academyPendingTasks,
    "academyPendingTasks",
  );
  const commandPending = strictNonNegativeInteger(
    commandCenterPendingTasks,
    "commandCenterPendingTasks",
  );
  const minimum = strictNonNegativeInteger(
    workerPoolContract.allocationRules.minimumWorkersPerActiveWorkstream,
    "minimumWorkersPerActiveWorkstream",
    4,
  );

  let allocation;
  if (academyPending === 0 && commandPending === 0) {
    allocation = {
      academyWorkers: 0,
      commandCenterWorkers: 0,
      idleWorkers: WORKER_TOTAL,
      decision: "no-eligible-work",
    };
  } else if (academyPending > 0 && commandPending === 0) {
    allocation = {
      academyWorkers: WORKER_TOTAL,
      commandCenterWorkers: 0,
      idleWorkers: 0,
      decision: "all-workers-academy",
    };
  } else if (academyPending === 0 && commandPending > 0) {
    allocation = {
      academyWorkers: 0,
      commandCenterWorkers: WORKER_TOTAL,
      idleWorkers: 0,
      decision: "all-workers-command-center",
    };
  } else {
    const remaining = WORKER_TOTAL - (minimum * 2);
    if (remaining < 0) {
      throw new Error("Worker contract minimums exceed the governed 36 worker total.");
    }
    const academyWeight = academyPending * (academyCritical ? 3 : 1);
    const commandWeight = commandPending * (commandCenterCritical ? 3 : 1);
    const totalWeight = Math.max(1, academyWeight + commandWeight);
    const academyAdditional = Math.round((remaining * academyWeight) / totalWeight);
    let academyWorkers = minimum + academyAdditional;
    let commandCenterWorkers = WORKER_TOTAL - academyWorkers;

    if (commandCenterWorkers < minimum) {
      commandCenterWorkers = minimum;
      academyWorkers = WORKER_TOTAL - commandCenterWorkers;
    }
    if (academyCritical && academyWorkers < 18) {
      academyWorkers = 18;
      commandCenterWorkers = WORKER_TOTAL - academyWorkers;
    }
    if (commandCenterCritical && commandCenterWorkers < 8) {
      commandCenterWorkers = 8;
      academyWorkers = WORKER_TOTAL - commandCenterWorkers;
    }
    allocation = {
      academyWorkers,
      commandCenterWorkers,
      idleWorkers: 0,
      decision: "elastic-parallel-split",
    };
  }

  validateAllocation(allocation);
  return Object.freeze({
    ...allocation,
    academyPendingTasks: academyPending,
    commandCenterPendingTasks: commandPending,
    contractId: workerPoolContract.contractId,
    contractHash: contractHash(),
    productionStandardId: commercialProductionStandard.standardId,
    productionStandardHash: commercialProductionStandardHash(),
    qualityTier: commercialProductionStandard.qualityTier,
    contractCompliant: true,
  });
}

export function validateAllocation(allocation) {
  const academyWorkers = strictNonNegativeInteger(
    allocation.academyWorkers,
    "academyWorkers",
  );
  const commandCenterWorkers = strictNonNegativeInteger(
    allocation.commandCenterWorkers,
    "commandCenterWorkers",
  );
  const idleWorkers = strictNonNegativeInteger(allocation.idleWorkers, "idleWorkers");
  const applicationWorkers = strictNonNegativeInteger(
    allocation.applicationWorkers,
    "applicationWorkers",
  );
  const total = academyWorkers + commandCenterWorkers + idleWorkers;
  if (total !== WORKER_TOTAL) {
    throw new Error(`Allocation accounts for ${total} workers; contract requires ${WORKER_TOTAL}.`);
  }
  if (applicationWorkers !== 0) {
    throw new Error("Unrelated application worker allocation is prohibited by the active contract.");
  }
  if ((academyWorkers > 0 || commandCenterWorkers > 0) && idleWorkers > 0) {
    throw new Error("Workers may be idle only when both governed workstreams have no eligible tasks.");
  }
  return true;
}

export function verifyWorkerPoolContract() {
  const findings = [];
  const checks = [];
  const check = (name, condition, detail) => {
    checks.push({ name, passed: Boolean(condition), detail });
    if (!condition) findings.push(name);
  };

  check("contract-id", workerPoolContract.contractId === "obserra-elastic-production-pool-36");
  check("worker-total", WORKER_TOTAL === 36, WORKER_TOTAL);
  check("interchangeable-assignments", workerPoolContract.assignmentMode === "interchangeable-task-based");
  check("zero-application-reservation", workerPoolContract.allocationRules.applicationWorkerReservation === 0);
  check("academy-stage-role-coverage", sameMembers(
    workerPoolContract.academyContract.requiredStages,
    Object.keys(ACADEMY_TASK_ROLES),
  ));
  check("academy-role-coverage", sameMembers(
    workerPoolContract.academyContract.allowedRoles,
    Object.values(ACADEMY_TASK_ROLES),
  ));
  check("academy-rule-coverage", sameMembers(
    workerPoolContract.academyContract.mandatoryRules,
    REQUIRED_ACADEMY_RULES,
  ));
  check("commercial-standard-id", commercialProductionStandard.standardId === "obserra-commercial-cinematic-course-production-v1");
  check("commercial-quality-tier", commercialProductionStandard.qualityTier === "commercial-hollywood-grade");
  check("commercial-claim-fail-closed", commercialProductionStandard.claimPolicy.qualityClaimAllowedOnlyAfterAcceptance === true);
  check("commercial-picture-master", commercialProductionStandard.pictureMaster.minimumRaster === "3840x2160");
  check("commercial-audio-master", commercialProductionStandard.audioMaster.sampleRateHz === 48000
    && commercialProductionStandard.audioMaster.minimumBitDepth >= 24
    && commercialProductionStandard.audioMaster.noSilentMaster === true);
  check("commercial-human-qc", commercialProductionStandard.qualityControl.humanEditorialQcRequired === true
    && commercialProductionStandard.qualityControl.humanVisualQcRequired === true
    && commercialProductionStandard.qualityControl.humanAudioQcRequired === true
    && commercialProductionStandard.qualityControl.ownerAcceptanceRequired === true);
  check("command-center-role-coverage", sameMembers(
    workerPoolContract.commandCenterContract.allowedRoles,
    Object.values(COMMAND_CENTER_TASK_ROLES),
  ));
  check("universal-rules-complete", sameMembers(
    workerPoolContract.universalRules,
    REQUIRED_UNIVERSAL_RULES,
  ));
  check("publication-fail-closed", workerPoolContract.academyContract.publicationDefault === false);
  check("checkout-fail-closed", workerPoolContract.academyContract.checkoutDefault === false);
  check("owner-release-approval", workerPoolContract.academyContract.releaseRequiresOwnerApproval === true);
  check("command-center-owner-only", workerPoolContract.commandCenterContract.ownerOnly === true);
  check("command-center-local-only", workerPoolContract.commandCenterContract.localOnly === true);
  check("command-center-first-party-only", workerPoolContract.commandCenterContract.firstPartyMutationOnly === true);

  return Object.freeze({
    schemaVersion: "1.1",
    verifiedAt: new Date().toISOString(),
    contractId: workerPoolContract.contractId,
    contractHash: contractHash(),
    productionStandardId: commercialProductionStandard.standardId,
    productionStandardHash: commercialProductionStandardHash(),
    qualityTier: commercialProductionStandard.qualityTier,
    ready: findings.length === 0,
    checkCount: checks.length,
    findingCount: findings.length,
    findings,
    checks,
  });
}
