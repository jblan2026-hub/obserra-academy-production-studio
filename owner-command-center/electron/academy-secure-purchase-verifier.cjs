"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const { resolvedConnectors } = require("./connectors.cjs");
const { maskReference, ownerSafeError } = require("./academy-data-protection.cjs");

const REQUEST_TIMEOUT_MS = 20000;
const MAX_LEDGER_ENTRIES = 1000;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]+$/;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/;

function nowIso() {
  return new Date().toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createSecureAcademyPurchaseVerifier({ store, safeStorage } = {}) {
  if (!store || !safeStorage) throw new Error("Secure Academy purchase verifier dependencies are required.");

  function assertOwnerEndpoint() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows credential encryption is required for purchase verification.");
    }
    const enrollment = store.get("endpoint.enrollment");
    if (!enrollment || enrollment.state !== "enrolled") {
      throw new Error("The owner endpoint must be enrolled before purchase verification is permitted.");
    }
  }

  function connector(id) {
    const value = resolvedConnectors(store).find((item) => item.id === id);
    if (!value) throw new Error(`Connector ${id} is not registered.`);
    return value;
  }

  function readSecret(key) {
    const encrypted = store.get(`secrets.${key}`);
    if (typeof encrypted !== "string" || !encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim() || null;
    } catch {
      return null;
    }
  }

  async function requestJson({ url, headers = {}, acceptedStatuses = [200] }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: controller.signal,
      });
      if (!acceptedStatuses.includes(response.status)) {
        return {
          ok: false,
          status: response.status,
          requestId:
            response.headers.get("request-id") ||
            response.headers.get("stripe-request-id") ||
            response.headers.get("x-request-id") ||
            null,
          reason: `Provider returned HTTP ${response.status}.`,
        };
      }
      const text = await response.text();
      let body = null;
      if (text) {
        try { body = JSON.parse(text); }
        catch { return { ok: false, status: response.status, requestId: null, reason: "Provider returned a non-JSON response." }; }
      }
      return {
        ok: true,
        status: response.status,
        requestId:
          response.headers.get("request-id") ||
          response.headers.get("stripe-request-id") ||
          response.headers.get("x-request-id") ||
          null,
        body,
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        requestId: null,
        reason: controller.signal.aborted ? "Provider request timed out." : ownerSafeError(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function stripeGet(pathname) {
    const stripe = connector("stripe");
    const secret = readSecret(stripe.credentialKey);
    if (!secret) {
      return { ok: false, status: null, requestId: null, reason: "Stripe owner credential is not configured." };
    }
    return requestJson({
      url: `${stripe.url}${pathname}`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
      },
    });
  }

  async function clerkGet(pathname) {
    const clerk = connector("clerk");
    const secret = readSecret(clerk.credentialKey);
    if (!secret) {
      return { ok: false, status: null, requestId: null, reason: "Clerk owner credential is not configured." };
    }
    return requestJson({
      url: `${clerk.url}${pathname}`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
      },
    });
  }

  async function academyHealth() {
    const academy = connector("academy");
    const secret = readSecret(academy.credentialKey);
    const response = await requestJson({
      url: `${academy.url}/api/academy/commerce-health`,
      headers: secret ? { Accept: "application/json", Authorization: `Bearer ${secret}` } : { Accept: "application/json" },
      acceptedStatuses: [200, 503],
    });
    return {
      ok: response.ok && response.status === 200 && response.body?.operational === true,
      status: response.status,
      requestId: response.requestId,
      operational: response.status === 200 && response.body?.operational === true,
      reason: response.ok ? null : response.reason,
    };
  }

  function ledgerEntries() {
    const value = store.get("academy.securePurchaseVerificationLedger");
    return Array.isArray(value) ? value : [];
  }

  function appendLedger(event) {
    const entries = ledgerEntries();
    const previousHash = entries.at(-1)?.hash || "GENESIS";
    const record = {
      schemaVersion: "1.0",
      eventId: crypto.randomUUID(),
      occurredAt: nowIso(),
      actor: `owner-device://${os.hostname().toLowerCase()}/${os.userInfo().username}`,
      courseId: event.courseId || null,
      referenceType: event.referenceType || null,
      reference: event.reference || null,
      paymentState: event.paymentState || null,
      entitlementState: event.entitlementState || null,
      commerceState: event.commerceState || null,
      amount: Number.isFinite(event.amount) ? event.amount : null,
      currency: event.currency || null,
      outcome: event.outcome || "unknown",
      reason: event.reason || null,
      providerRequestIds: event.providerRequestIds || {},
      previousHash,
    };
    record.hash = sha256(`${previousHash}:${stableJson(record)}`);
    store.set("academy.securePurchaseVerificationLedger", [...entries, record].slice(-MAX_LEDGER_ENTRIES));
    return record;
  }

  function ledger(limit = 100) {
    const bounded = Math.max(1, Math.min(MAX_LEDGER_ENTRIES, Number(limit) || 100));
    return ledgerEntries().slice(-bounded).reverse();
  }

  async function resolveCheckout(reference) {
    if (SESSION_ID.test(reference)) {
      const session = await stripeGet(`/v1/checkout/sessions/${encodeURIComponent(reference)}`);
      return { referenceType: "checkout-session", session, paymentIntent: null };
    }

    if (PAYMENT_INTENT_ID.test(reference)) {
      const paymentIntent = await stripeGet(`/v1/payment_intents/${encodeURIComponent(reference)}`);
      if (!paymentIntent.ok) return { referenceType: "payment-intent", session: null, paymentIntent };
      const query = new URLSearchParams({ payment_intent: reference, limit: "2" });
      const sessions = await stripeGet(`/v1/checkout/sessions?${query.toString()}`);
      if (!sessions.ok) return { referenceType: "payment-intent", session: sessions, paymentIntent };
      const data = Array.isArray(sessions.body?.data) ? sessions.body.data : [];
      if (data.length !== 1) {
        return {
          referenceType: "payment-intent",
          paymentIntent,
          session: {
            ok: false,
            status: sessions.status,
            requestId: sessions.requestId,
            reason: data.length === 0
              ? "No Checkout Session is associated with this PaymentIntent."
              : "More than one Checkout Session matched the PaymentIntent; automatic verification stopped.",
          },
        };
      }
      return {
        referenceType: "payment-intent",
        paymentIntent,
        session: { ok: true, status: sessions.status, requestId: sessions.requestId, body: data[0] },
      };
    }

    throw new Error("Enter a canonical Stripe Checkout Session (cs_...) or PaymentIntent (pi_...) reference.");
  }

  async function verifyPurchase(payload) {
    assertOwnerEndpoint();
    const courseIdRequested = String(payload?.courseId || "").trim() || null;
    const reference = String(payload?.reference || payload?.sessionId || "").trim();
    const resolved = await resolveCheckout(reference);
    const maskedReference = maskReference(reference);

    if (!resolved.session?.ok) {
      const event = appendLedger({
        courseId: courseIdRequested,
        referenceType: resolved.referenceType,
        reference: maskedReference,
        outcome: "failed",
        paymentState: "unverified",
        entitlementState: "not-checked",
        commerceState: "not-checked",
        reason: resolved.session?.reason || resolved.paymentIntent?.reason || "Stripe verification failed.",
        providerRequestIds: {
          stripePaymentIntent: resolved.paymentIntent?.requestId || null,
          stripeCheckoutSession: resolved.session?.requestId || null,
        },
      });
      return { ok: false, state: "stripe-verification-failed", reference: maskedReference, event };
    }

    const session = resolved.session.body || {};
    const paymentIntent = resolved.paymentIntent?.body || null;
    const courseIdObserved = String(session.metadata?.courseId || paymentIntent?.metadata?.courseId || "").trim() || null;
    const paymentPaid = session.payment_status === "paid" || paymentIntent?.status === "succeeded";
    const amount = Number.isFinite(session.amount_total)
      ? session.amount_total
      : Number.isFinite(paymentIntent?.amount_received) ? paymentIntent.amount_received : null;
    const currency = String(session.currency || paymentIntent?.currency || "").toUpperCase() || null;

    if (courseIdRequested && courseIdObserved && courseIdRequested !== courseIdObserved) {
      const event = appendLedger({
        courseId: courseIdObserved,
        referenceType: resolved.referenceType,
        reference: maskedReference,
        outcome: "course-mismatch",
        paymentState: paymentPaid ? "paid" : "not-paid",
        entitlementState: "not-checked",
        commerceState: "not-checked",
        amount,
        currency,
        reason: "The Stripe transaction is bound to a different Academy course than the selected course.",
        providerRequestIds: {
          stripePaymentIntent: resolved.paymentIntent?.requestId || null,
          stripeCheckoutSession: resolved.session?.requestId || null,
        },
      });
      return {
        ok: false,
        state: "course-mismatch",
        reference: maskedReference,
        courseId: courseIdObserved,
        paymentState: paymentPaid ? "paid" : "not-paid",
        amount,
        currency,
        event,
      };
    }

    if (!paymentPaid) {
      const event = appendLedger({
        courseId: courseIdObserved || courseIdRequested,
        referenceType: resolved.referenceType,
        reference: maskedReference,
        outcome: "payment-not-paid",
        paymentState: "not-paid",
        entitlementState: "not-checked",
        commerceState: "not-checked",
        amount,
        currency,
        reason: "Stripe does not report this transaction as paid/succeeded.",
        providerRequestIds: {
          stripePaymentIntent: resolved.paymentIntent?.requestId || null,
          stripeCheckoutSession: resolved.session?.requestId || null,
        },
      });
      return { ok: false, state: "payment-not-paid", reference: maskedReference, courseId: courseIdObserved, amount, currency, event };
    }

    const clerkUserId = String(session.metadata?.clerkUserId || paymentIntent?.metadata?.clerkUserId || "").trim();
    let entitlementState = "pending-account-claim";
    let entitlementVerified = false;
    let clerkRequestId = null;

    if (clerkUserId && courseIdObserved) {
      const clerk = await clerkGet(`/v1/users/${encodeURIComponent(clerkUserId)}`);
      clerkRequestId = clerk.requestId || null;
      if (clerk.ok) {
        const entitlement = clerk.body?.private_metadata?.academy?.entitlements?.[courseIdObserved];
        const paymentReference = String(entitlement?.paymentReference || "");
        const validReferences = new Set([
          String(session.id || ""),
          String(session.payment_intent || ""),
          String(paymentIntent?.id || ""),
        ].filter(Boolean));
        entitlementVerified = Boolean(entitlement) && validReferences.has(paymentReference);
        entitlementState = entitlementVerified ? "verified" : "missing-or-mismatched";
      } else {
        entitlementState = "provider-unavailable";
      }
    }

    const commerce = await academyHealth();
    const verified = paymentPaid && entitlementVerified && commerce.operational === true && Boolean(courseIdObserved);
    const state = verified
      ? "verified-success"
      : !courseIdObserved
        ? "course-binding-missing"
        : entitlementState === "pending-account-claim"
          ? "paid-pending-account-claim"
          : !commerce.operational
            ? "commerce-health-failed"
            : "entitlement-readback-failed";

    const reason = verified
      ? "Stripe payment, Academy course binding, Clerk entitlement, and Academy commerce health were independently verified."
      : state === "paid-pending-account-claim"
        ? "Stripe payment is valid, but no Clerk account is bound to this purchase yet."
        : state === "course-binding-missing"
          ? "Stripe payment is valid, but the transaction does not contain the required Academy course binding."
          : state === "commerce-health-failed"
            ? "Payment and identity checks completed, but Academy commerce health is not operational."
            : "Payment is valid, but the exact Academy entitlement could not be independently confirmed.";

    const event = appendLedger({
      courseId: courseIdObserved || courseIdRequested,
      referenceType: resolved.referenceType,
      reference: maskedReference,
      outcome: state,
      paymentState: "paid",
      entitlementState,
      commerceState: commerce.operational ? "operational" : "not-operational",
      amount,
      currency,
      reason,
      providerRequestIds: {
        stripePaymentIntent: resolved.paymentIntent?.requestId || null,
        stripeCheckoutSession: resolved.session?.requestId || null,
        clerk: clerkRequestId,
        academy: commerce.requestId || null,
      },
    });

    return {
      ok: verified,
      state,
      reference: maskedReference,
      referenceType: resolved.referenceType,
      courseId: courseIdObserved || courseIdRequested,
      paymentState: "paid",
      entitlementState,
      commerceState: commerce.operational ? "operational" : "not-operational",
      amount,
      currency,
      reason,
      event,
    };
  }

  return { verifyPurchase, ledger };
}

module.exports = { createSecureAcademyPurchaseVerifier };
