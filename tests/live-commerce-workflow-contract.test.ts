import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflows = [
  ".github/workflows/postmerge-production-evidence.yml",
  ".github/workflows/enterprise-50x-production-gate.yml",
  ".github/workflows/production-contract-release-gate.yml",
  ".github/workflows/enterprise-mega-release-gate.yml",
];

for (const workflow of workflows) {
  test(`${workflow} delegates live Academy commerce verification to the governed shared verifier`, () => {
    const source = fs.readFileSync(workflow, "utf8");
    assert.match(
      source,
      /studio\/verify-live-academy-commerce-contract\.mjs/,
      `${workflow} must call the shared live Academy commerce verifier`,
    );
    assert.doesNotMatch(
      source,
      /stripe-checkout-session-id/,
      `${workflow} must not assert the retired checkout-session idempotency label`,
    );
    assert.doesNotMatch(
      source,
      /\/api\/academy\/checkout\?course=/,
      `${workflow} must not use the retired GET checkout contract`,
    );
  });
}
