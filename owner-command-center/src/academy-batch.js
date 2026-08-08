const batchLog = document.getElementById("academyActionLog");
const academyMetricsHost = document.getElementById("academyMetrics");
let batchRunning = false;
let releaseApprovalRefreshTimer;

function writeBatchLog(message, state = "info") {
  const entry = document.createElement("div");
  entry.className = `logEntry ${state}`;
  entry.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  batchLog.prepend(entry);
}

function releaseMetric(label, value) {
  const card = document.createElement("div");
  card.className = "metric";
  const name = document.createElement("span");
  name.textContent = label;
  const amount = document.createElement("strong");
  amount.textContent = String(value);
  card.append(name, amount);
  return card;
}

function ensureReleaseApprovalPanel() {
  let panel = document.getElementById("academyReleaseApprovalGate");
  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = "academyReleaseApprovalGate";
  panel.className = "panel";

  const heading = document.createElement("div");
  heading.className = "sectionTitle";
  const titleBlock = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "60-COURSE RELEASE APPROVAL GATE";
  const title = document.createElement("h2");
  title.id = "academyReleaseApprovalTitle";
  title.textContent = "Reading governed staging evidence…";
  const detail = document.createElement("p");
  detail.id = "academyReleaseApprovalDetail";
  detail.className = "subhead";
  detail.textContent = "Publication and checkout remain disabled until all pre-owner gates pass and the owner records a separate decision.";
  titleBlock.append(eyebrow, title, detail);

  const actions = document.createElement("div");
  actions.className = "actions";
  const status = document.createElement("span");
  status.id = "academyReleaseApprovalStatus";
  status.className = "status unconfigured";
  status.textContent = "Checking";
  const refresh = document.createElement("button");
  refresh.id = "academyReleaseApprovalRefresh";
  refresh.className = "secondary";
  refresh.textContent = "Refresh gate";
  const recalculate = document.createElement("button");
  recalculate.id = "academyReleaseApprovalRecalculate";
  recalculate.className = "secondary";
  recalculate.dataset.batchAction = "true";
  recalculate.textContent = "Recalculate staging";
  actions.append(status, refresh, recalculate);
  heading.append(titleBlock, actions);

  const metrics = document.createElement("section");
  metrics.id = "academyReleaseApprovalMetrics";
  metrics.className = "grid metrics academyMetrics";
  const blockers = document.createElement("div");
  blockers.id = "academyReleaseApprovalBlockers";
  blockers.className = "gapList";
  const nextAction = document.createElement("div");
  nextAction.id = "academyReleaseApprovalNextAction";
  nextAction.className = "securitySummary";

  panel.append(heading, metrics, blockers, nextAction);
  academyMetricsHost.insertAdjacentElement("afterend", panel);

  refresh.addEventListener("click", refreshReleaseApprovalPanel);
  recalculate.addEventListener("click", () => runBatch("stage-approval", "Release-approval staging calculation"));
  return panel;
}

function renderReleaseApprovalPanel(snapshot) {
  ensureReleaseApprovalPanel();
  const summary = snapshot?.summary || {};
  const gate = snapshot?.releaseApprovalGate || {};
  const expected = Number(summary.approvalTarget ?? gate.expectedCourses ?? 60);
  const staged = Number(summary.stagedForOwnerApproval ?? gate.stagedCourses ?? 0);
  const blocked = Number(summary.blockedFromOwnerApproval ?? gate.blockedCourses ?? Math.max(0, expected - staged));
  const progress = Number(summary.approvalProgressPercent ?? gate.progressPercent ?? Math.round((staged / Math.max(1, expected)) * 100));
  const allStaged = summary.allStagedForOwnerApproval === true && staged === expected;
  const issueNumber = summary.ownerIssueNumber ?? gate.ownerIssueNumber ?? 27;

  const title = document.getElementById("academyReleaseApprovalTitle");
  const detail = document.getElementById("academyReleaseApprovalDetail");
  const status = document.getElementById("academyReleaseApprovalStatus");
  const metrics = document.getElementById("academyReleaseApprovalMetrics");
  const blockers = document.getElementById("academyReleaseApprovalBlockers");
  const nextAction = document.getElementById("academyReleaseApprovalNextAction");

  title.textContent = allStaged
    ? "All 60 courses are staged for your release decision."
    : `${staged} of ${expected} courses are staged for owner approval.`;
  detail.textContent = allStaged
    ? `Owner notification issue #${issueNumber} is ready. Publication, checkout, pricing, and learner access remain unchanged until your explicit approval is processed.`
    : `Owner notification issue #${issueNumber} tracks the same governed count. Staging requires complete instructional, reference, implementation, assessment, media, accessibility, rights, certificate, entitlement, security, recovery, and pre-owner review evidence.`;
  status.textContent = allStaged ? "READY FOR OWNER APPROVAL" : `${progress}% STAGED`;
  status.className = `status ${allStaged ? "connected" : blocked > 0 ? "degraded" : "unconfigured"}`;

  metrics.replaceChildren(
    releaseMetric("Staged", `${staged}/${expected}`),
    releaseMetric("Blocked", blocked),
    releaseMetric("Progress", `${progress}%`),
    releaseMetric("Owner decision", allStaged ? "Required" : "Not yet"),
    releaseMetric("Publication", "Disabled"),
    releaseMetric("Checkout", "Disabled")
  );

  blockers.replaceChildren();
  const frequent = Array.isArray(gate.blockersByFrequency) ? gate.blockersByFrequency.slice(0, 10) : [];
  if (allStaged) {
    const item = document.createElement("article");
    item.className = "gapItem clear";
    const strong = document.createElement("strong");
    strong.textContent = "All pre-owner release gates passed.";
    const span = document.createElement("span");
    span.textContent = "Review the exact staged learner packages and record approve, reject, or revise decisions. No release action has been taken automatically.";
    item.append(strong, span);
    blockers.append(item);
  } else if (frequent.length > 0) {
    for (const entry of frequent) {
      const item = document.createElement("article");
      item.className = "gapItem high";
      const strong = document.createElement("strong");
      strong.textContent = `${entry.count} course(s) blocked`;
      const span = document.createElement("span");
      span.textContent = entry.blocker;
      item.append(strong, span);
      blockers.append(item);
    }
  } else {
    const item = document.createElement("article");
    item.className = "gapItem high";
    item.textContent = "Release-approval staging evidence has not been generated on this endpoint.";
    blockers.append(item);
  }

  nextAction.replaceChildren();
  const label = document.createElement("strong");
  label.textContent = "Next governed action: ";
  nextAction.append(label, document.createTextNode(
    gate.nextGovernedAction
      || (allStaged
        ? "Complete owner review without enabling publication until an explicit approved decision is recorded."
        : "Continue governed production, resolve blockers, and recalculate the staging gate.")
  ));
}

async function refreshReleaseApprovalPanel() {
  try {
    const snapshot = await window.obserraOwner.getAcademySnapshot();
    renderReleaseApprovalPanel(snapshot);
  } catch (error) {
    ensureReleaseApprovalPanel();
    const status = document.getElementById("academyReleaseApprovalStatus");
    const title = document.getElementById("academyReleaseApprovalTitle");
    status.textContent = "UNAVAILABLE";
    status.className = "status failed";
    title.textContent = error?.message || "Unable to read release-approval staging evidence.";
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
    await refreshReleaseApprovalPanel();
  } catch (error) {
    writeBatchLog(error.message || String(error), "error");
  } finally {
    batchRunning = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

document.getElementById("academyGenerateAll").addEventListener("click", () => runBatch("author-all", "Generate all pending cinematic courses"));
document.getElementById("academyBuildAll").addEventListener("click", () => runBatch("build-all", "Build all structurally ready courses"));

ensureReleaseApprovalPanel();
refreshReleaseApprovalPanel();
releaseApprovalRefreshTimer = setInterval(refreshReleaseApprovalPanel, 30000);
window.addEventListener("beforeunload", () => clearInterval(releaseApprovalRefreshTimer));
