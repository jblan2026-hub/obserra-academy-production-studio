import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACADEMY_WORKSTREAM,
  COMMAND_CENTER_WORKSTREAM,
  assertTaskAssignment,
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  planWorkerAllocation,
  roleForTask,
  taskContract,
  validateAllocation,
  verifyWorkerPoolContract,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "catalog", "worker-pool-contract-verification.json");
const launcherPath = path.join(root, "studio", "author-courses-parallel.mjs");
const checks = [];

function record(name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function expectPass(name, action) {
  try {
    const detail = action();
    record(name, true, detail ?? null);
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function expectReject(name, action) {
  try {
    action();
    record(name, false, "Expected rejection, but the operation was accepted.");
  } catch (error) {
    record(name, true, error instanceof Error ? error.message : String(error));
  }
}

const structural = verifyWorkerPoolContract();
record(
  "contract-structure",
  structural.ready,
  structural.ready ? `${structural.checkCount} structural checks passed.` : structural.findings,
);

for (const scenario of [
  {
    name: "allocation-academy-only",
    input: { academyPendingTasks: 60, commandCenterPendingTasks: 0 },
    expected: { academyWorkers: 36, commandCenterWorkers: 0, idleWorkers: 0 },
  },
  {
    name: "allocation-command-center-only",
    input: { academyPendingTasks: 0, commandCenterPendingTasks: 5 },
    expected: { academyWorkers: 0, commandCenterWorkers: 36, idleWorkers: 0 },
  },
  {
    name: "allocation-parallel-normal",
    input: {
      academyPendingTasks: 60,
      commandCenterPendingTasks: 5,
      academyCritical: true,
      commandCenterCritical: false,
    },
    expected: { academyWorkers: 31, commandCenterWorkers: 5, idleWorkers: 0 },
  },
  {
    name: "allocation-parallel-both-critical",
    input: {
      academyPendingTasks: 60,
      commandCenterPendingTasks: 5,
      academyCritical: true,
      commandCenterCritical: true,
    },
    expected: { academyWorkers: 28, commandCenterWorkers: 8, idleWorkers: 0 },
  },
  {
    name: "allocation-no-eligible-work",
    input: { academyPendingTasks: 0, commandCenterPendingTasks: 0 },
    expected: { academyWorkers: 0, commandCenterWorkers: 0, idleWorkers: 36 },
  },
]) {
  expectPass(scenario.name, () => {
    const allocation = planWorkerAllocation(scenario.input);
    validateAllocation(allocation);
    for (const [key, expected] of Object.entries(scenario.expected)) {
      if (allocation[key] !== expected) {
        throw new Error(`${key} expected ${expected}, received ${allocation[key]}.`);
      }
    }
    if (allocation.productionStandardId !== commercialProductionStandard.standardId) {
      throw new Error("Allocation omitted the commercial production standard identity.");
    }
    return allocation;
  });
}

for (const taskType of workerPoolContract.academyContract.requiredStages) {
  expectPass(`academy-task-${taskType}`, () => {
    const governedTask = taskContract(taskType);
    const assignment = assertTaskAssignment({
      workstream: ACADEMY_WORKSTREAM,
      taskType,
      role: roleForTask(taskType),
      acknowledgedRules: governedTask.appliedRules,
    });
    if (assignment.productionStandardId !== commercialProductionStandard.standardId) {
      throw new Error("Academy assignment omitted the commercial production standard.");
    }
    if (assignment.qualityTier !== "commercial-hollywood-grade") {
      throw new Error("Academy assignment omitted the required commercial quality tier.");
    }
    return assignment;
  });
}

for (const taskType of [
  "command-center-security",
  "command-center-connectors",
  "command-center-package",
  "command-center-recovery",
  "command-center-installation",
]) {
  expectPass(`command-center-task-${taskType}`, () => {
    const governedTask = taskContract(taskType);
    return assertTaskAssignment({
      workstream: COMMAND_CENTER_WORKSTREAM,
      taskType,
      role: roleForTask(taskType),
      acknowledgedRules: governedTask.appliedRules,
    });
  });
}

expectPass("commercial-standard-picture-master", () => {
  if (commercialProductionStandard.pictureMaster.minimumRaster !== "3840x2160") {
    throw new Error("Picture master does not meet the commercial course standard.");
  }
  if (!commercialProductionStandard.pictureMaster.mezzanineMasterRequired
      || !commercialProductionStandard.pictureMaster.webDeliveryDerivativeRequired
      || !commercialProductionStandard.pictureMaster.providerPreviewMayNotBeFinal) {
    throw new Error("Commercial picture master controls are incomplete.");
  }
  return commercialProductionStandard.pictureMaster;
});

expectPass("commercial-standard-audio-master", () => {
  const audio = commercialProductionStandard.audioMaster;
  if (audio.sampleRateHz !== 48000
      || audio.minimumBitDepth < 24
      || audio.integratedLoudnessTargetLufs !== -16
      || audio.truePeakMaximumDbtp !== -1
      || !audio.noSilentMaster) {
    throw new Error("Commercial audio master controls are incomplete.");
  }
  return audio;
});

expectPass("commercial-standard-human-qc", () => {
  const qc = commercialProductionStandard.qualityControl;
  for (const [name, required] of Object.entries(qc)) {
    if (required !== true) throw new Error(`Commercial quality control ${name} is not required.`);
  }
  return qc;
});

expectPass("commercial-standard-accessibility-and-rights", () => {
  for (const groupName of ["accessibility", "rightsAndProvenance", "assessmentQuality"]) {
    for (const [name, required] of Object.entries(commercialProductionStandard[groupName])) {
      if (required !== true) throw new Error(`${groupName}.${name} is not required.`);
    }
  }
  return {
    accessibility: commercialProductionStandard.accessibility,
    rightsAndProvenance: commercialProductionStandard.rightsAndProvenance,
    assessmentQuality: commercialProductionStandard.assessmentQuality,
  };
});

expectReject("reject-under-allocation", () => validateAllocation({
  academyWorkers: 35,
  commandCenterWorkers: 0,
  idleWorkers: 0,
  applicationWorkers: 0,
}));
expectReject("reject-application-worker", () => validateAllocation({
  academyWorkers: 35,
  commandCenterWorkers: 0,
  idleWorkers: 1,
  applicationWorkers: 1,
}));
expectReject("reject-idle-while-work-active", () => validateAllocation({
  academyWorkers: 35,
  commandCenterWorkers: 0,
  idleWorkers: 1,
  applicationWorkers: 0,
}));
expectReject("reject-prohibited-workstream", () => assertTaskAssignment({
  workstream: "unrelated-application-development",
  taskType: "protected-authoring",
  role: "instructional-author",
  acknowledgedRules: taskContract("protected-authoring").appliedRules,
}));
expectReject("reject-incomplete-rule-acknowledgement", () => assertTaskAssignment({
  workstream: ACADEMY_WORKSTREAM,
  taskType: "protected-authoring",
  role: "instructional-author",
  acknowledgedRules: ["secure-by-design"],
}));
expectReject("reject-academy-assignment-without-commercial-rules", () => assertTaskAssignment({
  workstream: ACADEMY_WORKSTREAM,
  taskType: "video-script-and-media-production",
  role: "media-producer",
  acknowledgedRules: workerPoolContract.universalRules,
}));

expectPass("active-authoring-launcher-contract-binding", () => {
  const source = fs.readFileSync(launcherPath, "utf8");
  const requiredMarkers = [
    "./worker-pool-contract.mjs",
    "assertTaskAssignment",
    "taskContract",
    "validateAllocation",
    "OBSERRA_APPLICATION_WORKER_COUNT",
    "COMMAND_CENTER_WORKER_ALLOCATION",
    "contractHash()",
    "commercialProductionStandardHash()",
    "OBSERRA_PRODUCTION_STANDARD_ID",
    "OBSERRA_PRODUCTION_STANDARD_HASH",
    "OBSERRA_PRODUCTION_QUALITY_TIER",
  ];
  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) throw new Error(`Launcher is missing contract marker ${marker}.`);
  }
  for (const prohibited of [
    "const applicationWorkerAllocation = 20",
    "const courseWorkerAllocation = 16",
    "fixed 16-worker course allocation",
  ]) {
    if (source.includes(prohibited)) {
      throw new Error(`Launcher retains prohibited legacy allocation marker: ${prohibited}.`);
    }
  }
  return "Active authoring launcher imports and enforces the elastic contract and commercial production standard.";
});

const failures = checks.filter((check) => !check.passed);
const report = {
  schemaVersion: "1.1",
  verifiedAt: new Date().toISOString(),
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  totalLogicalWorkers: workerPoolContract.totalLogicalWorkers,
  assignmentMode: workerPoolContract.assignmentMode,
  ready: failures.length === 0,
  checkCount: checks.length,
  passedCount: checks.length - failures.length,
  failureCount: failures.length,
  failures,
  checks,
  ruleset: workerPoolContract,
  commercialProductionStandard,
  claimBoundary:
    "This verification proves source-level worker contract integrity, commercial cinematic production-standard integrity, and launcher binding. It does not prove that protected authoring, video rendering, audio mastering, accessibility production, rights clearance, compliance review, publication, or endpoint installation has completed successfully.",
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${report.ready}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `contract_hash=${report.contractHash}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `production_standard_hash=${report.productionStandardHash}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `check_count=${report.checkCount}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `failure_count=${report.failureCount}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    "## Elastic worker and commercial production contract verification",
    "",
    `- Contract: ${report.contractId}`,
    `- Contract hash: ${report.contractHash}`,
    `- Production standard: ${report.productionStandardId}`,
    `- Production standard hash: ${report.productionStandardHash}`,
    `- Quality tier: ${report.qualityTier}`,
    `- Ready: ${report.ready}`,
    `- Checks: ${report.passedCount}/${report.checkCount} passed`,
    `- Total logical workers: ${report.totalLogicalWorkers}`,
    `- Assignment mode: ${report.assignmentMode}`,
    "",
    report.claimBoundary,
  ].join("\n");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(2);
