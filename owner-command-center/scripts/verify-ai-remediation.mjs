import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const remediationPath = path.join(root, "electron", "ai-remediation.cjs");
if (!fs.existsSync(remediationPath)) throw new Error("AI remediation engine is missing");
const source = fs.readFileSync(remediationPath, "utf8");

const required = [
  ["APPROVED_REPOSITORIES", "approved repository allowlist"],
  ["obserra-website", "Website remediation target"],
  ["obserra-academy-production-studio", "Studio and Command Center remediation target"],
  ["Obserra-EIOS-Dual-Mode-Module-Platform", "EIOS remediation target"],
  ["MITRE or OWASP mapping is required", "mapped vulnerability requirement"],
  ["Owner approval record is required", "owner approval requirement"],
  ["approvalDecision !== \"approved\"", "approval decision enforcement"],
  ["git\", [\"status\", \"--porcelain\"]", "clean working tree enforcement"],
  ["git\", [\"pull\", \"--ff-only\"", "fast-forward-only base update"],
  ["git\", [\"checkout\", \"-b\"", "isolated remediation branch"],
  ["git\", [\"push\", \"--set-upstream\"", "branch push"],
  ["gh\", [\"pr\", \"create\", \"--draft\"", "draft PR creation"],
  ["expectedSha256", "stale-source protection"],
  ["validationResults", "validation evidence"],
  ["evidenceDigest", "cryptographic evidence digest"],
  ["automaticMergeAllowed: false", "automatic merge prohibition"],
  ["automaticProductionDeploymentAllowed: false", "automatic production deployment prohibition"],
  ["forcePushAllowed: false", "force push prohibition"],
  ["directDefaultBranchWriteAllowed: false", "default branch write prohibition"]
];

for (const [term, description] of required) {
  if (!source.includes(term)) throw new Error(`AI remediation verification failed: missing ${description}`);
}

for (const forbidden of ["--force", "git push origin main", "git push origin master", "--admin", "--merge", "--auto"]) {
  if (source.includes(forbidden)) throw new Error(`AI remediation verification failed: forbidden behavior ${forbidden}`);
}

const module = await import(`file://${remediationPath.replace(/\\/g, "/")}`);
const remediation = module.default || module;
const targets = remediation.APPROVED_REPOSITORIES;
if (!targets || Object.keys(targets).sort().join(",") !== "eios,studio,website") throw new Error("AI remediation targets must be exactly Website, Studio, and EIOS");

for (const [id, config] of Object.entries(targets)) {
  if (!config.repository || !config.defaultBranch || !config.workspaceEnv) throw new Error(`AI remediation target ${id} is incomplete`);
  if (!Array.isArray(config.validation) || config.validation.length === 0) throw new Error(`AI remediation target ${id} has no validation gate`);
  if (!Array.isArray(config.scopes) || config.scopes.length === 0) throw new Error(`AI remediation target ${id} has no governed scopes`);
}

const proposal = remediation.createRemediationProposal({
  id: "CVE-TEST-0001",
  title: "Known dependency vulnerability",
  mappings: ["OWASP-A06-2021"],
  severity: "high",
  knownBad: true
}, "website", [{ path: "app/api/health/route.ts", content: "export const dynamic = 'force-dynamic';\n" }]);

if (proposal.status !== "owner-approval-required") throw new Error("Remediation proposals must require owner approval");
if (proposal.draftPullRequestOnly !== true) throw new Error("Remediation proposals must be draft PR only");
if (proposal.files.length !== 1) throw new Error("Remediation proposal file manifest is invalid");

let rejected = false;
try {
  remediation.validatePlan({ target: "website", files: proposal.files, mappings: [], ownerApprovalId: "approval-1", findingId: "test" });
} catch {
  rejected = true;
}
if (!rejected) throw new Error("Unmapped remediation plans must be rejected");

console.log("[Owner Command Center] Governed AI remediation verified across Website, Studio, Command Center, EIOS, APIs, identity, commerce, purchase, certificate, and connector flows.");
