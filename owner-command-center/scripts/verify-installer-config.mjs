import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packagePath = path.join(root, "package.json");
const bootstrapPath = path.join(root, "resources", "Obserra-Command-Center-Bootstrap.json");
const indexPath = path.join(root, "src", "index.html");
const enrollmentUiPath = path.join(root, "src", "endpoint-enrollment-ui.js");
const mainPath = path.join(root, "electron", "main.cjs");
const endpointPath = path.join(root, "electron", "endpoint-enrollment.cjs");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

function targetNames(platform) {
  const targets = platform?.target ?? [];
  return targets.map((target) => typeof target === "string" ? target : target.target);
}

function targetArchitectures(platform, targetName) {
  const target = (platform?.target ?? []).find((item) => {
    const name = typeof item === "string" ? item : item.target;
    return name === targetName;
  });
  return typeof target === "object" && Array.isArray(target.arch) ? target.arch : [];
}

function hasBootstrapExtraFile(platform, expectedDestination) {
  return (platform?.extraFiles ?? []).some((entry) => {
    if (typeof entry === "string") return false;
    return entry.from === "resources/Obserra-Command-Center-Bootstrap.json"
      && entry.to === expectedDestination;
  });
}

for (const target of ["nsis", "portable"]) {
  if (!targetNames(packageJson?.build?.win).includes(target)) {
    throw new Error(`Missing required Windows packaging target: ${target}`);
  }
}
for (const target of ["dmg", "zip"]) {
  if (!targetNames(packageJson?.build?.mac).includes(target)) {
    throw new Error(`Missing required macOS packaging target: ${target}`);
  }
}
for (const target of ["AppImage", "deb"]) {
  if (!targetNames(packageJson?.build?.linux).includes(target)) {
    throw new Error(`Missing required Linux packaging target: ${target}`);
  }
}

for (const architecture of ["x64", "arm64"]) {
  if (!targetArchitectures(packageJson?.build?.win, "nsis").includes(architecture)) {
    throw new Error(`Windows setup installer must support ${architecture}.`);
  }
  if (!targetArchitectures(packageJson?.build?.win, "portable").includes(architecture)) {
    throw new Error(`Windows portable build must support ${architecture}.`);
  }
}
if (!targetArchitectures(packageJson?.build?.mac, "dmg").includes("universal")) {
  throw new Error("macOS DMG must be universal for Intel and Apple Silicon.");
}
for (const architecture of ["x64", "arm64"]) {
  if (!targetArchitectures(packageJson?.build?.linux, "AppImage").includes(architecture)) {
    throw new Error(`Linux AppImage must support ${architecture}.`);
  }
}

const nsis = packageJson?.build?.nsis ?? {};
if (nsis.oneClick !== false) {
  throw new Error("Windows setup must use the standard assisted installer wizard.");
}
if (nsis.perMachine !== false) {
  throw new Error("The default Windows installation must remain per-user and not require administrator rights.");
}
if (nsis.allowElevation !== true) {
  throw new Error("The standard Windows wizard must support owner-approved elevation when required.");
}
if (nsis.allowToChangeInstallationDirectory !== true) {
  throw new Error("The standard Windows wizard must allow the owner to select the installation directory.");
}
if (nsis.runAfterFinish !== true) {
  throw new Error("The standard Windows installer must launch the Command Center after setup.");
}
if (packageJson?.build?.win?.requestedExecutionLevel !== "asInvoker") {
  throw new Error("The Windows installer must not require administrator rights by default.");
}
if (!String(packageJson?.build?.nsis?.artifactName ?? "").includes("Setup")) {
  throw new Error("The standard Windows installer must be clearly named Setup.");
}
if (!String(packageJson?.build?.portable?.artifactName ?? "").includes("Portable")) {
  throw new Error("The optional portable artifact must be clearly labeled.");
}

if (!hasBootstrapExtraFile(packageJson?.build?.win, "Obserra-Command-Center-Bootstrap.json")) {
  throw new Error("The Windows setup must embed the generic bootstrap beside the installed executable.");
}
if (!hasBootstrapExtraFile(packageJson?.build?.mac, "MacOS/Obserra-Command-Center-Bootstrap.json")) {
  throw new Error("The macOS package must embed the generic bootstrap beside the application executable.");
}
if (!hasBootstrapExtraFile(packageJson?.build?.linux, "Obserra-Command-Center-Bootstrap.json")) {
  throw new Error("The Linux package must embed the generic bootstrap beside the application executable.");
}

for (const requiredPath of [bootstrapPath, indexPath, enrollmentUiPath, mainPath, endpointPath]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Required standard-installer asset is missing: ${path.relative(root, requiredPath)}`);
  }
}

const bootstrap = JSON.parse(fs.readFileSync(bootstrapPath, "utf8"));
if (bootstrap.schemaVersion !== "1.0") throw new Error("Generic bootstrap must use schema version 1.0.");
if (bootstrap.targetHostname !== "*") throw new Error("The distributable bootstrap must not be bound to one hostname.");
if (bootstrap.requireEnrollment !== true) throw new Error("The generic bootstrap must require explicit device enrollment.");
if (bootstrap.autoEnroll !== false) throw new Error("Wildcard packages must not silently enroll a new device.");
if (bootstrap.autoStart !== true) throw new Error("The standard desktop package must support owner-controlled auto-start.");
if (bootstrap.expectedCourseWorkerTarget !== 16) throw new Error("The Academy worker allocation must remain 16.");
if (bootstrap.expectedApplicationWorkerAllocation !== 20) throw new Error("The application worker allocation must remain 20.");
if (bootstrap.expectedTotalWorkerAllocation !== 36) throw new Error("The total worker allocation must remain 36.");
if (bootstrap.publicationAuthorityGranted !== false) throw new Error("Installation must not grant publication authority.");
if (!Array.isArray(bootstrap.connectors) || bootstrap.connectors.length < 10) {
  throw new Error("The generic desktop bootstrap connector inventory is incomplete.");
}

const index = fs.readFileSync(indexPath, "utf8");
const enrollmentUi = fs.readFileSync(enrollmentUiPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");
const endpoint = fs.readFileSync(endpointPath, "utf8");

for (const requiredTerm of [
  "endpointEnrollmentPanel",
  "endpointEnrollmentState",
  "endpointEnroll",
  "endpointRefresh",
  "endpointRevoke",
  "endpoint-enrollment-ui.js",
]) {
  if (!index.includes(requiredTerm)) throw new Error(`First-launch enrollment surface is missing: ${requiredTerm}`);
}
for (const requiredTerm of [
  "ENROLL THIS ENDPOINT",
  "REVOKE THIS ENDPOINT",
  "getEndpointSnapshot",
  "refreshEndpointSnapshot",
  "enrollEndpoint",
  "revokeEndpoint",
]) {
  if (!enrollmentUi.includes(requiredTerm)) throw new Error(`First-launch enrollment logic is missing: ${requiredTerm}`);
}
for (const requiredTerm of [
  "path.dirname(process.execPath)",
  "Obserra-Command-Center-Bootstrap.json",
]) {
  if (!main.includes(requiredTerm)) throw new Error(`Runtime bootstrap discovery is missing: ${requiredTerm}`);
}
for (const requiredTerm of [
  "targetHostname === \"*\"",
  "Wildcard bootstrap profiles require explicit owner enrollment",
  "endpoint-status.json",
  "installation-receipt.json",
]) {
  if (!endpoint.includes(requiredTerm)) throw new Error(`Endpoint enrollment runtime is missing: ${requiredTerm}`);
}

console.log(
  "[Owner Command Center] Standard installer verified: no PowerShell dependency, selectable Windows install path, Windows x64/arm64, macOS universal, Linux x64/arm64, embedded generic bootstrap, explicit owner enrollment, and no implicit publication authority."
);
