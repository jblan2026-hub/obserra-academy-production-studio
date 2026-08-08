import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const packageLockPath = path.join(root, "package-lock.json");
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
const targets = packageJson?.build?.win?.target ?? [];
const targetNames = targets.map((target) => typeof target === "string" ? target : target.target);

for (const target of ["nsis", "portable"]) {
  if (!targetNames.includes(target)) throw new Error(`Missing required Windows packaging target: ${target}`);
}
if (packageJson?.build?.nsis?.oneClick !== true) throw new Error("NSIS installer must remain one-click");
if (packageJson?.build?.nsis?.perMachine !== false) throw new Error("Installer must be per-user to avoid unnecessary elevation");
if (packageJson?.build?.nsis?.allowElevation !== false) throw new Error("Installer must not allow elevation by default");
if (packageJson?.build?.nsis?.runAfterFinish !== false) throw new Error("Application launch must remain controlled by the post-install verifier");
if (packageJson?.build?.nsis?.deleteAppDataOnUninstall !== false) throw new Error("Uninstall must preserve owner evidence and configuration unless deliberately removed");
if (packageJson?.build?.win?.requestedExecutionLevel !== "asInvoker") throw new Error("Installer must not request administrator rights by default");
if (!String(packageJson?.build?.portable?.artifactName ?? "").includes("Portable")) throw new Error("Portable artifact must be clearly labeled");
if (packageJson?.build?.asar !== true) throw new Error("Packaged application files must remain inside ASAR where supported");
if (!String(packageJson?.scripts?.["package:windows"] ?? "").includes("--publish never")) throw new Error("Local Windows packaging must not auto-publish artifacts");
if (packageJson?.packageManager !== "npm@10.9.8") throw new Error("Command Center package manager must remain pinned to npm 10.9.8");
if (packageLock?.lockfileVersion !== 3) throw new Error("Command Center dependency evidence requires npm lockfileVersion 3");
if (packageLock?.name !== packageJson.name || packageLock?.version !== packageJson.version) {
  throw new Error("Command Center package-lock identity does not match package.json");
}
if (!Object.prototype.hasOwnProperty.call(packageLock?.packages ?? {}, "")) {
  throw new Error("Command Center package-lock must retain npm's empty-string root package key");
}

const mediaScriptPath = path.join(root, "scripts", "build-removable-media-package.ps1");
const mediaScript = fs.readFileSync(mediaScriptPath, "utf8");
const requiredConnectorIds = [
  "lcms",
  "academy",
  "website",
  "store",
  "eios",
  "stripe",
  "github",
  "vercel",
  "clerk",
  "localAi",
];

if (!mediaScript.includes('schemaVersion = "1.0"')) {
  throw new Error("Removable-media bootstrap must use governed schema version 1.0");
}
if (!mediaScript.includes('schemaVersion = "1.1"')) {
  throw new Error("Release, installation, and endpoint-health evidence must use governed schema version 1.1");
}
if (!/TargetHostname\s*=\s*"obserra"/.test(mediaScript)) {
  throw new Error("Default removable-media target must remain machine 'obserra'");
}
for (const connectorId of requiredConnectorIds) {
  const pattern = new RegExp(`id\\s*=\\s*"${connectorId}"`);
  if (!pattern.test(mediaScript)) throw new Error(`Removable-media bootstrap is missing connector: ${connectorId}`);
}
for (const requiredTerm of [
  "SHA256SUMS.json",
  "Get-FileHash",
  "Get-AuthenticodeSignature",
  "OBSERRA_COMMAND_CENTER_BOOTSTRAP",
  "OBSERRA_ACADEMY_STUDIO_ROOT",
  "Test-Obserra-Command-Center-Installation.ps1",
  "Obserra-Command-Center-Release.json",
  "Obserra-Worker-Pool-Contract.json",
  "Obserra-Commercial-Course-Production-Standard.json",
  "Obserra-Command-Center-Dependency-Lock.json",
  "package-lock.json",
  "Read-JsonHashTable",
  "ConvertFrom-Json -AsHashTable",
  '$packageLock["packages"].Count',
  "dependencyLockSha256",
  "dependencyLockPackageCount",
  "dependencyLockVerified",
  "packageManager",
  "lockfileVersion",
  "endpoint-health.json",
  "installation-record.json",
  "StudioRoot",
  "RequireAuthenticode",
  "SetEnvironmentVariable",
  "Portable",
]) {
  if (!mediaScript.includes(requiredTerm)) {
    throw new Error(`Removable-media packaging is missing required behavior: ${requiredTerm}`);
  }
}
for (const requiredAllocation of [
  "academyWorkers = 28",
  "commandCenterWorkers = 8",
  "unrelatedApplicationWorkers = 0",
]) {
  if (!mediaScript.includes(requiredAllocation)) {
    throw new Error(`Release descriptor is missing governed allocation: ${requiredAllocation}`);
  }
}
if (!mediaScript.includes("productionDistributionRequiresTrustedCodeSigning = $true")) {
  throw new Error("Release descriptor must state that trusted code signing is required for production distribution");
}
if (!mediaScript.includes("ownerEndpointInstallationMayProceedAfterHashVerification = $true")) {
  throw new Error("Owner endpoint hash-verified installation policy is missing");
}

console.log(
  `[Owner Command Center] Installer configuration verified: Windows-compatible npm lock parsing, controlled post-install launch, deterministic dependency evidence, one-click per-user NSIS, portable target, persistent bootstrap and Studio root, post-install health evidence, hash verification, explicit code-signing state, and ${requiredConnectorIds.length} governed connectors.`,
);
