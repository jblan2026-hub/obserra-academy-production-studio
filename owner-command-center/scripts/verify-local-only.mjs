import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Required Command Center file is missing: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function requirePattern(content, pattern, description) {
  if (!pattern.test(content)) throw new Error(`Command Center verification failed: ${description}`);
}

function rejectPattern(content, pattern, description) {
  if (pattern.test(content)) throw new Error(`Command Center verification failed: ${description}`);
}

const main = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const academyStudio = read("electron/academy-studio.cjs");
const academyPreview = read("electron/academy-preview.cjs");
const dataProtection = read("electron/academy-data-protection.cjs");
const websiteRetrieval = read("electron/academy-website-retrieval.cjs");
const endpointEnrollment = read("electron/endpoint-enrollment.cjs");
const index = read("src/index.html");
const resetUi = read("src/academy-reset-ui.js");
const resetCss = read("src/academy-reset.css");
const packageJson = JSON.parse(read("package.json"));
const connectorCatalog = JSON.parse(read("policy/connector-catalog.json"));

for (const [pattern, description] of [
  [/contextIsolation:\s*true/, "Electron context isolation must be enabled"],
  [/nodeIntegration:\s*false/, "renderer Node integration must be disabled"],
  [/sandbox:\s*true/, "renderer sandbox must be enabled"],
  [/webSecurity:\s*true/, "Electron web security must be enabled"],
  [/setPermissionRequestHandler[\s\S]*callback\(false\)/, "renderer permissions must be denied by default"],
  [/setWindowOpenHandler[\s\S]*action:\s*["']deny["']/, "new-window creation must be denied"],
  [/safeStorage\.encryptString/, "secrets must use Windows-backed encryption"],
  [/safeStorage\.decryptString/, "encrypted secrets must support controlled decryption"],
]) requirePattern(main, pattern, description);

for (const [pattern, description] of [
  [/\.listen\s*\(/, "desktop application must not open an inbound HTTP listener"],
  [/0\.0\.0\.0|::0/, "desktop application must not bind a public listener"],
  [/nodeIntegration:\s*true/, "renderer Node integration cannot be enabled"],
  [/contextIsolation:\s*false/, "context isolation cannot be disabled"],
  [/webSecurity:\s*false/, "web security cannot be disabled"],
  [/executeJavaScript\s*\(/, "arbitrary renderer code execution is prohibited"],
]) rejectPattern(main, pattern, description);

requirePattern(preload, /contextBridge\.exposeInMainWorld/, "renderer APIs must use a constrained context bridge");
for (const method of [
  "getAcademySnapshot",
  "getAcademyControlSnapshot",
  "updateAcademyReview",
  "transitionAcademyCourse",
  "runAcademyControlledAction",
  "verifyAcademyPurchase",
  "retrieveWebsiteAcademyCourse",
  "retrieveWebsiteAcademyCertificate",
  "previewAcademyCourse",
  "previewAcademyMaterials",
  "previewAcademyCertificate",
]) requirePattern(preload, new RegExp(`${method}\\s*:`), `preload bridge must expose ${method}`);
rejectPattern(preload, /require\(["']node:(fs|child_process|net|http|https)|require\(["'](fs|child_process|net|http|https)/, "preload must not expose raw filesystem, process, or network modules");

requirePattern(academyStudio, /ALLOWED_ACTIONS/, "Studio actions must be allowlisted");
requirePattern(academyStudio, /shell:\s*false/, "Studio commands must execute without a shell");
requirePattern(academyStudio, /atomicWriteJson/, "course metadata updates must be atomic");
rejectPattern(academyStudio, /exec\s*\(/, "arbitrary command execution is prohibited");
for (const functionName of ["previewCourse", "previewMaterials", "previewCertificate"]) {
  requirePattern(academyPreview, new RegExp(`function\\s+${functionName}|${functionName}\\s*=`), `${functionName} must be implemented`);
}

for (const pattern of [/authorization/i, /cookie/i, /password/i, /card/i, /paymentmethod/i]) {
  requirePattern(dataProtection, pattern, `data protection rules must cover ${pattern}`);
}
requirePattern(websiteRetrieval, /parsed\.protocol !== "https:"/, "website retrieval must reject non-HTTPS connector origins");
requirePattern(websiteRetrieval, /redirect:\s*"error"/, "website retrieval must reject redirects");
requirePattern(websiteRetrieval, /MAX_RESPONSE_BYTES/, "website retrieval must bound response size");
requirePattern(endpointEnrollment, /safeStorage\.isEncryptionAvailable/, "endpoint enrollment must require Windows credential encryption");

for (const controlId of [
  "endpointState",
  "enrollEndpoint",
  "academyRefresh",
  "privacyState",
  "workspaceState",
  "academyMetrics",
  "academySearch",
  "academyFilter",
  "courseList",
  "courseDetail",
  "evidence",
  "previewDialog",
]) requirePattern(index, new RegExp(`id=["']${controlId}["']`), `Academy reset UI control ${controlId} must exist`);

requirePattern(index, /academy-reset-ui\.js/, "Academy reset renderer must be packaged");
requirePattern(index, /academy-reset\.css/, "Academy reset stylesheet must be packaged");
requirePattern(index, /Content-Security-Policy/, "Academy reset shell must define a CSP");
requirePattern(index, /connect-src 'none'/, "renderer must not make direct network connections");
rejectPattern(index, /ownerAiPanel|securityPanel|trendPanel/, "legacy broad command-center panels must not return to the Academy-only shell");
requirePattern(resetUi, /getAcademyControlSnapshot/, "Academy reset UI must load governed course-control state");
requirePattern(resetUi, /previewAcademyCourse|previewAcademyMaterials|previewAcademyCertificate/, "Academy reset UI must support governed review previews");
requirePattern(resetUi, /updateAcademyReview/, "Academy reset UI must record owner review decisions through IPC");
requirePattern(resetUi, /transitionAcademyCourse/, "Academy reset UI must use governed release transitions");
requirePattern(resetUi, /verifyAcademyPurchase/, "Academy reset UI must support secure real-purchase verification");
requirePattern(resetCss, /courseList|detailPanel|evidencePanel/, "Academy reset styling must cover owner review surfaces");

if (packageJson.private !== true) throw new Error("Command Center verification failed: package must remain private");
if (!packageJson.build || packageJson.build.publish) throw new Error("Command Center verification failed: automatic public publishing must not be configured");
if (packageJson.name !== "obserra-academy-command-center") throw new Error("Command Center verification failed: Academy product identity is incorrect");
if (!String(packageJson.build?.productName || "").includes("Obserra Academy Command Center")) throw new Error("Command Center verification failed: packaged product name is incorrect");
for (const gate of [
  "verify-academy-action-runtime.mjs",
  "verify-academy-data-protection.mjs",
  "verify-payment-control-behavior.mjs",
  "verify-credential-encryption-controls.mjs",
  "verify-academy-website-retrieval.mjs",
  "verify-control-manifest.mjs",
  "verify-green-path-locks.mjs",
]) {
  if (!String(packageJson.scripts?.verify || "").includes(gate)) throw new Error(`Command Center verification failed: ${gate} must be part of the release gate`);
}
for (const requiredFile of ["electron/**/*", "src/**/*", "scripts/**/*"]) {
  if (!packageJson.build.files?.includes(requiredFile)) throw new Error(`Command Center verification failed: package must include ${requiredFile}`);
}

const resources = connectorCatalog.resources;
if (!Array.isArray(resources) || resources.length === 0) throw new Error("Command Center verification failed: approved resource catalog is missing or empty");
if (!String(connectorCatalog.defaultControlMode ?? "").toLowerCase().includes("read")) throw new Error("Command Center verification failed: default control mode must be read-only");
for (const resource of resources) {
  if (!resource.id || !resource.name || !resource.type) throw new Error("Command Center verification failed: every resource requires an id, name, and type");
  if (resource.writeCapabilitiesRequireOwnerApproval !== true) throw new Error(`Command Center verification failed: resource ${resource.id} must require owner approval for writes`);
  if (!Array.isArray(resource.capabilities) || resource.capabilities.length === 0) throw new Error(`Command Center verification failed: resource ${resource.id} must declare capabilities`);
}

console.log(`[Obserra Academy Command Center] Local-only security, privacy, Academy reset, connector, and owner-control verification passed for ${resources.length} approved resource(s).`);
