const { spawn } = require("node:child_process");
const path = require("node:path");
const { resolveStudioRoot } = require("./academy-studio.cjs");

function assertCourseId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(value)) throw new Error("Invalid course identifier");
  return value;
}

function reviseCourseWithAI(courseId) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable");
  const id = assertCourseId(courseId);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(npmCommand, ["run", "author:course", "--", "--course", id, "--force"], {
      cwd: root,
      env: { ...process.env },
      windowsHide: true,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-100000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-100000); });
    child.on("error", (error) => resolve({ ok: false, action: "revise", courseId: id, startedAt, completedAt: new Date().toISOString(), exitCode: null, stdout, stderr: error.message }));
    child.on("close", (exitCode) => resolve({ ok: exitCode === 0, action: "revise", courseId: id, startedAt, completedAt: new Date().toISOString(), exitCode, stdout, stderr }));
  });
}

module.exports = { reviseCourseWithAI };
