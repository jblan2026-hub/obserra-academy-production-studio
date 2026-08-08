import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const policyPath = path.join(repoRoot, "policy", "academy-commerce-policy.json");
const securityPath = path.join(repoRoot, "policy", "academy-payment-security.json");

const commerce = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const security = JSON.parse(fs.readFileSync(securityPath, "utf8"));

assert.equal(commerce.salesPolicy?.allSalesFinal, true);
assert.equal(commerce.salesPolicy?.acknowledgementRequired, true);
assert.match(commerce.salesPolicy?.checkoutNotice || "", /all .*sales .*final/i);
assert.match(commerce.salesPolicy?.receiptNotice || "", /all .*sales .*final/i);
assert.match(commerce.salesPolicy?.checkoutNotice || "", /required by applicable law/i);
assert.equal(commerce.checkoutRequirements?.displayBeforePayment, true);
assert.equal(commerce.checkoutRequirements?.requireTermsAcceptance, true);
assert.equal(commerce.checkoutRequirements?.doNotCollectPrimaryCardData, true);
assert.equal(commerce.receiptRequirements?.emailReceiptEnabled, true);
assert.equal(commerce.receiptRequirements?.excludeCardNumber, true);
assert.equal(commerce.receiptRequirements?.excludeCvc, true);

assert.equal(security.requirements?.httpsRequired, true);
assert.equal(security.requirements?.minimumTlsVersion, "1.2");
assert.equal(security.requirements?.hstsRequired, true);
assert.equal(security.requirements?.mixedContentForbidden, true);
assert.equal(security.requirements?.stripeHostedCardCollectionRequired, true);
assert.equal(security.requirements?.primaryAccountNumberStorageForbidden, true);
assert.equal(security.requirements?.cvcStorageForbidden, true);
assert.equal(security.requirements?.webhookSignatureVerificationRequired, true);
assert.equal(security.requirements?.checkoutFulfillmentRequiresServerSideVerification, true);
assert.equal(security.releaseGate?.blockPublicationIfHttpPaymentRouteDetected, true);
assert.equal(security.releaseGate?.blockPublicationIfRawCardInputDetected, true);

console.log("Academy commerce/security policy verification passed: HTTPS/TLS, Stripe-hosted card collection, final-sale disclosure, receipt notice, and payment-data minimization are enforced by policy contract.");
