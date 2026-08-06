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
  if (!pattern.test(content)) {
    throw new Error(`Local-only verification failed: ${description}`);
  }
}

function rejectPattern(content, pattern, description) {
  if (pattern.test(content)) {
    throw new Error(`Local-only verification failed: ${description}`);
  }
}

const main = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const packageJson = JSON.parse(read("package.json"));
const connectorCatalog = JSON.parse(read("policy/connector-catalog.json"));

requirePattern(main, /contextIsolation:\s*true/, "Electron context isolation must be enabled");
requirePattern(main, /nodeIntegration:\s*false/, "renderer Node integration must be disabled");
requirePattern(main, /sandbox:\s*true/, "renderer sandbox must be enabled");
requirePattern(main, /webSecurity:\s*true/, "Electron web security must be enabled");
requirePattern(main, /setPermissionRequestHandler\([^)]*=>\s*callback\(false\)\)/s, "all renderer permission requests must be denied by default");
requirePattern(main, /setWindowOpenHandler\([^)]*=>\s*\(\{\s*action:\s*["']deny["']\s*\}\)\)/s, "new-window creation must be denied");
requirePattern(main, /will-navigate/, "navigation interception must be configured");
requirePattern(main, /file:\/\//, "renderer navigation must remain restricted to packaged local files");
requirePattern(main, /safeStorage\.encryptString/, "secrets must use Windows-backed Electron safeStorage encryption");
requirePattern(main, /safeStorage\.decryptString/, "encrypted secrets must support controlled decryption");
requirePattern(main, /readOnly|read-only/i, "new connector capabilities must default to read-only control");

rejectPattern(main, /\.listen\s*\(/, "the desktop application must not open an inbound HTTP listener");
rejectPattern(main, /0\.0\.0\.0|::0|::1\s*[,)]/, "the desktop application must not bind a public or network listener");
rejectPattern(main, /nodeIntegration:\s*true/, "renderer Node integration cannot be enabled");
rejectPattern(main, /contextIsolation:\s*false/, "context isolation cannot be disabled");
rejectPattern(main, /webSecurity:\s*false/, "web security cannot be disabled");
rejectPattern(main, /executeJavaScript\s*\(/, "arbitrary renderer code execution is prohibited");

requirePattern(preload, /contextBridge\.exposeInMainWorld/, "renderer APIs must be exposed through a constrained context bridge");
rejectPattern(preload, /require\(["']node:(fs|child_process|net|http|https)|require\(["'](fs|child_process|net|http|https)/, "the preload bridge must not expose raw filesystem, process, or network modules");

if (packageJson.private !== true) {
  throw new Error("Local-only verification failed: package must remain private");
}
if (!packageJson.build || packageJson.build.publish) {
  throw new Error("Local-only verification failed: automatic public publishing must not be configured");
}
if (!Array.isArray(connectorCatalog.connectors) || connectorCatalog.connectors.length === 0) {
  throw new Error("Local-only verification failed: approved connector catalog is missing or empty");
}

for (const connector of connectorCatalog.connectors) {
  if (!connector.id || !connector.name) {
    throw new Error("Local-only verification failed: every connector requires an id and name");
  }
  const mode = String(connector.defaultMode ?? connector.mode ?? "").toLowerCase();
  if (!mode.includes("read")) {
    throw new Error(`Local-only verification failed: connector ${connector.id} must default to read-only mode`);
  }
}

console.log(`[Owner Command Center] Local-only security verification passed for ${connectorCatalog.connectors.length} approved connector(s).`);
