import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const connectorSource = read("electron/connectors.cjs");
const bootstrapSource = read("scripts/build-removable-media-package.ps1");
const mainSource = read("electron/main.cjs");
const preloadSource = read("electron/preload.cjs");
const websiteDashboardSource = read("src/website-dashboard.js");
const policy = JSON.parse(read("policy/connector-catalog.json"));

const requiredIds = ["lcms", "academy", "website", "store", "eios", "stripe", "github", "vercel", "clerk", "localAi"];
const policyIds = new Set((policy.resources ?? []).map((resource) => resource.id));

for (const id of requiredIds) {
  const runtimePattern = new RegExp(`id:\\s*["']${id}["']`);
  const bootstrapPattern = new RegExp(`id\\s*=\\s*["']${id}["']`);
  if (!runtimePattern.test(connectorSource)) throw new Error(`Runtime connector missing: ${id}`);
  if (!bootstrapPattern.test(bootstrapSource)) throw new Error(`Bootstrap connector missing: ${id}`);
  if (!policyIds.has(id)) throw new Error(`Policy connector missing: ${id}`);
}

if ((policy.resources ?? []).length !== requiredIds.length) {
  throw new Error(`Policy connector count must equal ${requiredIds.length}`);
}
if (!/schemaVersion\s*=\s*["']1\.0["']/.test(bootstrapSource)) {
  throw new Error("Bootstrap builder schema must remain 1.0");
}
if (!/profile\.schemaVersion\s*!==\s*["']1\.0["']/.test(mainSource)) {
  throw new Error("Electron runtime must accept the same bootstrap schema 1.0");
}
if (!/id:\s*["']eios["'][\s\S]*credentialKey:\s*["']eiosToken["']/.test(connectorSource)) {
  throw new Error("EIOS connector must use a dedicated encrypted credential key");
}
if (!/id:\s*["']website["'][\s\S]*credentialKey:\s*["']websiteToken["']/.test(connectorSource)) {
  throw new Error("Website intelligence connector must use a dedicated encrypted credential key");
}
for (const credentialKey of ["websiteToken", "eiosToken"]) {
  if (!connectorSource.includes(`credentialKey: "${credentialKey}"`)) {
    throw new Error(`Authenticated intelligence credential missing: ${credentialKey}`);
  }
}
if (!/headers\.Authorization\s*=\s*`Bearer \$\{secret\}`/.test(mainSource)) {
  throw new Error("Command Center must send bearer credentials through the constrained connector header path");
}
if (!/intelligencePath:\s*["']\/api\/obserra\/intelligence["']/.test(connectorSource)) {
  throw new Error("Federated intelligence path is not configured");
}
if (!preloadSource.includes('analyzeOwnerAINow: () => ipcRenderer.invoke("ownerAI:analyzeNow")')) {
  throw new Error("Owner website operations requires the constrained Owner AI monitoring bridge");
}
if (!preloadSource.includes('getLastSecurityScan: () => ipcRenderer.invoke("security:getLastScan")')) {
  throw new Error("Owner website operations requires the constrained security evidence bridge");
}
for (const requiredToken of ["collectWebsiteOperationsSnapshot", "analyzeOwnerAINow", "intelligenceReports", "getLastSecurityScan", "deploymentState", "criticalCount", "highCount"]) {
  if (!websiteDashboardSource.includes(requiredToken)) {
    throw new Error(`Website Operations Center intelligence contract missing: ${requiredToken}`);
  }
}
if (websiteDashboardSource.includes("await refreshWebsiteOperations();")) {
  throw new Error("Website security scan must not recurse through the in-flight refresh lock");
}
for (const resource of policy.resources ?? []) {
  if (resource.writeCapabilitiesRequireOwnerApproval !== true) {
    throw new Error(`Connector ${resource.id} must require owner approval for write capabilities`);
  }
  if (!Array.isArray(resource.capabilities) || resource.capabilities.length === 0) {
    throw new Error(`Connector ${resource.id} must declare governed capabilities`);
  }
}

console.log(`[Owner Command Center] Connector contract verified for ${requiredIds.length} governed resources with authenticated Website and EIOS intelligence, deployment visibility, and security evidence.`);