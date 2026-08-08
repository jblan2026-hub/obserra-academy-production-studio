import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const commandCenterRoot = path.resolve(here, "..");
const repoRoot = path.resolve(commandCenterRoot, "..");

const { ownerSafe, maskReference } = require("../electron/academy-data-protection.cjs");
const { normalizeBaseUrl } = require("../electron/connectors.cjs");

// Test 1: sensitive payment/customer data is removed before owner-facing rendering.
const hostilePayload = {
  authorization: "Bearer sk_live_super_secret_value_123456789",
  customer_email: "student@example.com",
  phone: "+1-555-555-1212",
  card: {
    number: "4242 4242 4242 4242",
    cvc: "123",
    last4: "4242",
  },
  payment_method: "pm_1234567890",
  payment_intent: "pi_1234567890abcdefgh",
  client_secret: "pi_123_secret_abcdef",
  freeText: "student@example.com 4242424242424242 Bearer sk_live_hidden_987654321",
  courseId: "ai-data-privacy-ip",
  paymentStatus: "paid",
};
const safe = ownerSafe(hostilePayload);
const serialized = JSON.stringify(safe);
assert.equal(safe.authorization, "[REDACTED]");
assert.equal(safe.customer_email, "[REDACTED]");
assert.equal(safe.phone, "[REDACTED]");
assert.equal(safe.card, "[REDACTED]");
assert.equal(safe.payment_method, "[REDACTED]");
assert.equal(safe.payment_intent, "[REDACTED]");
assert.equal(safe.client_secret, "[REDACTED]");
assert.equal(safe.courseId, "ai-data-privacy-ip");
assert.equal(safe.paymentStatus, "paid");
assert.doesNotMatch(serialized, /student@example\.com/i);
assert.doesNotMatch(serialized, /4242424242424242/);
assert.doesNotMatch(serialized, /sk_live_/i);
assert.doesNotMatch(serialized, /pi_123_secret/i);

// Test 2: transaction references are masked for evidence/UI use.
const masked = maskReference("pi_1234567890abcdefgh");
assert.equal(masked.startsWith("pi_123"), true);
assert.equal(masked.endsWith("efgh"), true);
assert.equal(masked.includes("4567890abcd"), false);

// Test 3: connector URL policy rejects clear-text remote endpoints but permits loopback dev endpoints.
assert.throws(() => normalizeBaseUrl("http://payments.example.com"), /Unencrypted connector URLs are allowed only on loopback/);
assert.equal(new URL(normalizeBaseUrl("http://127.0.0.1:11434")).origin, "http://127.0.0.1:11434");
assert.equal(new URL(normalizeBaseUrl("https://api.stripe.com")).origin, "https://api.stripe.com");

// Test 4: production policy remains fail closed for client-only success and raw card handling.
const paymentPolicy = JSON.parse(fs.readFileSync(path.join(repoRoot, "policy", "academy-payment-security.json"), "utf8"));
const pciProfile = JSON.parse(fs.readFileSync(path.join(repoRoot, "policy", "academy-pci-dss-v4.0.1-profile.json"), "utf8"));
assert.equal(paymentPolicy.requirements.checkoutSuccessRedirectAloneInsufficientForEntitlement, true);
assert.equal(paymentPolicy.requirements.webhookSignatureVerificationRequired, true);
assert.equal(paymentPolicy.requirements.checkoutFulfillmentRequiresServerSideVerification, true);
assert.equal(paymentPolicy.requirements.idempotentEntitlementGrantRequired, true);
assert.equal(paymentPolicy.releaseGate.blockPublicationIfRawCardInputDetected, true);
assert.equal(paymentPolicy.releaseGate.blockPublicationIfSensitivePaymentLoggingDetected, true);
assert.equal(pciProfile.releaseGate.blockIfEntitlementCanBeGrantedFromClientRedirectAlone, true);
assert.equal(pciProfile.releaseGate.blockIfMerchantHostedCardFieldDetected, true);
assert.equal(pciProfile.releaseGate.blockIfRawPaymentOrCustomerPayloadLoggingDetected, true);

// Test 5: reset Academy UI cannot list raw purchaser records and accepts secure verification references instead.
const uiSource = fs.readFileSync(path.join(commandCenterRoot, "src", "academy-reset-ui.js"), "utf8");
assert.doesNotMatch(uiSource, /listAcademyPurchases\s*\(/);
assert.doesNotMatch(uiSource, /customerEmail|customer_email|cardNumber|cvc|cvv/i);
assert.match(uiSource, /verifyAcademyPurchase/);
assert.match(uiSource, /PaymentIntent|Checkout Session|pi_|cs_/i);
assert.match(uiSource, /retrieveWebsiteAcademyCourse/);
assert.match(uiSource, /retrieveWebsiteAcademyCertificate/);

console.log("Payment security behavioral controls passed: sensitive data redaction, reference masking, HTTPS connector enforcement, fail-closed payment policy, minimized Academy UI behavior, and website readback boundaries are verified.");
