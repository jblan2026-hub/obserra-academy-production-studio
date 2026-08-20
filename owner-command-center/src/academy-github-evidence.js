let academyGithubEvidenceState = null;
let academyGithubEvidenceRefreshInFlight = false;
let academyGithubEvidenceActionInFlight = false;

function createGithubMetric(label, value, detail = "") {
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

function renderGithubMessages(container, messages, clearMessage) {
  container.replaceChildren();
  if (!messages?.length) {
    const item = document.createElement("article");
    item.className = "gapItem clear";
    const detail = document.createElement("span");
    detail.textContent = clearMessage;
    item.append(detail);
    container.append(item);
    return;
  }
  for (const message of messages) {
    const item = document.createElement("article");
    item.className = "gapItem high";
    const detail = document.createElement("span");
    detail.textContent = String(message);
    item.append(detail);
    container.append(item);
  }
}

function ensureAcademyGithubEvidencePanel() {
  if (document.getElementById("academyGithubEvidencePanel")) return;
  const anchor = document.getElementById("academyOwnerReleasePanel") || document.querySelector(".academyPanel");
  if (!anchor?.parentNode) return;

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.id = "academyGithubEvidencePanel";
  panel.innerHTML = `
    <div class="sectionTitle">
      <div>
        <p class="eyebrow">AUTHENTICATED GITHUB EVIDENCE</p>
        <h2>Live Academy approval inbox</h2>
        <p id="academyGithubEvidenceSummary" class="subhead">Loading GitHub owner identity, production run, artifact, and decision-submission status…</p>
      </div>
      <div class="actions">
        <button id="academyGithubEvidenceSync">Sync production evidence</button>
        <button id="academyGithubDecisionSubmit" class="secondary">Submit recorded decision</button>
        <button id="academyGithubEvidenceRefresh" class="secondary">Refresh status</button>
      </div>
    </div>
    <section id="academyGithubEvidenceMetrics" class="grid metrics"></section>
    <div class="dashboardColumns">
      <div><h3>Synchronization state</h3><div id="academyGithubEvidenceMessages" class="gapList"></div></div>
      <div><h3>Owner decision submission</h3><div id="academyGithubDecisionMessages" class="gapList"></div></div>
    </div>
  `;
  anchor.parentNode.insertBefore(panel, anchor);

  document.getElementById("academyGithubEvidenceSync")?.addEventListener("click", synchronizeAcademyGithubEvidence);
  document.getElementById("academyGithubDecisionSubmit")?.addEventListener("click", submitRecordedAcademyDecision);
  document.getElementById("academyGithubEvidenceRefresh")?.addEventListener("click", refreshAcademyGithubEvidence);
}

function renderAcademyGithubEvidence() {
  ensureAcademyGithubEvidencePanel();
  const summary = document.getElementById("academyGithubEvidenceSummary");
  const metrics = document.getElementById("academyGithubEvidenceMetrics");
  const evidenceMessages = document.getElementById("academyGithubEvidenceMessages");
  const decisionMessages = document.getElementById("academyGithubDecisionMessages");
  const syncButton = document.getElementById("academyGithubEvidenceSync");
  const submitButton = document.getElementById("academyGithubDecisionSubmit");
  if (!summary || !metrics || !evidenceMessages || !decisionMessages || !syncButton || !submitButton) return;

  syncButton.disabled = academyGithubEvidenceActionInFlight;
  if (!academyGithubEvidenceState) {
    summary.textContent = "GitHub Academy evidence status is unavailable.";
    metrics.replaceChildren();
    renderGithubMessages(evidenceMessages, ["No GitHub evidence snapshot was returned."], "GitHub evidence is synchronized.");
    renderGithubMessages(decisionMessages, ["No owner decision-submission status was returned."], "No decision submission blockers.");
    submitButton.disabled = true;
    return;
  }

  const state = academyGithubEvidenceState;
  const metadata = state.metadata || {};
  const run = metadata.run || {};
  const artifact = metadata.artifact || {};
  const gate = state.gate || {};
  const submission = state.submission || null;
  summary.textContent = `${state.repository} · ${state.branch} · owner ${state.expectedOwnerLogin} · ${state.evidenceAvailable ? "governed evidence cached" : "evidence not cached"}`;
  metrics.replaceChildren(
    createGithubMetric("GitHub token", state.tokenConfigured ? "CONFIGURED" : "REQUIRED", "Stored using Windows device encryption"),
    createGithubMetric("Evidence cache", state.evidenceAvailable ? "AVAILABLE" : "MISSING", state.cacheRoot || "No cache directory"),
    createGithubMetric("Workflow run", run.id || "Not synchronized", run.conclusion ? `${run.conclusion} · run ${run.runNumber || "unknown"}` : "No run metadata"),
    createGithubMetric("Artifact", artifact.id || "Not synchronized", artifact.name || "No governed artifact"),
    createGithubMetric("Gate progress", `${gate.stagedCourses || 0}/${gate.expectedCourses || 0}`, `${gate.blockedCourses || 0} blocked · ${gate.progressPercent || 0}%`),
    createGithubMetric("Owner decision due", gate.ownerDecisionRequired ? "YES" : "NO", gate.allStagedForOwnerApproval ? "Complete portfolio staged" : "Production gates remain"),
    createGithubMetric("Publication authority", gate.publicationAuthorized ? "UNEXPECTED" : "NOT GRANTED", "Sync and approval do not publish"),
    createGithubMetric("Decision submitted", submission ? String(submission.decision || "recorded").toUpperCase() : "NO", submission?.submittedAt || "No authenticated GitHub receipt"),
  );

  const evidenceIssues = [];
  if (!state.tokenConfigured) evidenceIssues.push("Authorize the GitHub connector in Owner Connections using an owner token with repository Actions read and issue-comment write access.");
  if (!state.evidenceAvailable) evidenceIssues.push("Run Sync production evidence after the GitHub connector is authorized.");
  if (state.metadataError) evidenceIssues.push(`Sync metadata error: ${state.metadataError}`);
  if (state.gateError) evidenceIssues.push(`Release gate cache error: ${state.gateError}`);
  if (state.lastFailure?.error) evidenceIssues.push(`Last synchronization failure: ${state.lastFailure.error}`);
  renderGithubMessages(evidenceMessages, evidenceIssues, `Latest governed evidence synchronized at ${metadata.synchronizedAt ? new Date(metadata.synchronizedAt).toLocaleString() : "an unknown time"}.`);

  const decisionIssues = [];
  if (!submission) decisionIssues.push("No device-bound owner decision has been submitted to GitHub for the current gate.");
  if (submission && gate.gateHash && submission.gateHash !== gate.gateHash) decisionIssues.push("The submitted decision applies to an older gate hash and does not authorize the current staged portfolio.");
  renderGithubMessages(
    decisionMessages,
    decisionIssues,
    `Decision ${submission.decisionId || "unknown"} was submitted by ${submission.submittedBy || state.expectedOwnerLogin} without granting publication or checkout authority.`,
  );
  submitButton.disabled = academyGithubEvidenceActionInFlight || !state.tokenConfigured || !state.evidenceAvailable;
}

async function refreshAcademyGithubEvidence() {
  if (academyGithubEvidenceRefreshInFlight) return;
  academyGithubEvidenceRefreshInFlight = true;
  try {
    academyGithubEvidenceState = await window.obserraOwner.getAcademyGithubEvidence();
  } catch (error) {
    academyGithubEvidenceState = {
      repository: "unknown",
      branch: "unknown",
      expectedOwnerLogin: "unknown",
      tokenConfigured: false,
      evidenceAvailable: false,
      lastFailure: { error: error.message || String(error) },
    };
  } finally {
    academyGithubEvidenceRefreshInFlight = false;
    renderAcademyGithubEvidence();
  }
}

async function synchronizeAcademyGithubEvidence() {
  if (academyGithubEvidenceActionInFlight) return;
  academyGithubEvidenceActionInFlight = true;
  renderAcademyGithubEvidence();
  try {
    await window.obserraOwner.syncAcademyGithubEvidence();
    document.getElementById("academyProductionEvidenceRefresh")?.click();
    document.getElementById("academyOwnerReleaseRefresh")?.click();
  } catch (error) {
    window.alert(error.message || String(error));
  } finally {
    academyGithubEvidenceActionInFlight = false;
    await refreshAcademyGithubEvidence();
  }
}

async function submitRecordedAcademyDecision() {
  if (academyGithubEvidenceActionInFlight) return;
  if (!window.confirm("Submit the current device-bound owner decision to the governed Academy GitHub issue? This does not publish courses or enable checkout.")) return;
  academyGithubEvidenceActionInFlight = true;
  renderAcademyGithubEvidence();
  try {
    const receipt = await window.obserraOwner.submitRecordedAcademyReleaseDecision();
    window.alert(`Owner decision submitted to GitHub. Decision ${receipt.decisionId}. Publication remains disabled.`);
  } catch (error) {
    window.alert(error.message || String(error));
  } finally {
    academyGithubEvidenceActionInFlight = false;
    await refreshAcademyGithubEvidence();
  }
}

ensureAcademyGithubEvidencePanel();
void refreshAcademyGithubEvidence();
window.setInterval(() => void refreshAcademyGithubEvidence(), 15000);
