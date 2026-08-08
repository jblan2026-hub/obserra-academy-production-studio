import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORING_EXIT_CODES,
  classificationFromAuthoringExit,
  classifyProviderHttpFailure,
} from "../studio/authoring-provider-errors.mjs";

test("OpenAI insufficient quota is non-retryable", () => {
  const result = classifyProviderHttpFailure({
    provider: "openai",
    status: 429,
    body: JSON.stringify({
      error: {
        message: "You exceeded your current quota, please check your plan and billing details.",
        type: "insufficient_quota",
        code: "insufficient_quota",
      },
    }),
  });

  assert.equal(result.category, "provider_quota_exhausted");
  assert.equal(result.retryable, false);
  assert.equal(result.exitCode, AUTHORING_EXIT_CODES.PROVIDER_QUOTA_EXHAUSTED);
});

test("OpenAI exhausted credit balance is non-retryable", () => {
  const result = classifyProviderHttpFailure({
    provider: "openai",
    status: 429,
    body: JSON.stringify({
      error: {
        message: "You have no credits remaining. Add credits to continue using the API.",
        type: "insufficient_quota",
        code: "credit_balance_exhausted",
      },
    }),
  });

  assert.equal(result.category, "provider_quota_exhausted");
  assert.equal(result.retryable, false);
  assert.equal(result.exitCode, AUTHORING_EXIT_CODES.PROVIDER_QUOTA_EXHAUSTED);
  assert.equal(result.providerCode, "credit_balance_exhausted");
});

test("transient 429 rate limit remains retryable", () => {
  const result = classifyProviderHttpFailure({
    provider: "openai",
    status: 429,
    body: JSON.stringify({
      error: {
        message: "Rate limit reached for requests.",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    }),
  });

  assert.equal(result.category, "provider_transient_failure");
  assert.equal(result.retryable, true);
  assert.equal(result.exitCode, 1);
});

test("provider authentication failures stop retrying", () => {
  const result = classifyProviderHttpFailure({
    provider: "openai",
    status: 401,
    body: JSON.stringify({ error: { message: "Invalid API key", code: "invalid_api_key" } }),
  });

  assert.equal(result.category, "provider_authentication_failed");
  assert.equal(result.retryable, false);
  assert.equal(result.exitCode, AUTHORING_EXIT_CODES.PROVIDER_AUTHENTICATION_FAILED);
});

test("invalid provider requests stop retrying", () => {
  const result = classifyProviderHttpFailure({
    provider: "openai",
    status: 400,
    body: JSON.stringify({ error: { message: "Unsupported request", code: "invalid_request_error" } }),
  });

  assert.equal(result.category, "provider_request_invalid");
  assert.equal(result.retryable, false);
  assert.equal(result.exitCode, AUTHORING_EXIT_CODES.PROVIDER_REQUEST_INVALID);
});

test("parallel coordinator recognizes non-retryable quota exit", () => {
  const result = classificationFromAuthoringExit({
    exitCode: AUTHORING_EXIT_CODES.PROVIDER_QUOTA_EXHAUSTED,
  });

  assert.equal(result.category, "provider_quota_exhausted");
  assert.equal(result.retryable, false);
});

test("timeouts remain retryable", () => {
  const result = classificationFromAuthoringExit({ exitCode: null, timedOut: true });

  assert.equal(result.category, "authoring_process_timeout");
  assert.equal(result.retryable, true);
});
