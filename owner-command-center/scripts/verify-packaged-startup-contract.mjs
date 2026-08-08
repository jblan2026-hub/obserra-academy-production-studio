import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandCenterRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(commandCenterRoot, "package.json"), "utf8"),
);
const bootstrap = fs.readFileSync(
  path.join(commandCenterRoot, "electron", "bootstrap-main.cjs"),
  "utf8",
);
const mainWithRemediation = fs.readFileSync(
  path.join(commandCenterRoot, "electron", "main-with-remediation.cjs"),
  "utf8",
);
const main = fs.readFileSync(
  path.join(commandCenterRoot, "electron", "main.cjs"),
  "utf8",
);

assert.equal(packageJson.version, "0.4.1");
assert.equal(packageJson.main, "electron/bootstrap-main.cjs");
assert.equal(packageJson.build.asar, true);
assert.equal(packageJson.build.compression, "normal");
assert.equal(packageJson.build.nsis.createDesktopShortcut, "always");
assert.equal(packageJson.build.nsis.createStartMenuShortcut, true);
assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, true);
assert.equal(packageJson.build.nsis.runAfterFinish, true);

assert.match(bootstrap, /await import\("electron-store"\)/);
assert.match(bootstrap, /installElectronStoreCompatibility/);
assert.match(bootstrap, /request === "electron-store"/);
assert.match(bootstrap, /require\("\.\/main-with-remediation\.cjs"\)/);
assert.match(bootstrap, /OBSERRA_STARTUP_SMOKE_TEST/);
assert.match(bootstrap, /startup-health\.json/);
assert.match(bootstrap, /rendererRecoveryAttempts/);
assert.match(bootstrap, /primary-window-ready/);
assert.match(bootstrap, /createSplashWindow/);
assert.match(mainWithRemediation, /require\("electron-store"\)/);
assert.match(main, /require\("electron-store"\)/);

const importIndex = bootstrap.indexOf('await import("electron-store")');
const mainIndex = bootstrap.indexOf('require("./main-with-remediation.cjs")');
assert.ok(importIndex >= 0 && mainIndex > importIndex);

console.log(
  JSON.stringify(
    {
      gate: "packaged-startup-contract",
      version: packageJson.version,
      electronStoreEsmCompatibility: true,
      persistentDesktopShortcut: true,
      startMenuShortcut: true,
      selectableInstallDirectory: true,
      startupHealthTelemetry: true,
      startupSplash: true,
      rendererSingleRecoveryAttempt: true,
      normalCompressionForFasterInstall: true,
      passed: true,
    },
    null,
    2,
  ),
);
