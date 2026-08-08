import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "policy", "academy-credential-and-encryption-security.json"), "utf8"));
const main = fs.readFileSync(path.join(repoRoot, "owner-command-center", "electron", "main.cjs"), "utf8");
const endpoint = fs.readFileSync(path.join(repoRoot, "owner-command-center", "electron", "endpoint-enrollment.cjs"), "utf8");

assert.equal(policy.passwords?.applicationPasswordPersistenceForbidden, true);
assert.equal(policy.passwords?.plaintextStorageForbidden, true);
assert.equal(policy.passwords?.reversiblePasswordEncryptionForbidden, true);
assert.equal(policy.passwords?.identityProviderDelegationRequired, true);
assert.equal(policy.passwords?.sha256AloneForbiddenForPasswords, true);
assert.equal(policy.secrets?.encryptionAtRestRequired, true);
assert.equal(policy.secrets?.windowsCredentialBackedEncryptionRequiredForCommandCenter, true);
assert.equal(policy.secrets?.failClosedIfEncryptionUnavailable, true);
assert.equal(policy.secrets?.plaintextSecretPersistenceForbidden, true);
assert.equal(policy.productionStorage?.fullVolumeEncryptionRequired, true);
assert.equal(policy.productionStorage?.preferredControl, "BitLocker");

assert.match(main, /safeStorage\.isEncryptionAvailable\(\)/);
assert.match(main, /safeStorage\.encryptString\(/);
assert.match(main, /safeStorage\.decryptString\(/);
assert.match(main, /store\.set\(`secrets\.\$\{key\}`\s*,\s*encryptForDevice\(value\)\)/);
assert.doesNotMatch(main, /store\.set\(`secrets\.\$\{key\}`\s*,\s*value\s*\)/);

assert.match(endpoint, /safeStorage\.isEncryptionAvailable\(\)/);
assert.match(endpoint, /safeStorage\.encryptString\(secret\)/);
assert.match(endpoint, /encryptedSecret/);
assert.match(endpoint, /Windows credential encryption is required/);

const forbiddenPasswordPersistence = [
  /store\.set\([^\n]*password/i,
  /writeFileSync\([^\n]*password/i,
  /passwordHash\s*[:=]/i,
  /passwordDigest\s*[:=]/i,
  /createHash\(["']sha256["']\)[^\n]*password/i,
];
for (const pattern of forbiddenPasswordPersistence) {
  assert.doesNotMatch(main, pattern);
  assert.doesNotMatch(endpoint, pattern);
}

console.log("Credential/encryption controls passed: no application password persistence, Command Center secrets use Windows safeStorage, endpoint identity fails closed without encryption, and BitLocker is required for the production workspace.");
