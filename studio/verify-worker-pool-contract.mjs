import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACADEMY_WORKSTREAM,
  COMMAND_CENTER_WORKSTREAM,
  WORKER_TOTAL,
  assertTaskAssignment,
  contractHash,
  planWorkerAllocation,
  validateAllocation,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const evidencePath = path.join(root, "catalog", "worker-pool-contract-verification.json");
const checks = [];

function check(name, condition, detail = null) {
  checks.push({ name, passed: Boolean(condition), detail });
}

function includesEvery(values, required) {
  const available = new Set(Array.isArray(values) ? values : []);
  return required.every((item) => available.has(item));
}

function expectThrow(name, fn) {
  try {
    fn();
    check(name, false, "Expected rejection but operation was accepted.");
  } catch (error) {
    check(name, true, error instanceof Error ? error.message : String(error));
  }
}

check("contract schema", workerPoolContract.schemaVersion === "1.1", workerPoolContract.schemaVersion);
check("contract identity", workerPoolContract.contractId === "obserra-elastic-production-pool-36", workerPoolContract.contractId);
check("36 logical workers", WORKER_TOTAL === 36, WORKER_TOTAL);
check("interchangeable task assignment", workerPoolContract.assignmentMode === "interchangeable-task-based", workerPoolContract.assignmentMode);
check("Academy workstream allowed", workerPoolContract.allowedWorkstreams?.includes(ACADEMY_WORKSTREAM));
check("Command Center workstream allowed", workerPoolContract.allowedWorkstreams?.includes(COMMAND_CENTER_WORKSTREAM));
check("unrelated application work prohibited", workerPoolContract.prohibitedWorkstreams?.includes("unrelated-application-development"));
check("unapproved publication prohibited", workerPoolContract.prohibitedWorkstreams?.includes("unapproved-production-publication"));
check("unapproved commerce activation prohibited", workerPoolContract.prohibitedWorkstreams?.includes("unapproved-commerce-activation"));
check("application reservation is zero", workerPoolContract.allocationRules?.applicationWorkerReservation === 0, workerPoolContract.allocationRules?.applicationWorkerReservation);
check("cinematic policy enforcement fail closed", workerPoolContract.qualityStandard?.enforcementMode === "fail-closed", workerPoolContract.qualityStandard?.enforcementMode);
check("cinematic policy bound to all Academy workers", workerPoolContract.qualityStandard?.appliesToAllAcademyWorkers === true);
check("owner acceptance required for public quality claim", workerPoolContract.qualityStandard?.publicClaimRequiresOwnerAcceptance === true);
check("Academy target is 60 owner review courses", workerPoolContract.academyContract?.targetOwnerReviewCourses === 60, workerPoolContract.academyContract?.targetOwnerReviewCourses);
check("Academy publication defaults off", workerPoolContract.academyContract?.publicationDefault === false);
check("Academy checkout defaults off", workerPoolContract.academyContract?.checkoutDefault === false);
check("Academy release requires owner approval", workerPoolContract.academyContract?.releaseRequiresOwnerApproval === true);
check("Command Center owner only", workerPoolContract.commandCenterContract?.ownerOnly === true);
check("Command Center read only by default", workerPoolContract.commandCenterContract?.readOnlyByDefault === true);
check("Command Center mutation requires owner approval", workerPoolContract.commandCenterContract?.ownerApprovalRequiredForMutation === true);
check("Command Center mutation requires rollback", workerPoolContract.commandCenterContract?.rollbackRequiredForMutation === true);
check("Command Center mutation requires evidence", workerPoolContract.commandCenterContract?.evidenceRequiredForMutation === true);

check("universal secure operating rules", includesEvery(workerPoolContract.universalRules, [
  "secure-by-design",
  "secure-by-default",
  "least-privilege",
  "zero-trust",
  "tenant-isolation",
  "no-secret-logging",
  "no-secret-commits",
  "human-oversight",
  "full-auditability",
  "fail-closed",
  "checkpoint-before-claim",
  "no-fabricated-evidence",
  "no-false-production-claims",
  "no-automatic-publication",
  "no-automatic-purchase-enablement",
  "no-owner-approval-bypass",
]));

check("Academy release evidence contract", includesEvery(workerPoolContract.academyContract?.requiredEvidence, [
  "source-traceability",
  "assessment-integrity",
  "psychometric-review",
  "caption-and-transcript-verification",
  "accessibility-equivalence",
  "rights-clearance",
  "entitlement-validation",
  "security-validation",
  "sha256-integrity-manifest",
  "rollback-evidence",
  "owner-acceptance",
]));

check("weak completion substitutes prohibited", includesEvery(workerPoolContract.academyContract?.prohibitedCompletionSubstitutes, [
  "script-only",
  "storyboard-only",
  "provider-job-submitted-only",
  "test-mode-output",
  "silent-media",
  "placeholder-media",
  "unreviewed-ai-output",
  "missing-rights",
  "missing-captions-or-transcript",
  "failed-media-qc",
]));

const allAcademy = planWorkerAllocation({ academyPendingTasks: 60, commandCenterPendingTasks: 0 });
check("all workers can be allocated to Academy", allAcademy.academyWorkers === 36 && allAcademy.commandCenterWorkers === 0 && allAcademy.idleWorkers === 0, allAcademy);
check("all Academy allocation validates", validateAllocation(allAcademy) === true);

const allCommandCenter = planWorkerAllocation({ academyPendingTasks: 0, commandCenterPendingTasks: 12, commandCenterCritical: true });
check("all workers can be allocated to Command Center", allCommandCenter.academyWorkers === 0 && allCommandCenter.commandCenterWorkers === 36 && allCommandCenter.idleWorkers === 0, allCommandCenter);
check("all Command Center allocation validates", validateAllocation(allCommandCenter) === true);

const parallel = planWorkerAllocation({ academyPendingTasks: 60, commandCenterPendingTasks: 12, academyCritical: true, commandCenterCritical: true });
check("parallel allocation accounts for all workers", parallel.academyWorkers + parallel.commandCenterWorkers + parallel.idleWorkers === 36, parallel);
check("parallel allocation preserves Academy priority", parallel.academyWorkers >= 18, parallel);
check("parallel allocation preserves Command Center minimum", parallel.commandCenterWorkers >= 8, parallel);
check("parallel allocation validates", validateAllocation(parallel) === true);

check("Academy instructional task assignment accepted", assertTaskAssignment({ workstream: ACADEMY_WORKSTREAM, taskType: "learner-materials", role: "learner-materials-producer" }) === true);
check("Academy assessment task assignment accepted", assertTaskAssignment({ workstream: ACADEMY_WORKSTREAM, taskType: "assessment-and-answer-key", role: "assessment-author" }) === true);
check("Command Center security task assignment accepted", assertTaskAssignment({ workstream: COMMAND_CENTER_WORKSTREAM, taskType: "command-center-security", role: "security-validator" }) === true);
check("Command Center connector task assignment accepted", assertTaskAssignment({ workstream: COMMAND_CENTER_WORKSTREAM, taskType: "command-center-connectors", role: "connector-validator" }) === true);

expectThrow("wrong role rejected", () => assertTaskAssignment({ workstream: ACADEMY_WORKSTREAM, taskType: "assessment-and-answer-key", role: "video-editor" }));
expectThrow("prohibited workstream rejected", () => assertTaskAssignment({ workstream: "unrelated-application-development", taskType: "learner-materials", role: "learner-materials-producer" }));
expectThrow("invalid allocation rejected", () => validateAllocation({ academyWorkers: 20, commandCenterWorkers: 10, idleWorkers: 0 }));

const failed = checks.filter((item) => !item.passed);
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  totalLogicalWorkers: WORKER_TOTAL,
  checks: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  ready: failed.length === 0,
  claimBoundary: "This verifies the governed elastic worker allocation and authorization contract. It does not by itself prove that course production, publication, payment, entitlement, learner access, or final owner acceptance has completed.",
  results: checks,
};

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);

for (const item of checks) {
  console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}${item.detail == null ? "" : `: ${typeof item.detail === "string" ? item.detail : JSON.stringify(item.detail)}`}`);
}
console.log(`[Academy Studio] Elastic worker pool verification: ${report.passed}/${report.checks} passed.`);
if (failed.length > 0) process.exit(1);
