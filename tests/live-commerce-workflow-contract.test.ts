import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateCommerceHealthPayload } from "../studio/verify-live-academy-commerce-contract.mjs";

const workflows = [
  ".github/workflows/postmerge-production-evidence.yml",
  ".github/workflows/enterprise-50x-production-gate.yml",
  ".github/workflows/production-contract-release-gate.yml",
  ".github/workflows/enterprise-mega-release-gate.yml",
];

function healthyPayload(idempotencyKey = "stripe-event-id") {
  return {
    contract: "academy-commerce-health-v1",
    operational: true,
    paymentProvider: "stripe",
    providerVerification: {
      environment: "live",
      connected: true,
      chargesEnabled: true,
    },
    webhookVerification: "required",
    checkoutModes: ["authenticated", "guest-email"],
    claimPolicy: "purchaser-email-match-v1",
    identity: "available",
    durableStorage: "available",
    purchaserIdentityHashing: "available",
    fulfillment: {
      authenticated: "immediate-entitlement",
      guest: "paid-pending-account-claim",
      idempotencyKey,
      auditLedger: "durable-supabase",
    },
  };
}

test("shared verifier accepts the current website commerce health contract", () => {
  assert.doesNotThrow(() => validateCommerceHealthPayload(healthyPayload()));
});

test("shared verifier rejects the retired checkout-session idempotency label", () => {
  assert.throws(
    () => validateCommerceHealthPayload(healthyPayload("stripe-checkout-session-id")),
    /fulfillment idempotency key/,
  );
});

test("live checkout verification uses only a non-sale sentinel course", () => {
  const source = fs.readFileSync("studio/verify-live-academy-commerce-contract.mjs", "utf8");
  assert.match(source, /obserra-contract-probe-not-for-sale/);
  assert.doesNotMatch(source, /zero-trust-strategy|ai-ready-workforce/);
});

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
