import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wrapper = fs.readFileSync(path.join(root, "electron", "main-with-remediation.cjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function requireMarker(marker, description) {
  if (!wrapper.includes(marker)) {
    throw new Error(`Command Center runtime governance is missing ${description}: ${marker}`);
  }
}

for (const [marker, description] of [
  ["app.requestSingleInstanceLock", "single-instance locking"],
  ["second-instance", "existing-window focus handling"],
  ["app.setAppUserModelId", "stable Windows application identity"],
  ["runtime-evidence.jsonl", "owner-local runtime evidence"],
  ["uncaughtExceptionMonitor", "main-process exception evidence"],
  ["unhandledRejection", "unhandled rejection fail-closed handling"],
  ["app.exit(1)", "fail-closed rejection exit"],
  ["SENSITIVE_FIELD", "sensitive-field classification"],
  ["redactRuntimeText", "runtime text redaction"],
  ["sanitizeRuntimeDetail", "recursive runtime detail sanitization"],
  ["Bearer [REDACTED]", "authorization redaction"],
  ["[REDACTED_API_KEY]", "API-key redaction"],
  ["[REDACTED_LONG_VALUE]", "long-token redaction"],
  ["mode: 0o600", "restricted runtime evidence permissions"],
]) {
  requireMarker(marker, description);
}

for (const prohibited of [
  "error.stack",
  "reason.stack",
  "authorization: error",
  "credential: error",
]) {
  if (wrapper.includes(prohibited)) {
    throw new Error(`Command Center runtime governance contains prohibited raw evidence logging: ${prohibited}`);
  }
}

if (packageJson.author?.name !== "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC") {
  throw new Error("Command Center package author metadata is missing or incorrect.");
}
if (packageJson.license !== "UNLICENSED") {
  throw new Error("Owner-only Command Center package must remain UNLICENSED.");
}
if (packageJson.packageManager !== "npm@10.9.8") {
  throw new Error("Command Center package manager must be pinned to npm 10.9.8.");
}
if (packageJson.engines?.node !== ">=22 <23" || packageJson.engines?.npm !== ">=10 <11") {
  throw new Error("Command Center build engines must remain constrained to Node 22 and npm 10.");
}
if (packageJson.build?.appId !== "com.obserra.ownercommandcenter") {
  throw new Error("Command Center application identity is inconsistent with the runtime AppUserModelID.");
}

console.log("[Owner Command Center] Single-instance startup, fail-closed runtime evidence, secret redaction, and deterministic build identity verified.");
