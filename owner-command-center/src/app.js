const connectorContainer = document.getElementById("connectors");
const connectorTemplate = document.getElementById("connectorTemplate");
const metrics = document.getElementById("metrics");
const localBadge = document.getElementById("localBadge");
const securitySummary = document.getElementById("securitySummary");

let snapshot;
let connectorState = [];

function statusLabel(status) {
  return ({ connected: "Connected", degraded: "Degraded", failed: "Unavailable", unconfigured: "Needs authorization" })[status] || "Not checked";
}

function renderMetrics() {
  const connected = connectorState.filter((item) => item.status === "connected").length;
  const controlEnabled = connectorState.filter((item) => item.controlEnabled).length;
  const cards = [
    ["Connected services", `${connected}/${connectorState.length}`],
    ["Control-enabled", String(controlEnabled)],
    ["Logical processors", String(snapshot.logicalProcessors)],
    ["Memory available", `${snapshot.freeMemoryGb} GB`],
    ["Windows encryption", snapshot.windowsEncryption ? "Available" : "Unavailable"]
  ];
  metrics.replaceChildren(...cards.map(([label, value]) => {
    const element = document.createElement("div");
    element.className = "metric";
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    const valueElement = document.createElement("strong");
    valueElement.textContent = value;
    element.append(labelElement, valueElement);
    return element;
  }));
}

function renderSecurity() {
  const enabled = connectorState.filter((item) => item.controlEnabled).length;
  securitySummary.replaceChildren();
  const rows = [
    ["Local security boundary", snapshot.localOnly ? "Enforced" : "Not verified"],
    ["Windows credential encryption", snapshot.windowsEncryption ? "Available" : "Unavailable"],
    ["Control authorization", `${enabled} connector(s) verified and enabled`],
    ["Expansion policy", "Signed definitions only; new websites, stores, courses, applications, and controls begin read-only"],
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
      : connector.error || (connector.configured ? "Configured, awaiting successful verification" : "Credential or owner authorization required");
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
  renderConnectors();
  renderSecurity();
}

async function probeAll() {
  const button = document.getElementById("connectAll");
  button.disabled = true;
  button.textContent = "Discovering and verifying…";
  try {
    connectorState = await window.obserraOwner.probeAllConnectors();
    renderAll();
  } finally {
    button.disabled = false;
    button.textContent = "Discover and connect all";
  }
}

document.getElementById("connectAll").addEventListener("click", probeAll);
document.getElementById("exportConfig").addEventListener("click", async () => {
  const passphrase = window.prompt("Create a recovery passphrase of at least 14 characters. Do not store it with the removable media.");
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
})();
