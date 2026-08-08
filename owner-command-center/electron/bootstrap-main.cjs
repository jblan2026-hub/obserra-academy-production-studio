const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const APP_ID = "com.obserra.ownercommandcenter";
const BOOTSTRAP_FILE = "Obserra-Command-Center-Bootstrap.json";

if (typeof app.setAppUserModelId === "function") {
  app.setAppUserModelId(APP_ID);
}

function packagedBootstrapCandidates() {
  const candidates = [
    process.env.OBSERRA_COMMAND_CENTER_BOOTSTRAP,
    path.join(path.dirname(process.execPath), BOOTSTRAP_FILE),
    process.resourcesPath ? path.join(process.resourcesPath, BOOTSTRAP_FILE) : null,
    path.join(app.getAppPath(), BOOTSTRAP_FILE),
    path.join(app.getAppPath(), "resources", BOOTSTRAP_FILE),
  ].filter(Boolean);
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

if (!process.env.OBSERRA_COMMAND_CENTER_BOOTSTRAP) {
  const packagedBootstrap = packagedBootstrapCandidates().find((candidate) => fs.existsSync(candidate));
  if (packagedBootstrap) {
    process.env.OBSERRA_COMMAND_CENTER_BOOTSTRAP = packagedBootstrap;
  }
}

require("./main-with-remediation.cjs");
