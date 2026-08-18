import assert from "node:assert/strict";
import test from "node:test";
import {
  getClerkIdentityReadiness,
  isClerkIdentityConfigured,
} from "../lib/identity-readiness";

test("Clerk identity is ready only when both required keys are present", () => {
  const env = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
    CLERK_SECRET_KEY: "sk_test_example",
  };

  assert.equal(isClerkIdentityConfigured(env), true);
  assert.deepEqual(getClerkIdentityReadiness(env), {
    provider: "clerk",
    configured: true,
    publishableKeyPresent: true,
    secretKeyPresent: true,
    missingRequiredEnvironment: [],
  });
});

test("Clerk identity fails closed when the publishable key is missing", () => {
  const readiness = getClerkIdentityReadiness({
    CLERK_SECRET_KEY: "sk_test_example",
  });

  assert.equal(readiness.configured, false);
  assert.deepEqual(readiness.missingRequiredEnvironment, [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ]);
});

test("Clerk identity fails closed when the secret key is missing", () => {
  const readiness = getClerkIdentityReadiness({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
  });

  assert.equal(readiness.configured, false);
  assert.deepEqual(readiness.missingRequiredEnvironment, ["CLERK_SECRET_KEY"]);
});

test("blank Clerk keys are treated as missing", () => {
  const readiness = getClerkIdentityReadiness({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "   ",
    CLERK_SECRET_KEY: "\t",
  });

  assert.equal(readiness.configured, false);
  assert.equal(readiness.publishableKeyPresent, false);
  assert.equal(readiness.secretKeyPresent, false);
  assert.deepEqual(readiness.missingRequiredEnvironment, [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
  ]);
});
