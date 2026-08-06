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
console.log("[Owner Command Center] Installer configuration verified: one-click NSIS and removable-media portable targets enabled.");
