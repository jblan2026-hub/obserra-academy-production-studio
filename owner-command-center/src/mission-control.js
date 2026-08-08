(() => {
  "use strict";

  const navigation = [...document.querySelectorAll("[data-nav-page]")];
  const pages = [...document.querySelectorAll("[data-workspace-page]")];
  const title = document.getElementById("workspaceTitle");
  const subtitle = document.getElementById("workspaceSubtitle");
  const globalRefresh = document.getElementById("globalRefresh");
  const missionMetrics = document.getElementById("missionMetrics");
  const missionSystemStatus = document.getElementById("missionSystemStatus");
  const missionEventStream = document.getElementById("missionEventStream");
  const commandStatus = document.getElementById("commandStatus");
  const updatedAt = document.getElementById("missionUpdatedAt");

  const pageCopy = {
    overview: ["Executive Mission Control", "Enterprise status, health, risk, workers, courses, web surfaces, and owner actions."],
    workers: ["AI Worker Operations", "Live worker heartbeat, jobs, tasks, cost, capacity, and owner lifecycle controls."],
    academy: ["Academy Review Center", "Review all protected course packages, lesson media, materials, assessments, decisions, and release queues."],
    website: ["Website and Network Operations", "HTTPS, HTML, deployment, route, connector, and network health across Obserra services."],
    intelligence: ["Owner AI Intelligence", "Live recommendations, evidence, approvals, memory, and owner-directed analysis."],
    security: ["Security and Remediation", "Findings, mapped blocking, owner overrides, validated remediation, and rollback evidence."],
    devices: ["Devices and Connections", "Endpoint enrollment, heartbeat, identity, connectors, credentials, and recovery operations."],
  };

  let activePage = "overview";
  let refreshing = false;

  function setCommandStatus(message, state = "info") {
    if (!commandStatus) return;
    commandStatus.textContent = message;
    commandStatus.dataset.state = state;
  }

  function openPage(pageName, { focus = true } = {}) {
    if (!pageCopy[pageName]) return;
    activePage = pageName;
    for (const page of pages) {
      const active = page.dataset.workspacePage === pageName;
      page.hidden = !active;
      page.classList.toggle("active", active);
    }
    for (const button of navigation) {
      const active = button.dataset.navPage === pageName;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    title.textContent = pageCopy[pageName][0];
    subtitle.textContent = pageCopy[pageName][1];
    localStorage.setItem("obserra-owner-page", pageName);
    if (focus) document.querySelector(`[data-workspace-page="${pageName}"]`)?.focus?.();
  }

  function metric(label, value, note, page, state = "neutral") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "missionMetric";
    button.dataset.state = state;
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = String(value);
    const noteNode = document.createElement("small");
    noteNode.textContent = note;
    button.append(labelNode, valueNode, noteNode);
    if (page) button.addEventListener("click", () => openPage(page));
    return button;
  }

  function statusItem(label, status, detail, page) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "statusRailItem";
    button.dataset.state = status;
    const marker = document.createElement("i");
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("small");
    small.textContent = detail;
    copy.append(strong, small);
    button.append(marker, copy);
    if (page) button.addEventListener("click", () => openPage(page));
    return button;
  }

  function eventItem(time, titleText, detail, severity = "info") {
    const item = document.createElement("article");
    item.className = "missionEvent";
    item.dataset.severity = severity;
    const when = document.createElement("time");
    when.textContent = time;
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = titleText;
    const body = document.createElement("span");
    body.textContent = detail;
    copy.append(heading, body);
    item.append(when, copy);
    return item;
  }

  function summarizeSnapshot(snapshot) {
    const workers = snapshot?.workers || {};
    const workerTotals = workers.totals || {};
    const academy = snapshot?.academy || {};
    const academySummary = academy.summary || {};
    const web = snapshot?.web || {};
    const webTotals = web.totals || {};
    const network = snapshot?.network || {};
    const networkTotals = network.totals || {};

    missionMetrics.replaceChildren(
      metric(
        "Healthy AI workers",
        `${workerTotals.healthy || 0}/${workerTotals.workers || 0}`,
        workers.available ? `${workerTotals.activeJobs || 0} active jobs` : "EIOS heartbeat unavailable",
        "workers",
        workers.available && workerTotals.healthy > 0 ? "good" : "warning",
      ),
      metric(
        "Courses ready for review",
        `${academySummary.contentReady || 0}/${academySummary.total || 0}`,
        `${academySummary.pendingReview || 0} pending owner decision`,
        "academy",
        academy.available && academySummary.contentReady === academySummary.total ? "good" : "warning",
      ),
      metric(
        "HTTPS and HTML surfaces",
        `${webTotals.htmlReady || 0}/${webTotals.surfaces || 0}`,
        `${webTotals.failed || 0} surface checks require attention`,
        "website",
        webTotals.failed === 0 && webTotals.surfaces > 0 ? "good" : "warning",
      ),
      metric(
        "Network resolution",
        `${networkTotals.resolved || 0}/${networkTotals.nodes || 0}`,
        `${networkTotals.https || 0} HTTPS endpoints`,
        "website",
        networkTotals.unresolved === 0 && networkTotals.nodes > 0 ? "good" : "warning",
      ),
      metric(
        "Queued worker jobs",
        workerTotals.queuedJobs || 0,
        `$${Number(workerTotals.actualCostUsd || 0).toFixed(2)} observed worker cost`,
        "workers",
        Number(workerTotals.queuedJobs || 0) > 0 ? "active" : "neutral",
      ),
      metric(
        "Publication approved",
        academySummary.publicationApproved || 0,
        "Approval never implies deployment without release evidence",
        "academy",
        Number(academySummary.publicationApproved || 0) > 0 ? "good" : "neutral",
      ),
    );

    missionSystemStatus.replaceChildren(
      statusItem(
        "Worker heartbeat",
        workers.available && workerTotals.healthy > 0 ? "good" : "critical",
        workers.available
          ? `${workerTotals.healthy || 0} healthy, ${workerTotals.stale || 0} stale, ${workerTotals.unknown || 0} unknown`
          : (workers.blockers || ["EIOS worker control unavailable"])[0],
        "workers",
      ),
      statusItem(
        "Academy review packages",
        academy.available ? (academySummary.blocked > 0 ? "warning" : "good") : "critical",
        academy.available
          ? `${academySummary.total || 0} synchronized, ${academySummary.blocked || 0} blocked`
          : (academy.blockers || ["Protected course artifact not synchronized"])[0],
        "academy",
      ),
      statusItem(
        "Public web surfaces",
        webTotals.failed === 0 && webTotals.surfaces > 0 ? "good" : "warning",
        `${webTotals.httpsCompliant || 0} HTTPS, ${webTotals.htmlReady || 0} HTML, ${webTotals.healthReady || 0} healthy`,
        "website",
      ),
      statusItem(
        "Owner endpoint",
        "active",
        `${snapshot?.system?.hostname || "Current device"} · ${snapshot?.system?.freeMemoryGb || 0} GB free memory`,
        "devices",
      ),
    );

    const events = [];
    const now = new Date().toLocaleTimeString();
    if (!workers.available) {
      events.push(eventItem(now, "Worker telemetry unavailable", (workers.blockers || ["EIOS is not reporting current worker heartbeats."])[0], "critical"));
    } else if ((workerTotals.stale || 0) > 0 || (workerTotals.unknown || 0) > 0) {
      events.push(eventItem(now, "Worker heartbeat attention", `${workerTotals.stale || 0} stale and ${workerTotals.unknown || 0} unknown worker heartbeat states.`, "high"));
    } else {
      events.push(eventItem(now, "Worker heartbeat synchronized", `${workerTotals.healthy || 0} workers currently report healthy heartbeat evidence.`, "low"));
    }
    if (!academy.available) {
      events.push(eventItem(now, "Academy review package unavailable", (academy.blockers || ["Synchronize the protected GitHub artifact."])[0], "high"));
    } else {
      events.push(eventItem(now, "Academy review portfolio loaded", `${academySummary.total || 0} courses loaded with ${academySummary.pendingReview || 0} pending decisions.`, academySummary.blocked > 0 ? "high" : "low"));
    }
    if ((webTotals.failed || 0) > 0) {
      events.push(eventItem(now, "Web monitoring attention", `${webTotals.failed} HTTPS, HTML, or health verification check(s) require attention.`, "high"));
    } else {
      events.push(eventItem(now, "Web surfaces verified", `${webTotals.surfaces || 0} governed surfaces passed the current HTTPS, HTML, and health check.`, "low"));
    }
    missionEventStream.replaceChildren(...events);
    updatedAt.textContent = snapshot?.generatedAt
      ? `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}`
      : "Update time unavailable";
  }

  async function refreshMission({ manual = false } = {}) {
    if (refreshing) return;
    refreshing = true;
    globalRefresh.disabled = true;
    globalRefresh.textContent = manual ? "Refreshing all…" : "Refreshing…";
    setCommandStatus("Collecting worker, Academy, web, network, endpoint, and AI evidence.", "working");
    try {
      const snapshot = await window.obserraOwner.getMissionSnapshot();
      summarizeSnapshot(snapshot);
      setCommandStatus("Mission Control synchronized with current available evidence.", "success");
      window.dispatchEvent(new CustomEvent("obserra:mission-snapshot", { detail: snapshot }));
    } catch (error) {
      setCommandStatus(`Mission refresh failed: ${error.message || String(error)}`, "error");
      missionEventStream.replaceChildren(
        eventItem(new Date().toLocaleTimeString(), "Mission refresh failed", error.message || String(error), "critical"),
      );
    } finally {
      globalRefresh.disabled = false;
      globalRefresh.textContent = "Refresh all intelligence";
      refreshing = false;
    }
  }

  for (const button of navigation) {
    button.addEventListener("click", () => openPage(button.dataset.navPage));
  }
  globalRefresh.addEventListener("click", () => refreshMission({ manual: true }));
  document.querySelectorAll("[data-open-page]").forEach((button) => {
    button.addEventListener("click", () => openPage(button.dataset.openPage));
  });

  window.obserraMission = {
    openPage,
    refreshMission,
    setCommandStatus,
    get activePage() { return activePage; },
  };

  const savedPage = localStorage.getItem("obserra-owner-page");
  openPage(pageCopy[savedPage] ? savedPage : "overview", { focus: false });
  refreshMission().catch(() => {});
  window.setInterval(() => refreshMission().catch(() => {}), 15000);
})();
