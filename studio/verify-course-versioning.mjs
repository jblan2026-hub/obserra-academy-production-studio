import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const policy = JSON.parse(fs.readFileSync(path.join(root, "policy", "academy-course-versioning.json"), "utf8"));
const semver = /^[1-9]\d*\.\d+\.\d+$/;

let count = 0;
const failures = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  count += 1;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const version = String(manifest.release?.version || "");
  if (!semver.test(version)) failures.push(`${entry.name}: invalid or pre-v1 release version ${version || "missing"}`);
}
if (count !== 61) failures.push(`expected 61 course manifests; found ${count}`);
if (failures.length) throw new Error(`Academy course version verification failed:\n${failures.join("\n")}`);
console.log(`Academy course versioning passed: ${count}/61 courses use SemVer >= 1.0.0 under ${policy.policyId}.`);
