#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { executeApprovedRemediation, validatePlan } = require("../electron/ai-remediation.cjs");

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const manifestPath = process.argv[2];
if (!manifestPath) fail("Usage: node scripts/remediate-approved-finding.cjs <approved-remediation-manifest.json>", 2);
const resolvedManifest = path.resolve(manifestPath);
if (!fs.existsSync(resolvedManifest)) fail(`Remediation manifest not found: ${resolvedManifest}`, 2);

let plan;
try {
  plan = JSON.parse(fs.readFileSync(resolvedManifest, "utf8"));
  validatePlan(plan);
} catch (error) {
  fail(`Invalid remediation manifest: ${error instanceof Error ? error.message : String(error)}`, 2);
}

if (plan.approvalDecision !== "approved") fail("Remediation manifest is not owner approved", 3);
if (!plan.ownerApprovalId || !plan.approvedBy || !plan.approvedAt) fail("Owner approval evidence is incomplete", 3);

executeApprovedRemediation(plan)
  .then((result) => {
    const evidencePath = resolvedManifest.replace(/\.json$/i, "") + ".evidence.json";
    fs.writeFileSync(evidencePath, JSON.stringify(result, null, 2), { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ...result, evidencePath }, null, 2)}\n`);
  })
  .catch((error) => {
    const failure = {
      schemaVersion: "1.0",
      status: "failed",
      failedAt: new Date().toISOString(),
      findingId: plan.findingId,
      target: plan.target,
      ownerApprovalId: plan.ownerApprovalId,
      message: error instanceof Error ? error.message : String(error),
      validationResults: error?.validationResults || []
    };
    const evidencePath = resolvedManifest.replace(/\.json$/i, "") + ".failure.json";
    fs.writeFileSync(evidencePath, JSON.stringify(failure, null, 2), { encoding: "utf8", mode: 0o600 });
    process.stderr.write(`${JSON.stringify({ ...failure, evidencePath }, null, 2)}\n`);
    process.exit(1);
  });
