import crypto from "node:crypto";
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

function excludesAll(name, source, markers) {
  const present = markers.filter((marker) => source.includes(marker));
  record(name, present.length === 0, present.length ? { present } : null);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const packageText = read("package.json");
const packageJson = JSON.parse(packageText);
const packageLockText = read("package-lock.json");
const packageLock = JSON.parse(packageLockText);
const main = read("electron/main.cjs");
const runtimeWrapper = read("electron/main-with-remediation.cjs");
const academyStudio = read("electron/academy-studio.cjs");
const academyGovernance = read("electron/academy-governance.cjs");
const academyDashboard = read("src/academy-batch.js");
const preload = read("electron/preload.cjs");
const installer = read("scripts/build-removable-media-package.ps1");
const runtimeVerifier = read("scripts/verify-runtime-governance.mjs");
const windowsWorkflow = read(".github/workflows/owner-command-center-windows.yml", repositoryRoot);
const lockWorkflow = read(".github/workflows/owner-command-center-lockfile.yml", repositoryRoot);
const parallelWorkflow = read(".github/workflows/academy-command-center-parallel-production.yml", repositoryRoot);
const workerContract = JSON.parse(read("policy/elastic-worker-pool-contract.json", repositoryRoot));
const productionStandard = JSON.parse(
  read("policy/commercial-cinematic-course-production-standard.json", repositoryRoot),
);

record("package-version-production-increment", /^0\.[3-9]\.|^[1-9]\./.test(packageJson.version), packageJson.version);
record("package-author-governed", packageJson.author?.name === "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC", packageJson.author ?? null);
record("package-owner-only-license", packageJson.license === "UNLICENSED", packageJson.license ?? null);
record("package-manager-pinned", packageJson.packageManager === "npm@10.9.8", packageJson.packageManager ?? null);
record("node-engine-constrained", packageJson.engines?.node === ">=22 <23", packageJson.engines?.node ?? null);
record("npm-engine-constrained", packageJson.engines?.npm === ">=10 <11", packageJson.engines?.npm ?? null);
record("electron-main-with-remediation", packageJson.main === "electron/main-with-remediation.cjs", packageJson.main);
record("windows-installer-target", (packageJson.build?.win?.target ?? []).some((target) => target.target === "nsis"));
record("windows-portable-target", (packageJson.build?.win?.target ?? []).some((target) => target.target === "portable"));
record("per-user-installation", packageJson.build?.nsis?.perMachine === false);
record("no-default-elevation", packageJson.build?.nsis?.allowElevation === false && packageJson.build?.win?.requestedExecutionLevel === "asInvoker");
record("controlled-post-install-launch", packageJson.build?.nsis?.runAfterFinish === false);
record("preserve-owner-state-on-uninstall", packageJson.build?.nsis?.deleteAppDataOnUninstall === false);
record("asar-packaging", packageJson.build?.asar === true);
record("update-signature-verification", packageJson.build?.win?.verifyUpdateCodeSignature === true);

const rootLock = packageLock.packages?.[""];
record("lockfile-schema", packageLock.lockfileVersion === 3, packageLock.lockfileVersion ?? null);
record("lockfile-name", packageLock.name === packageJson.name, packageLock.name ?? null);
record("lockfile-version", packageLock.version === packageJson.version, packageLock.version ?? null);
record("lockfile-root-package", Boolean(rootLock));
record(
  "lockfile-direct-dependencies",
  Object.keys(packageJson.dependencies ?? {}).every((name) => name in (rootLock?.dependencies ?? {})),
  rootLock?.dependencies ?? null,
);
record(
  "lockfile-direct-dev-dependencies",
  Object.keys(packageJson.devDependencies ?? {}).every((name) => name in (rootLock?.devDependencies ?? {})),
  rootLock?.devDependencies ?? null,
);
record("lockfile-resolved-package-count", Object.keys(packageLock.packages ?? {}).length >= 300, Object.keys(packageLock.packages ?? {}).length);
record("lockfile-sha256", /^[a-f0-9]{64}$/.test(sha256(packageLockText)), sha256(packageLockText));

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
includesAll("runtime-governance", runtimeWrapper, [
  "app.requestSingleInstanceLock",
  "app.setAppUserModelId",
  "runtime-evidence.jsonl",
  "MAX_RUNTIME_EVIDENCE_BYTES",
  "rotateRuntimeEvidence",
  "sanitizeRuntimeDetail",
  "uncaughtExceptionMonitor",
  "unhandledRejection",
  "app.exit(1)",
]);
includesAll("runtime-governance-verifier", runtimeVerifier, [
  "Single-instance startup",
  "bounded runtime evidence retention",
  "secret redaction",
  "deterministic build identity",
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
  "workflow_call:",
  "windows-2025",
  "npm ci --ignore-scripts --no-audit --no-fund",
  "package-lock.json",
  "npm run verify",
  "build-removable-media-package.ps1",
  "Test-Obserra-Command-Center-Installation.ps1",
  "Obserra-Command-Center-Release.json",
  "COMMAND_CENTER_WORKER_ALLOCATION: 8",
  "OBSERRA_APPLICATION_WORKER_COUNT: 0",
  "retention-days: 90",
]);
excludesAll("windows-release-no-feature-branch-duplicate", windowsWorkflow, [
  "agent/academy-36-worker-course-surge",
  "pull_request:",
]);
includesAll("lockfile-read-only-workflow", lockWorkflow, [
  "permissions:\n  contents: read",
  "npm install --package-lock-only",
  "git status --porcelain -- package-lock.json",
  "npm ci --ignore-scripts --no-audit --no-fund",
  "lockfileVersion",
]);
excludesAll("lockfile-workflow-no-write-path", lockWorkflow, [
  "contents: write",
  "git push",
  "git commit",
  "github-actions[bot]",
]);
includesAll("parallel-workflow-reuses-windows-gate", parallelWorkflow, [
  "uses: ./.github/workflows/owner-command-center-windows.yml",
  "preflight:checkpoint-gateway",
  "authoring-checkpoint-gateway-preflight.json",
  "retention-days: 90",
]);
excludesAll("parallel-workflow-no-duplicate-command-center-build", parallelWorkflow, [
  "electron-builder --win",
  "Install deterministic Command Center dependencies",
  "issues: write",
]);

record(
  "verify-chain-includes-runtime-governance",
  String(packageJson.scripts?.verify ?? "").includes("verify-runtime-governance.mjs"),
  packageJson.scripts?.verify ?? null,
);
record(
  "verify-chain-includes-production-readiness",
  String(packageJson.scripts?.verify ?? "").includes("verify-production-readiness.mjs"),
  packageJson.scripts?.verify ?? null,
);
record(
  "windows-package-script-present",
  String(packageJson.scripts?.["package:windows"] ?? "").includes("electron-builder --win nsis portable")
    && String(packageJson.scripts?.["package:windows"] ?? "").includes("--publish never"),
  packageJson.scripts?.["package:windows"] ?? null,
);
record(
  "removable-media-script-present",
  String(packageJson.scripts?.["package:media"] ?? "").includes("build-removable-media-package.ps1"),
);

const failures = checks.filter((check) => !check.passed);
const report = {
  schemaVersion: "1.1",
  verifiedAt: new Date().toISOString(),
  product: packageJson.build?.productName,
  version: packageJson.version,
  packageManager: packageJson.packageManager,
  dependencyLock: {
    lockfileVersion: packageLock.lockfileVersion,
    packageCount: Object.keys(packageLock.packages ?? {}).length,
    sha256: sha256(packageLockText),
  },
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
    "This gate proves source-level Command Center security, runtime governance, deterministic dependency locking, installer evidence, Academy governance, and reusable Windows workflow bindings. It does not prove that a Windows artifact was signed, installed, launched, or connected on the owner's endpoint; those claims require current workflow artifacts and endpoint-health evidence.",
};
const reportPath = path.join(commandCenterRoot, "production-readiness.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(2);
