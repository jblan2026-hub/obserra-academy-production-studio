import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const requirePattern = (content, pattern, message) => {
  if (!pattern.test(content)) throw new Error(`Remediation runtime verification failed: ${message}`);
};
const rejectPattern = (content, pattern, message) => {
  if (pattern.test(content)) throw new Error(`Remediation runtime verification failed: ${message}`);
};

const packageJson = JSON.parse(read("package.json"));
const wrapper = read("electron/main-with-remediation.cjs");
const queue = read("electron/remediation-queue.cjs");
const engine = read("electron/ai-remediation.cjs");
const preload = read("electron/preload.cjs");
const index = read("src/index.html");
const academyUi = read("src/academy-reset-ui.js");

if (packageJson.main !== "electron/main-with-remediation.cjs") {
  throw new Error("Remediation runtime verification failed: package entrypoint must use the governed remediation wrapper");
}

for (const channel of ["remediation:getSnapshot", "remediation:propose", "remediation:decide", "remediation:execute"]) {
  requirePattern(wrapper, new RegExp(channel.replace(":", "\\:")), `IPC channel ${channel} must remain registered behind the governed runtime`);
}
requirePattern(wrapper, /require\("\.\/main\.cjs"\)/, "existing Academy Command Center runtime must remain active");
requirePattern(wrapper, /createRemediationQueue/, "durable remediation queue must be instantiated");
requirePattern(wrapper, /security\.lastScan/, "remediation must be bound to the latest verified security scan");
requirePattern(wrapper, /resolveVerifiedFinding/, "verified findings must be resolved from stored evidence");
requirePattern(wrapper, /knownBad\s*!==\s*true/, "unverified findings must be rejected");
requirePattern(wrapper, /high[\s\S]*critical/, "only high or critical verified findings may be remediated");
requirePattern(wrapper, /mappings do not match/, "requested mappings must match verified scan evidence");
requirePattern(wrapper, /severity does not match/, "requested severity must match verified scan evidence");

for (const method of ["getRemediationSnapshot", "proposeRemediation", "decideRemediation", "executeRemediation"]) {
  requirePattern(preload, new RegExp(`${method}\\s*:`), `sandbox bridge must preserve governed ${method} capability`);
}

// The Academy-only reset intentionally does not expose the retired broad remediation dashboard.
rejectPattern(index, /remediationPanel|remediationStatus|remediationMetrics|remediationQueueList|remediationExecutions/, "legacy generic remediation dashboard controls must not return to the Academy-only shell");
rejectPattern(index, /remediation-dashboard\.js/, "legacy remediation dashboard script must not be loaded by the Academy-only shell");
requirePattern(index, /academy-reset-ui\.js/, "Academy reset renderer must remain the active owner UI");
requirePattern(index, /Private owner review, release, and publication control plane/, "Academy-only owner purpose must remain explicit");

// Academy remediation is surfaced through the governed course-revision action, not a generic security console.
requirePattern(academyUi, /AI revise/, "owner-controlled Academy AI revise action must be visible");
requirePattern(academyUi, /data-course-action="revise"/, "Academy AI revise must use the controlled course-action path");
requirePattern(academyUi, /runAcademyControlledAction/, "Academy revision must dispatch through the governed IPC action boundary");
requirePattern(academyUi, /Approval does not publish/, "revision and approval must remain separate from publication");
requirePattern(academyUi, /PUBLISH \$\{course\.id\}/, "publication must still require exact owner confirmation after revision/review");

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

console.log("[Obserra Academy Command Center] Governed remediation runtime verified: verified-evidence binding, owner approval, draft-only execution, rollback protection, Academy AI revise integration, and no legacy generic remediation panel or automatic production deployment.");
