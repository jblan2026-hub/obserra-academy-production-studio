import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const lockPath = path.join(repoRoot, "policy", "academy-green-path-locks.json");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const registry = JSON.parse(fs.readFileSync(lockPath, "utf8"));
assert.equal(registry.schemaVersion, "1.0");
assert.equal(registry.rebaseline?.ownerApprovalRequired, true);
assert.equal(registry.rebaseline?.reasonRequired, true);
assert.equal(registry.rebaseline?.verificationEvidenceRequired, true);
assert.equal(registry.rebaseline?.silentHashRefreshForbidden, true);
assert.ok(Array.isArray(registry.locks));

const lockIds = new Set();
for (const lock of registry.locks) {
  assert.equal(lock.state, "frozen", `Lock ${lock.id || "unknown"} must be frozen.`);
  assert.ok(lock.id && !lockIds.has(lock.id), `Duplicate green-path lock id: ${lock.id}`);
  lockIds.add(lock.id);
  assert.ok(lock.greenCommit, `Lock ${lock.id} is missing greenCommit.`);
  assert.ok(lock.verificationEvidence, `Lock ${lock.id} is missing verificationEvidence.`);
  assert.ok(lock.ownerApprovalReference, `Lock ${lock.id} is missing ownerApprovalReference.`);
  assert.ok(lock.lockedAt, `Lock ${lock.id} is missing lockedAt.`);
  assert.ok(Array.isArray(lock.files) && lock.files.length > 0, `Lock ${lock.id} has no protected files.`);

  const seen = new Set();
  for (const entry of lock.files) {
    assert.ok(entry.path && entry.sha256, `Lock ${lock.id} contains an incomplete file record.`);
    assert.ok(!seen.has(entry.path), `Lock ${lock.id} repeats ${entry.path}.`);
    seen.add(entry.path);
    const absolute = path.resolve(repoRoot, entry.path);
    assert.ok(absolute.startsWith(`${repoRoot}${path.sep}`), `Lock ${lock.id} escapes repository root: ${entry.path}`);
    assert.ok(fs.existsSync(absolute), `Frozen path was removed: ${entry.path}`);
    const actual = sha256File(absolute);
    assert.equal(actual, entry.sha256, `FROZEN PATH DRIFT: ${entry.path}. Re-baseline only through an explicit owner-approved green-path lock update.`);
  }
}

console.log(`Green-path immutability verification passed: ${registry.locks.length} frozen lock(s) checked.`);
