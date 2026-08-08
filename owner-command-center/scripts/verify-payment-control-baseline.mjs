import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const payment = JSON.parse(fs.readFileSync(path.join(repoRoot, "policy", "academy-payment-security.json"), "utf8"));
const pci = JSON.parse(fs.readFileSync(path.join(repoRoot, "policy", "academy-pci-dss-v4.0.1-profile.json"), "utf8"));

const requiredPaymentControls = {
  httpsRequired: true,
  minimumTlsVersion: "1.2",
  hstsRequired: true,
  secureCookiesRequired: true,
  httpOnlySessionCookiesRequired: true,
  sameSiteCookiesRequired: true,
  mixedContentForbidden: true,
  stripeHostedCardCollectionRequired: true,
  primaryAccountNumberStorageForbidden: true,
  cvcStorageForbidden: true,
  rawPaymentMethodStorageForbidden: true,
  clientSecretLoggingForbidden: true,
  stripeSecretLoggingForbidden: true,
  webhookSignatureVerificationRequired: true,
  checkoutFulfillmentRequiresServerSideVerification: true,
  checkoutSuccessRedirectAloneInsufficientForEntitlement: true,
  idempotentEntitlementGrantRequired: true,
  piiLoggingMinimized: true,
  customerEmailMaskingRequiredInOwnerUi: true,
  paymentReferenceMaskingRequiredInOwnerUi: true,
};

for (const [control, expected] of Object.entries(requiredPaymentControls)) {
  assert.equal(payment.requirements?.[control], expected, `Missing or invalid payment control: ${control}`);
}

for (const control of [
  "blockPublicationIfHttpPaymentRouteDetected",
  "blockPublicationIfMixedContentDetected",
  "blockPublicationIfRawCardInputDetected",
  "blockPublicationIfWebhookVerificationMissing",
  "blockPublicationIfSensitivePaymentLoggingDetected",
]) {
  assert.equal(payment.releaseGate?.[control], true, `Payment release gate is not fail-closed: ${control}`);
}

for (const control of [
  "merchantHostedCardFieldsForbidden",
  "directPostForbidden",
  "primaryAccountNumberStorageForbidden",
  "cvcStorageForbidden",
  "rawPaymentMethodStorageForbidden",
  "cardholderDataLoggingForbidden",
  "stripeCheckoutRedirectOnlyForCardCapture",
  "serverSidePaymentVerificationRequired",
  "webhookSignatureVerificationRequired",
  "successRedirectDoesNotGrantEntitlement",
  "idempotentEntitlementGrantRequired",
]) {
  assert.equal(pci.architecture?.[control], true, `PCI architecture control missing: ${control}`);
}

for (const control of [
  "httpsRequired",
  "hstsRequired",
  "secureCookieRequired",
  "httpOnlyCookieRequired",
  "sameSiteCookieRequired",
  "mixedContentForbidden",
  "securityPatchManagementRequired",
  "uniqueAdministrativeIdentitiesRequired",
  "strongAuthenticationRequired",
  "leastPrivilegeRequired",
  "redirectIntegrityProtectionRequired",
  "thirdPartyProviderComplianceMonitoringRequired",
]) {
  assert.equal(pci.merchantWebsiteControls?.[control], true, `Merchant website control missing: ${control}`);
}

for (const control of [
  "cspRequired",
  "frameAncestorsRestricted",
  "formActionRestricted",
  "dependencyAndSupplyChainScanningRequired",
]) {
  assert.equal(pci.ecommerceSecurity?.[control], true, `E-commerce control missing: ${control}`);
}

for (const control of [
  "customerEmailMinimizationRequired",
  "customerEmailMaskingInOwnerUiRequired",
  "fullPaymentReferenceDisplayForbidden",
  "paymentReferenceMaskingRequired",
  "providerPayloadPersistenceForbidden",
  "secretsEncryptedAtRestRequired",
  "secretsExcludedFromLogsRequired",
  "auditEvidenceMustBeMinimumNecessary",
]) {
  assert.equal(pci.dataProtection?.[control], true, `Payment data-protection control missing: ${control}`);
}

for (const control of [
  "blockIfMerchantHostedCardFieldDetected",
  "blockIfDirectPostDetected",
  "blockIfHttpCheckoutOrReturnUrlDetected",
  "blockIfMixedContentDetected",
  "blockIfWebhookSignatureVerificationMissing",
  "blockIfEntitlementCanBeGrantedFromClientRedirectAlone",
  "blockIfRawPaymentOrCustomerPayloadLoggingDetected",
  "blockIfStripeSecretOrClientSecretLoggingDetected",
]) {
  assert.equal(pci.releaseGate?.[control], true, `PCI release gate is not fail-closed: ${control}`);
}

console.log("Payment control baseline verification passed: secure redirect payment architecture, HTTPS/TLS, secret protection, least privilege, data minimization, webhook verification, server-side entitlement, and fail-closed release gates are all enforced by contract.");
