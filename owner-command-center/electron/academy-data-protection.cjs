"use strict";

const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|token|secret|password|passphrase|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|session|customer[_-]?email|email|phone|address|billing|shipping|card|cvc|cvv|pan|account[_-]?number|routing[_-]?number|payment[_-]?method|payment[_-]?intent|client[_-]?secret)/i;
const KEEP_LAST4_KEY = /(?:last4|brand|funding|exp_month|exp_year)/i;
const TOKEN_PATTERN = /\b(?:sk|pk|rk|whsec|ghp|github_pat|Bearer)[-_A-Za-z0-9.]{8,}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_DIGIT_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const MAX_STRING = 4000;
const MAX_DEPTH = 12;
const MAX_ARRAY = 100;

function maskEmail(value) {
  const text = String(value || "");
  const [local, domain] = text.split("@");
  if (!domain) return "[REDACTED]";
  const visible = local.slice(0, 1);
  return `${visible || "*"}***@${domain}`;
}

function sanitizeString(value) {
  return String(value || "")
    .replace(TOKEN_PATTERN, "[REDACTED_SECRET]")
    .replace(EMAIL_PATTERN, (email) => maskEmail(email))
    .replace(LONG_DIGIT_PATTERN, "[REDACTED_PAYMENT_DATA]")
    .slice(0, MAX_STRING);
}

function redactValue(value, key = "", depth = 0) {
  if (depth > MAX_DEPTH) return "[REDACTED_DEPTH_LIMIT]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (SENSITIVE_KEY.test(key) && !KEEP_LAST4_KEY.test(key)) return "[REDACTED]";
    return sanitizeString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    if (SENSITIVE_KEY.test(key) && !KEEP_LAST4_KEY.test(key)) return "[REDACTED]";
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redactValue(item, key, depth + 1));
  }

  if (typeof value === "object") {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(childKey) && !KEEP_LAST4_KEY.test(childKey)) {
        output[childKey] = "[REDACTED]";
      } else {
        output[childKey] = redactValue(childValue, childKey, depth + 1);
      }
    }
    return output;
  }

  return sanitizeString(value);
}

function ownerSafe(value) {
  return redactValue(value);
}

function ownerSafeError(error) {
  return sanitizeString(error instanceof Error ? error.message : String(error));
}

module.exports = {
  ownerSafe,
  ownerSafeError,
  sanitizeString,
};
