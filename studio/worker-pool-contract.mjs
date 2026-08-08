import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contractPath = path.join(root, "policy", "elastic-worker-pool-contract.json");
const productionStandardPath = path.join(
  root,
  "policy",
  "commercial-cinematic-course-production-standard.json",
);

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readContract() {
  const contract = readJson(contractPath, "Worker pool contract");
  if (contract.schemaVersion !== "1.1") {
    throw new Error(`Unsupported worker pool contract schema: ${contract.schemaVersion ?? "missing"}`);
  }
  if (contract.totalLogicalWorkers !== 36) {
    throw new Error("The governed production pool must contain exactly 36 logical workers.");
  }
  if (contract.assignmentMode !== "interchangeable-task-based") {
    throw new Error("The governed production pool must use interchangeable task-based assignments.");
  }
  if (contract.allocationRules?.applicationWorkerReservation !== 0) {
    throw new Error("Unrelated application work must receive zero workers during the governed production surge.");
  }
  if (
    contract.qualityStandard?.standardId !==
    "obserra-commercial-cinematic-course-production-v1"
  ) {
    throw new Error("The worker contract must bind Academy work to the commercial cinematic production standard.");
  }
  if (contract.qualityStandard?.enforcementMode !== "fail-closed") {
    throw new Error("Commercial cinematic production enforcement must remain fail closed.");
  }
  return contract;
}

function readProductionStandard() {
  const standard = readJson(productionStandardPath, "Commercial cinematic production standard");
  if (standard.schemaVersion !== "1.0") {
    throw new Error(`Unsupported commercial cinematic standard schema: ${standard.schemaVersion ?? "missing"}`);
  }
  if (standard.standardId !== "obserra-commercial-cinematic-course-production-v1") {
    throw new Error("Commercial cinematic production standard identity mismatch.");
  }
  if (standard.releaseControls?.failClosed !== true) {
    throw new Error("Commercial cinematic production release controls must fail closed.");
  }
  return standard;
}

export const workerPoolContract = Object.freeze(readContract());
export const commercialCinematicStandard = Object.freeze(readProductionStandard());
export const WORKER_TOTAL = workerPoolContract.totalLogicalWorkers;
export const ACADEMY_WORKSTREAM = "academy-course-production";
export const COMMAND_CENTER_WORKSTREAM = "command-center-release";

const allowedWorkstreams = new Set(workerPoolContract.allowedWorkstreams);
const academyRoles = new Set(workerPoolContract.academyContract.allowedRoles);
const commandCenterRoles = new Set(workerPoolContract.commandCenterContract.allowedRoles);
const universalRules = new Set(workerPoolContract.universalRules);

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function contractHash() {
  return stableHash(workerPoolContract);
}

export function productionStandardHash() {
  return stableHash(commercialCinematicStandard);
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function assertWorkstream(workstream) {
  if (!allowedWorkstreams.has(workstream)) {
    throw new Error(`Worker assignment rejected for non-contract workstream: ${workstream}`);
  }
}

export function assertUniversalRules(requiredRules) {
  for (const rule of requiredRules) {
    if (!universalRules.has(rule)) {
      throw new Error(`Worker assignment omitted required contract rule: ${rule}`);
    }
  }
}

export function roleForTask(taskType) {
  const roles = {
    "learning-architecture": "instructional-director",
    "source-and-rights-planning": "rights-clearance-producer",
    "screenplay-and-narration-script": "script-editor",
    "protected-authoring": "instructional-author",
    "storyboard-and-shot-list": "storyboard-producer",
    "visual-asset-production": "visual-director",
    "motion-graphics-and-compositing": "motion-graphics-producer",
    "picture-edit": "video-editor",
    "color-finishing": "colorist",
    "narration-recording": "narration-director",
    "audio-edit-mix-and-master": "audio-engineer",
    "learner-materials": "learner-materials-producer",
    "assessment-and-answer-key": "assessment-author",
    "psychometric-review": "psychometric-reviewer",
    "captions-transcript-and-accessibility": "caption-transcript-qc",
    "accessibility-equivalence": "accessibility-producer",
    "rights-and-source-records": "rights-clearance-producer",
    "certificate-package": "certificate-packager",
    "automated-media-qc": "media-qc-validator",
    "human-creative-and-technical-qc": "media-qc-validator",
    "compliance-staging": "compliance-validator",
    "commercial-production-coordination": "executive-producer",
    "command-center-security": "security-validator",
    "command-center-connectors": "connector-validator",
    "command-center-package": "release-packager",
    "command-center-recovery": "recovery-validator",
    "command-center-installation": "endpoint-installation-preparer"
  };
  const role = roles[taskType];
  if (!role) throw new Error(`No governed role is defined for task type: ${taskType}`);
  return role;
}

export function assertTaskAssignment({ workstream, taskType, role }) {
  assertWorkstream(workstream);
  const expectedRole = roleForTask(taskType);
  if (role !== expectedRole) {
    throw new Error(`Task ${taskType} requires role ${expectedRole}, received ${role}.`);
  }
  if (workstream === ACADEMY_WORKSTREAM && !academyRoles.has(role)) {
    throw new Error(`Academy role is not authorized by contract: ${role}`);
  }
  if (workstream === COMMAND_CENTER_WORKSTREAM && !commandCenterRoles.has(role)) {
    throw new Error(`Command Center role is not authorized by contract: ${role}`);
  }

  const requiredRules = [
    "secure-by-design",
    "secure-by-default",
    "least-privilege",
    "human-oversight",
    "full-auditability",
    "fail-closed",
    "checkpoint-before-claim",
    "no-fabricated-evidence",
    "no-false-production-claims",
    "no-owner-approval-bypass"
  ];
  if (workstream === ACADEMY_WORKSTREAM) {
    requiredRules.push(
      "no-placeholder-media-as-final",
      "no-silent-media-as-final",
      "no-provider-submission-as-completion",
      "no-unlicensed-media",
      "ai-media-provenance-required",
      "accessibility-before-release",
      "rights-before-release",
      "no-automatic-publication",
      "no-automatic-purchase-enablement",
    );
  }
  assertUniversalRules(requiredRules);
  return true;
}

export function planWorkerAllocation({
  academyPendingTasks,
  commandCenterPendingTasks,
  academyCritical = true,
  commandCenterCritical = false
}) {
  const academyPending = nonNegativeInteger(academyPendingTasks);
  const commandPending = nonNegativeInteger(commandCenterPendingTasks);
  const minimum = nonNegativeInteger(
    workerPoolContract.allocationRules.minimumWorkersPerActiveWorkstream,
    4
  );

  if (academyPending === 0 && commandPending === 0) {
    return {
      academyWorkers: 0,
      commandCenterWorkers: 0,
      idleWorkers: WORKER_TOTAL,
      academyPendingTasks: 0,
      commandCenterPendingTasks: 0,
      decision: "no-eligible-work",
      contractCompliant: true
    };
  }

  if (academyPending > 0 && commandPending === 0) {
    return {
      academyWorkers: WORKER_TOTAL,
      commandCenterWorkers: 0,
      idleWorkers: 0,
      academyPendingTasks: academyPending,
      commandCenterPendingTasks: 0,
      decision: "all-workers-academy",
      contractCompliant: true
    };
  }

  if (academyPending === 0 && commandPending > 0) {
    return {
      academyWorkers: 0,
      commandCenterWorkers: WORKER_TOTAL,
      idleWorkers: 0,
      academyPendingTasks: 0,
      commandCenterPendingTasks: commandPending,
      decision: "all-workers-command-center",
      contractCompliant: true
    };
  }

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

  if (academyWorkers < minimum) academyWorkers = minimum;
  if (commandCenterWorkers < minimum) {
    commandCenterWorkers = minimum;
    academyWorkers = WORKER_TOTAL - commandCenterWorkers;
  }

  if (academyCritical && academyPending > 0 && academyWorkers < 18) {
    academyWorkers = 18;
    commandCenterWorkers = WORKER_TOTAL - academyWorkers;
  }
  if (commandCenterCritical && commandPending > 0 && commandCenterWorkers < 8) {
    commandCenterWorkers = 8;
    academyWorkers = WORKER_TOTAL - commandCenterWorkers;
  }

  const allocated = academyWorkers + commandCenterWorkers;
  if (allocated !== WORKER_TOTAL) {
    throw new Error(`Worker allocation must total ${WORKER_TOTAL}; calculated ${allocated}.`);
  }

  return {
    academyWorkers,
    commandCenterWorkers,
    idleWorkers: 0,
    academyPendingTasks: academyPending,
    commandCenterPendingTasks: commandPending,
    decision: "elastic-parallel-split",
    contractCompliant: true
  };
}

export function validateAllocation(allocation) {
  const academyWorkers = nonNegativeInteger(allocation.academyWorkers);
  const commandCenterWorkers = nonNegativeInteger(allocation.commandCenterWorkers);
  const idleWorkers = nonNegativeInteger(allocation.idleWorkers);
  const total = academyWorkers + commandCenterWorkers + idleWorkers;
  if (total !== WORKER_TOTAL) {
    throw new Error(`Allocation accounts for ${total} workers; contract requires ${WORKER_TOTAL}.`);
  }
  if (allocation.applicationWorkers && nonNegativeInteger(allocation.applicationWorkers) !== 0) {
    throw new Error("Unrelated application worker allocation is prohibited by the active contract.");
  }
  return true;
}
