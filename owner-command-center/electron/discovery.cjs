const dns = require("node:dns").promises;
const os = require("node:os");

const { monitorWebPages } = require("./web-monitor.cjs");

const MAX_RESPONSE_BYTES = 512 * 1024;
const DISCOVERY_TIMEOUT_MS = 8000;

function networkTopology(connectors) {
  const interfaces = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.internal) continue;
      interfaces.push({
        name,
        family: address.family,
        address: address.address,
        cidr: address.cidr || null,
        mac: address.mac || null,
      });
    }
  }
  interfaces.sort((a, b) => `${a.name}:${a.address}`.localeCompare(`${b.name}:${b.address}`));

  const approvedServices = connectors.map((connector) => {
    const parsed = new URL(connector.url);
    return {
      id: connector.id,
      name: connector.name,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
      localOnly: connector.localOnly === true,
      intelligenceReporting: Boolean(connector.intelligencePath),
      htmlMonitoring: Array.isArray(connector.htmlPaths) && connector.htmlPaths.length > 0,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return {
    hostname: os.hostname(),
    interfaces,
    approvedServices,
    discoveryMode: "approved-endpoints-and-local-interfaces",
    unrestrictedPortScanning: false,
  };
}

async function resolveApprovedService(service) {
  const startedAt = Date.now();
  try {
    const addresses = await dns.lookup(service.hostname, { all: true, verbatim: true });
    return {
      ...service,
      dnsState: "resolved",
      addresses: addresses.map((entry) => ({ address: entry.address, family: entry.family })),
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      ...service,
      dnsState: "failed",
      addresses: [],
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function analyzeApprovedNetwork(connectors, headersForConnector = () => ({})) {
  const topology = networkTopology(connectors);
  const [services, web] = await Promise.all([
    Promise.all(topology.approvedServices.map(resolveApprovedService)),
    monitorWebPages(connectors, headersForConnector),
  ]);
  const resolved = services.filter((service) => service.dnsState === "resolved").length;
  const httpsServices = services.filter(
    (service) => service.protocol === "https:" || service.localOnly,
  ).length;
  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    hostname: topology.hostname,
    interfaces: topology.interfaces,
    services,
    webPages: web.pages,
    summary: {
      interfaces: topology.interfaces.length,
      services: services.length,
      dnsResolved: resolved,
      dnsFailed: services.length - resolved,
      encryptedOrLocalServices: httpsServices,
      webpageTotal: web.summary.total,
      webpageHealthy: web.summary.healthy,
      webpageProtected: web.summary.protected,
      webpageDegraded: web.summary.degraded,
      webpageFailed: web.summary.failed,
    },
    discoveryMode: topology.discoveryMode,
    unrestrictedPortScanning: false,
    claimBoundary: "Network analysis is limited to local interface inventory, DNS resolution for approved connectors, and approved HTTPS and HTML webpage checks. It does not perform unrestricted network or port scanning.",
  };
}

async function readBoundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      throw new Error("Intelligence response exceeded the approved size limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function collectIntelligence(connector, headers) {
  if (!connector.intelligencePath) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(`${connector.url}${connector.intelligencePath}`, {
      method: "GET",
      headers: {
        ...headers,
        Accept: "application/json",
        "X-Obserra-Intelligence-Contract": "obserra-intelligence-v1",
      },
      signal: controller.signal,
      redirect: "error",
    });
    if (response.status === 404) {
      return {
        sourceId: connector.id,
        status: "not-supported",
        observedAt: new Date().toISOString(),
      };
    }
    if (!response.ok) {
      return {
        sourceId: connector.id,
        status: "degraded",
        httpStatus: response.status,
        observedAt: new Date().toISOString(),
      };
    }
    const text = await readBoundedText(response);
    const report = text ? JSON.parse(text) : {};
    return {
      sourceId: connector.id,
      status: "reporting",
      contract: report.contract || null,
      observedAt: new Date().toISOString(),
      report,
      memory: typeof report.memory === "string" ? report.memory : null,
    };
  } catch (error) {
    return {
      sourceId: connector.id,
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
      observedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  analyzeApprovedNetwork,
  collectIntelligence,
  networkTopology,
};
