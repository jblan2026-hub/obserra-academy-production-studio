import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required Command Center file is missing: ${relativePath}`);
  }
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
const index = read("src/index.html");
const renderer = read("src/app.js");
const styles = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));
const connectorCatalog = JSON.parse(read("policy/connector-catalog.json"));

requirePattern(main, /contextIsolation:\s*true/, "Electron context isolation must be enabled");
requirePattern(main, /nodeIntegration:\s*false/, "renderer Node integration must be disabled");
requirePattern(main, /sandbox:\s*true/, "renderer sandbox must be enabled");
requirePattern(main, /webSecurity:\s*true/, "Electron web security must be enabled");
requirePattern(main, /setPermissionRequestHandler[\s\S]*callback\(false\)/, "renderer permissions must be denied by default");
requirePattern(main, /setWindowOpenHandler[\s\S]*action:\s*["']deny["']/, "new-window creation must be denied");
requirePattern(main, /will-navigate/, "navigation interception must be configured");
requirePattern(main, /file:\/\//, "renderer navigation must remain restricted to packaged local files");
requirePattern(main, /safeStorage\.encryptString/, "secrets must use Windows-backed safeStorage encryption");
requirePattern(main, /safeStorage\.decryptString/, "encrypted secrets must support controlled decryption");
rejectPattern(main, /\.listen\s*\(/, "the desktop application must not open an inbound HTTP listener");
rejectPattern(main, /0\.0\.0\.0|::0|::1\s*[,)]/, "the desktop application must not bind a public listener");
rejectPattern(main, /nodeIntegration:\s*true/, "renderer Node integration cannot be enabled");
rejectPattern(main, /contextIsolation:\s*false/, "context isolation cannot be disabled");
rejectPattern(main, /webSecurity:\s*false/, "web security cannot be disabled");
rejectPattern(main, /executeJavaScript\s*\(/, "arbitrary renderer code execution is prohibited");

requirePattern(preload, /contextBridge\.exposeInMainWorld/, "renderer APIs must use a constrained context bridge");
rejectPattern(preload, /require\(["']node:(fs|child_process|net|http|https)|require\(["'](fs|child_process|net|http|https)/, "preload must not expose raw filesystem, process, or network modules");

for (const channel of [
  "academy:getSnapshot",
  "academy:updateCourse",
  "academy:runAction",
  "academy:getPreview",
  "academy:getMaterialPreview",
  "academy:getCertificatePreview"
]) {
  requirePattern(main, new RegExp(channel.replace(":", "\\:")), `main process must register ${channel}`);
}

for (const bridgeMethod of [
  "getAcademySnapshot",
  "updateAcademyCourse",
  "runAcademyAction",
  "getAcademyPreview",
  "getAcademyMaterialPreview",
  "getAcademyCertificatePreview"
]) {
  requirePattern(preload, new RegExp(`${bridgeMethod}\\s*:`), `preload bridge must expose ${bridgeMethod}`);
}

requirePattern(academyStudio, /ALLOWED_ACTIONS/, "Studio actions must be allowlisted");
requirePattern(academyStudio, /author-all/, "batch course generation must be supported");
requirePattern(academyStudio, /build-all/, "batch release building must be supported");
requirePattern(academyStudio, /shell:\s*false/, "Studio commands must execute without a shell");
requirePattern(academyStudio, /atomicWriteJson/, "course metadata updates must be atomic");
rejectPattern(academyStudio, /exec\s*\(/, "arbitrary command execution is prohibited");

requirePattern(academyPreview, /getCoursePreview/, "course preview service must be implemented");
requirePattern(academyPreview, /getMaterialPreview/, "material preview service must be implemented");
requirePattern(academyPreview, /getCertificatePreview/, "certificate preview service must be implemented");
requirePattern(academyPreview, /path\.resolve/, "preview paths must be normalized");

for (const controlId of [
  "academyGenerateAll",
  "academyBuildAll",
  "academyVerify",
  "academyCatalog",
  "academyPreviewDialog"
]) {
  requirePattern(index, new RegExp(`id=["']${controlId}["']`), `UI control ${controlId} must exist`);
}

for (const action of [
  "preview-course",
  "preview-materials",
  "preview-certificate",
  "ai-revise",
  "author",
  "build",
  "edit"
]) {
  requirePattern(index, new RegExp(`data-action=["']${action}["']`), `course action ${action} must exist`);
}

requirePattern(renderer, /runAcademyAction\("author-all"/, "Generate all pending must invoke the governed batch authoring action");
requirePattern(renderer, /runAcademyAction\("build-all"/, "Build all ready must invoke the governed batch build action");
requirePattern(renderer, /getAcademyPreview/, "renderer must invoke course preview through the bridge");
requirePattern(renderer, /getAcademyMaterialPreview/, "renderer must invoke material preview through the bridge");
requirePattern(renderer, /getAcademyCertificatePreview/, "renderer must invoke certificate preview through the bridge");
requirePattern(renderer, /runAcademyAction\("author"[\s\S]*force|ai-revise/, "AI revision must be wired to governed course regeneration");
requirePattern(styles, /previewDialog|previewModal|academyPreview/, "preview interface styling must be packaged");

if (packageJson.private !== true) throw new Error("Command Center verification failed: package must remain private");
if (!packageJson.build || packageJson.build.publish) throw new Error("Command Center verification failed: automatic public publishing must not be configured");
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

console.log(`[Owner Command Center] Security and Academy Operations verification passed for ${resources.length} approved resource(s).`);
