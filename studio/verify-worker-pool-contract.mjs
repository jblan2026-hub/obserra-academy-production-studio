import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACADEMY_WORKSTREAM,
  COMMAND_CENTER_WORKSTREAM,
  assertTaskAssignment,
  contractHash,
  planWorkerAllocation,
  roleForTask,
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
    return allocation;
  });
}

for (const taskType of workerPoolContract.academyContract.requiredStages) {
  expectPass(`academy-task-${taskType}`, () => {
    const role = roleForTask(taskType);
    return assertTaskAssignment({
      workstream: ACADEMY_WORKSTREAM,
      taskType,
      role,
      acknowledgedRules: workerPoolContract.universalRules,
    });
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
    const role = roleForTask(taskType);
    return assertTaskAssignment({
      workstream: COMMAND_CENTER_WORKSTREAM,
      taskType,
      role,
      acknowledgedRules: workerPoolContract.universalRules,
    });
  });
}

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
  acknowledgedRules: workerPoolContract.universalRules,
}));
expectReject("reject-incomplete-rule-acknowledgement", () => assertTaskAssignment({
  workstream: ACADEMY_WORKSTREAM,
  taskType: "protected-authoring",
  role: "instructional-author",
  acknowledgedRules: ["secure-by-design"],
}));

expectPass("active-authoring-launcher-contract-binding", () => {
  const source = fs.readFileSync(launcherPath, "utf8");
  const requiredMarkers = [
    "./worker-pool-contract.mjs",
    "assertTaskAssignment",
    "validateAllocation",
    "OBSERRA_APPLICATION_WORKER_COUNT",
    "COMMAND_CENTER_WORKER_ALLOCATION",
    "contractHash()",
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
  return "Active authoring launcher imports and enforces the elastic contract.";
});

const failures = checks.filter((check) => !check.passed);
const report = {
  schemaVersion: "1.0",
  verifiedAt: new Date().toISOString(),
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  totalLogicalWorkers: workerPoolContract.totalLogicalWorkers,
  assignmentMode: workerPoolContract.assignmentMode,
  ready: failures.length === 0,
  checkCount: checks.length,
  passedCount: checks.length - failures.length,
  failureCount: failures.length,
  failures,
  checks,
  ruleset: workerPoolContract,
  claimBoundary:
    "This verification proves source-level contract integrity and launcher binding. It does not prove that protected provider, database, media, compliance, publication, or endpoint installation work completed successfully.",
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${report.ready}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `contract_hash=${report.contractHash}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `check_count=${report.checkCount}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `failure_count=${report.failureCount}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    "## Elastic worker pool contract verification",
    "",
    `- Contract: ${report.contractId}`,
    `- Contract hash: ${report.contractHash}`,
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
