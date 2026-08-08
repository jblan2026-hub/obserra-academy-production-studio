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

function normalizeConnectorState(connectors) {
  return (connectors || []).map((connector) => {
    if (!connector || connector.status || !connector.lastStatus) return connector;
    return {
      ...connector,
      ...connector.lastStatus,
      id: connector.id,
      name: connector.name,
      url: connector.url
    };
  });
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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstValue(source, keys, fallback = "Not reported") {
  if (!source) return fallback;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return fallback;
}

function shortCommit(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Not reported";
  return normalized.length > 12 ? normalized.slice(0, 12) : normalized;
}

function serviceCount(services) {
  if (Array.isArray(services)) return services.length;
  if (services && typeof services === "object") return Object.keys(services).length;
  return 0;
}

function scanAgeMinutes(scanRecord) {
  const value = scanRecord?.scan?.completedAt || scanRecord?.storedAt;
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60000));
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

function renderWebsiteOperations(snapshot) {
  const connectors = normalizeConnectorState(snapshot?.connectors || []);
  const intelligenceReports = snapshot?.intelligenceReports || [];
  const website = connectorById(connectors, "website");
  const vercel = connectorById(connectors, "vercel");
  const github = connectorById(connectors, "github");
  const academy = connectorById(connectors, "academy");
  const controlReady = Boolean(website?.controlEnabled && vercel?.controlEnabled && github?.controlEnabled);
  const healthyCount = [website, vercel, github, academy].filter((connector) => connector?.status === "connected").length;

  const websiteIntelligence = intelligenceReports.find((report) => report?.sourceId === "website") || null;
  const intelligenceReport = asObject(websiteIntelligence?.report);
  const deployment = asObject(intelligenceReport?.deployment);
  const deploymentState = firstValue(deployment, ["readyState", "state", "status"], "Not reported");
  const deploymentEnvironment = firstValue(deployment, ["environment", "target", "stage"], "Not reported");
  const deploymentBranch = firstValue(deployment, ["branch", "gitBranch", "ref"], "Not reported");
  const deploymentCommit = shortCommit(firstValue(deployment, ["commitSha", "commit", "gitSha", "sha"], ""));
  const servicesReported = serviceCount(intelligenceReport?.services);
  const scanRecord = snapshot?.lastSecurityScan || null;
  const scan = scanRecord?.scan || null;
  const findings = Number(scan?.findingsCount || 0);
  const critical = Number(scan?.criticalCount || 0);
  const high = Number(scan?.highCount || 0);
  const ageMinutes = scanAgeMinutes(scanRecord);
  const intelligenceStatus = websiteIntelligence?.status === "reporting"
    ? "Reporting"
    : websiteIntelligence?.status
      ? websiteIntelligence.status
      : "Not reported";

  websiteOpsMetrics.replaceChildren(
    websiteOpsMetric("Website", connectorHealth(website)),
    websiteOpsMetric("Website HTTP", connectorHttp(website)),
    websiteOpsMetric("Vercel", connectorHealth(vercel)),
    websiteOpsMetric("GitHub", connectorHealth(github)),
    websiteOpsMetric("Academy", connectorHealth(academy)),
    websiteOpsMetric("Owner control", controlReady ? "Authorized" : "Restricted"),
    websiteOpsMetric("Core services healthy", `${healthyCount}/4`),
    websiteOpsMetric("Website intelligence", intelligenceStatus),
    websiteOpsMetric("Deployment", deploymentState),
    websiteOpsMetric("Environment", deploymentEnvironment),
    websiteOpsMetric("Branch", deploymentBranch),
    websiteOpsMetric("Commit", deploymentCommit),
    websiteOpsMetric("Services reported", String(servicesReported)),
    websiteOpsMetric("Security findings", scan ? String(findings) : "Not scanned"),
    websiteOpsMetric("Critical / high", scan ? `${critical} / ${high}` : "N/A")
  );

  const checkedAt = snapshot?.checkedAt ? new Date(snapshot.checkedAt) : new Date();
  const checkedText = Number.isNaN(checkedAt.getTime()) ? "now" : checkedAt.toLocaleTimeString();
  const scanText = scan ? `${findings} finding${findings === 1 ? "" : "s"}` : "no completed scan";
  websiteOpsStatus.textContent = `Checked ${checkedText} · website control ${controlReady ? "authorized" : "restricted"} · deployment ${deploymentState} · security ${scanText}.`;
  websiteOpsFindings.replaceChildren();

  if (!website || website.status !== "connected") {
    addFinding("critical", "Website health is not verified", website?.error || "The website connector did not return a healthy response.");
  }
  if (website?.status === "connected" && !website.controlEnabled) {
    addFinding("high", "Website owner control is not authorized", "The public website is reachable, but privileged owner control remains fail safe disabled until its owner credential is verified.");
  }
  if (!vercel || vercel.status !== "connected") {
    addFinding("high", "Vercel deployment control is not healthy", vercel?.error || "Verify the Vercel connector and owner token before relying on deployment control.");
  }
  if (!github || github.status !== "connected") {
    addFinding("high", "GitHub source control health is not verified", github?.error || "Verify the GitHub connector and owner token before relying on repository or workflow control.");
  }
  if (!academy || academy.status !== "connected") {
    addFinding("medium", "Academy website dependency is not healthy", academy?.error || "The Academy connector did not return a healthy commerce or application response.");
  }
  if (!websiteIntelligence || websiteIntelligence.status !== "reporting") {
    addFinding("medium", "Website deployment intelligence is incomplete", websiteIntelligence?.error || "The authenticated website intelligence endpoint is not currently reporting deployment and service context.");
  }
  if (/fail|error|cancel|rollback/i.test(deploymentState)) {
    addFinding("critical", "Website deployment reports a failed state", `The latest website intelligence report returned deployment state ${deploymentState}.`);
  }
  if (critical > 0) {
    addFinding("critical", "Critical website security findings require action", `${critical} critical finding${critical === 1 ? "" : "s"} remain in the latest full site security scan.`);
  } else if (high > 0) {
    addFinding("high", "High severity website security findings require action", `${high} high severity finding${high === 1 ? "" : "s"} remain in the latest full site security scan.`);
  } else if (findings > 0) {
    addFinding("medium", "Website security findings remain open", `${findings} noncritical finding${findings === 1 ? "" : "s"} remain in the latest full site security scan.`);
  }
  if (ageMinutes !== null && ageMinutes > 30) {
    addFinding("medium", "Website security evidence is stale", `The latest completed full site security scan is approximately ${ageMinutes} minutes old.`);
  }
  if (!websiteOpsFindings.children.length) {
    addFinding("clear", "Website operations are healthy", "Website, deployment, source control, Academy dependencies, authenticated intelligence, and the latest security evidence are healthy with required owner control authorized.");
  }
}

async function collectWebsiteOperationsSnapshot() {
  let cycle = null;
  try {
    cycle = await window.obserraOwner.analyzeOwnerAINow();
  } catch {
    cycle = null;
  }

  let connectors = Array.isArray(cycle?.connectors) ? cycle.connectors : [];
  const intelligenceReports = Array.isArray(cycle?.intelligenceReports) ? cycle.intelligenceReports : [];

  if (!connectors.length) {
    try {
      const probed = await window.obserraOwner.probeAllConnectors();
      if (Array.isArray(probed)) connectors = probed;
    } catch {
      connectors = [];
    }
  }

  if (!connectors.length) {
    try {
      connectors = normalizeConnectorState(await window.obserraOwner.listConnectors());
    } catch {
      connectors = [];
    }
  }

  let lastSecurityScan = null;
  try {
    lastSecurityScan = await window.obserraOwner.getLastSecurityScan();
  } catch {
    lastSecurityScan = null;
  }

  const websiteIntelligence = intelligenceReports.find((report) => report?.sourceId === "website") || null;
  return {
    connectors,
    intelligenceReports,
    lastSecurityScan,
    checkedAt: websiteIntelligence?.observedAt || new Date().toISOString()
  };
}

async function refreshWebsiteOperations() {
  if (websiteOpsInFlight) return;
  websiteOpsInFlight = true;
  websiteOpsRefresh.disabled = true;
  websiteOpsRefresh.textContent = "Refreshing…";
  websiteOpsStatus.textContent = "Checking website, deployment, source control, Academy, intelligence, and security health…";
  try {
    renderWebsiteOperations(await collectWebsiteOperationsSnapshot());
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
  websiteOpsStatus.textContent = "Running governed entire site security scan…";
  try {
    const result = await window.obserraOwner.runFullSecurityScan();
    const scan = result?.scan || result?.lastScan?.scan || null;
    if (scan) {
      websiteOpsStatus.textContent = `Security scan completed · ${scan.routesScanned || 0} routes · ${scan.findingsCount || 0} findings · ${scan.criticalCount || 0} critical · ${scan.highCount || 0} high.`;
    } else {
      websiteOpsStatus.textContent = result?.skipped ? `Security scan skipped: ${result.reason || "scan already running"}.` : "Security scan completed.";
    }
    renderWebsiteOperations(await collectWebsiteOperationsSnapshot());
  } catch (error) {
    websiteOpsFindings.replaceChildren();
    addFinding("critical", "Website security scan failed", error.message || String(error));
    websiteOpsStatus.textContent = `Security scan failed: ${error.message || String(error)}`;
  } finally {
    websiteOpsSecurityScan.disabled = false;
    websiteOpsSecurityScan.textContent = "Run full site security scan";
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