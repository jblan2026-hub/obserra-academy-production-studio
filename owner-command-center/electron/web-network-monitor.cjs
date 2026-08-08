const dns = require("node:dns").promises;
const net = require("node:net");
const os = require("node:os");
const tls = require("node:tls");

const { resolvedConnectors } = require("./connectors.cjs");
const { networkTopology } = require("./discovery.cjs");

const PAGE_TIMEOUT_MS = 15000;
const NETWORK_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_CUSTOM_PAGES = 100;

const DEFAULT_WEBPAGES = Object.freeze([
  {
    id: "public-website",
    name: "Obserra public website",
    url: "https://www.obserrallc.com/",
    category: "website",
    managed: true,
  },
  {
    id: "academy-website",
    name: "Obserra Academy",
    url: "https://www.obserrallc.com/academy",
    category: "academy",
    managed: true,
  },
  {
    id: "applications-website",
    name: "Obserra applications",
    url: "https://www.obserrallc.com/applications",
    category: "applications",
    managed: true,
  },
  {
    id: "store-website",
    name: "Obserra Store",
    url: "https://www.obserrallc.com/store",
    category: "commerce",
    managed: true,
  },
  {
    id: "owner-command-center",
    name: "Private owner Command Center",
    url: "https://owner.obserrallc.com/",
    category: "owner-control",
    managed: true,
  },
]);

function nowIso() {
  return new Date().toISOString();
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error).slice(0, 2000);
}

function normalizeHttpsUrl(value) {
  const parsed = new URL(String(value || "").trim());
  if (parsed.protocol !== "https:") {
    throw new Error("Monitored webpages must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Monitored webpage URLs cannot contain embedded credentials.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function slug(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || `page-${Date.now().toString(36)}`;
}

function customPages(store) {
  const values = store.get("webpages.custom");
  return Array.isArray(values)
    ? values.filter((page) => page && typeof page === "object")
    : [];
}

function configuredPages(store) {
  const byId = new Map(DEFAULT_WEBPAGES.map((page) => [page.id, { ...page }]));
  for (const page of customPages(store)) {
    if (!page.id || !page.url) continue;
    byId.set(String(page.id), {
      id: String(page.id),
      name: String(page.name || page.id),
      url: normalizeHttpsUrl(page.url),
      category: String(page.category || "custom"),
      managed: false,
    });
  }
  return [...byId.values()].sort((left, right) =>
    `${left.category}:${left.name}`.localeCompare(`${right.category}:${right.name}`),
  );
}

function addOrUpdatePage(store, input) {
  const name = String(input?.name || "").trim();
  if (name.length < 2 || name.length > 160) {
    throw new Error("A monitored webpage name between 2 and 160 characters is required.");
  }
  const url = normalizeHttpsUrl(input?.url);
  const category = String(input?.category || "custom").trim().slice(0, 80) || "custom";
  const existing = customPages(store);
  let id = slug(input?.id || name);
  const matchingUrl = existing.find((page) => page.url === url);
  if (matchingUrl) id = matchingUrl.id;
  if (!matchingUrl && existing.length >= MAX_CUSTOM_PAGES) {
    throw new Error(`No more than ${MAX_CUSTOM_PAGES} custom webpages may be monitored.`);
  }
  const record = { id, name, url, category, managed: false, updatedAt: nowIso() };
  const next = existing.filter((page) => page.id !== id && page.url !== url);
  next.push(record);
  store.set("webpages.custom", next);
  return record;
}

function removePage(store, pageId) {
  const id = String(pageId || "").trim();
  if (DEFAULT_WEBPAGES.some((page) => page.id === id)) {
    throw new Error("Managed Obserra webpages cannot be removed from monitoring.");
  }
  const existing = customPages(store);
  const next = existing.filter((page) => page.id !== id);
  if (next.length === existing.length) throw new Error("Monitored webpage was not found.");
  store.set("webpages.custom", next);
  const results = { ...(store.get("webpages.lastResults") || {}) };
  delete results[id];
  store.set("webpages.lastResults", results);
  return { removed: true, id };
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
      try {
        await reader.cancel();
      } catch {
        // The response is already bounded and the scan can continue with a clear error.
      }
      throw new Error(`HTML response exceeded ${MAX_HTML_BYTES} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchHttpsPage(url, signal, redirects = 0) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      "User-Agent": "Obserra-Owner-Command-Center/0.5 Webpage-Monitor",
      "Cache-Control": "no-cache",
    },
    redirect: "manual",
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw new Error("HTTPS webpage redirect limit exceeded.");
    const location = response.headers.get("location");
    if (!location) throw new Error(`HTTP ${response.status} redirect did not include a location.`);
    const nextUrl = normalizeHttpsUrl(new URL(location, url).toString());
    return fetchHttpsPage(nextUrl, signal, redirects + 1);
  }
  return { response, finalUrl: normalizeHttpsUrl(response.url || url), redirects };
}

function extractTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return match[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || null;
}

function headerEvidence(headers) {
  const names = [
    "strict-transport-security",
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "x-frame-options",
  ];
  return Object.fromEntries(names.map((name) => [name, headers.get(name) || null]));
}

async function scanPage(page) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const requestedUrl = normalizeHttpsUrl(page.url);
    const { response, finalUrl, redirects } = await fetchHttpsPage(
      requestedUrl,
      controller.signal,
    );
    const html = await readBoundedHtml(response);
    const contentType = response.headers.get("content-type") || "";
    const htmlContentType = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
    const htmlDocument = /<!doctype\s+html|<html(?:\s|>)/i.test(html);
    const https = new URL(finalUrl).protocol === "https:";
    const title = extractTitle(html);
    const headers = headerEvidence(response.headers);
    const securityHeaderCount = Object.values(headers).filter(Boolean).length;
    const healthy = response.ok && https && htmlContentType && htmlDocument;
    return {
      id: page.id,
      name: page.name,
      category: page.category,
      requestedUrl,
      finalUrl,
      managed: page.managed === true,
      checkedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      status: healthy ? "healthy" : "degraded",
      httpStatus: response.status,
      https,
      html: htmlContentType && htmlDocument,
      htmlContentType,
      htmlDocument,
      contentType: contentType || null,
      contentLength: Buffer.byteLength(html, "utf8"),
      title,
      redirects,
      securityHeaders: headers,
      securityHeaderCount,
      error: healthy
        ? null
        : [
          !response.ok ? `HTTP ${response.status}` : null,
          !https ? "final response was not HTTPS" : null,
          !htmlContentType ? `content type was ${contentType || "missing"}` : null,
          !htmlDocument ? "response did not contain an HTML document" : null,
        ].filter(Boolean).join("; "),
    };
  } catch (error) {
    return {
      id: page.id,
      name: page.name,
      category: page.category,
      requestedUrl: page.url,
      finalUrl: null,
      managed: page.managed === true,
      checkedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      status: "failed",
      httpStatus: null,
      https: true,
      html: false,
      htmlContentType: false,
      htmlDocument: false,
      contentType: null,
      contentLength: 0,
      title: null,
      redirects: 0,
      securityHeaders: {},
      securityHeaderCount: 0,
      error: controller.signal.aborted
        ? `HTTPS and HTML check timed out after ${PAGE_TIMEOUT_MS} ms.`
        : safeError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function testTcpConnection({ hostname, port, secure }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const options = secure
      ? {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: true,
      }
      : { host: hostname, port };
    const socket = secure ? tls.connect(options) : net.connect(options);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, latencyMs: Date.now() - startedAt });
    };
    socket.setTimeout(NETWORK_TIMEOUT_MS);
    socket.once(secure ? "secureConnect" : "connect", () => {
      const certificate = secure && typeof socket.getPeerCertificate === "function"
        ? socket.getPeerCertificate()
        : null;
      finish({
        connected: true,
        authorized: secure ? socket.authorized === true : true,
        authorizationError: secure ? socket.authorizationError || null : null,
        certificateSubject: certificate?.subject?.CN || null,
        certificateIssuer: certificate?.issuer?.CN || null,
        certificateValidTo: certificate?.valid_to || null,
      });
    });
    socket.once("timeout", () => finish({ connected: false, authorized: false, error: "connection timed out" }));
    socket.once("error", (error) => finish({ connected: false, authorized: false, error: safeError(error) }));
  });
}

async function analyzeService(connector) {
  const parsed = new URL(connector.url);
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const secure = parsed.protocol === "https:";
  const startedAt = Date.now();
  try {
    const addresses = await withTimeout(
      dns.lookup(parsed.hostname, { all: true, verbatim: true }),
      NETWORK_TIMEOUT_MS,
      "DNS lookup timed out",
    );
    const transport = await testTcpConnection({
      hostname: parsed.hostname,
      port,
      secure,
    });
    const lastStatus = connector.storeStatus || null;
    return {
      id: connector.id,
      name: connector.name,
      url: connector.url,
      hostname: parsed.hostname,
      protocol: parsed.protocol,
      port,
      localOnly: connector.localOnly === true,
      checkedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      dnsResolved: addresses.length > 0,
      addresses: addresses.slice(0, 8).map((address) => ({
        address: address.address,
        family: address.family,
      })),
      transportConnected: transport.connected === true,
      tlsAuthorized: secure ? transport.authorized === true : null,
      transport,
      applicationStatus: lastStatus?.status || "not-checked",
      applicationHttpStatus: lastStatus?.httpStatus || null,
      status: transport.connected && (!secure || transport.authorized)
        ? "reachable"
        : "failed",
      error: transport.error || transport.authorizationError || null,
    };
  } catch (error) {
    return {
      id: connector.id,
      name: connector.name,
      url: connector.url,
      hostname: parsed.hostname,
      protocol: parsed.protocol,
      port,
      localOnly: connector.localOnly === true,
      checkedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      dnsResolved: false,
      addresses: [],
      transportConnected: false,
      tlsAuthorized: secure ? false : null,
      transport: null,
      applicationStatus: connector.storeStatus?.status || "not-checked",
      applicationHttpStatus: connector.storeStatus?.httpStatus || null,
      status: "failed",
      error: safeError(error),
    };
  }
}

function createWebNetworkMonitor({ store }) {
  if (!store) throw new Error("A durable Command Center store is required.");

  function pageSnapshot() {
    const results = store.get("webpages.lastResults") || {};
    const pages = configuredPages(store).map((page) => ({
      ...page,
      result: results[page.id] || null,
    }));
    const checked = pages.filter((page) => page.result);
    return {
      schemaVersion: "1.0",
      checkedAt: store.get("webpages.lastScan.checkedAt") || null,
      pages,
      total: pages.length,
      healthy: checked.filter((page) => page.result.status === "healthy").length,
      degraded: checked.filter((page) => page.result.status === "degraded").length,
      failed: checked.filter((page) => page.result.status === "failed").length,
      unchecked: pages.length - checked.length,
      contract: "Every monitored webpage must complete an HTTPS request and return an HTML document. API health endpoints are monitored separately as service connectors.",
    };
  }

  async function scanAll(trigger = "owner-requested") {
    const pages = configuredPages(store);
    const resultsList = await Promise.all(pages.map(scanPage));
    const results = Object.fromEntries(resultsList.map((result) => [result.id, result]));
    const record = {
      trigger,
      checkedAt: nowIso(),
      total: resultsList.length,
      healthy: resultsList.filter((result) => result.status === "healthy").length,
      degraded: resultsList.filter((result) => result.status === "degraded").length,
      failed: resultsList.filter((result) => result.status === "failed").length,
    };
    store.set("webpages.lastResults", results);
    store.set("webpages.lastScan", record);
    return pageSnapshot();
  }

  async function scanOne(pageId) {
    const page = configuredPages(store).find((candidate) => candidate.id === pageId);
    if (!page) throw new Error("Monitored webpage was not found.");
    const result = await scanPage(page);
    const results = { ...(store.get("webpages.lastResults") || {}), [page.id]: result };
    store.set("webpages.lastResults", results);
    store.set("webpages.lastScan", {
      trigger: `single-page:${page.id}`,
      checkedAt: result.checkedAt,
    });
    return result;
  }

  function networkSnapshot() {
    const connectors = resolvedConnectors(store).map((connector) => ({
      ...connector,
      storeStatus: store.get(`connectors.${connector.id}.lastStatus`) || null,
    }));
    return {
      schemaVersion: "1.0",
      checkedAt: store.get("network.lastAnalysis.checkedAt") || null,
      topology: networkTopology(connectors),
      services: store.get("network.lastAnalysis.services") || connectors.map((connector) => ({
        id: connector.id,
        name: connector.name,
        url: connector.url,
        status: "not-checked",
        applicationStatus: connector.storeStatus?.status || "not-checked",
      })),
      local: {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        uptimeSeconds: Math.round(os.uptime()),
      },
      contract: "Network analysis is limited to local interfaces and approved Obserra service endpoints. It does not perform unrestricted network or port scanning.",
    };
  }

  async function analyzeNetwork(trigger = "owner-requested") {
    const connectors = resolvedConnectors(store).map((connector) => ({
      ...connector,
      storeStatus: store.get(`connectors.${connector.id}.lastStatus`) || null,
    }));
    const services = await Promise.all(connectors.map(analyzeService));
    store.set("network.lastAnalysis", {
      trigger,
      checkedAt: nowIso(),
      services,
    });
    return networkSnapshot();
  }

  return {
    addOrUpdatePage: (input) => addOrUpdatePage(store, input),
    removePage: (pageId) => removePage(store, pageId),
    getPageSnapshot: pageSnapshot,
    scanAll,
    scanOne,
    getNetworkSnapshot: networkSnapshot,
    analyzeNetwork,
  };
}

module.exports = {
  DEFAULT_WEBPAGES,
  createWebNetworkMonitor,
  normalizeHttpsUrl,
};
