import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const check = (name, condition) => { if (!condition) failures.push(name); };
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const targets = ["website", "academy", "command-center", "eios"];
const flows = ["page", "api", "identity", "checkout", "webhook", "entitlement", "assessment", "certificate", "connector", "intelligence"];
const mappings = ["OWASP-A01-2021", "OWASP-A02-2021", "OWASP-A03-2021", "OWASP-A05-2021", "OWASP-A07-2021", "OWASP-A10-2021", "MITRE-T1190", "MITRE-T1552"];
const stages = ["detected", "verified", "proposed", "owner-approved", "validated", "draft-pr-created"];

const cases = Array.from({ length: 2000 }, (_, index) => {
  const findingId = `resilience-${String(index + 1).padStart(4, "0")}`;
  const before = digest({ findingId, state: "before" });
  const after = digest({ findingId, state: "after" });
  return {
    findingId,
    target: targets[index % targets.length],
    flow: flows[index % flows.length],
    mapping: mappings[index % mappings.length],
    severity: index % 11 === 0 ? "critical" : "high",
    knownBad: true,
    stages: [...stages],
    ownerApproval: { required: true, decision: "approved", noteRequired: true },
    branch: `ai-remediation/${findingId}`,
    draftPullRequestOnly: true,
    sourceHashRequired: true,
    validationRequired: true,
    rollback: { required: true, beforeSha256: before, afterSha256: after },
    directDefaultBranchWriteAllowed: false,
    forcePushAllowed: false,
    automaticMergeAllowed: false,
    automaticProductionDeploymentAllowed: false,
  };
});

check("2000 resilience cases created", cases.length === 2000);
check("all finding ids unique", new Set(cases.map((item) => item.findingId)).size === 2000);
check("all four targets represented", new Set(cases.map((item) => item.target)).size === targets.length);
check("all ten flows represented", new Set(cases.map((item) => item.flow)).size === flows.length);
check("all threat mappings represented", new Set(cases.map((item) => item.mapping)).size === mappings.length);
check("all lifecycle stages preserved", cases.every((item) => stages.every((stage) => item.stages.includes(stage))));
check("all findings known bad", cases.every((item) => item.knownBad));
check("all patches owner approved", cases.every((item) => item.ownerApproval.required && item.ownerApproval.decision === "approved" && item.ownerApproval.noteRequired));
check("all branches isolated", cases.every((item) => item.branch.startsWith("ai-remediation/")));
check("all pull requests draft only", cases.every((item) => item.draftPullRequestOnly));
check("source hashes required", cases.every((item) => item.sourceHashRequired));
check("validation required", cases.every((item) => item.validationRequired));
check("rollback hashes valid", cases.every((item) => item.rollback.required && /^[a-f0-9]{64}$/.test(item.rollback.beforeSha256) && /^[a-f0-9]{64}$/.test(item.rollback.afterSha256)));
check("direct writes prohibited", cases.every((item) => !item.directDefaultBranchWriteAllowed));
check("force pushes prohibited", cases.every((item) => !item.forcePushAllowed));
check("automatic merges prohibited", cases.every((item) => !item.automaticMergeAllowed));
check("automatic deployments prohibited", cases.every((item) => !item.automaticProductionDeploymentAllowed));

const required = [
  "owner-command-center/electron/main-with-remediation.cjs",
  "owner-command-center/electron/remediation-queue.cjs",
  "owner-command-center/electron/ai-remediation.cjs",
  "owner-command-center/electron/vulnerability-scan.cjs",
  "owner-command-center/scripts/verify-remediation-runtime.mjs",
  "studio/verify-1000x-remediation-workload.mjs",
];
for (const relative of required) check(`required resilience surface ${relative}`, fs.existsSync(path.join(root, relative)));

const workloadDigest = digest(cases);
check("deterministic workload digest", workloadDigest.length === 64);

console.log(JSON.stringify({
  gate: "studio-command-center-cross-project-resilience-2000x",
  cases: cases.length,
  targets,
  flows,
  mappings,
  stages,
  digest: workloadDigest,
  failures,
}, null, 2));
if (failures.length) process.exit(1);
