import { spawnSync } from "node:child_process";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course");
const finalRequested = process.argv.includes("--final");

if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  console.error("Usage: node studio/build-course-workflow.mjs --course <course-id> [--final]");
  process.exit(1);
}

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

run("studio/apply-course-policy.mjs");
run("studio/build-all-courses.mjs");
run("studio/materialize-commercial-implementation-guidance.mjs", ["--course", courseId]);
run("studio/enforce-course-legal-assets.mjs");
run(
  "studio/build-course.mjs",
  ["--course", courseId, ...(finalRequested ? ["--final"] : [])],
);

console.log(
  `[Academy Studio] Governed ${finalRequested ? "FINAL" : "COMPLIANCE-STAGED"} build workflow completed for ${courseId}.`,
);
