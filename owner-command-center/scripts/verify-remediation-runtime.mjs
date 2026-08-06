import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const requirePattern = (content, pattern, message) => {
  if (!pattern.test(content)) throw new Error(`Remediation runtime verification failed: ${message}`);
};

const packageJson = JSON.parse(read("package.json"));
const wrapper = read("electron/main-with-remediation.cjs");
const queue = read("electron/remediation-queue.cjs");
const engine = read("electron/ai-remediation.cjs");
const preload = read("electron/preload.cjs");
const index = read("src/index.html");
const dashboard = read("src/remediation-dashboard.js");

if (packageJson.main !== "electron/main-with-remediation.cjs") throw new Error("Remediation runtime verification failed: package entrypoint must use the governed remediation wrapper");

for (const channel of ["remediation:getSnapshot", "remediation:propose", "remediation:decide", "remediation:execute"]) {
  requirePattern(wrapper, new RegExp(channel.replace(":", "\\:")), `IPC channel ${channel} must be registered`);
}
requirePattern(wrapper, /require\("\.\/main\.cjs"\)/, "existing Command Center runtime must remain active");
requirePattern(wrapper, /createRemediationQueue/, "durable remediation queue must be instantiated");
requirePattern(wrapper, /security\.lastScan/, "remediation must be bound to the latest verified security scan");
requirePattern(wrapper, /resolveVerifiedFinding/, "verified findings must be resolved from stored evidence");
requirePattern(wrapper, /knownBad\s*!==\s*true/, "unverified findings must be rejected");
requirePattern(wrapper, /high[\s\S]*critical/, "only high or critical verified findings may be remediated");
requirePattern(wrapper, /mappings do not match/, "requested mappings must match verified scan evidence");
requirePattern(wrapper, /severity does not match/, "requested severity must match verified scan evidence");

for (const method of ["getRemediationSnapshot", "proposeRemediation", "decideRemediation", "executeRemediation"]) {
  requirePattern(preload, new RegExp(`${method}\\s*:`), `sandbox bridge must expose ${method}`);
}

for (const id of ["remediationPanel", "remediationStatus", "remediationRefresh", "remediationMetrics", "remediationQueueList", "remediationExecutions"]) {
  requirePattern(index, new RegExp(`id=["']${id}["']`), `dashboard control ${id} must exist`);
}
requirePattern(index, /remediation-dashboard\.js/, "remediation dashboard script must be packaged");
requirePattern(dashboard, /Approve patch/, "owner approval control must be visible");
requirePattern(dashboard, /Reject/, "owner rejection control must be visible");
requirePattern(dashboard, /Validate and create draft PR/, "approved remediation execution control must be visible");
requirePattern(dashboard, /failed and rollback|failed-rolled-back|rollback/i, "rollback evidence must be visible");
requirePattern(dashboard, /setInterval[\s\S]*15000/, "remediation queue must refresh every 15 seconds");

requirePattern(queue, /pending-owner-approval/, "proposals must begin pending owner approval");
requirePattern(queue, /approved-for-execution/, "approved proposals must have a distinct execution state");
requirePattern(queue, /failed-rolled-back/, "failed executions must preserve rollback state");
requirePattern(queue, /MAX_RECORDS\s*=\s*5000/, "queue retention must support large sustained workloads");
requirePattern(engine, /--draft/, "remediation must create draft pull requests only");
requirePattern(engine, /pull[\s\S]*--ff-only/, "base branch update must be fast-forward only");
requirePattern(engine, /reset[\s\S]*--hard/, "failed remediation must reset changed files");
requirePattern(engine, /branch[\s\S]*-D/, "failed remediation must remove its isolated local branch");
requirePattern(engine, /forcePushAllowed:\s*false/, "force pushes must remain prohibited");
requirePattern(engine, /automaticProductionDeploymentAllowed:\s*false/, "automatic production deployment must remain prohibited");

console.log("[Owner Command Center] Verified-scan-bound remediation runtime, owner controls, draft PR, and rollback verification passed.");
