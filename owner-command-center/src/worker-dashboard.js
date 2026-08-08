(() => {
  "use strict";

  const metrics = document.getElementById("workerMetrics");
  const heartbeatSvg = document.getElementById("workerHeartbeatSvg");
  const heartbeatStatus = document.getElementById("workerHeartbeatStatus");
  const roster = document.getElementById("workerRoster");
  const tasks = document.getElementById("workerTaskQueue");
  const credits = document.getElementById("workerCreditStatus");
  const refreshButton = document.getElementById("workerRefresh");
  const filter = document.getElementById("workerFilter");
  const emergencyStop = document.getElementById("workerEmergencyStop");

  let snapshot = null;
  let inFlight = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function metric(label, value, detail, state = "neutral") {
    const card = element("article", "operationMetric");
    card.dataset.state = state;
    card.append(
      element("span", "operationMetricLabel", label),
      element("strong", "operationMetricValue", value),
      element("small", "operationMetricDetail", detail),
    );
    return card;
  }

  function drawEkg(history = []) {
    const width = 1200;
    const height = 240;
    const padding = 24;
    heartbeatSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    heartbeatSvg.replaceChildren();

    const namespace = "http://www.w3.org/2000/svg";
    const background = document.createElementNS(namespace, "rect");
    background.setAttribute("x", "0");
    background.setAttribute("y", "0");
    background.setAttribute("width", String(width));
    background.setAttribute("height", String(height));
    background.setAttribute("class", "ekgBackground");
    heartbeatSvg.append(background);

    for (let index = 0; index <= 12; index += 1) {
      const line = document.createElementNS(namespace, "line");
      const x = (width / 12) * index;
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
      line.setAttribute("y1", "0");
      line.setAttribute("y2", String(height));
      line.setAttribute("class", "ekgGrid");
      heartbeatSvg.append(line);
    }
    for (let index = 0; index <= 6; index += 1) {
      const line = document.createElementNS(namespace, "line");
      const y = (height / 6) * index;
      line.setAttribute("x1", "0");
      line.setAttribute("x2", String(width));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("class", "ekgGrid");
      heartbeatSvg.append(line);
    }

    const points = history.slice(-80);
    if (!points.length) {
      const text = document.createElementNS(namespace, "text");
      text.setAttribute("x", String(width / 2));
      text.setAttribute("y", String(height / 2));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "ekgEmpty");
      text.textContent = "Awaiting authenticated worker heartbeat evidence";
      heartbeatSvg.append(text);
      return;
    }

    const expanded = [];
    for (const [index, point] of points.entries()) {
      const ratio = point.total > 0 ? point.healthy / point.total : 0;
      const baseline = height - padding - ratio * (height - padding * 2);
      const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
      expanded.push([x - 8, baseline]);
      if (Number(point.activeJobs || 0) > 0 && index % 3 === 0) {
        expanded.push([x - 4, baseline]);
        expanded.push([x, Math.max(padding, baseline - 42 - Math.min(42, Number(point.activeJobs || 0) * 3))]);
        expanded.push([x + 4, Math.min(height - padding, baseline + 30)]);
        expanded.push([x + 8, baseline]);
      } else {
        expanded.push([x, baseline]);
      }
    }

    const glow = document.createElementNS(namespace, "polyline");
    glow.setAttribute("points", expanded.map(([x, y]) => `${x},${y}`).join(" "));
    glow.setAttribute("class", "ekgLine ekgGlow");
    heartbeatSvg.append(glow);

    const line = document.createElementNS(namespace, "polyline");
    line.setAttribute("points", expanded.map(([x, y]) => `${x},${y}`).join(" "));
    line.setAttribute("class", "ekgLine");
    heartbeatSvg.append(line);

    const latest = points.at(-1);
    const pulse = document.createElementNS(namespace, "circle");
    pulse.setAttribute("cx", String(expanded.at(-1)[0]));
    pulse.setAttribute("cy", String(expanded.at(-1)[1]));
    pulse.setAttribute("r", "7");
    pulse.setAttribute("class", latest.healthy > 0 ? "ekgPulse healthy" : "ekgPulse critical");
    heartbeatSvg.append(pulse);
  }

  function workerState(worker) {
    const heartbeat = worker.heartbeat || {};
    if (heartbeat.state === "healthy") return "good";
    if (heartbeat.state === "delayed") return "warning";
    if (heartbeat.state === "stale") return "critical";
    return "unknown";
  }

  function commandButton(worker, action, label, destructive = false) {
    const button = element("button", destructive ? "dangerButton" : "secondary", label);
    button.type = "button";
    button.disabled = !snapshot?.available || inFlight;
    button.addEventListener("click", async () => {
      if (destructive) {
        const confirmation = window.prompt(`Type ${action.toUpperCase()} ${worker.name} to continue.`);
        if (confirmation !== `${action.toUpperCase()} ${worker.name}`) return;
      }
      const reason = window.prompt(`Owner reason for ${action} on ${worker.name}`, "Owner-directed worker lifecycle control");
      if (!reason) return;
      inFlight = true;
      try {
        window.obserraMission?.setCommandStatus(`Submitting ${action} command for ${worker.name}.`, "working");
        const result = await window.obserraOwner.issueWorkerCommand({
          workerId: worker.worker_id,
          action,
          reason,
          idempotencyKey: `owner-${action}-${worker.worker_id}-${Date.now()}`,
        });
        window.obserraMission?.setCommandStatus(result.claimBoundary || `${action} command accepted.`, "success");
        await refresh({ force: true });
      } catch (error) {
        window.obserraMission?.setCommandStatus(`${action} command failed: ${error.message || String(error)}`, "error");
      } finally {
        inFlight = false;
      }
    });
    return button;
  }

  function renderWorker(worker) {
    const state = workerState(worker);
    const card = element("article", "workerCard");
    card.dataset.state = state;
    card.dataset.search = [worker.name, worker.role, worker.worker_type, worker.specialization, worker.worker_id]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const header = element("div", "workerCardHeader");
    const identity = element("div", "workerIdentity");
    const nameRow = element("div", "workerNameRow");
    nameRow.append(element("i", "workerHealthDot"), element("strong", "workerName", worker.name));
    identity.append(
      nameRow,
      element("span", "workerRole", `${worker.role || worker.worker_type || "AI worker"} · ${worker.specialization || "general"}`),
      element("code", "workerId", worker.worker_id),
    );
    const stateBadge = element("span", "workerStateBadge", worker.heartbeat?.state || "unknown");
    stateBadge.dataset.state = state;
    header.append(identity, stateBadge);

    const facts = element("div", "workerFacts");
    const factRows = [
      ["Lifecycle", worker.lifecycle_state || "unknown"],
      ["Desired", worker.desired_state || "unknown"],
      ["Provider / model", [worker.provider, worker.model].filter(Boolean).join(" / ") || "Not reported"],
      ["Heartbeat age", worker.heartbeat?.ageSeconds === null ? "Unavailable" : `${worker.heartbeat.ageSeconds}s`],
      ["Active / queued", `${worker.active_jobs || 0} / ${worker.queued_jobs || 0}`],
      ["Progress", `${worker.progress_percent || 0}%`],
      ["Current task", worker.current_task_id || "None"],
      ["Last error", worker.last_error || "None"],
    ];
    for (const [label, value] of factRows) {
      const row = element("div", "workerFact");
      row.append(element("span", "workerFactLabel", label), element("strong", "workerFactValue", value));
      facts.append(row);
    }

    const progress = element("div", "workerProgress");
    const bar = element("span", "workerProgressBar");
    bar.style.width = `${Math.max(0, Math.min(100, Number(worker.progress_percent || 0)))}%`;
    progress.append(bar);

    const actions = element("div", "workerActions");
    actions.append(
      commandButton(worker, "pause", "Pause"),
      commandButton(worker, "resume", "Resume"),
      commandButton(worker, "drain", "Drain"),
      commandButton(worker, "restart", "Restart"),
      commandButton(worker, "quarantine", "Quarantine", true),
      commandButton(worker, "stop", "Stop", true),
    );

    card.append(header, facts, progress, actions);
    return card;
  }

  function renderTasks(taskList = []) {
    tasks.replaceChildren();
    const ordered = [...taskList].sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
    for (const task of ordered.slice(0, 100)) {
      const item = element("article", "taskCard");
      item.dataset.state = ["failed", "blocked"].includes(task.state) ? "critical" : task.state === "running" ? "active" : "neutral";
      const header = element("div", "taskHeader");
      header.append(element("strong", null, task.title), element("span", "taskState", task.state));
      const detail = element("p", "taskDetail", task.description || "No task description reported.");
      const meta = element("div", "taskMeta", `${task.product || "Unassigned product"} · priority ${task.priority || 0} · progress ${task.progress_percent || 0}%`);
      item.append(header, detail, meta);
      tasks.append(item);
    }
    if (!ordered.length) tasks.append(element("div", "emptyState", "No worker tasks are currently registered."));
  }

  function renderCredits(accounts = []) {
    credits.replaceChildren();
    for (const account of accounts) {
      const item = element("article", "creditCard");
      item.dataset.state = ["critical", "exhausted"].includes(account.status) ? "critical" : account.status === "healthy" ? "good" : "warning";
      item.append(
        element("strong", null, account.provider),
        element("span", null, account.balance_usd === null || account.balance_usd === undefined ? "Balance unavailable" : `$${Number(account.balance_usd).toFixed(2)} balance`),
        element("small", null, `${account.status || "unknown"} · $${Number(account.monthly_spend_usd || 0).toFixed(2)} monthly spend`),
      );
      credits.append(item);
    }
    if (!accounts.length) credits.append(element("div", "emptyState", "No provider credit telemetry is available."));
  }

  function applyFilter() {
    const query = String(filter.value || "").trim().toLowerCase();
    roster.querySelectorAll(".workerCard").forEach((card) => {
      card.hidden = Boolean(query) && !card.dataset.search.includes(query);
    });
  }

  function render(next) {
    snapshot = next;
    const totals = next.totals || {};
    metrics.replaceChildren(
      metric("Registered workers", totals.workers || 0, "Fixed portfolio target: 36", totals.workers === 36 ? "good" : "warning"),
      metric("Healthy heartbeat", totals.healthy || 0, `${totals.delayed || 0} delayed`, totals.healthy > 0 ? "good" : "critical"),
      metric("Stale / unknown", `${totals.stale || 0} / ${totals.unknown || 0}`, "No worker is assumed healthy without heartbeat evidence", totals.stale || totals.unknown ? "critical" : "good"),
      metric("Active jobs", totals.activeJobs || 0, `${totals.queuedJobs || 0} queued`, totals.activeJobs > 0 ? "active" : "neutral"),
      metric("Observed cost", `$${Number(totals.actualCostUsd || 0).toFixed(2)}`, `$${Number(totals.estimatedCostUsd || 0).toFixed(2)} estimated`, "neutral"),
      metric("Control plane", next.productionOperational ? "Operational" : "Restricted", `${(next.blockers || []).length} blocker(s)`, next.productionOperational ? "good" : "warning"),
    );

    drawEkg(next.history || []);
    heartbeatStatus.textContent = next.available
      ? `${totals.healthy || 0} current healthy heartbeats · ${totals.activeJobs || 0} active jobs · ${totals.queuedJobs || 0} queued jobs · ${next.latencyMs || 0} ms control-plane latency`
      : (next.blockers || ["Worker heartbeat evidence is unavailable."])[0];
    heartbeatStatus.dataset.state = next.available && totals.healthy > 0 ? "good" : "critical";

    roster.replaceChildren(...(next.workers || []).map(renderWorker));
    if (!(next.workers || []).length) {
      roster.append(element("div", "emptyState", next.available ? "No workers are registered." : "Worker roster is unavailable until EIOS owner authorization and live worker registration are complete."));
    }
    applyFilter();
    renderTasks(next.tasks || []);
    renderCredits(next.creditAccounts || []);
    emergencyStop.disabled = !next.available || !(next.workers || []).length || inFlight;
  }

  async function refresh({ force = false } = {}) {
    if (inFlight) return;
    inFlight = true;
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing heartbeat…";
    try {
      const next = await window.obserraOwner.getWorkerControlSnapshot({ force });
      render(next);
    } catch (error) {
      render({
        available: false,
        workers: [],
        tasks: [],
        creditAccounts: [],
        history: snapshot?.history || [],
        blockers: [error.message || String(error)],
        totals: {},
      });
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh worker telemetry";
      inFlight = false;
    }
  }

  refreshButton.addEventListener("click", () => refresh({ force: true }));
  filter.addEventListener("input", applyFilter);
  emergencyStop.addEventListener("click", async () => {
    if (!snapshot?.available || inFlight) return;
    const confirmation = window.prompt("Type STOP ALL AI WORKERS to submit stop commands for every non-retired worker.");
    if (confirmation !== "STOP ALL AI WORKERS") return;
    const reason = window.prompt("Owner reason for emergency stop", "Owner emergency stop");
    if (!reason) return;
    inFlight = true;
    const candidates = (snapshot.workers || []).filter((worker) => worker.lifecycle_state !== "retired");
    let accepted = 0;
    const failures = [];
    for (const worker of candidates) {
      try {
        await window.obserraOwner.issueWorkerCommand({
          workerId: worker.worker_id,
          action: "stop",
          reason,
          idempotencyKey: `owner-emergency-stop-${worker.worker_id}-${Date.now()}`,
        });
        accepted += 1;
      } catch (error) {
        failures.push(`${worker.name}: ${error.message || String(error)}`);
      }
    }
    window.obserraMission?.setCommandStatus(
      failures.length
        ? `Emergency stop submitted for ${accepted}/${candidates.length} workers. ${failures.length} command(s) failed.`
        : `Emergency stop submitted for all ${accepted} workers. Await heartbeat acknowledgement.`,
      failures.length ? "error" : "success",
    );
    inFlight = false;
    await refresh({ force: true });
  });

  window.addEventListener("obserra:mission-snapshot", (event) => {
    if (event.detail?.workers) render(event.detail.workers);
  });
  refresh().catch(() => {});
  window.setInterval(() => refresh().catch(() => {}), 15000);
})();
