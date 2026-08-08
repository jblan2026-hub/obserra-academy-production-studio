import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const read = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Required Command Center file is missing: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
};
const requirePattern = (content, pattern, description) => { if (!pattern.test(content)) throw new Error(`Command Center verification failed: ${description}`); };
const rejectPattern = (content, pattern, description) => { if (pattern.test(content)) throw new Error(`Command Center verification failed: ${description}`); };

const main = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const academyStudio = read("electron/academy-studio.cjs");
const academyPreview = read("electron/academy-preview.cjs");
const ownerAI = read("electron/owner-ai.cjs");
const discovery = read("electron/discovery.cjs");
const vulnerabilityScan = read("electron/vulnerability-scan.cjs");
const threatPolicy = read("electron/threat-policy.cjs");
const enforcement = read("electron/security-enforcement.cjs");
const trendStore = read("electron/trend-store.cjs");
const index = read("src/index.html");
const renderer = read("src/app.js");
const securityDashboard = read("src/security-dashboard.js");
const styles = read("src/styles.css");
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
  [/MONITOR_INTERVAL_MS\s*=\s*15000/, "live monitoring must run every 15 seconds"],
  [/runFullSecurityScan/, "full-site scanning must be integrated"],
  [/createSecurityEnforcement/, "mapped known-bad enforcement must be integrated"],
  [/createTrendStore/, "trend analytics must be integrated"],
  [/security:ownerOverride/, "owner override IPC must be registered"],
  [/trends:getDashboard/, "trend dashboard IPC must be registered"]
]) requirePattern(main, pattern, description);

for (const [pattern, description] of [
  [/\.listen\s*\(/, "the desktop application must not open an inbound HTTP listener"],
  [/0\.0\.0\.0|::0|::1\s*[,)]/, "the desktop application must not bind a public listener"],
  [/nodeIntegration:\s*true/, "renderer Node integration cannot be enabled"],
  [/contextIsolation:\s*false/, "context isolation cannot be disabled"],
  [/webSecurity:\s*false/, "web security cannot be disabled"],
  [/executeJavaScript\s*\(/, "arbitrary renderer code execution is prohibited"]
]) rejectPattern(main, pattern, description);

requirePattern(preload, /contextBridge\.exposeInMainWorld/, "renderer APIs must use a constrained context bridge");
for (const method of [
  "getAcademySnapshot", "updateAcademyCourse", "runAcademyAction", "previewAcademyCourse",
  "previewAcademyMaterials", "previewAcademyCertificate", "getOwnerAISnapshot", "runFullSecurityScan",
  "getSecuritySnapshot", "createOwnerOverride", "releaseOwnerOverride", "getTrendDashboard",
  "getTrendDomainHistory", "compareTrendDomain", "compareTrendSeries"
]) requirePattern(preload, new RegExp(`${method}\\s*:`), `preload bridge must expose ${method}`);
rejectPattern(preload, /require\(["']node:(fs|child_process|net|http|https)|require\(["'](fs|child_process|net|http|https)/, "preload must not expose raw filesystem, process, or network modules");

requirePattern(academyStudio, /ALLOWED_ACTIONS/, "Studio actions must be allowlisted");
requirePattern(academyStudio, /function\s+studioActionArgs/, "Studio action dispatch must validate only the selected action");
requirePattern(academyStudio, /case\s+["']author-all["'][\s\S]*return\s+\[["']run["'],\s*["']author:parallel["']\]/, "batch authoring must dispatch governed parallel portfolio authoring without requiring a single course identifier");
requirePattern(academyStudio, /case\s+["']build-all["'][\s\S]*return\s+\[["']run["'],\s*["']build:all["']\]/, "batch building must not require a single course identifier");
requirePattern(academyStudio, /ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS/, "owner Academy actions must have a governed timeout override");
requirePattern(academyStudio, /ACTION_TIMEOUT_DEFAULTS_MS/, "owner Academy actions must have action-specific timeout defaults");
requirePattern(academyStudio, /function\s+terminateChildTree/, "timed out Studio actions must terminate their child process tree");
requirePattern(academyStudio, /taskkill/, "Windows Studio process-tree termination must be implemented");
requirePattern(academyStudio, /SIGTERM/, "non-Windows Studio actions must receive graceful termination first");
requirePattern(academyStudio, /SIGKILL/, "non-Windows Studio actions must have a forced termination fallback");
requirePattern(academyStudio, /timedOut/, "Studio action results must expose timeout evidence");
requirePattern(academyStudio, /MAX_CAPTURED_OUTPUT_CHARS/, "Studio action output must remain bounded");
requirePattern(academyStudio, /shell:\s*false/, "Studio commands must execute without a shell");
requirePattern(academyStudio, /atomicWriteJson/, "course metadata updates must be atomic");
rejectPattern(academyStudio, /const\s+commandMap\s*=\s*\{/, "Studio action dispatch cannot eagerly validate unrelated course actions");
rejectPattern(academyStudio, /exec\s*\(/, "arbitrary command execution is prohibited");

for (const functionName of ["previewCourse", "previewMaterials", "previewCertificate"]) requirePattern(academyPreview, new RegExp(`function\\s+${functionName}|${functionName}\\s*=`), `${functionName} must be implemented`);
requirePattern(ownerAI, /MAX_MEMORIES/, "Owner AI must preserve durable bounded memory");
requirePattern(ownerAI, /blockedScopes/, "Owner AI must preserve governed blocking state");
requirePattern(discovery, /collectIntelligence/, "federated intelligence collection must exist");
requirePattern(discovery, /networkTopology/, "approved service topology discovery must exist");

for (const [pattern, description] of [
  [/discoverAllRoutes/, "vulnerability scanning must discover the entire internal site"],
  [/sitemap\.xml/, "sitemap discovery must be supported"],
  [/extractLinks/, "internal link crawling must be supported"],
  [/MAX_DISCOVERED_ROUTES\s*=\s*500/, "site discovery must support the 500-route workload ceiling"],
  [/api\/academy\/commerce-health/, "Academy commerce health must be scanned"],
  [/api\/webhook\/stripe/, "Stripe webhook boundary must be scanned"],
  [/npm["']?,?\s*\[?"audit"|\["audit"/, "dependency vulnerability audit must be included"],
  [/owner-approved-ai-assist/, "AI remediation proposals must require owner approval"]
]) requirePattern(vulnerabilityScan, pattern, description);

for (const identifier of ["MITRE-T1110", "OWASP-A01-2021", "OWASP-A03-2021", "OWASP-A10-2021"]) requirePattern(threatPolicy, new RegExp(identifier), `${identifier} mapping must exist`);
requirePattern(threatPolicy, /classifyResponse/, "alert, recommend, and block policy must be explicit");
requirePattern(threatPolicy, /confidence/, "automatic blocking must require confidence evidence");
requirePattern(enforcement, /automatic-block/, "known-bad automatic block evidence must be recorded");
requirePattern(enforcement, /ownerOverride/, "owner override must be implemented");
requirePattern(enforcement, /expiresAt/, "owner overrides must expire");
requirePattern(enforcement, /assertAllowed/, "blocked scopes must be enforced before writes");
requirePattern(trendStore, /recordSnapshot/, "cross-domain snapshots must be retained");
requirePattern(trendStore, /compareSnapshots/, "historical comparison must be implemented");
requirePattern(trendStore, /MAX_POINTS_PER_SERIES\s*=\s*10000/, "trend retention must support sustained operation");

for (const controlId of [
  "ownerAiPanel", "ownerAiAnalyze", "ownerAiRecommendations", "ownerAiApprovals", "securityPanel",
  "securityScanNow", "securityAlerts", "securityBlocks", "trendPanel", "trendComparisons",
  "academyGenerateAll", "academyBuildAll", "academyVerify", "academyCatalog", "academyPreviewDialog"
]) requirePattern(index, new RegExp(`id=["']${controlId}["']`), `UI control ${controlId} must exist`);
requirePattern(index, /security-dashboard\.js/, "security and trend dashboard renderer must be packaged");
requirePattern(securityDashboard, /setInterval[\s\S]*15000/, "visible intelligence dashboards must refresh every 15 seconds");
requirePattern(securityDashboard, /createOwnerOverride/, "owner override UI must be wired");
requirePattern(securityDashboard, /runFullSecurityScan/, "full-site scan UI must be wired");
requirePattern(securityDashboard, /compareTrendDomain/, "trend comparison UI must be wired");
requirePattern(renderer, /REFRESH_INTERVAL_MS\s*=\s*(15000|30000)/, "core renderer refresh interval must be defined");
requirePattern(styles, /panel|gapItem|metrics/, "dashboard styling must be packaged");

if (packageJson.private !== true) throw new Error("Command Center verification failed: package must remain private");
if (!packageJson.build || packageJson.build.publish) throw new Error("Command Center verification failed: automatic public publishing must not be configured");
if (!packageJson.scripts?.verify?.includes("verify-academy-action-runtime.mjs")) throw new Error("Command Center verification failed: Academy action runtime regression test must be part of the release gate");
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

console.log(`[Owner Command Center] Live AI, Academy, bounded action execution, vulnerability, mapped blocking, override, and trend verification passed for ${resources.length} approved resource(s).`);
