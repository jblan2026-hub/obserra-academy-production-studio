import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  checkpointsRequired,
  persistAuthoringCheckpoint,
} from "./authoring-checkpoints.mjs";
import { AUTHORING_EXIT_CODES } from "./authoring-provider-errors.mjs";

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
  console.error("Usage: node studio/author-course-with-checkpoint.mjs --course <course-id> [--provider provider] [--force]");
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runGovernedProcess(scriptName, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [scriptName, "--course", courseId, "--provider", provider, ...extraArgs];
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
      resolve({ code, signal, scriptName });
    });
  });
}

async function persistGeneratedPackage() {
  const manifestPath = path.join(root, "courses", courseId, "course-manifest.json");
  const packagePath = path.join(root, "courses", courseId, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) {
    throw new Error(`Generated authoring package or manifest is missing for ${courseId}.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  for (let attempt = 1; attempt <= persistenceAttempts; attempt += 1) {
    try {
      const result = await persistAuthoringCheckpoint({ courseId, envelope, manifest });
      if (result.stored) {
        console.log(`[Academy Studio] Protected authoring checkpoint stored for ${courseId}.`);
      } else {
        console.log(`[Academy Studio] Authoring checkpoint skipped for ${courseId}: ${result.reason}.`);
      }
      return;
    } catch (error) {
      if (attempt >= persistenceAttempts) throw error;
      const waitMs = 2_000 * (2 ** (attempt - 1));
      console.warn(`[Academy Studio] Checkpoint persistence attempt ${attempt}/${persistenceAttempts} failed for ${courseId}; retrying in ${waitMs} ms.`);
      await delay(waitMs);
    }
  }
}

function stopForChildFailure(result, label) {
  if (result.code === 0) return false;
  if (result.signal) {
    console.error(`[Academy Studio] ${label} for ${courseId} ended with signal ${result.signal}.`);
  }
  process.exit(result.code ?? 1);
  return true;
}

try {
  const authoringArgs = force ? ["--force"] : [];
  const authoring = await runGovernedProcess("studio/author-course-ai.mjs", authoringArgs);
  if (stopForChildFailure(authoring, "Base commercial course authoring")) process.exit();

  const implementation = await runGovernedProcess(
    "studio/enrich-commercial-implementation-guidance.mjs",
  );
  if (stopForChildFailure(
    implementation,
    "Real-world case and implementation-guidance enrichment",
  )) process.exit();

  await persistGeneratedPackage();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Academy Studio] AUTHORING_CHECKPOINT_FAILURE course=${courseId} required=${checkpointsRequired()}: ${message.replace(/\s+/g, " ").slice(0, 1600)}`);
  process.exit(AUTHORING_EXIT_CODES.CHECKPOINT_PERSISTENCE_FAILED);
}
