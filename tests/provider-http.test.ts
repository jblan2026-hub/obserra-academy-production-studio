import assert from "node:assert/strict";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import {
  ProviderTransportError,
  providerHttpRequest,
} from "../studio/provider-http.mjs";

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  operation: (baseUrl: string) => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("provider transport accepts delayed loopback response headers within the governed timeout", async () => {
  await withServer(
    (_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json", "x-request-id": "req-delayed" });
        response.end(JSON.stringify({ output_text: "READY" }));
      }, 150);
    },
    async (baseUrl) => {
      const response = await providerHttpRequest({
        provider: "openai",
        url: `${baseUrl}/v1/responses`,
        body: JSON.stringify({ input: "READY" }),
        headers: { "content-type": "application/json" },
        timeoutMs: 2_000,
      });

      assert.equal(response.ok, true);
      assert.equal(response.status, 200);
      assert.equal(response.headers["x-request-id"], "req-delayed");
      assert.deepEqual(await response.json(), { output_text: "READY" });
    },
  );
});

test("provider transport does not automatically follow redirects", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(307, { location: "https://example.invalid/redirected" });
      response.end("redirect denied");
    },
    async (baseUrl) => {
      const response = await providerHttpRequest({
        provider: "openai",
        url: `${baseUrl}/v1/responses`,
        body: "{}",
        headers: { "content-type": "application/json" },
        timeoutMs: 2_000,
      });

      assert.equal(response.ok, false);
      assert.equal(response.status, 307);
      assert.equal(await response.text(), "redirect denied");
    },
  );
});

test("provider transport bounds response size", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("x".repeat(4_096));
    },
    async (baseUrl) => {
      await assert.rejects(
        providerHttpRequest({
          provider: "openai",
          url: `${baseUrl}/v1/responses`,
          body: "{}",
          headers: { "content-type": "application/json" },
          timeoutMs: 2_000,
          maximumResponseBytes: 1_024,
        }),
        (error: unknown) => {
          assert.ok(error instanceof ProviderTransportError);
          assert.equal(error.category, "provider_response_too_large");
          return true;
        },
      );
    },
  );
});

test("provider transport rejects unencrypted non-loopback endpoints", async () => {
  await assert.rejects(
    providerHttpRequest({
      provider: "openai",
      url: "http://example.com/v1/responses",
      body: "{}",
      timeoutMs: 2_000,
    }),
    /must use HTTPS/,
  );
});
