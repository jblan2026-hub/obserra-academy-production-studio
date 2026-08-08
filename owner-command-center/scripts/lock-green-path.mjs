import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const registryPath = path.join(repoRoot, "policy", "academy-green-path-locks.json");
const controlManifestPath = path.join(repoRoot, "policy", "academy-command-center-control-manifest.json");

const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".ps1", ".ts", ".tsx", ".txt", ".yml", ".yaml",
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function canonicalBytes(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return bytes;
  const text = bytes.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return Buffer.from(text, "utf8");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(canonicalBytes(filePath)).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

const controlId = String(process.argv[2] || "").trim();
if (!controlId) fail("Usage: node scripts/lock-green-path.mjs <CONTROL_ID>");
if (process.env.OBSERRA_OWNER_APPROVE_GREEN_LOCK !== "LOCK GREEN PATH") {
  fail("Owner approval missing. Set OBSERRA_OWNER_APPROVE_GREEN_LOCK exactly to: LOCK GREEN PATH");
}
const verificationEvidence = String(process.env.OBSERRA_GREEN_VERIFICATION_EVIDENCE || "").trim();
const ownerApprovalReference = String(process.env.OBSERRA_GREEN_OWNER_APPROVAL_REFERENCE || "").trim();
const reason = String(process.env.OBSERRA_GREEN_LOCK_REASON || "").trim();
if (!verificationEvidence) fail("OBSERRA_GREEN_VERIFICATION_EVIDENCE is required.");
if (!ownerApprovalReference) fail("OBSERRA_GREEN_OWNER_APPROVAL_REFERENCE is required.");
if (!reason) fail("OBSERRA_GREEN_LOCK_REASON is required.");

const status = git("status", "--porcelain");
if (status) fail("Working tree must be clean before freezing a green path.");

const manifest = JSON.parse(fs.readFileSync(controlManifestPath, "utf8"));
const control = manifest.controls.find((item) => item.id === controlId);
if (!control) fail(`Unknown control ID: ${controlId}`);
const files = [...new Set([...(control.implementation || []), ...(control.verification || [])])];
if (files.length === 0) fail(`Control ${controlId} has no implementation or verification files.`);

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
if (registry.locks.some((item) => item.id === controlId && item.state === "frozen")) {
  fail(`Control ${controlId} is already frozen. Re-baselining requires an explicit registry change retaining Git history.`);
}

const protectedFiles = files.map((relativePath) => {
  const absolute = path.resolve(repoRoot, relativePath);
  if (!absolute.startsWith(`${repoRoot}${path.sep}`)) fail(`Path escapes repository root: ${relativePath}`);
  if (!fs.existsSync(absolute)) fail(`Cannot freeze missing path: ${relativePath}`);
  return {
    path: relativePath.replaceAll("\\", "/"),
    sha256: sha256File(absolute),
    hashMode: TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase()) ? "canonical-utf8-lf" : "raw-bytes",
  };
});

registry.locks.push({
  id: controlId,
  name: control.name,
  state: "frozen",
  greenCommit: git("rev-parse", "HEAD"),
  verificationEvidence,
  ownerApprovalReference,
  reason,
  lockedAt: new Date().toISOString(),
  files: protectedFiles,
});

fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
console.log(`Frozen ${controlId} with ${protectedFiles.length} file(s) using canonical text hashing and raw binary hashing. Commit the updated lock registry to activate the immutable baseline.`);
