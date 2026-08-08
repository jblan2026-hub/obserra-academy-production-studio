import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const provider = (process.env.ACADEMY_AUTHORING_PROVIDER || "openai").toLowerCase();
const force = process.argv.includes("--force");
const requestedLimit = Number(process.env.ACADEMY_AUTHORING_BATCH_LIMIT || 0);
const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
  ? requestedLimit
  : Number.POSITIVE_INFINITY;

if (provider === "openai" && !process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required for batch course generation");
}
if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required for batch course generation");
}

function runCourse(courseId) {
  return new Promise((resolve) => {
    const args = [
      path.join(root, "studio", "author-course-with-checkpoint.mjs"),
      "--course",
      courseId,
      "--provider",
      provider,
    ];
    if (force) args.push("--force");
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", (error) => resolve({
      courseId,
      ok: false,
      error: error.message,
    }));
    child.on("close", (code) => resolve({
      courseId,
      ok: code === 0,
      exitCode: code,
    }));
  });
}

const candidates = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(
    coursesRoot,
    courseId,
    "course-manifest.json",
  )))
  .filter((courseId) => force || !fs.existsSync(path.join(
    coursesRoot,
    courseId,
    "generated",
    "authoring",
    "course-package.json",
  )))
  .slice(0, limit);

if (!candidates.length) {
  console.log("[Academy Studio] No pending courses require governed commercial authoring.");
  process.exit(0);
}

const results = [];
for (const [index, courseId] of candidates.entries()) {
  console.log(`[Academy Studio] Authoring, enriching, and checkpointing ${index + 1}/${candidates.length}: ${courseId}`);
  const result = await runCourse(courseId);
  results.push(result);
  if (!result.ok) {
    fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "catalog", "authoring-batch-result.json"),
      `${JSON.stringify({
        provider,
        completedAt: new Date().toISOString(),
        results,
      }, null, 2)}\n`,
    );
    throw new Error(`Governed commercial course authoring failed for ${courseId}`);
  }
}

fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(
  path.join(root, "catalog", "authoring-batch-result.json"),
  `${JSON.stringify({
    provider,
    completedAt: new Date().toISOString(),
    generated: results.length,
    implementationGuidanceRequired: true,
    checkpointRequired: true,
    results,
  }, null, 2)}\n`,
);
console.log(`[Academy Studio] Generated, implementation-enriched, and checkpointed ${results.length} governed course package(s).`);
