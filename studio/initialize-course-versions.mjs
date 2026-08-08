import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const policy = JSON.parse(fs.readFileSync(path.join(root, "policy", "academy-course-versioning.json"), "utf8"));
const initialVersion = policy.initialVersion;
const checkOnly = process.argv.includes("--check");

let found = 0;
let changed = 0;
const problems = [];

for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  found += 1;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.release || typeof manifest.release !== "object") {
    problems.push(`${entry.name}: missing release block`);
    continue;
  }
  const current = String(manifest.release.version || "");
  if (current === initialVersion) continue;
  if (checkOnly) {
    problems.push(`${entry.name}: expected ${initialVersion}, found ${current || "missing"}`);
    continue;
  }
  if (["published", "approved"].includes(String(manifest.release.status || "").toLowerCase()) && current && current !== initialVersion) {
    throw new Error(`${entry.name}: refusing to rewrite an approved/published version ${current} to ${initialVersion}`);
  }
  manifest.release.version = initialVersion;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  changed += 1;
}

if (problems.length) {
  throw new Error(`Academy version initialization check failed:\n${problems.join("\n")}`);
}
if (found !== 61) throw new Error(`Expected 61 Academy course manifests; found ${found}.`);
console.log(checkOnly
  ? `Academy version baseline verified: ${found}/61 courses are ${initialVersion}.`
  : `Academy version baseline initialized: ${changed} changed, ${found}/61 total, version ${initialVersion}.`);
