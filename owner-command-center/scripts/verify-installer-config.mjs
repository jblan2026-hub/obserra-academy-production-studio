import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const targets = packageJson?.build?.win?.target ?? [];
const targetNames = targets.map((target) => typeof target === "string" ? target : target.target);

for (const target of ["nsis", "portable"]) {
  if (!targetNames.includes(target)) throw new Error(`Missing required Windows packaging target: ${target}`);
}
if (packageJson?.build?.nsis?.oneClick !== true) throw new Error("NSIS installer must remain one-click");
if (packageJson?.build?.nsis?.perMachine !== false) throw new Error("Installer must be per-user to avoid unnecessary elevation");
if (packageJson?.build?.nsis?.runAfterFinish !== true) throw new Error("Installer must launch the Command Center so endpoint verification can complete");
if (packageJson?.build?.win?.requestedExecutionLevel !== "asInvoker") throw new Error("Installer must not request administrator rights by default");
if (!String(packageJson?.build?.portable?.artifactName ?? "").includes("Portable")) throw new Error("Portable artifact must be clearly labeled");

const mediaScriptPath = path.join(root, "scripts", "build-removable-media-package.ps1");
const installScriptPath = path.join(root, "scripts", "Install-Obserra-Command-Center.ps1");
const endpointTestPath = path.join(root, "scripts", "Test-Obserra-Command-Center-Endpoint.ps1");
const endpointOperationsPath = path.join(root, "ENDPOINT-OPERATIONS.md");
for (const requiredPath of [mediaScriptPath, installScriptPath, endpointTestPath, endpointOperationsPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Required endpoint release asset is missing: ${path.basename(requiredPath)}`);
}

const mediaScript = fs.readFileSync(mediaScriptPath, "utf8");
const installScript = fs.readFileSync(installScriptPath, "utf8");
const endpointTest = fs.readFileSync(endpointTestPath, "utf8");
const requiredConnectorIds = ["lcms", "academy", "website", "store", "eios", "stripe", "github", "vercel", "clerk", "localAi"];

if (!/schemaVersion\s*=\s*"1\.0"/.test(mediaScript)) throw new Error("Removable-media bootstrap must use compatibility schema version 1.0");
if (!/TargetHostname\s*=\s*"obserra"/.test(mediaScript)) throw new Error("Default removable-media target must remain machine 'obserra'");
for (const connectorId of requiredConnectorIds) {
  const pattern = new RegExp(`id\\s*=\\s*"${connectorId}"`);
  if (!pattern.test(mediaScript)) throw new Error(`Removable-media bootstrap is missing connector: ${connectorId}`);
}
for (const requiredTerm of [
  "localOnly = $true",
  "requireEnrollment = $true",
  "autoEnroll = $true",
  "autoStart = $true",
  "heartbeatIntervalSeconds = 15",
  "expectedCourseWorkerTarget = 36",
  "expectedApplicationWorkerAllocation = 0",
  "requiredWorkerMode = \"interchangeable-course-production\"",
  "publicationAuthorityGranted = $false",
  "Install-Obserra-Command-Center.ps1",
  "Test-Obserra-Command-Center-Endpoint.ps1",
  "ENDPOINT-OPERATIONS.md",
  "SHA256SUMS.json",
]) {
  if (!mediaScript.includes(requiredTerm)) throw new Error(`Removable-media packaging is missing required behavior: ${requiredTerm}`);
}

for (const requiredTerm of [
  "Assert-PackageIntegrity",
  "Assert-TargetProfile",
  "endpoint-status.json",
  "installer-verification.json",
  "Test-Obserra-Command-Center-Endpoint.ps1",
  "RequireControlPlaneOperational",
  "Get-FileHash",
]) {
  if (!installScript.includes(requiredTerm)) throw new Error(`Endpoint installer is missing required behavior: ${requiredTerm}`);
}
for (const requiredTerm of [
  "installation-receipt.json",
  "endpointReady",
  "controlPlaneOperational",
  "windowsEncryption",
  "enrollment.state",
  "lastHeartbeatAt",
  "readinessUrl",
  "Invoke-RestMethod",
]) {
  if (!endpointTest.includes(requiredTerm)) throw new Error(`Endpoint verifier is missing required behavior: ${requiredTerm}`);
}

console.log(`[Owner Command Center] Installer configuration verified: one-click NSIS, portable target, target-bound enrollment, live heartbeat verification, loopback readiness, 36-worker telemetry contract, and ${requiredConnectorIds.length} governed connectors.`);
