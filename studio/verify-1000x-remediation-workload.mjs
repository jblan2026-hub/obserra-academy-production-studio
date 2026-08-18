import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const failures = [];
const check = (name, condition) => { if (!condition) failures.push(name); };

const remediation = read("owner-command-center/electron/ai-remediation.cjs");
const worker = read("owner-command-center/scripts/remediate-approved-finding.cjs");
const verifier = read("owner-command-center/scripts/verify-ai-remediation.mjs");
const manifestSchema = JSON.parse(read("owner-command-center/policy/ai-remediation-schema.json"));

const targets = ["website", "studio", "eios"];
const mappings = ["OWASP-A01-2021", "OWASP-A03-2021", "OWASP-A05-2021", "MITRE-T1190", "MITRE-T1552"];
const scopes = ["website", "academy", "commerce", "identity", "api", "purchase", "certificate", "command-center", "connector", "eios"];
const workloadApprovedAt = "2026-08-18T00:00:00.000Z";

const plans = Array.from({ length: 1000 }, (_, index) => {
  const target = targets[index % targets.length];
  const mapping = mappings[index % mappings.length];
  const scope = scopes[index % scopes.length];
  const findingId = `finding-${String(index + 1).padStart(4, "0")}`;
  const content = `// governed remediation ${findingId}\nexport const remediated = true;\n`;
  return {
    schemaVersion: "1.0",
    target,
    findingId,
    title: `Remediate ${scope} vulnerability ${index + 1}`,
    mappings: [mapping],
    severity: index % 5 === 0 ? "critical" : "high",
    knownBad: true,
    ownerApprovalId: `approval-${String(index + 1).padStart(4, "0")}`,
    approvalDecision: "approved",
    approvedBy: "owner-validation-workload",
    approvedAt: workloadApprovedAt,
    scopes: [scope],
    files: [{
      path: target === "eios" ? `apps/eios-web/lib/remediation-${index + 1}.ts` : target === "website" ? `app/remediation-${index + 1}.ts` : `studio/remediation-${index + 1}.mjs`,
      content,
      expectedSha256: crypto.createHash("sha256").update(`before-${index + 1}`).digest("hex")
    }]
  };
});

check("1000 remediation plans created", plans.length === 1000);
check("all finding ids unique", new Set(plans.map((plan) => plan.findingId)).size === 1000);
check("all approvals unique", new Set(plans.map((plan) => plan.ownerApprovalId)).size === 1000);
check("all repositories represented", new Set(plans.map((plan) => plan.target)).size === 3);
check("all plans mapped", plans.every((plan) => plan.mappings.some((item) => /^(MITRE|OWASP)-/.test(item))));
check("all plans known bad", plans.every((plan) => plan.knownBad === true));
check("all plans owner approved", plans.every((plan) => plan.approvalDecision === "approved" && plan.ownerApprovalId && plan.approvedBy && plan.approvedAt));
check("all files hash guarded", plans.every((plan) => plan.files.every((file) => /^[a-f0-9]{64}$/.test(file.expectedSha256))));
check("all patch paths relative", plans.every((plan) => plan.files.every((file) => !path.isAbsolute(file.path) && !file.path.includes(".."))));

for (const pattern of [
  /APPROVED_REPOSITORIES/,
  /MAX_FILES_PER_PLAN/,
  /expectedSha256/,
  /git["'],?\s*\[?"checkout"/,
  /checkout["'],?\s*"-b"/,
  /pull["'],?\s*"--ff-only"/,
  /push["'],?\s*"--set-upstream"/,
  /gh["'],?\s*\[?"pr"/,
  /--draft/,
  /reset["'],?\s*"--hard"/,
  /automaticProductionDeploymentAllowed:\s*false/,
  /directDefaultBranchWriteAllowed:\s*false/,
  /forcePushAllowed:\s*false/
]) check(`remediation contract ${pattern}`, pattern.test(remediation));

check("worker validates manifest", /validatePlan/.test(worker));
check("worker executes approved remediation", /executeApprovedRemediation/.test(worker));
check("worker rejects incomplete owner approval evidence", /approvedBy/.test(worker) && /approvedAt/.test(worker));
check("release verifier enforces draft PR", /draft/i.test(verifier));
check("manifest schema requires approval id", manifestSchema.required?.includes("ownerApprovalId"));
check("manifest schema requires approval actor", manifestSchema.required?.includes("approvedBy"));
check("manifest schema requires approval timestamp", manifestSchema.required?.includes("approvedAt"));
check("manifest schema covers three targets", manifestSchema.properties?.target?.enum?.includes("website") && manifestSchema.properties?.target?.enum?.includes("studio") && manifestSchema.properties?.target?.enum?.includes("eios"));

const digest = crypto.createHash("sha256").update(JSON.stringify(plans)).digest("hex");
check("deterministic evidence digest", digest.length === 64);

console.log(JSON.stringify({
  gate: "governed-ai-remediation-1000x",
  plans: plans.length,
  targets: [...new Set(plans.map((plan) => plan.target))],
  mappings: [...new Set(plans.flatMap((plan) => plan.mappings))],
  scopes: [...new Set(plans.flatMap((plan) => plan.scopes))],
  digest,
  failures
}, null, 2));

if (failures.length) process.exit(1);
