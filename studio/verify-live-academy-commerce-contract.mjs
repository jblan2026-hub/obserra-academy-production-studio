import crypto from "node:crypto";

const EXPECTED_ORIGIN = "https://www.obserrallc.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_COURSES = ["zero-trust-strategy", "ai-ready-workforce"];

function fail(message) {
  throw new Error(message);
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function requireSet(actual, expected, label) {
  if (!Array.isArray(actual)) fail(`${label}: expected array, got ${typeof actual}`);
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`${label}: expected ${JSON.stringify(right)}, got ${JSON.stringify(left)}`);
  }
}

function productionOrigin(value = process.env.OBSERRA_WEBSITE_BASE_URL ?? EXPECTED_ORIGIN) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== EXPECTED_ORIGIN) {
    fail(`Refusing noncanonical production origin ${url.origin}`);
  }
  return url.origin;
}

function endpoint(origin, pathname) {
  return new URL(pathname, `${origin}/`).toString();
}

async function request(url, init = {}) {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  return fetch(url, { ...init, signal: timeout });
}

function requireHeader(response, name, expected) {
  const actual = response.headers.get(name);
  requireEqual(actual, expected, `header ${name}`);
}

export function validateCommerceHealthPayload(payload) {
  requireEqual(payload?.contract, "academy-commerce-health-v1", "commerce contract");
  requireEqual(payload?.operational, true, "commerce operational");
  requireEqual(payload?.paymentProvider, "stripe", "payment provider");
  requireEqual(payload?.providerVerification?.environment, "live", "Stripe environment");
  requireEqual(payload?.providerVerification?.connected, true, "Stripe connectivity");
  requireEqual(payload?.providerVerification?.chargesEnabled, true, "Stripe charges enabled");
  requireEqual(payload?.webhookVerification, "required", "webhook verification");
  requireSet(payload?.checkoutModes, ["authenticated", "guest-email"], "checkout modes");
  requireEqual(payload?.claimPolicy, "purchaser-email-match-v1", "claim policy");
  requireEqual(payload?.identity, "available", "identity readiness");
  requireEqual(payload?.durableStorage, "available", "durable storage readiness");
  requireEqual(payload?.purchaserIdentityHashing, "available", "purchaser identity hashing");
  requireEqual(payload?.fulfillment?.authenticated, "immediate-entitlement", "authenticated fulfillment");
  requireEqual(payload?.fulfillment?.guest, "paid-pending-account-claim", "guest fulfillment");
  requireEqual(payload?.fulfillment?.idempotencyKey, "stripe-event-id", "fulfillment idempotency key");
  requireEqual(payload?.fulfillment?.auditLedger, "durable-supabase", "audit ledger");
}

async function verifyHealth(origin) {
  const response = await request(endpoint(origin, "/api/academy/commerce-health"), {
    headers: { accept: "application/json" },
    redirect: "manual",
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail(`commerce health returned non-JSON status ${response.status}`);
  }

  requireHeader(response, "x-obserra-commerce-contract", "academy-commerce-health-v1");
  requireHeader(response, "x-obserra-claim-policy", "purchaser-email-match-v1");
  if ((response.headers.get("cache-control") ?? "").toLowerCase().includes("public")) {
    fail("commerce health must not be publicly cacheable");
  }

  try {
    validateCommerceHealthPayload(payload);
  } catch (error) {
    const details = {
      status: response.status,
      operational: payload?.operational,
      paymentProvider: payload?.paymentProvider,
      providerEnvironment: payload?.providerVerification?.environment,
      providerConnected: payload?.providerVerification?.connected,
      chargesEnabled: payload?.providerVerification?.chargesEnabled,
      webhookVerification: payload?.webhookVerification,
      identity: payload?.identity,
      durableStorage: payload?.durableStorage,
      purchaserIdentityHashing: payload?.purchaserIdentityHashing,
    };
    fail(`${error instanceof Error ? error.message : String(error)}; observed ${JSON.stringify(details)}`);
  }
  requireEqual(response.status, 200, "commerce health HTTP status");
}

async function verifyCheckoutBoundary(origin, courses = DEFAULT_COURSES) {
  const getResponse = await request(endpoint(origin, "/api/academy/checkout"), {
    method: "GET",
    redirect: "manual",
  });
  requireEqual(getResponse.status, 405, "checkout GET status");
  requireEqual(getResponse.headers.get("allow"), "POST", "checkout Allow header");

  for (const course of courses) {
    const attemptId = crypto.randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000).toString();
    const body = new URLSearchParams({
      course,
      checkoutAttemptId: attemptId,
      checkoutAttemptIssuedAt: issuedAt,
    });
    const response = await request(endpoint(origin, "/api/academy/checkout"), {
      method: "POST",
      redirect: "manual",
      headers: {
        origin,
        accept: "text/html,application/xhtml+xml",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    requireEqual(response.status, 307, `${course} licensing-pending checkout status`);
    const location = response.headers.get("location") ?? "";
    const redirected = new URL(location, `${origin}/`);
    requireEqual(redirected.origin, origin, `${course} redirect origin`);
    requireEqual(redirected.pathname, "/academy", `${course} redirect path`);
    requireEqual(redirected.searchParams.get("enrollment"), "licensing-pending", `${course} enrollment state`);
    requireHeader(response, "x-obserra-sales-license", "pending");
    requireHeader(response, "x-obserra-existing-entitlements", "preserved");
    requireHeader(response, "x-obserra-webhook-verification", "required");
  }
}

async function verifyWebhookBoundary(origin) {
  const response = await request(endpoint(origin, "/api/webhook/stripe"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    redirect: "manual",
  });
  requireEqual(response.status, 400, "unsigned webhook status");
  const body = await response.text();
  if (!/Webhook not configured|Invalid webhook signature/i.test(body)) {
    fail(`unsigned webhook rejection body is unexpected: ${body.slice(0, 200)}`);
  }
}

function selectedChecks(argv) {
  const flags = new Set(argv.filter((value) => value.startsWith("--")));
  if (flags.size === 0 || flags.has("--all")) return new Set(["health", "checkout", "webhook"]);
  const checks = new Set();
  if (flags.has("--health")) checks.add("health");
  if (flags.has("--checkout")) checks.add("checkout");
  if (flags.has("--webhook")) checks.add("webhook");
  if (checks.size === 0) fail(`Unsupported verifier flags: ${[...flags].join(", ")}`);
  return checks;
}

export async function verifyLiveAcademyCommerce({ origin = productionOrigin(), checks = new Set(["health", "checkout", "webhook"]) } = {}) {
  const failures = [];
  const run = async (name, operation) => {
    try {
      await operation();
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      console.error(`FAIL ${name}: ${message}`);
    }
  };

  if (checks.has("health")) await run("commerce-health", () => verifyHealth(origin));
  if (checks.has("checkout")) await run("checkout-boundary", () => verifyCheckoutBoundary(origin));
  if (checks.has("webhook")) await run("webhook-boundary", () => verifyWebhookBoundary(origin));

  if (failures.length > 0) {
    fail(`Live Academy commerce verification failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const origin = productionOrigin();
  const checks = selectedChecks(process.argv.slice(2));
  await verifyLiveAcademyCommerce({ origin, checks });
}
