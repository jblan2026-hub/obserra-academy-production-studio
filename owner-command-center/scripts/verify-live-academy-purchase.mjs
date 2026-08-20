import assert from "node:assert/strict";

const stripeSecret = String(process.env.STRIPE_SECRET_KEY || "").trim();
const clerkSecret = String(process.env.CLERK_SECRET_KEY || "").trim();
const sessionId = String(process.env.ACADEMY_TEST_CHECKOUT_SESSION_ID || "").trim();
const courseId = String(process.env.ACADEMY_TEST_COURSE_ID || "").trim();
const academyBaseUrl = String(process.env.OBSERRA_ACADEMY_URL || "https://www.obserrallc.com").replace(/\/$/, "");

assert.ok(stripeSecret, "STRIPE_SECRET_KEY is required for live purchase verification");
assert.ok(clerkSecret, "CLERK_SECRET_KEY is required for live purchase verification");
assert.match(sessionId, /^cs_(?:test|live)_[A-Za-z0-9]+$/, "ACADEMY_TEST_CHECKOUT_SESSION_ID must be canonical");
assert.match(courseId, /^[a-z0-9][a-z0-9-]{2,159}$/, "ACADEMY_TEST_COURSE_ID must be canonical");

async function request(url, options, acceptedStatus = 200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...options, redirect: "manual", signal: controller.signal });
    const rawBody = await response.text();
    let body;
    try { body = JSON.parse(rawBody); } catch { body = rawBody; }
    if (response.status !== acceptedStatus) {
      throw new Error(JSON.stringify({
        url,
        status: response.status,
        requestId: response.headers.get("request-id") || response.headers.get("stripe-request-id") || response.headers.get("x-request-id"),
        rawBody,
      }, null, 2));
    }
    return {
      status: response.status,
      requestId: response.headers.get("request-id") || response.headers.get("stripe-request-id") || response.headers.get("x-request-id"),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

const stripe = await request(
  `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
  { headers: { Authorization: `Bearer ${stripeSecret}` } },
);
assert.equal(stripe.body.payment_status, "paid", `Stripe payment_status is ${stripe.body.payment_status || "missing"}`);
assert.equal(stripe.body.metadata?.courseId, courseId, `Stripe metadata courseId is ${stripe.body.metadata?.courseId || "missing"}`);

const clerkUserId = String(stripe.body.metadata?.clerkUserId || "").trim();
assert.ok(clerkUserId, "Paid checkout has no Clerk user binding; it remains pending the account-claim workflow");

const clerk = await request(
  `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`,
  { headers: { Accept: "application/json", Authorization: `Bearer ${clerkSecret}` } },
);
const entitlement = clerk.body?.private_metadata?.academy?.entitlements?.[courseId];
assert.ok(entitlement, `Clerk user ${clerkUserId} does not contain the ${courseId} entitlement`);
assert.equal(entitlement.paymentReference, sessionId, "Clerk entitlement paymentReference does not match the paid Stripe Checkout Session");

const commerce = await request(`${academyBaseUrl}/api/academy/commerce-health`, { headers: { Accept: "application/json" } });
assert.equal(commerce.body?.operational, true, "Academy commerce health is not operational");

console.log(JSON.stringify({
  state: "verified-success",
  courseId,
  checkoutSessionId: sessionId,
  clerkUserId,
  stripe: { status: stripe.status, requestId: stripe.requestId, paymentStatus: stripe.body.payment_status },
  clerk: { status: clerk.status, requestId: clerk.requestId, entitlement },
  academy: { status: commerce.status, requestId: commerce.requestId, contract: commerce.body?.contract, operational: commerce.body?.operational },
  verifiedAt: new Date().toISOString(),
}, null, 2));
