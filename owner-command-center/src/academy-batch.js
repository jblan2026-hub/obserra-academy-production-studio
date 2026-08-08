const batchLog = document.getElementById("academyActionLog");
let batchRunning = false;
let governanceRefreshRunning = false;

function writeBatchLog(message, state = "info") {
  const entry = document.createElement("div");
  entry.className = `logEntry ${state}`;
  entry.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  batchLog.prepend(entry);
}

function governanceMetric(label, value, detail = "") {
  const card = document.createElement("div");
  card.className = "metric";
  const heading = document.createElement("span");
  heading.textContent = label;
  const number = document.createElement("strong");
  number.textContent = String(value);
  card.append(heading, number);
  if (detail) {
    const note = document.createElement("small");
    note.textContent = detail;
    card.append(note);
  }
  return card;
}

function ensureGovernancePanel() {
  let panel = document.getElementById("academyGovernancePanel");
  if (panel) return panel;
  const academyPanel = document.querySelector(".academyPanel");
  if (!academyPanel) return null;

  panel = document.createElement("section");
  panel.id = "academyGovernancePanel";
  panel.className = "panel";
  panel.innerHTML = `
    <div class="sectionTitle">
      <div>
        <p class="eyebrow">PRODUCTION GOVERNANCE CENTER</p>
        <h2>36-worker allocation, commercial course gates, and release evidence</h2>
        <p id="academyGovernanceStatus" class="subhead">Loading governed worker and Academy production status…</p>
      </div>
      <div class="actions">
        <button id="academyGovernanceRefresh" class="secondary">Refresh governance</button>
        <button id="academyStageAll" data-batch-action>Stage all courses</button>
        <button id="academySourceQueue" data-batch-action class="secondary">Build source queue</button>
        <button id="academyReleaseCheck" data-batch-action class="secondary">Measure release gates</button>
      </div>
    </div>
    <section id="academyGovernanceMetrics" class="grid metrics academyMetrics"></section>
    <div class="dashboardColumns">
      <div>
        <h3>Governed production gates</h3>
        <div id="academyGovernanceGates" class="gapList"></div>
      </div>
      <div>
        <h3>Contract and quality boundary</h3>
        <div id="academyGovernanceContract" class="gapList"></div>
      </div>
    </div>`;
  academyPanel.insertAdjacentElement("afterend", panel);

  document.getElementById("academyGovernanceRefresh").addEventListener("click", refreshGovernance);
  document.getElementById("academyStageAll").addEventListener("click", () =>
    runBatch("stage-all", "Compliance stage all courses"));
  document.getElementById("academySourceQueue").addEventListener("click", () =>
    runBatch("source-queue", "Build authoritative source resolution queue"));
  document.getElementById("academyReleaseCheck").addEventListener("click", () =>
    runBatch("release-check", "Measure commercial release gates"));
  return panel;
}

function gateClass(state) {
  const normalized = String(state || "").toLowerCase();
  if (["passed", "ready", "success", "compliance-staged"].includes(normalized)) return "clear";
  if (["in-progress", "available", "not-produced"].includes(normalized)) return "medium";
  return "high";
}

function renderGovernance(snapshot) {
  ensureGovernancePanel();
  const governance = snapshot?.governance;
  const status = document.getElementById("academyGovernanceStatus");
  const metrics = document.getElementById("academyGovernanceMetrics");
  const gates = document.getElementById("academyGovernanceGates");
  const contract = document.getElementById("academyGovernanceContract");
  if (!status || !metrics || !gates || !contract) return;

  if (!snapshot?.available || !governance) {
    status.textContent = "Academy workspace or governed production evidence is unavailable.";
    metrics.replaceChildren();
    gates.replaceChildren();
    contract.replaceChildren();
    return;
  }

  const allocation = governance.workerAllocation || {};
  const counts = governance.counts || {};
  status.textContent = `Checked ${new Date(governance.checkedAt).toLocaleTimeString()} · allocation source ${allocation.source || "unknown"} · compliant=${Boolean(allocation.compliant)}`;
  metrics.replaceChildren(
    governanceMetric("TOTAL WORKERS", allocation.totalWorkers ?? 36, "Governed logical pool"),
    governanceMetric("ACADEMY WORKERS", allocation.academyWorkers ?? 0, "Course production and staging"),
    governanceMetric("COMMAND CENTER", allocation.commandCenterWorkers ?? 0, "Release and endpoint work"),
    governanceMetric("UNRELATED APPS", allocation.applicationWorkers ?? 0, "Contract requires zero"),
    governanceMetric("AUTHORED", `${counts.authoredCourses ?? 0}/${counts.totalCourses ?? 0}`, "Current detailed packages"),
    governanceMetric("COMPLIANCE STAGED", `${counts.stagedCourses ?? 0}/${counts.totalCourses ?? 0}`, "Not published or purchasable"),
    governanceMetric("COMMERCIAL READY", `${counts.commercialReadyCourses ?? 0}/${counts.totalCourses ?? 0}`, "Exact release evidence passed"),
    governanceMetric("UNRESOLVED REFERENCES", counts.unresolvedReferences ?? 0, "External source verification")
  );

  gates.replaceChildren();
  for (const gate of governance.gates || []) {
    const item = document.createElement("article");
    item.className = `gapItem ${gateClass(gate.state)}`;
    const title = document.createElement("strong");
    title.textContent = `${gate.label}: ${String(gate.state || "unknown").toUpperCase()}`;
    const detail = document.createElement("span");
    detail.textContent = gate.detail || "No detail available.";
    item.append(title, detail);
    gates.append(item);
  }

  contract.replaceChildren();
  const contractItem = document.createElement("article");
  contractItem.className = `gapItem ${governance.contract?.available ? "clear" : "high"}`;
  const contractTitle = document.createElement("strong");
  contractTitle.textContent = governance.contract?.available
    ? `${governance.contract.id} · ${governance.contract.assignmentMode}`
    : "Worker contract unavailable";
  const contractDetail = document.createElement("span");
  contractDetail.textContent = `Total ${governance.contract?.totalLogicalWorkers ?? 36}; unrelated application reservation ${governance.contract?.applicationWorkerReservation ?? 0}.`;
  contractItem.append(contractTitle, contractDetail);
  contract.append(contractItem);

  const qualityItem = document.createElement("article");
  qualityItem.className = `gapItem ${governance.productionStandard?.available ? "clear" : "high"}`;
  const qualityTitle = document.createElement("strong");
  qualityTitle.textContent = governance.productionStandard?.available
    ? `${governance.productionStandard.qualityTier} internal target`
    : "Commercial production standard unavailable";
  const qualityDetail = document.createElement("span");
  qualityDetail.textContent = governance.productionStandard?.claimBoundary
    || "The quality claim remains disabled until exact media and owner-acceptance gates pass.";
  qualityItem.append(qualityTitle, qualityDetail);
  contract.append(qualityItem);

  const releaseItem = document.createElement("article");
  releaseItem.className = (counts.commercialReleaseBlockers ?? 0) === 0 ? "gapItem clear" : "gapItem high";
  const releaseTitle = document.createElement("strong");
  releaseTitle.textContent = `${counts.commercialReleaseBlockers ?? 0} commercial release blocker(s)`;
  const releaseDetail = document.createElement("span");
  releaseDetail.textContent = `${counts.publicationApprovedCourses ?? 0} course(s) are publication-approved; Command Center cannot enable publication without a FINAL package and accepted owner evidence.`;
  releaseItem.append(releaseTitle, releaseDetail);
  contract.append(releaseItem);
}

async function refreshGovernance() {
  if (governanceRefreshRunning) return;
  governanceRefreshRunning = true;
  const button = document.getElementById("academyGovernanceRefresh");
  if (button) button.disabled = true;
  try {
    const snapshot = await window.obserraOwner.getAcademySnapshot();
    renderGovernance(snapshot);
  } catch (error) {
    writeBatchLog(`Governance refresh failed: ${error.message || String(error)}`, "error");
  } finally {
    governanceRefreshRunning = false;
    if (button) button.disabled = false;
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
    const blockerMeasurement = action === "release-check" && !result.ok;
    writeBatchLog(
      `${label} ${result.ok ? "completed" : blockerMeasurement ? "completed with blocking findings" : "failed"}${result.exitCode === null ? "" : ` with exit code ${result.exitCode}`}.`,
      result.ok ? "ok" : blockerMeasurement ? "info" : "error"
    );
    if (result.stderr) writeBatchLog(result.stderr.slice(-3000), blockerMeasurement ? "info" : "error");
    if (result.stdout) writeBatchLog(result.stdout.slice(-3000), "info");
    const academyRefresh = document.getElementById("academyRefresh");
    if (academyRefresh) academyRefresh.click();
    await refreshGovernance();
  } catch (error) {
    writeBatchLog(error.message || String(error), "error");
  } finally {
    batchRunning = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

ensureGovernancePanel();
document.getElementById("academyGenerateAll").addEventListener("click", () =>
  runBatch("author-all", "Generate all pending detailed commercial courses"));
document.getElementById("academyBuildAll").addEventListener("click", () =>
  runBatch("build-all", "Materialize all detailed learner and implementation assets"));
refreshGovernance();
setInterval(refreshGovernance, 30000);
