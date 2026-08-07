import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const validatorPath = path.join(root, "studio", "validate-ai-native-course.mjs");

if (!fs.existsSync(coursesRoot)) {
  console.error(`[Academy Studio] Missing courses directory: ${coursesRoot}`);
  process.exit(1);
}

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
    if (!fs.existsSync(manifestPath)) return [];
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return manifest.course?.aiNative === true ? [entry.name] : [];
  })
  .sort();

if (courseIds.length === 0) {
  console.log("[Academy Studio] No AI-native courses require validation.");
  process.exit(0);
}

let failed = false;
for (const courseId of courseIds) {
  console.log(`[Academy Studio] Validating AI-native course ${courseId}`);
  const result = spawnSync(process.execPath, [validatorPath, "--course", courseId], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    console.error(`[Academy Studio] Failed to start validator for ${courseId}: ${result.error.message}`);
    failed = true;
  } else if (result.status !== 0) {
    console.error(`[Academy Studio] AI-native validation failed for ${courseId}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`[Academy Studio] Validated ${courseIds.length} AI-native course(s).`);
