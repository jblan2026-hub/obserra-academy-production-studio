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

const ACADEMY_TASK_ROLES = Object.freeze({
  "protected-authoring": "instructional-author",
  "learner-materials": "learner-materials-producer",
  "assessment-and-answer-key": "assessment-author",
  "video-script-and-media-production": "media-producer",
  "captions-transcripts-and-accessibility": "accessibility-producer",
  "rights-and-source-records": "rights-record-producer",
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
  return new Set(values).size === values.length;
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function assertBoolean(value, name, expected = true) {
  if (value !== expected) {
    throw new Error(`${name} must be ${expected}.`);
  }
}

function readContract() {
  if (!fs.existsSync(contractPath)) {
    throw new Error(`Worker pool contract not found: ${contractPath}`);
  }
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  if (contract.schemaVersion !== "1.0") {
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
  assertBoolean(contract.academyContract?.publicationDefault, "academy publicationDefault", false);
  assertBoolean(contract.academyContract?.checkoutDefault, "academy checkoutDefault", false);
  assertBoolean(
    contract.academyContract?.releaseRequiresOwnerApproval,
    "academy releaseRequiresOwnerApproval",
  );

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
  return contract;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const workerPoolContract = deepFreeze(readContract());
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

export function taskContract(taskType) {
  if (Object.hasOwn(ACADEMY_TASK_ROLES, taskType)) {
    return Object.freeze({
      taskType,
      workstream: ACADEMY_WORKSTREAM,
      role: ACADEMY_TASK_ROLES[taskType],
      appliedRules: workerPoolContract.universalRules,
    });
  }
  if (Object.hasOwn(COMMAND_CENTER_TASK_ROLES, taskType)) {
    return Object.freeze({
      taskType,
      workstream: COMMAND_CENTER_WORKSTREAM,
      role: COMMAND_CENTER_TASK_ROLES[taskType],
      appliedRules: workerPoolContract.universalRules,
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
  acknowledgedRules = workerPoolContract.universalRules,
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
    throw new Error("Worker assignment must acknowledge the complete universal rule catalog.");
  }
  const acknowledged = new Set(acknowledgedRules);
  for (const rule of workerPoolContract.universalRules) {
    if (!acknowledged.has(rule)) {
      throw new Error(`Worker assignment did not acknowledge mandatory rule ${rule}.`);
    }
  }
  assertUniversalRules();
  return Object.freeze({
    contractId: workerPoolContract.contractId,
    contractHash: contractHash(),
    workstream,
    taskType,
    role,
    appliedRules: workerPoolContract.universalRules,
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
    schemaVersion: "1.0",
    verifiedAt: new Date().toISOString(),
    contractId: workerPoolContract.contractId,
    contractHash: contractHash(),
    ready: findings.length === 0,
    checkCount: checks.length,
    findingCount: findings.length,
    findings,
    checks,
  });
}
