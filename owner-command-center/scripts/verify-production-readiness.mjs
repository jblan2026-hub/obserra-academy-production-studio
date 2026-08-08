import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandCenterRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.dirname(commandCenterRoot);
const checks = [];

function read(relativePath, root = commandCenterRoot) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function record(name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function includesAll(name, source, markers) {
  const missing = markers.filter((marker) => !source.includes(marker));
  record(name, missing.length === 0, missing.length ? { missing } : null);
}

const packageJson = JSON.parse(read("package.json"));
const main = read("electron/main.cjs");
const academyStudio = read("electron/academy-studio.cjs");
const academyGovernance = read("electron/academy-governance.cjs");
const academyDashboard = read("src/academy-batch.js");
const preload = read("electron/preload.cjs");
const installer = read("scripts/build-removable-media-package.ps1");
const windowsWorkflow = read(".github/workflows/owner-command-center-windows.yml", repositoryRoot);
const workerContract = JSON.parse(read("policy/elastic-worker-pool-contract.json", repositoryRoot));
const productionStandard = JSON.parse(
  read("policy/commercial-cinematic-course-production-standard.json", repositoryRoot),
);

record("package-version-production-increment", /^0\.[3-9]\.|^[1-9]\./.test(packageJson.version), packageJson.version);
record("electron-main-with-remediation", packageJson.main === "electron/main-with-remediation.cjs", packageJson.main);
record("windows-installer-target", (packageJson.build?.win?.target ?? []).some((target) => target.target === "nsis"));
record("windows-portable-target", (packageJson.build?.win?.target ?? []).some((target) => target.target === "portable"));
record("per-user-installation", packageJson.build?.nsis?.perMachine === false);
record("no-default-elevation", packageJson.build?.nsis?.allowElevation === false && packageJson.build?.win?.requestedExecutionLevel === "asInvoker");
record("asar-packaging", packageJson.build?.asar === true);

includesAll("browser-security-boundary", main, [
  "contextIsolation: true",
  "nodeIntegration: false",
  "sandbox: true",
  "webSecurity: true",
  "setPermissionRequestHandler",
  "callback(false)",
  "setWindowOpenHandler(() => ({ action: \"deny\" }))",
  "will-navigate",
]);
includesAll("local-bootstrap-discovery", main, [
  "OBSERRA_COMMAND_CENTER_BOOTSTRAP",
  "Obserra-Command-Center-Bootstrap.json",
  "LOCALAPPDATA",
  "targetHostname",
]);
includesAll("preload-minimum-bridge", preload, [
  "contextBridge.exposeInMainWorld",
  "getAcademySnapshot",
  "runAcademyAction",
  "getSecuritySnapshot",
  "getRemediationSnapshot",
]);

includesAll("academy-governance-reader", academyGovernance, [
  "elastic-worker-pool-contract.json",
  "commercial-cinematic-course-production-standard.json",
  "parallel-authoring-summary.json",
  "learner-catalog-readiness.json",
  "commercial-implementation-guidance-readiness.json",
  "authoritative-source-resolution-queue.json",
  "compliance-staging-summary.json",
  "commercial-release-readiness.json",
  "protected-workflow-configuration",
]);
includesAll("academy-command-policy", academyStudio, [
  "stage-all",
  "source-queue",
  "release-check",
  "assertPublicationEligible",
  "Publication requires a valid FINAL governed package",
  "accepted commercial release evidence",
  "author:parallel",
  "verify:protected",
  "governedRuntimeEnvironment",
]);
for (const prohibited of [
  'case "publish"',
  'case "finalize"',
  'case "checkout"',
]) {
  record(`academy-command-prohibits-${prohibited}`, !academyStudio.includes(prohibited));
}
includesAll("academy-governance-dashboard", academyDashboard, [
  "PRODUCTION GOVERNANCE CENTER",
  "TOTAL WORKERS",
  "ACADEMY WORKERS",
  "COMMAND CENTER",
  "UNRELATED APPS",
  "COMPLIANCE STAGED",
  "COMMERCIAL READY",
  "UNRESOLVED REFERENCES",
  "stage-all",
  "source-queue",
  "release-check",
]);

record("worker-contract-id", workerContract.contractId === "obserra-elastic-production-pool-36");
record("worker-total-36", workerContract.totalLogicalWorkers === 36);
record("zero-unrelated-app-reservation", workerContract.allocationRules?.applicationWorkerReservation === 0);
record("interchangeable-workers", workerContract.assignmentMode === "interchangeable-task-based");
record("commercial-production-standard", productionStandard.qualityTier === "commercial-hollywood-grade");
record("quality-claim-fail-closed", productionStandard.claimPolicy?.qualityClaimAllowedOnlyAfterAcceptance === true);

includesAll("endpoint-installer-evidence", installer, [
  "SHA256SUMS.json",
  "Get-AuthenticodeSignature",
  "OBSERRA_COMMAND_CENTER_BOOTSTRAP",
  "OBSERRA_ACADEMY_STUDIO_ROOT",
  "Test-Obserra-Command-Center-Installation.ps1",
  "endpoint-health.json",
  "installation-record.json",
  "RequireAuthenticode",
  "ownerEndpointInstallationMayProceedAfterHashVerification",
  "productionDistributionRequiresTrustedCodeSigning",
]);
includesAll("windows-release-workflow", windowsWorkflow, [
  "windows-2025",
  "npm run verify",
  "build-removable-media-package.ps1",
  "Test-Obserra-Command-Center-Installation.ps1",
  "Obserra-Command-Center-Release.json",
  "agent/academy-36-worker-course-surge",
  "COMMAND_CENTER_WORKER_ALLOCATION: 8",
  "OBSERRA_APPLICATION_WORKER_COUNT: 0",
]);

record(
  "verify-chain-includes-production-readiness",
  String(packageJson.scripts?.verify ?? "").includes("verify-production-readiness.mjs"),
  packageJson.scripts?.verify ?? null,
);
record(
  "windows-package-script-present",
  packageJson.scripts?.["package:windows"] === "electron-builder --win nsis portable",
);
record(
  "removable-media-script-present",
  String(packageJson.scripts?.["package:media"] ?? "").includes("build-removable-media-package.ps1"),
);

const failures = checks.filter((check) => !check.passed);
const report = {
  schemaVersion: "1.0",
  verifiedAt: new Date().toISOString(),
  product: packageJson.build?.productName,
  version: packageJson.version,
  workerContractId: workerContract.contractId,
  productionStandardId: productionStandard.standardId,
  qualityTier: productionStandard.qualityTier,
  ready: failures.length === 0,
  checkCount: checks.length,
  passedCount: checks.length - failures.length,
  failureCount: failures.length,
  failures,
  checks,
  claimBoundary:
    "This gate proves source-level Command Center security, installer, endpoint-evidence, Academy governance, and Windows workflow bindings. It does not prove that a Windows artifact was built, signed, installed, launched, or connected on the owner's endpoint; those claims require workflow artifacts and endpoint-health evidence.",
};
const reportPath = path.join(commandCenterRoot, "production-readiness.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(2);
