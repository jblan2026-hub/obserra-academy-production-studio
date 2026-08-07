import http from "node:http";
import https from "node:https";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function validatedProviderUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Authoring provider URL is invalid.");
  }

  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("Authoring provider URL cannot contain credentials or a fragment.");
  }
  if (parsed.protocol === "https:") return parsed;
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed;
  throw new Error("Authoring provider URL must use HTTPS except for an approved loopback test endpoint.");
}

export class ProviderTransportError extends Error {
  constructor(provider, category, message, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProviderTransportError";
    this.provider = provider;
    this.category = category;
    this.retryable = true;
  }
}

export async function providerHttpRequest({
  provider,
  url,
  method = "POST",
  headers = {},
  body = "",
  timeoutMs = 15 * 60 * 1000,
  maximumResponseBytes = 64 * 1024 * 1024,
}) {
  const parsed = validatedProviderUrl(url);
  const requestTimeoutMs = boundedNumber(timeoutMs, 15 * 60 * 1000, 1000, 30 * 60 * 1000);
  const responseLimit = boundedNumber(maximumResponseBytes, 64 * 1024 * 1024, 1024, 128 * 1024 * 1024);
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const transport = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimeout);
      callback(value);
    };

    const request = transport.request(
      parsed,
      {
        method,
        headers: {
          accept: "application/json",
          ...headers,
          ...(payloadBuffer.length > 0 ? { "content-length": String(payloadBuffer.length) } : {}),
        },
        agent: false,
      },
      (response) => {
        const chunks = [];
        let receivedBytes = 0;

        response.on("data", (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > responseLimit) {
            response.destroy(
              new ProviderTransportError(
                provider,
                "provider_response_too_large",
                `${provider} authoring response exceeded ${responseLimit} bytes.`,
              ),
            );
            return;
          }
          chunks.push(buffer);
        });

        response.on("aborted", () => {
          finish(
            reject,
            new ProviderTransportError(
              provider,
              "provider_connection_aborted",
              `${provider} closed the authoring response before completion.`,
            ),
          );
        });

        response.on("error", (error) => {
          finish(
            reject,
            error instanceof ProviderTransportError
              ? error
              : new ProviderTransportError(
                  provider,
                  "provider_response_failure",
                  `${provider} authoring response failed before completion.`,
                  error,
                ),
          );
        });

        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          const status = Number(response.statusCode ?? 0);
          const normalizedHeaders = Object.fromEntries(
            Object.entries(response.headers).map(([name, value]) => [
              name,
              Array.isArray(value) ? value.join(", ") : String(value ?? ""),
            ]),
          );
          finish(resolve, {
            ok: status >= 200 && status < 300,
            status,
            headers: normalizedHeaders,
            async text() {
              return responseBody;
            },
            async json() {
              return JSON.parse(responseBody);
            },
          });
        });
      },
    );

    const overallTimeout = setTimeout(() => {
      request.destroy(
        new ProviderTransportError(
          provider,
          "provider_request_timeout",
          `${provider} authoring request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`,
        ),
      );
    }, requestTimeoutMs);

    request.on("error", (error) => {
      finish(
        reject,
        error instanceof ProviderTransportError
          ? error
          : new ProviderTransportError(
              provider,
              "provider_connection_failure",
              `${provider} authoring connection failed.`,
              error,
            ),
      );
    });

    request.end(payloadBuffer);
  });
}
