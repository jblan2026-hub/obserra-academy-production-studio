import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  checkpointsRequired,
  persistHollywoodCheckpoint,
} from "./academy-hollywood-checkpoints.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course");
const provider = arg("--provider") || process.env.ACADEMY_AUTHORING_PROVIDER || "openai";
const force = process.argv.includes("--force");
const persistenceAttempts = 3;

if (!courseId) {
  console.error("Usage: node studio/author-course-hollywood-with-checkpoint.mjs --course <course-id> [--provider provider] [--force]");
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAuthoringProcess() {
  return new Promise((resolve, reject) => {
    const args = ["studio/author-course-hollywood.mjs", "--course", courseId, "--provider", provider];
    if (force) args.push("--force");
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });

    const forwardSignal = (signal) => {
      if (child.exitCode === null && !child.killed) child.kill(signal);
    };
    const onSigterm = () => forwardSignal("SIGTERM");
    const onSigint = () => forwardSignal("SIGINT");
    process.once("SIGTERM", onSigterm);
    process.once("SIGINT", onSigint);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);
      resolve({ code, signal });
    });
  });
}

async function persistGeneratedPackage() {
  const manifestPath = path.join(root, "courses", courseId, "course-manifest.json");
  const packagePath = path.join(root, "courses", courseId, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) {
    throw new Error(`Generated cinematic package or manifest is missing for ${courseId}.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  for (let attempt = 1; attempt <= persistenceAttempts; attempt += 1) {
    try {
      const result = await persistHollywoodCheckpoint({ courseId, envelope, manifest });
      if (!result.stored && checkpointsRequired()) {
        throw new Error(`Checkpoint persistence was required but skipped: ${result.reason}.`);
      }
      console.log(result.stored
        ? `[Academy Studio] Protected cinematic checkpoint stored for ${courseId}.`
        : `[Academy Studio] Cinematic checkpoint skipped for ${courseId}: ${result.reason}.`);
      return;
    } catch (error) {
      if (attempt >= persistenceAttempts) throw error;
      const waitMs = 2_000 * (2 ** (attempt - 1));
      console.warn(`[Academy Studio] Cinematic checkpoint attempt ${attempt}/${persistenceAttempts} failed for ${courseId}; retrying in ${waitMs} ms.`);
      await delay(waitMs);
    }
  }
}

try {
  const authoring = await runAuthoringProcess();
  if (authoring.code !== 0) {
    if (authoring.signal) console.error(`[Academy Studio] Cinematic authoring for ${courseId} ended with signal ${authoring.signal}.`);
    process.exit(authoring.code ?? 1);
  }
  await persistGeneratedPackage();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Academy Studio] HOLLYWOOD_AUTHORING_CHECKPOINT_FAILURE course=${courseId} required=${checkpointsRequired()}: ${message.replace(/\s+/g, " ").slice(0, 1600)}`);
  process.exit(45);
}
