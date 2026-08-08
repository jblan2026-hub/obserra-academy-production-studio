const { performance } = require("node:perf_hooks");

const MAX_HTML_BYTES = 512 * 1024;
const WEB_MONITOR_TIMEOUT_MS = 12000;

function isLoopback(hostname) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(hostname || "").toLowerCase());
}

function normalizePath(value) {
  const path = String(value || "/").trim();
  if (!path.startsWith("/")) throw new Error("HTML monitor paths must begin with a slash.");
  if (path.includes("\0") || path.includes("\\")) throw new Error("HTML monitor path is invalid.");
  return path;
}

function buildTargets(connectors) {
  const targets = [];
  const seen = new Set();
  for (const connector of connectors || []) {
    const paths = Array.isArray(connector.htmlPaths) ? connector.htmlPaths : [];
    for (const pathValue of paths) {
      const pagePath = normalizePath(pathValue);
      const url = new URL(pagePath, `${connector.url}/`);
      const key = url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        id: `${connector.id}:${pagePath}`,
        connectorId: connector.id,
        connectorName: connector.name,
        pagePath,
        url: key,
        credentialKey: connector.credentialKey || null,
      });
    }
  }
  return targets;
}

async function readBoundedHtml(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      throw new Error(`HTML response exceeded ${MAX_HTML_BYTES} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function htmlTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim().slice(0, 300) : null;
}

function looksLikeHtml(contentType, html) {
  if (/\btext\/html\b/i.test(String(contentType || ""))) return true;
  const prefix = String(html || "").slice(0, 512).toLowerCase();
  return prefix.includes("<!doctype html") || prefix.includes("<html");
}

async function monitorTarget(target, headers = {}) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_MONITOR_TIMEOUT_MS);
  try {
    const requested = new URL(target.url);
    if (requested.protocol !== "https:" && !isLoopback(requested.hostname)) {
      throw new Error("Non-loopback webpages must use HTTPS.");
    }

    const response = await fetch(requested, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        ...headers,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "User-Agent": "Obserra-Owner-Command-Center-Web-Monitor",
      },
    });
    const finalUrl = new URL(response.url || requested.toString());
    const contentType = response.headers.get("content-type") || "";
    const html = await readBoundedHtml(response);
    const httpsValid = finalUrl.protocol === "https:" || isLoopback(finalUrl.hostname);
    const htmlValid = looksLikeHtml(contentType, html);
    const protectedResponse = [401, 403].includes(response.status);
    const healthyResponse = response.ok;
    const state = healthyResponse && httpsValid && htmlValid
      ? "healthy"
      : protectedResponse && httpsValid && htmlValid
        ? "protected"
        : "degraded";

    return {
      ...target,
      state,
      checkedAt: new Date().toISOString(),
      httpStatus: response.status,
      responseOk: response.ok,
      protectedResponse,
      httpsValid,
      htmlValid,
      finalUrl: finalUrl.toString(),
      contentType,
      title: htmlTitle(html),
      responseBytes: Buffer.byteLength(html, "utf8"),
      latencyMs: Math.round(performance.now() - startedAt),
      error: null,
    };
  } catch (error) {
    return {
      ...target,
      state: "failed",
      checkedAt: new Date().toISOString(),
      httpStatus: null,
      responseOk: false,
      protectedResponse: false,
      httpsValid: false,
      htmlValid: false,
      finalUrl: null,
      contentType: null,
      title: null,
      responseBytes: 0,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function monitorWebPages(connectors, headersForConnector = () => ({})) {
  const targets = buildTargets(connectors);
  const byConnector = new Map((connectors || []).map((connector) => [connector.id, connector]));
  const pages = await Promise.all(
    targets.map((target) => {
      const connector = byConnector.get(target.connectorId);
      return monitorTarget(target, connector ? headersForConnector(connector) : {});
    }),
  );
  const healthy = pages.filter((page) => page.state === "healthy").length;
  const protectedPages = pages.filter((page) => page.state === "protected").length;
  const failed = pages.filter((page) => page.state === "failed").length;
  const degraded = pages.length - healthy - protectedPages - failed;
  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    monitorMode: "approved-https-and-html-pages",
    unrestrictedCrawling: false,
    pages,
    summary: {
      total: pages.length,
      healthy,
      protected: protectedPages,
      degraded,
      failed,
      httpsValid: pages.filter((page) => page.httpsValid).length,
      htmlValid: pages.filter((page) => page.htmlValid).length,
    },
    claimBoundary: "Healthy proves that the approved URL completed an HTTPS request and returned HTML at the recorded time. It does not prove every application workflow, authenticated transaction, or downstream dependency.",
  };
}

module.exports = {
  MAX_HTML_BYTES,
  WEB_MONITOR_TIMEOUT_MS,
  buildTargets,
  htmlTitle,
  looksLikeHtml,
  monitorTarget,
  monitorWebPages,
};
