import http from "node:http";

const listenHost = process.env.ACADEMY_OLLAMA_PROXY_HOST || "127.0.0.1";
const listenPort = Number(process.env.ACADEMY_OLLAMA_PROXY_PORT || 11436);
const upstreamHost = process.env.ACADEMY_OLLAMA_UPSTREAM_HOST || "127.0.0.1";
const upstreamPort = Number(process.env.ACADEMY_OLLAMA_UPSTREAM_PORT || 11434);
const maxRequestBytes = Math.max(1_000_000, Math.min(20_000_000, Number(process.env.ACADEMY_OLLAMA_PROXY_MAX_REQUEST_BYTES || 12_000_000)));
const upstreamTimeoutMs = Math.max(60_000, Math.min(7_200_000, Number(process.env.ACADEMY_OLLAMA_PROXY_TIMEOUT_MS || 3_600_000)));
const keepAliveIntervalMs = Math.max(5_000, Math.min(60_000, Number(process.env.ACADEMY_OLLAMA_PROXY_KEEPALIVE_MS || 15_000)));

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { ok: true, mode: "local-ollama-cpu-keepalive", upstream: `${upstreamHost}:${upstreamPort}` });
    return;
  }
  if (req.method !== "POST" || req.url !== "/api/chat") {
    json(res, 404, { error: "not-found" });
    return;
  }

  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > maxRequestBytes) {
      req.destroy(new Error(`request exceeds ${maxRequestBytes} bytes`));
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", (error) => {
    if (!res.headersSent) json(res, 400, { error: "invalid-request", message: error.message });
    else res.end();
  });
  req.on("end", () => {
    const requestBody = Buffer.concat(chunks);

    // Open the downstream response immediately. A whitespace keepalive is valid
    // before a JSON document and prevents Node/Undici header and body idle timers
    // from terminating long CPU-only Ollama generations.
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Transfer-Encoding": "chunked",
      "X-Obserra-Local-Ollama-Proxy": "keepalive-v1",
    });
    res.flushHeaders?.();
    res.write(" ");
    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(" ");
    }, keepAliveIntervalMs);
    keepAlive.unref?.();

    const upstream = http.request({
      host: upstreamHost,
      port: upstreamPort,
      path: "/api/chat",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": requestBody.length,
      },
    }, (upstreamRes) => {
      const upstreamChunks = [];
      upstreamRes.on("data", (chunk) => upstreamChunks.push(chunk));
      upstreamRes.on("end", () => {
        clearInterval(keepAlive);
        const body = Buffer.concat(upstreamChunks);
        if ((upstreamRes.statusCode || 500) >= 200 && (upstreamRes.statusCode || 500) < 300) {
          res.end(body);
          return;
        }
        res.end(JSON.stringify({
          error: "ollama-upstream-error",
          upstreamStatus: upstreamRes.statusCode || null,
          upstreamBody: body.toString("utf8").slice(0, 4000),
        }));
      });
    });

    upstream.setTimeout(upstreamTimeoutMs, () => {
      upstream.destroy(new Error(`Ollama upstream exceeded ${upstreamTimeoutMs} ms`));
    });
    upstream.on("error", (error) => {
      clearInterval(keepAlive);
      if (!res.writableEnded) res.end(JSON.stringify({ error: "ollama-upstream-failure", message: error.message }));
    });
    upstream.end(requestBody);
  });
});

server.requestTimeout = Math.max(upstreamTimeoutMs + 60_000, 3_660_000);
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;
server.listen(listenPort, listenHost, () => {
  console.log(`[Academy Studio] Local Ollama keepalive proxy listening on http://${listenHost}:${listenPort}, upstream http://${upstreamHost}:${upstreamPort}.`);
});
