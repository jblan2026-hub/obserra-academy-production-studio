const batchLog = document.getElementById("academyActionLog");
let batchRunning = false;
let endpointState = null;
let academyProductionEvidence = null;
let operationalRefreshInFlight = false;

function writeBatchLog(message, state = "info") {
  const entry = document.createElement("div");
  entry.className = `logEntry ${state}`;
  entry.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  batchLog.prepend(entry);
}

function createMetricCard(label, value, detail = "") {
  const card = document.createElement("div");
  card.className = "metric";
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = String(value ?? "Unknown");
  card.append(labelNode, valueNode);
  if (detail) {
    const detailNode = document.createElement("small");
    detailNode.textContent = detail;
    card.append(detailNode);
  }
  return card;
}

function ensureOperationalPanels() {
  const academyPanel = document.querySelector(".academyPanel");
  if (!academyPanel) return;

  if (!document.getElementById("endpointLivePanel")) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "endpointLivePanel";
    panel.innerHTML = `
      <div class="sectionTitle">
        <div>
          <p class="eyebrow">ENDPOINT ENROLLMENT AND LIVE READINESS</p>
          <h2>Installed owner endpoint health</h2>
          <p id="endpointLiveSummary" class="subhead">Loading encrypted device identity, bootstrap, heartbeat, and loopback readiness evidence…</p>
        </div>
        <div class="actions">
          <button id="endpointLiveRefresh" class="secondary">Refresh endpoint</button>
          <button id="endpointLiveEnroll">Enroll this endpoint</button>
          <button id="endpointLiveRevoke" class="secondary">Revoke endpoint</button>
        </div>
      </div>
      <section id="endpointLiveMetrics" class="grid metrics"></section>
      <div id="endpointLiveBlockers" class="gapList"></div>
    `;
    academyPanel.parentNode.insertBefore(panel, academyPanel);
  }

  if (!document.getElementById("academyProductionEvidencePanel")) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "academyProductionEvidencePanel";
    panel.innerHTML = `
      <div class="sectionTitle">
        <div>
          <p class="eyebrow">ACADEMY PRODUCTION EVIDENCE</p>
          <h2>36-worker course surge and compliance staging</h2>
          <p id="academyProductionEvidenceSummary" class="subhead">Loading machine-readable worker, course, media, provider, checkpoint, and publication evidence…</p>
        </div>
        <button id="academyProductionEvidenceRefresh" class="secondary">Refresh production evidence</button>
      </div>
      <section id="academyProductionEvidenceMetrics" class="grid metrics"></section>
      <div class="dashboardColumns">
        <div><h3>Operational blockers</h3><div id="academyProductionEvidenceBlockers" class="gapList"></div></div>
        <div><h3>Evidence sources</h3><div id="academyProductionEvidenceFiles" class="gapList"></div></div>
      </div>
    `;
    academyPanel.parentNode.insertBefore(panel, academyPanel);
  }

  document.getElementById("endpointLiveRefresh")?.addEventListener("click", refreshOperationalPanels);
  document.getElementById("academyProductionEvidenceRefresh")?.addEventListener("click", refreshOperationalPanels);
  document.getElementById("endpointLiveEnroll")?.addEventListener("click", async () => {
    if (!window.confirm("Enroll this Windows endpoint using the target-bound bootstrap and Windows encrypted device identity?")) return;
    try {
      await window.obserraOwner.enrollEndpoint({ confirmation: "ENROLL THIS ENDPOINT" });
      writeBatchLog("Endpoint enrollment completed.", "ok");
      await refreshOperationalPanels();
    } catch (error) {
      writeBatchLog(error.message || String(error), "error");
    }
  });
  document.getElementById("endpointLiveRevoke")?.addEventListener("click", async () => {
    if (!window.confirm("Revoke this endpoint enrollment? The local Command Center will remain installed but not endpoint-ready.")) return;
    try {
      await window.obserraOwner.revokeEndpoint({
        confirmation: "REVOKE THIS ENDPOINT",
        reason: "owner-command-center-ui-revocation",
      });
      writeBatchLog("Endpoint enrollment revoked.", "ok");
      await refreshOperationalPanels();
    } catch (error) {
      writeBatchLog(error.message || String(error), "error");
    }
  });
}

function renderGapList(container, items, emptyMessage, severity = "high") {
  container.replaceChildren();
  if (!items?.length) {
    const clear = document.createElement("article");
    clear.className = "gapItem clear";
    const title = document.createElement("strong");
    title.textContent = emptyMessage;
    clear.append(title);
    container.append(clear);
    return;
  }
  for (const text of items) {
    const item = document.createElement("article");
    item.className = `gapItem ${severity}`;
    const detail = document.createElement("span");
    detail.textContent = String(text);
    item.append(detail);
    container.append(item);
  }
}

function renderEndpointState() {
  const summary = document.getElementById("endpointLiveSummary");
  const metrics = document.getElementById("endpointLiveMetrics");
  const blockers = document.getElementById("endpointLiveBlockers");
  if (!summary || !metrics || !blockers) return;

  if (!endpointState) {
    summary.textContent = "Endpoint status is unavailable.";
    metrics.replaceChildren();
    renderGapList(blockers, ["No endpoint receipt was returned by the Electron main process."], "No endpoint blockers.");
    return;
  }

  const enrollment = endpointState.enrollment?.state || "not-enrolled";
  summary.textContent = `${endpointState.hostname} · device ${endpointState.deviceId || "not-created"} · heartbeat ${endpointState.lastHeartbeatAt ? new Date(endpointState.lastHeartbeatAt).toLocaleTimeString() : "unknown"}`;
  metrics.replaceChildren(
    createMetricCard("Endpoint ready", endpointState.endpointReady ? "YES" : "NO", "Bootstrap, encryption, identity, enrollment, and loopback health"),
    createMetricCard("Control plane", endpointState.controlPlaneOperational ? "OPERATIONAL" : "BLOCKED", "Requires authoritative Academy evidence with no blockers"),
    createMetricCard("Enrollment", enrollment.toUpperCase(), endpointState.enrollment?.enrolledAt || endpointState.enrollment?.revokedAt || "No enrollment timestamp"),
    createMetricCard("Windows encryption", endpointState.windowsEncryption ? "AVAILABLE" : "UNAVAILABLE", "Device-bound credential protection"),
    createMetricCard("Bootstrap", endpointState.bootstrap?.applied ? "APPLIED" : "NOT APPLIED", endpointState.bootstrap?.profileId || endpointState.bootstrap?.error || "No verified profile"),
    createMetricCard("Loopback health", endpointState.healthServer?.port ? `127.0.0.1:${endpointState.healthServer.port}` : "OFFLINE", "Read-only local health and readiness"),
    createMetricCard("Auto start", endpointState.autoStartEnabled ? "ENABLED" : "DISABLED", "Windows login item state"),
    createMetricCard("Connectors", `${endpointState.connectorSummary?.connected || 0}/${endpointState.connectorSummary?.observed || 0}`, `${endpointState.connectorSummary?.controlEnabled || 0} control-enabled`),
  );
  renderGapList(blockers, endpointState.blockers || [], "Endpoint readiness has no active blockers.");
}

function renderAcademyProductionEvidence() {
  const summary = document.getElementById("academyProductionEvidenceSummary");
  const metrics = document.getElementById("academyProductionEvidenceMetrics");
  const blockers = document.getElementById("academyProductionEvidenceBlockers");
  const files = document.getElementById("academyProductionEvidenceFiles");
  if (!summary || !metrics || !blockers || !files) return;

  if (!academyProductionEvidence) {
    summary.textContent = "Academy production evidence is unavailable.";
    metrics.replaceChildren();
    renderGapList(blockers, ["No authoritative production evidence was returned."], "No Academy blockers.");
    renderGapList(files, ["No evidence inventory was returned."], "Evidence sources are available.");
    return;
  }

  const workers = academyProductionEvidence.workerStatus || {};
  const courses = academyProductionEvidence.courseStatus || {};
  const media = academyProductionEvidence.mediaStatus || {};
  const provider = academyProductionEvidence.providerStatus || {};
  summary.textContent = `${academyProductionEvidence.source} · checked ${new Date(academyProductionEvidence.checkedAt).toLocaleTimeString()} · publication ${academyProductionEvidence.publicationLocked ? "LOCKED" : "eligible for final approval review"}`;
  metrics.replaceChildren(
    createMetricCard("Course worker target", academyProductionEvidence.workerTarget || 36, "Owner-approved Academy surge"),
    createMetricCard("Configured course workers", workers.configuredCourseWorkers ?? "Unknown", `Application workers ${workers.configuredApplicationWorkers ?? "unknown"}`),
    createMetricCard("Workers launched", workers.launchedWorkers || 0, `${workers.activeWorkers || 0} active assignments`),
    createMetricCard("Assignments complete", workers.completedAssignments || 0, `${workers.successfulAssignments || 0} successful · ${workers.failedAssignments || 0} failed`),
    createMetricCard("Interchangeable roles", workers.interchangeable === true ? "VERIFIED" : "NOT VERIFIED", workers.workerMode || "No worker mode evidence"),
    createMetricCard("Owner-review courses", courses.ownerReviewEligible || 0, `${courses.discovered || 0} manifests discovered`),
    createMetricCard("Compliance staged", courses.complianceStagingReady || 0, "Structural instructional and production contract passed"),
    createMetricCard("Publication ready", courses.publicationReady || 0, `${courses.publicationApproved || 0} publication approved`),
    createMetricCard("Provider", provider.ready ? "READY" : "NOT PROVEN", `${provider.provider || "unknown"} · ${provider.model || "unknown model"}`),
    createMetricCard("Video jobs", `${media.submittedVideoJobs || 0}/${media.requestedVideoJobs || 0}`, `${media.failedVideoJobs || 0} failed · ${media.configurationRequiredVideoJobs || 0} need configuration`),
    createMetricCard("Learner catalog", courses.learnerCatalogReady ? "READY" : "BLOCKED", "Protected learner delivery evidence"),
    createMetricCard("Operational", academyProductionEvidence.operational ? "YES" : "NO", "No inference from missing or stale evidence"),
  );
  renderGapList(blockers, academyProductionEvidence.blockers || [], "Academy production evidence has no active blockers.");

  const evidenceEntries = Object.entries(academyProductionEvidence.evidence || {}).map(([name, evidence]) => {
    const suffix = evidence.error ? ` · ${evidence.error}` : "";
    return `${name}: ${evidence.status} · ${evidence.file}${suffix}`;
  });
  renderGapList(files, evidenceEntries, "All required evidence files are available.", "medium");
}

async function refreshOperationalPanels() {
  if (operationalRefreshInFlight) return;
  operationalRefreshInFlight = true;
  try {
    [endpointState, academyProductionEvidence] = await Promise.all([
      window.obserraOwner.getEndpointSnapshot(),
      window.obserraOwner.getAcademyProductionEvidence(),
    ]);
  } catch (error) {
    writeBatchLog(`Operational evidence refresh failed: ${error.message || String(error)}`, "error");
  } finally {
    operationalRefreshInFlight = false;
    renderEndpointState();
    renderAcademyProductionEvidence();
  }
}

async function runBatch(action, label) {
  if (batchRunning) return;
  batchRunning = true;
  const buttons = document.querySelectorAll("[data-batch-action]");
  buttons.forEach((button) => { button.disabled = true; });
  writeBatchLog(`${label} started.`);
  try {
    const result = await window.obserraOwner.runAcademyAction({ action });
    writeBatchLog(`${label} ${result.ok ? "completed" : "failed"}${result.exitCode === null ? "" : ` with exit code ${result.exitCode}`}.`, result.ok ? "ok" : "error");
    if (result.stderr) writeBatchLog(result.stderr.slice(-3000), "error");
    if (result.stdout) writeBatchLog(result.stdout.slice(-3000), "info");
    document.getElementById("academyRefresh").click();
    await refreshOperationalPanels();
  } catch (error) {
    writeBatchLog(error.message || String(error), "error");
  } finally {
    batchRunning = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

ensureOperationalPanels();
void refreshOperationalPanels();
window.setInterval(() => void refreshOperationalPanels(), 15000);

document.getElementById("academyGenerateAll").addEventListener("click", () => runBatch("author-all", "Generate all pending courses"));
document.getElementById("academyBuildAll").addEventListener("click", () => runBatch("build-all", "Build all release-ready courses"));
