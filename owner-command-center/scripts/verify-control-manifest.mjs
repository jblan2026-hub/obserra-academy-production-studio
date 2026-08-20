import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const manifestPath = path.join(repoRoot, "policy", "academy-command-center-control-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const registerPath = path.join(repoRoot, manifest.documentation);

assert.ok(Array.isArray(manifest.controls) && manifest.controls.length > 0, "Control manifest must contain controls");
assert.ok(fs.existsSync(registerPath), `Audit register is missing: ${manifest.documentation}`);
const register = fs.readFileSync(registerPath, "utf8");

for (const control of manifest.controls) {
  assert.match(String(control.id || ""), /^ACC-\d{3}$/);
  assert.ok(control.name, `${control.id} must have a name`);
  assert.match(register, new RegExp(`\\| ${control.id.replace("-", "\\-")} \\|`), `${control.id} is missing from the audit register`);
  for (const relativePath of control.implementation || []) {
    assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), `${control.id} implementation is missing: ${relativePath}`);
  }
  for (const relativePath of control.verification || []) {
    assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), `${control.id} verification is missing: ${relativePath}`);
  }
  if (control.required === true && (control.implementation || []).length === 0 && !control.externalImplementation) {
    throw new Error(`${control.id} is required but has no implementation reference`);
  }
}

console.log(`Academy Command Center audit manifest verification passed for ${manifest.controls.length} controls.`);
