const ownerAiMetrics = document.getElementById("ownerAiMetrics");
const ownerAiRecommendations = document.getElementById("ownerAiRecommendations");
const ownerAiApprovals = document.getElementById("ownerAiApprovals");
const ownerAiMemory = document.getElementById("ownerAiMemory");
const securityMetrics = document.getElementById("securityMetrics");
const securityAlerts = document.getElementById("securityAlerts");
const securityBlocks = document.getElementById("securityBlocks");
const securityScanStatus = document.getElementById("securityScanStatus");
const trendMetrics = document.getElementById("trendMetrics");
const trendComparisons = document.getElementById("trendComparisons");

function dashboardMetric(label, value) {
  const card = document.createElement("div");
  card.className = "metric";
  const name = document.createElement("span");
  name.textContent = label;
  const result = document.createElement("strong");
  result.textContent = String(value);
  card.append(name, result);
  return card;
}

function emptyState(container, text) {
  const item = document.createElement("article");
  item.className = "gapItem clear";
  item.textContent = text;
  container.append(item);
}

function mappingText(mappings = []) {
  return mappings.length ? mappings.map((item) => `${item.framework}: ${item.id} ${item.title}`).join(" · ") : "No MITRE or OWASP mapping";
}

async function refreshOwnerAI() {
  const snapshot = await window.obserraOwner.getOwnerAISnapshot();
  ownerAiMetrics.replaceChildren(...[
    ["Status", snapshot.status || "live"],
    ["Memory records", snapshot.memoryCount || 0],
    ["Events", snapshot.eventCount || 0],
    ["Recommendations", snapshot.recommendationCount || 0],
    ["Pending approvals", snapshot.pendingApprovalCount || 0],
    ["Blocked scopes", snapshot.blockedScopeCount || 0],
    ["Analysis cycles", snapshot.cycleCount || 0]
  ].map(([label, value]) => dashboardMetric(label, value)));

  ownerAiRecommendations.replaceChildren();
  for (const recommendation of snapshot.recommendations || []) {
    const item = document.createElement("article");
    item.className = `gapItem ${recommendation.severity || "medium"}`;
    const title = document.createElement("strong");
    title.textContent = recommendation.title || recommendation.scope;
    const detail = document.createElement("span");
    detail.textContent = recommendation.recommendation || "Review supporting evidence.";
    const acknowledge = document.createElement("button");
    acknowledge.className = "secondary";
    acknowledge.textContent = "Acknowledge";
    acknowledge.addEventListener("click", async () => {
      await window.obserraOwner.acknowledgeOwnerAIRecommendation(recommendation.id);
      await refreshOwnerAI();
    });
    item.append(title, detail, acknowledge);
    ownerAiRecommendations.append(item);
  }
  if (!(snapshot.recommendations || []).length) emptyState(ownerAiRecommendations, "No open Owner AI recommendations.");

  ownerAiApprovals.replaceChildren();
  for (const approval of snapshot.approvals || []) {
    const item = document.createElement("article");
    item.className = `gapItem ${approval.severity || "high"}`;
    const title = document.createElement("strong");
    title.textContent = approval.scope;
    const detail = document.createElement("span");
    detail.textContent = approval.summary || "Owner decision required.";
    const actions = document.createElement("div");
    actions.className = "actions";
    for (const decision of ["approved", "rejected"]) {
      const button = document.createElement("button");
      button.className = decision === "approved" ? "secondary" : "";
      button.textContent = decision === "approved" ? "Approve" : "Reject";
      button.addEventListener("click", async () => {
        const note = window.prompt(`Decision note for ${approval.scope}`, "Reviewed by owner");
        if (note === null) return;
        await window.obserraOwner.decideOwnerAIApproval({ id: approval.id, decision, note });
        await refreshOwnerAI();
      });
      actions.append(button);
    }
    item.append(title, detail, actions);
    ownerAiApprovals.append(item);
  }
  if (!(snapshot.approvals || []).length) emptyState(ownerAiApprovals, "No pending Owner AI approvals.");
}

async function refreshSecurity() {
  const [snapshot, lastScan] = await Promise.all([
    window.obserraOwner.getSecuritySnapshot(),
    window.obserraOwner.getLastSecurityScan()
  ]);
  securityMetrics.replaceChildren(...[
    ["Open alerts", snapshot.alertCount || 0],
    ["Recommendations", snapshot.recommendationCount || 0],
    ["Automatic blocks", snapshot.blockCount || 0],
    ["Active overrides", snapshot.activeOverrideCount || 0],
    ["Routes scanned", lastScan?.scan?.routesScanned || 0],
    ["Critical findings", lastScan?.scan?.criticalCount || 0],
    ["Known bad mapped", lastScan?.scan?.mappedKnownBadCount || 0]
  ].map(([label, value]) => dashboardMetric(label, value)));
  securityScanStatus.textContent = lastScan?.scan?.completedAt
    ? `Last full-site scan ${new Date(lastScan.scan.completedAt).toLocaleString()} · ${lastScan.scan.routesScanned} routes · ${lastScan.scan.findingsCount} findings`
    : "No full-site scan evidence is available yet.";

  securityAlerts.replaceChildren();
  for (const alert of snapshot.alerts || []) {
    const item = document.createElement("article");
    item.className = `gapItem ${alert.severity || "medium"}`;
    const title = document.createElement("strong");
    title.textContent = `${alert.action.toUpperCase()} · ${alert.scope}`;
    const detail = document.createElement("span");
    detail.textContent = `${alert.type} · ${mappingText(alert.mappings)}`;
    item.append(title, detail);
    securityAlerts.append(item);
  }
  if (!(snapshot.alerts || []).length) emptyState(securityAlerts, "No open security alerts.");

  securityBlocks.replaceChildren();
  for (const [scope, block] of Object.entries(snapshot.blocks || {})) {
    const item = document.createElement("article");
    item.className = "gapItem critical";
    const title = document.createElement("strong");
    title.textContent = `Automatically blocked · ${scope}`;
    const detail = document.createElement("span");
    detail.textContent = `${block.reason} ${mappingText(block.mappings)}`;
    const override = document.createElement("button");
    override.textContent = "Owner override";
    override.addEventListener("click", async () => {
      const reason = window.prompt(`Override reason for ${scope}`);
      if (!reason) return;
      const durationText = window.prompt("Override duration in minutes, maximum 60", "15");
      if (durationText === null) return;
      await window.obserraOwner.createOwnerOverride({ scope, reason, durationMinutes: Number(durationText) });
      await refreshSecurity();
    });
    item.append(title, detail, override);
    securityBlocks.append(item);
  }
  for (const override of snapshot.overrides || []) {
    if (override.status !== "active" || Date.parse(override.expiresAt) <= Date.now()) continue;
    const item = document.createElement("article");
    item.className = "gapItem high";
    const title = document.createElement("strong");
    title.textContent = `Owner override active · ${override.scope}`;
    const detail = document.createElement("span");
    detail.textContent = `${override.reason} · expires ${new Date(override.expiresAt).toLocaleString()}`;
    const release = document.createElement("button");
    release.className = "secondary";
    release.textContent = "Release override";
    release.addEventListener("click", async () => {
      await window.obserraOwner.releaseOwnerOverride(override.id);
      await refreshSecurity();
    });
    item.append(title, detail, release);
    securityBlocks.append(item);
  }
  if (!securityBlocks.children.length) emptyState(securityBlocks, "No automatic blocks or active owner overrides.");
}

async function refreshTrends() {
  const dashboard = await window.obserraOwner.getTrendDashboard();
  trendMetrics.replaceChildren(...[
    ["Tracked domains", dashboard.domains?.length || 0],
    ["Trend series", dashboard.seriesCount || 0],
    ["Historical snapshots", dashboard.snapshotCount || 0],
    ["Comparisons", dashboard.latestComparisons?.length || 0]
  ].map(([label, value]) => dashboardMetric(label, value)));
  trendComparisons.replaceChildren();
  for (const domain of dashboard.domains || []) {
    const comparison = await window.obserraOwner.compareTrendDomain(domain);
    const item = document.createElement("article");
    item.className = "gapItem medium";
    const title = document.createElement("strong");
    title.textContent = domain;
    const detail = document.createElement("span");
    if (!comparison.available) detail.textContent = "Collecting baseline history.";
    else {
      detail.textContent = Object.entries(comparison.metrics || {}).map(([name, metric]) => `${name}: ${metric.before} → ${metric.after}${metric.delta === null ? "" : ` (${metric.delta >= 0 ? "+" : ""}${metric.delta})`}`).join(" · ");
    }
    item.append(title, detail);
    trendComparisons.append(item);
  }
  if (!(dashboard.domains || []).length) emptyState(trendComparisons, "Trend history will appear after monitoring cycles complete.");
}

async function refreshIntelligenceDashboards() {
  await Promise.all([refreshOwnerAI(), refreshSecurity(), refreshTrends()]);
}

document.getElementById("ownerAiAnalyze").addEventListener("click", async () => {
  await window.obserraOwner.analyzeOwnerAINow();
  await refreshIntelligenceDashboards();
});
document.getElementById("ownerAiRemember").addEventListener("click", async () => {
  const text = ownerAiMemory.value.trim();
  if (!text) return;
  await window.obserraOwner.rememberOwnerAI({ text, tags: ["owner-instruction"] });
  ownerAiMemory.value = "";
  await refreshOwnerAI();
});
document.getElementById("securityScanNow").addEventListener("click", async () => {
  securityScanStatus.textContent = "Full-site scan running…";
  await window.obserraOwner.runFullSecurityScan();
  await refreshIntelligenceDashboards();
});
document.getElementById("securityRefresh").addEventListener("click", refreshSecurity);
document.getElementById("trendRefresh").addEventListener("click", refreshTrends);

refreshIntelligenceDashboards().catch((error) => {
  securityScanStatus.textContent = `Intelligence dashboard unavailable: ${error.message || String(error)}`;
});
setInterval(() => refreshIntelligenceDashboards().catch(() => {}), 15000);
