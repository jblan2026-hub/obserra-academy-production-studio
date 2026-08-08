import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ownerSafe } = require("../electron/academy-data-protection.cjs");

const sample = {
  authorization: "Bearer ghp_supersecrettoken123456789",
  customer_email: "student@example.com",
  phone: "+1-555-555-1212",
  card: {
    number: "4242 4242 4242 4242",
    cvc: "123",
    last4: "4242",
    brand: "visa",
  },
  payment_method: "pm_1234567890",
  nested: {
    access_token: "secret-access-token",
    note: "Contact student@example.com and use 4242424242424242 only as test data.",
  },
  status: "paid",
  courseId: "ai-data-privacy-ip",
};

const safe = ownerSafe(sample);
const serialized = JSON.stringify(safe);

assert.equal(safe.authorization, "[REDACTED]");
assert.equal(safe.customer_email, "[REDACTED]");
assert.equal(safe.phone, "[REDACTED]");
assert.equal(safe.card, "[REDACTED]");
assert.equal(safe.payment_method, "[REDACTED]");
assert.equal(safe.nested.access_token, "[REDACTED]");
assert.equal(safe.status, "paid");
assert.equal(safe.courseId, "ai-data-privacy-ip");
assert.doesNotMatch(serialized, /student@example\.com/i);
assert.doesNotMatch(serialized, /4242424242424242/);
assert.doesNotMatch(serialized, /ghp_supersecret/i);
assert.doesNotMatch(serialized, /secret-access-token/i);

console.log("Academy data-protection verification passed: owner-facing data is minimized and sensitive values are redacted.");
