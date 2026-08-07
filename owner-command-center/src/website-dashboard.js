const websiteOpsMetrics = document.getElementById("websiteOpsMetrics");
const websiteOpsStatus = document.getElementById("websiteOpsStatus");
const websiteOpsFindings = document.getElementById("websiteOpsFindings");
const websiteOpsRefresh = document.getElementById("websiteOpsRefresh");
const websiteOpsSecurityScan = document.getElementById("websiteOpsSecurityScan");
const websiteOpsAuthorize = document.getElementById("websiteOpsAuthorize");

let websiteOpsInFlight = false;

function websiteOpsMetric(label, value) {
  const element = document.createElement("div");
  element.className = "metric";
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  element.append(labelElement, valueElement);
  return element;
}

function connectorById(connectors, id) {
  return (connectors || []).find((connector) => connector.id === id) || null;
}

function connectorHealth(connector) {
  if (!connector) return "Not configured";
  if (connector.status === "connected") return "Healthy";
  if (connector.status === "degraded") return "Degraded";
  if (connector.status === "failed") return "Unavailable";
  return "Not checked";
}

function connectorHttp(connector) {
  if (!connector) return "N/A";
  if (connector.httpStatus) return `HTTP ${connector.httpStatus}`;
  return connector.status === "connected" ? "Healthy response" : "No response";
}

function addFinding(severity, title, detail) {
  const item = document.createElement("article");
  item.className = `gapItem ${severity}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const body = document.createElement("span");
  body.textContent = detail;
  item.append(heading, body);
  websiteOpsFindings.append(item);
}

function renderWebsiteOperations(connectors) {
  const website = connectorById(connectors, "website");
  const vercel = connectorById(connectors, "vercel");
  const github = connectorById(connectors, "github");
  const academy = connectorById(connectors, "academy");
  const controlReady = Boolean(website?.controlEnabled && vercel?.controlEnabled && github?.controlEnabled);
  const healthyCount = [website, vercel, github, academy].filter((connector) => connector?.status === "connected").length;

  websiteOpsMetrics.replaceChildren(
    websiteOpsMetric("Website", connectorHealth(website)),
    websiteOpsMetric("Website HTTP", connectorHttp(website)),
    websiteOpsMetric("Vercel", connectorHealth(vercel)),
    websiteOpsMetric("GitHub", connectorHealth(github)),
    websiteOpsMetric("Academy", connectorHealth(academy)),
    websiteOpsMetric("Owner control", controlReady ? "Authorized" : "Restricted"),
    websiteOpsMetric("Core services healthy", `${healthyCount}/4`)
  );

  websiteOpsStatus.textContent = `Checked ${new Date().toLocaleTimeString()} · website control ${controlReady ? "authorized" : "restricted until all required owner connectors are verified"}.`;
  websiteOpsFindings.replaceChildren();

  if (!website || website.status !== "connected") {
    addFinding("critical", "Website health is not verified", website?.error || "The website connector did not return a healthy response.");
  }
  if (website?.status === "connected" && !website.controlEnabled) {
    addFinding("high", "Website owner control is not authorized", "The public website is reachable, but privileged owner control remains fail-safe disabled until its owner credential is verified.");
  }
  if (!vercel || vercel.status !== "connected") {
    addFinding("high", "Vercel deployment control is not healthy", vercel?.error || "Verify the Vercel connector and owner token before relying on deployment control.");
  }
  if (!github || github.status !== "connected") {
    addFinding("high", "GitHub source-control health is not verified", github?.error || "Verify the GitHub connector and owner token before relying on repository or workflow control.");
  }
  if (!academy || academy.status !== "connected") {
    addFinding("medium", "Academy website dependency is not healthy", academy?.error || "The Academy connector did not return a healthy commerce/application response.");
  }
  if (!websiteOpsFindings.children.length) {
    addFinding("clear", "Website operations are healthy", "Website, deployment, source-control, and Academy dependencies are reachable and the required owner-control connectors are authorized.");
  }
}

async function refreshWebsiteOperations() {
  if (websiteOpsInFlight) return;
  websiteOpsInFlight = true;
  websiteOpsRefresh.disabled = true;
  websiteOpsRefresh.textContent = "Refreshing…";
  websiteOpsStatus.textContent = "Checking website, deployment, source-control, and Academy health…";
  try {
    const connectors = await window.obserraOwner.probeAllConnectors();
    renderWebsiteOperations(connectors);
  } catch (error) {
    websiteOpsFindings.replaceChildren();
    addFinding("critical", "Website operations refresh failed", error.message || String(error));
    websiteOpsStatus.textContent = "Website operations refresh failed.";
  } finally {
    websiteOpsRefresh.disabled = false;
    websiteOpsRefresh.textContent = "Refresh website health";
    websiteOpsInFlight = false;
  }
}

async function runWebsiteSecurityScan() {
  if (websiteOpsInFlight) return;
  websiteOpsInFlight = true;
  websiteOpsSecurityScan.disabled = true;
  websiteOpsSecurityScan.textContent = "Scanning…";
  websiteOpsStatus.textContent = "Running governed entire-site security scan…";
  try {
    const result = await window.obserraOwner.runFullSecurityScan();
    const scan = result?.scan || result?.lastScan?.scan || null;
    if (scan) {
      websiteOpsStatus.textContent = `Security scan completed · ${scan.routesScanned || 0} routes · ${scan.findingsCount || 0} findings · ${scan.criticalCount || 0} critical · ${scan.highCount || 0} high.`;
    } else {
      websiteOpsStatus.textContent = result?.skipped ? `Security scan skipped: ${result.reason || "scan already running"}.` : "Security scan completed.";
    }
    await refreshWebsiteOperations();
  } catch (error) {
    websiteOpsStatus.textContent = `Security scan failed: ${error.message || String(error)}`;
  } finally {
    websiteOpsSecurityScan.disabled = false;
    websiteOpsSecurityScan.textContent = "Run full-site security scan";
    websiteOpsInFlight = false;
  }
}

function focusWebsiteAuthorization() {
  const connectorCards = [...document.querySelectorAll(".connectorCard")];
  const websiteCard = connectorCards.find((card) => card.querySelector("h3")?.textContent === "Obserra Website");
  if (websiteCard) {
    websiteCard.scrollIntoView({ behavior: "smooth", block: "center" });
    websiteCard.querySelector(".configure")?.focus();
  } else {
    document.getElementById("connectors")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

websiteOpsRefresh.addEventListener("click", refreshWebsiteOperations);
websiteOpsSecurityScan.addEventListener("click", runWebsiteSecurityScan);
websiteOpsAuthorize.addEventListener("click", focusWebsiteAuthorization);

window.addEventListener("DOMContentLoaded", () => {
  window.setTimeout(refreshWebsiteOperations, 750);
});
