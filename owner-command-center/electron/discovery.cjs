const os = require("node:os");

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

module.exports = { networkTopology, collectIntelligence };
