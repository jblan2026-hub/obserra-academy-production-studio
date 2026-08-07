export const AUTHORING_EXIT_CODES = Object.freeze({
  PROVIDER_QUOTA_EXHAUSTED: 42,
  PROVIDER_AUTHENTICATION_FAILED: 43,
  PROVIDER_REQUEST_INVALID: 44,
  CHECKPOINT_PERSISTENCE_FAILED: 45,
});

export class ProviderAuthoringError extends Error {
  constructor({ provider, category, retryable, exitCode, status = null, providerCode = null, message }) {
    super(message);
    this.name = "ProviderAuthoringError";
    this.provider = provider;
    this.category = category;
    this.retryable = retryable;
    this.exitCode = exitCode;
    this.status = status;
    this.providerCode = providerCode;
  }
}

function parsedProviderError(body) {
  if (typeof body !== "string" || !body.trim()) return {};
  try {
    const payload = JSON.parse(body);
    const error = payload?.error ?? payload;
    return {
      code: typeof error?.code === "string" ? error.code : null,
      type: typeof error?.type === "string" ? error.type : null,
      message: typeof error?.message === "string" ? error.message : body,
    };
  } catch {
    return { code: null, type: null, message: body };
  }
}

function normalizedText(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function classifyProviderHttpFailure({ provider, status, body }) {
  const parsed = parsedProviderError(body);
  const code = normalizedText(parsed.code);
  const type = normalizedText(parsed.type);
  const message = normalizedText(parsed.message);
  const quotaExhausted =
    status === 429 && (
      code.includes("insufficient_quota") ||
      code.includes("credit_balance_exhausted") ||
      type.includes("insufficient_quota") ||
      type.includes("credit_balance_exhausted") ||
      message.includes("exceeded your current quota") ||
      message.includes("no credits remaining") ||
      message.includes("add credits to continue") ||
      message.includes("billing quota") ||
      message.includes("billing limit")
    );

  if (quotaExhausted) {
    return {
      provider,
      category: "provider_quota_exhausted",
      retryable: false,
      exitCode: AUTHORING_EXIT_CODES.PROVIDER_QUOTA_EXHAUSTED,
      status,
      providerCode: parsed.code ?? parsed.type ?? null,
      message: parsed.message || `${provider} authoring quota is exhausted.`,
    };
  }

  if (status === 401 || status === 403) {
    return {
      provider,
      category: "provider_authentication_failed",
      retryable: false,
      exitCode: AUTHORING_EXIT_CODES.PROVIDER_AUTHENTICATION_FAILED,
      status,
      providerCode: parsed.code ?? parsed.type ?? null,
      message: parsed.message || `${provider} authoring authentication failed.`,
    };
  }

  if ([300, 301, 302, 303, 307, 308, 400, 404, 413, 422].includes(status)) {
    return {
      provider,
      category: "provider_request_invalid",
      retryable: false,
      exitCode: AUTHORING_EXIT_CODES.PROVIDER_REQUEST_INVALID,
      status,
      providerCode: parsed.code ?? parsed.type ?? null,
      message: parsed.message || `${provider} rejected the authoring request.`,
    };
  }

  return {
    provider,
    category: "provider_transient_failure",
    retryable: true,
    exitCode: 1,
    status,
    providerCode: parsed.code ?? parsed.type ?? null,
    message: parsed.message || `${provider} authoring request failed with HTTP ${status}.`,
  };
}

export function providerAuthoringErrorFromHttp({ provider, status, body }) {
  return new ProviderAuthoringError(classifyProviderHttpFailure({ provider, status, body }));
}

export function classificationFromAuthoringExit({ exitCode, timedOut = false, signal = null }) {
  if (timedOut) {
    return {
      category: "authoring_process_timeout",
      retryable: true,
      exitCode: exitCode ?? 1,
    };
  }
  if (exitCode === AUTHORING_EXIT_CODES.PROVIDER_QUOTA_EXHAUSTED) {
    return {
      category: "provider_quota_exhausted",
      retryable: false,
      exitCode,
    };
  }
  if (exitCode === AUTHORING_EXIT_CODES.PROVIDER_AUTHENTICATION_FAILED) {
    return {
      category: "provider_authentication_failed",
      retryable: false,
      exitCode,
    };
  }
  if (exitCode === AUTHORING_EXIT_CODES.PROVIDER_REQUEST_INVALID) {
    return {
      category: "provider_request_invalid",
      retryable: false,
      exitCode,
    };
  }
  if (exitCode === AUTHORING_EXIT_CODES.CHECKPOINT_PERSISTENCE_FAILED) {
    return {
      category: "authoring_checkpoint_persistence_failed",
      retryable: false,
      exitCode,
    };
  }
  if (signal) {
    return {
      category: "authoring_process_signal_failure",
      retryable: true,
      exitCode: exitCode ?? 1,
    };
  }
  return {
    category: "authoring_process_failure",
    retryable: true,
    exitCode: exitCode ?? 1,
  };
}
