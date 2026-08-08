import "./academy-zero-cost-lock.mjs";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const courseId = arg("--course");
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error("Usage: node studio/render-canary-course-local-media.mjs --course <course-id>");
}

const targetManifest = path.join(coursesRoot, courseId, "course-manifest.json");
if (!fs.existsSync(targetManifest)) throw new Error(`Canary course manifest not found for ${courseId}.`);

const renamed = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === courseId) continue;
  const manifest = path.join(coursesRoot, entry.name, "course-manifest.json");
  if (!fs.existsSync(manifest)) continue;
  const disabled = path.join(coursesRoot, entry.name, ".course-manifest.canary-disabled.json");
  if (fs.existsSync(disabled)) throw new Error(`Unexpected existing canary manifest placeholder: ${disabled}`);
  fs.renameSync(manifest, disabled);
  renamed.push({ manifest, disabled });
}

const previousExpected = process.env.ACADEMY_EXPECTED_SURGE_COURSES;
process.env.ACADEMY_EXPECTED_SURGE_COURSES = "1";

try {
  await import(`./render-all-61-local-media.mjs?canary=${encodeURIComponent(courseId)}-${Date.now()}`);
  console.log(`[Academy Studio] Completed isolated local media rendering for canary course ${courseId}.`);
} finally {
  if (previousExpected === undefined) delete process.env.ACADEMY_EXPECTED_SURGE_COURSES;
  else process.env.ACADEMY_EXPECTED_SURGE_COURSES = previousExpected;

  for (const { manifest, disabled } of renamed.reverse()) {
    if (fs.existsSync(disabled)) fs.renameSync(disabled, manifest);
  }
}
