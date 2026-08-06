const connectorContainer = document.getElementById("connectors");
const connectorTemplate = document.getElementById("connectorTemplate");
const metrics = document.getElementById("metrics");
const localBadge = document.getElementById("localBadge");
const refreshBadge = document.getElementById("refreshBadge");
const securitySummary = document.getElementById("securitySummary");
const gapContainer = document.getElementById("gaps");
const gapCount = document.getElementById("gapCount");
const REFRESH_INTERVAL_MS = 30000;
let snapshot;
let connectorState = [];
let refreshTimer;
let refreshInFlight = false;

function statusLabel(status) {
  return ({ connected: "Connected", degraded: "Degraded", failed: "Unavailable", unconfigured: "Needs authorization" })[status] || "Not checked";
}

function gapForConnector(connector) {
  if (connector.status === "connected" && connector.controlEnabled) return null;
  if (connector.status === "connected") {
    return {
      severity: "medium",
      title: `${connector.name}: monitoring only`,
      detail: "The service is reachable, but privileged owner control is not authorized.",
      action: connector.credentialKey ? "Provide the owner credential and re-run verification." : "Review the connector control policy."
    };
  }
  if (connector.status === "unconfigured") {
    return {
      severity: "high",
      title: `${connector.name}: authorization required`,
      detail: "The connector cannot validate privileged operations because its owner credential is missing.",
      action: "Select Authorize / configure and store the credential using Windows device encryption."
    };
  }
  if (connector.status === "degraded") {
    return {
      severity: "high",
      title: `${connector.name}: degraded`,
      detail: `The endpoint responded with HTTP ${connector.httpStatus || "an unhealthy status"}.",
      action: "Inspect the service health endpoint, identity configuration, and current deployment logs."
    };
  }
  return {
    severity: "critical",
    title: `${connector.name}: unavailable`,
    detail: connector.error || "The endpoint could not be reached or verified.",
    action: "Confirm endpoint, network reachability, service deployment, and credentials."
  };
}

function renderMetrics() {
  const connected = connectorState.filter((item) => item.status === "connected").length;
  const degraded = connectorState.filter((item) => item.status === "degraded").length;
  const failed = connectorState.filter((item) => item.status === "failed").length;
  const controlEnabled = connectorState.filter((item) => item.controlEnabled).length;
  const cards = [
    ["Connected services", `${connected}/${connectorState.length}`],
    ["Degraded services", String(degraded)],
    ["Unavailable services", String(failed)],
    ["Control-enabled", String(controlEnabled)],
    ["Logical processors", String(snapshot.logicalProcessors)],
    ["Memory available", `${snapshot.freeMemoryGb} GB`],
    ["Windows encryption", snapshot.windowsEncryption ? "Available" : "Unavailable"]
  ];
  metrics.replaceChildren(...cards.map(([label, value]) => {
    const element = document.createElement("div");
    element.className = "metric";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("strong");
    v.textContent = value;
    element.append(l, v);
    return element;
  }));
}

function renderGaps() {
  const gaps = connectorState.map(gapForConnector).filter(Boolean);
  gapCount.textContent = `${gaps.length} active gap${gaps.length === 1 ? "" : "s"}`;
  gapCount.className = gaps.length === 0 ? "gapCount clear" : "gapCount";
  gapContainer.replaceChildren();
  if (gaps.length === 0) {
    const clear = document.createElement("div");
    clear.className = "gapItem clear";
    clear.innerHTML = "<strong>No active connector gaps.</strong><span>All approved services are connected and owner-control authorization is verified.</span>";
    gapContainer.append(clear);
    return;
  }
  for (const gap of gaps) {
    const item = document.createElement("article");
    item.className = `gapItem ${gap.severity}`;
    const title = document.createElement("strong");
    title.textContent = gap.title;
    const detail = document.createElement("span");
    detail.textContent = gap.detail;
    const action = document.createElement("em");
    action.textContent = `Required action: ${gap.action}`;
    item.append(title, detail, action);
    gapContainer.append(item);
  }
}

function renderSecurity() {
  const enabled = connectorState.filter((item) => item.controlEnabled).length;
  securitySummary.replaceChildren();
  const rows = [
    ["Local security boundary", snapshot.localOnly ? "Enforced" : "Not verified"],
    ["Windows credential encryption", snapshot.windowsEncryption ? "Available" : "Unavailable"],
    ["Control authorization", `${enabled} connector(s) verified and enabled`],
    ["Continuous monitoring", `Automatic refresh every ${REFRESH_INTERVAL_MS / 1000} seconds`],
    ["Expansion policy", "Signed definitions only; new resources begin read-only"],
    ["Fail-safe mode", "Unverified or unhealthy connectors cannot execute write actions"]
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    row.append(strong, document.createTextNode(value));
    securitySummary.append(row);
  }
}

function renderConnectors() {
  connectorContainer.replaceChildren();
  for (const connector of connectorState) {
    const fragment = connectorTemplate.content.cloneNode(true);
    fragment.querySelector("h3").textContent = connector.name;
    fragment.querySelector(".endpoint").textContent = connector.url;
    fragment.querySelector(".description").textContent = connector.description;
    const status = fragment.querySelector(".status");
    status.textContent = statusLabel(connector.status);
    status.className = `status ${connector.status || "unconfigured"}`;
    fragment.querySelector(".connectorMeta").textContent = connector.controlEnabled
      ? `Verified · owner control enabled · checked ${connector.checkedAt || "now"}`
      : connector.error || (connector.configured ? "Reachable or configured, but privileged control is not yet verified" : "Credential or owner authorization required");
    fragment.querySelector(".configure").addEventListener("click", async () => {
      const url = window.prompt(`${connector.name} endpoint`, connector.url);
      if (url === null) return;
      const secret = connector.credentialKey ? window.prompt(`${connector.name} owner credential. It will be encrypted by Windows.`) : undefined;
      try {
        const updated = await window.obserraOwner.configureConnector({ id: connector.id, url, secret });
        connectorState = connectorState.map((item) => item.id === updated.id ? updated : item);
        renderAll();
      } catch (error) {
        window.alert(error.message || String(error));
      }
    });
    connectorContainer.append(fragment);
  }
}

function renderAll() {
  renderMetrics();
  renderGaps();
  renderConnectors();
  renderSecurity();
}

async function probeAll({ manual = false } = {}) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const button = document.getElementById("connectAll");
  button.disabled = true;
  button.textContent = manual ? "Refreshing…" : "Checking…";
  refreshBadge.textContent = "Live status checking…";
  refreshBadge.classList.remove("ok", "warn");
  try {
    connectorState = await window.obserraOwner.probeAllConnectors();
    const unhealthy = connectorState.filter((item) => item.status !== "connected").length;
    const now = new Date();
    refreshBadge.textContent = `Updated ${now.toLocaleTimeString()} · ${unhealthy} gap${unhealthy === 1 ? "" : "s"}`;
    refreshBadge.classList.toggle("ok", unhealthy === 0);
    refreshBadge.classList.toggle("warn", unhealthy > 0);
    renderAll();
  } catch (error) {
    refreshBadge.textContent = "Live refresh failed";
    refreshBadge.classList.add("warn");
  } finally {
    button.disabled = false;
    button.textContent = "Refresh all now";
    refreshInFlight = false;
  }
}

document.getElementById("connectAll").addEventListener("click", () => probeAll({ manual: true }));
document.getElementById("exportConfig").addEventListener("click", async () => {
  const passphrase = window.prompt("Create a recovery passphrase of at least 14 characters.");
  if (!passphrase) return;
  try {
    const result = await window.obserraOwner.exportRecoveryBundle(passphrase);
    if (result.exported) window.alert("Encrypted owner recovery bundle exported successfully.");
  } catch (error) {
    window.alert(error.message || String(error));
  }
});
document.getElementById("importConfig").addEventListener("click", async () => {
  const passphrase = window.prompt("Enter the recovery bundle passphrase.");
  if (!passphrase) return;
  try {
    const result = await window.obserraOwner.importRecoveryBundle(passphrase);
    if (result.imported) {
      connectorState = result.connectors;
      renderAll();
    }
  } catch (error) {
    window.alert(error.message || String(error));
  }
});

(async () => {
  snapshot = await window.obserraOwner.getSystemSnapshot();
  localBadge.textContent = snapshot.localOnly ? `Local only · ${snapshot.hostname}` : "Security boundary not verified";
  localBadge.classList.toggle("ok", snapshot.localOnly);
  connectorState = await window.obserraOwner.listConnectors();
  renderAll();
  await probeAll();
  refreshTimer = window.setInterval(() => probeAll(), REFRESH_INTERVAL_MS);
  window.addEventListener("beforeunload", () => window.clearInterval(refreshTimer), { once: true });
})();
