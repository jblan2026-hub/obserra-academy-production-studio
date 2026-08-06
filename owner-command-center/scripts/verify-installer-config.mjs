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
if (packageJson?.build?.win?.requestedExecutionLevel !== "asInvoker") throw new Error("Installer must not request administrator rights by default");
if (!String(packageJson?.build?.portable?.artifactName ?? "").includes("Portable")) throw new Error("Portable artifact must be clearly labeled");

const mediaScriptPath = path.join(root, "scripts", "build-removable-media-package.ps1");
const mediaScript = fs.readFileSync(mediaScriptPath, "utf8");
const requiredConnectorIds = ["lcms", "academy", "website", "store", "eios", "stripe", "github", "vercel", "clerk", "localAi"];

if (!/schemaVersion\s*=\s*"1\.1"/.test(mediaScript)) throw new Error("Removable-media bootstrap must use schema version 1.1");
if (!/TargetHostname\s*=\s*"obserra"/.test(mediaScript)) throw new Error("Default removable-media target must remain machine 'obserra'");
for (const connectorId of requiredConnectorIds) {
  const pattern = new RegExp(`id\\s*=\\s*"${connectorId}"`);
  if (!pattern.test(mediaScript)) throw new Error(`Removable-media bootstrap is missing connector: ${connectorId}`);
}
for (const requiredTerm of ["SHA256SUMS.json", "Get-FileHash", "OBSERRA_COMMAND_CENTER_BOOTSTRAP", "Portable"]) {
  if (!mediaScript.includes(requiredTerm)) throw new Error(`Removable-media packaging is missing required behavior: ${requiredTerm}`);
}

console.log(`[Owner Command Center] Installer configuration verified: one-click NSIS, portable target, schema 1.1 bootstrap, and ${requiredConnectorIds.length} governed connectors.`);
