(() => {
  "use strict";

  const heartbeatStatus = document.getElementById("workerHeartbeatStatus");
  const heartbeatMetrics = document.getElementById("workerHeartbeatMetrics");
  const heartbeatCanvas = document.getElementById("workerEkgCanvas");
  const heartbeatLegend = document.getElementById("workerEkgLegend");
  const workerCards = document.getElementById("workerCards");
  const refreshButton = document.getElementById("workerRefresh");
  const commandReason = document.getElementById("workerCommandReason");
  const usageStatus = document.getElementById("aiUsageStatus");
  const usageMetrics = document.getElementById("aiUsageMetrics");
  const usageProviders = document.getElementById("aiUsageProviders");
  const usageTasks = document.getElementById("aiUsageTasks");
  const usageRefresh = document.getElementById("aiUsageRefresh");

  if (!heartbeatStatus || !heartbeatCanvas || !window.obserraOwner) return;

  const REFRESH_INTERVAL_MS = 15000;
  let snapshot = null;
  let busy = false;

  function notify(message, state = "info") {
    if (typeof window.obserraNotify === "function") window.obserraNotify(message, state);
  }

  function metric(label, value, detail = "") {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "metric interactiveMetric";
    card.setAttribute("aria-label", `${label}: ${value}`);
    const name = document.createElement("span");
    name.textContent = label;
    const result = document.createElement("strong");
    result.textContent = String(value ?? "Unavailable");
    card.append(name, result);
    if (detail) {
      const detailNode = document.createElement("small");
      detailNode.textContent = detail;
      card.append(detailNode);
    }
    card.addEventListener("click", () => notify(`${label}: ${value}${detail ? ` · ${detail}` : ""}`, "info"));
    return card;
  }

  function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "Unavailable";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toLocaleString() : "Unavailable";
  }

  function time(value) {
    if (!value) return "Never";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }

  function stateClass(value) {
    if (["healthy", "operational", "active", "completed", "ready"].includes(value)) return "clear";
    if (["stale", "degraded", "provisioning", "draining", "paused", "queued"].includes(value)) return "medium";
    if (["failed", "unhealthy", "quarantined", "critical", "exhausted"].includes(value)) return "critical";
    return "high";
  }

  function resizeCanvas(canvas) {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(600, canvas.clientWidth || 600);
    const height = Math.max(220, canvas.clientHeight || 220);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
  }

  function fleetPulseSeries() {
    const workers = snapshot?.workers || [];
    const history = snapshot?.history || {};
    const timeline = new Map();
    for (const worker of workers) {
      for (const sample of history[worker.worker_id] || []) {
        const bucket = String(sample.at || "");
        if (!bucket) continue;
        const record = timeline.get(bucket) || { total: 0, count: 0 };
        record.total += Number(sample.pulse || 0);
        record.count += 1;
        timeline.set(bucket, record);
      }
    }
    return [...timeline.entries()]
      .sort(([left], [right]) => Date.parse(left) - Date.parse(right))
      .slice(-80)
      .map(([at, record]) => ({
        at,
        pulse: record.count ? record.total / record.count : 0,
      }));
  }

  function drawEkg() {
    const { context, width, height } = resizeCanvas(heartbeatCanvas);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(document.documentElement);
    const line = styles.getPropertyValue("--ok").trim() || "#65d69e";
    const grid = styles.getPropertyValue("--line").trim() || "#253147";
    const muted = styles.getPropertyValue("--muted").trim() || "#9ba7b8";
    const padding = 28;
    const usableWidth = width - padding * 2;
    const centerY = height / 2;

    context.lineWidth = 1;
    context.strokeStyle = grid;
    context.globalAlpha = 0.65;
    for (let x = padding; x <= width - padding; x += 30) {
      context.beginPath();
      context.moveTo(x, padding);
      context.lineTo(x, height - padding);
      context.stroke();
    }
    for (let y = padding; y <= height - padding; y += 30) {
      context.beginPath();
      context.moveTo(padding, y);
      context.lineTo(width - padding, y);
      context.stroke();
    }
    context.globalAlpha = 1;

    const series = fleetPulseSeries();
    if (series.length === 0) {
      context.fillStyle = muted;
      context.font = "14px Segoe UI";
      context.textAlign = "center";
      context.fillText("No authenticated AI worker heartbeat samples are available.", width / 2, centerY);
      return;
    }

    const pointWidth = series.length > 1 ? usableWidth / (series.length - 1) : usableWidth;
    context.strokeStyle = line;
    context.lineWidth = 2.5;
    context.shadowColor = line;
    context.shadowBlur = 10;
    context.beginPath();

    series.forEach((sample, index) => {
      const x = padding + index * pointWidth;
      const pulse = Math.max(0, Math.min(1, Number(sample.pulse || 0)));
      const amplitude = 18 + pulse * 62;
      const pattern = index % 8;
      let y = centerY;
      if (pattern === 2) y = centerY - amplitude * 0.22;
      if (pattern === 3) y = centerY + amplitude * 0.16;
      if (pattern === 4) y = centerY - amplitude;
      if (pattern === 5) y = centerY + amplitude * 0.52;
      if (pattern === 6) y = centerY - amplitude * 0.14;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.shadowBlur = 0;

    const latest = series.at(-1);
    context.fillStyle = muted;
    context.font = "12px Segoe UI";
    context.textAlign = "left";
    context.fillText(`Authenticated samples: ${series.length}`, padding, height - 8);
    context.textAlign = "right";
    context.fillText(`Latest ${latest ? time(latest.at) : "unavailable"}`, width - padding, height - 8);
  }

  function heartbeatStrip(worker) {
    const strip = document.createElement("div");
    strip.className = "heartbeatStrip";
    strip.setAttribute("aria-label", `${worker.name} heartbeat history`);
    const history = (snapshot?.history?.[worker.worker_id] || []).slice(-30);
    if (!history.length) {
      strip.classList.add("empty");
      strip.textContent = "No heartbeat history";
      return strip;
    }
    for (const sample of history) {
      const bar = document.createElement("span");
      bar.className = `heartbeatBar ${sample.state || "unknown"}`;
      bar.style.height = `${Math.max(10, Math.round(Number(sample.pulse || 0) * 100))}%`;
      bar.title = `${time(sample.at)} · ${sample.state} · ${sample.heartbeatAgeSeconds ?? "unknown"}s age`;
      strip.append(bar);
    }
    return strip;
  }

  async function issueCommand(worker, action) {
    if (busy) return;
    const reason = String(commandReason?.value || "").trim();
    if (reason.length < 3) {
      notify("Enter a substantive owner reason before issuing a worker command.", "error");
      commandReason?.focus();
      return;
    }
    const confirmed = window.confirm(
      `${action.toUpperCase()} ${worker.name}?\n\nReason: ${reason}\n\nThe command remains pending until the worker or provisioner acknowledges it.`,
    );
    if (!confirmed) return;
    busy = true;
    renderWorkers();
    try {
      const response = await window.obserraOwner.commandWorker({
        workerId: worker.worker_id,
        action,
        reason,
      });
      snapshot = response.snapshot;
      renderAll();
      notify(`${action} command submitted for ${worker.name}. Review command and heartbeat evidence for acknowledgement.`, "ok");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      busy = false;
      renderWorkers();
    }
  }

  function workerTask(worker) {
    return (snapshot?.tasks || []).find(
      (task) => task.task_id === worker.current_task_id || task.worker_id === worker.worker_id,
    ) || null;
  }

  function renderWorkers() {
    const workers = snapshot?.workers || [];
    workerCards.replaceChildren();
    for (const worker of workers) {
      const pulse = worker.heartbeat || {};
      const task = workerTask(worker);
      const card = document.createElement("article");
      card.className = `workerCard ${stateClass(pulse.state || worker.health_state)}`;

      const header = document.createElement("div");
      header.className = "workerCardHeader";
      const identity = document.createElement("div");
      const eyebrow = document.createElement("p");
      eyebrow.className = "eyebrow";
      eyebrow.textContent = `${worker.worker_type || "AI worker"} · ${worker.provider || "provider unavailable"}`;
      const title = document.createElement("h3");
      title.textContent = worker.name || worker.worker_id;
      const role = document.createElement("p");
      role.className = "subhead";
      role.textContent = `${worker.role || "Role unavailable"} · ${worker.specialization || "Specialization unavailable"}`;
      identity.append(eyebrow, title, role);
      const badge = document.createElement("span");
      badge.className = `status ${pulse.state === "healthy" ? "connected" : pulse.state === "stale" ? "degraded" : "failed"}`;
      badge.textContent = `${pulse.state || worker.health_state || "unknown"} · ${pulse.ageSeconds ?? "?"}s`;
      header.append(identity, badge);

      const facts = document.createElement("div");
      facts.className = "workerFacts";
      const values = [
        ["Lifecycle", worker.lifecycle_state || "Unavailable"],
        ["Desired", worker.desired_state || "Unavailable"],
        ["Last heartbeat", time(worker.last_heartbeat_at)],
        ["Task", task?.title || worker.current_task_id || "No active task"],
        ["Progress", `${Number(worker.progress_percent || task?.progress_percent || 0)}%`],
        ["Jobs", `${worker.active_jobs || 0} active · ${worker.queued_jobs || 0} queued`],
        ["Model", worker.model || "Not assigned"],
        ["Version", worker.version || "Unavailable"],
      ];
      for (const [label, value] of values) {
        const row = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = `${label}: `;
        row.append(strong, document.createTextNode(String(value)));
        facts.append(row);
      }

      const actions = document.createElement("div");
      actions.className = "actions";
      for (const action of ["pause", "resume", "drain", "restart", "stop", "quarantine"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = action === "quarantine" || action === "stop" ? "secondary dangerButton" : "secondary";
        button.textContent = action[0].toUpperCase() + action.slice(1);
        button.disabled = busy || snapshot?.available !== true;
        button.addEventListener("click", () => void issueCommand(worker, action));
        actions.append(button);
      }

      card.append(header, heartbeatStrip(worker), facts, actions);
      if (worker.last_error) {
        const error = document.createElement("p");
        error.className = "monitorError workerError";
        error.textContent = worker.last_error;
        card.append(error);
      }
      workerCards.append(card);
    }

    if (!workers.length) {
      const empty = document.createElement("article");
      empty.className = "gapItem high";
      empty.textContent = (snapshot?.blockers || ["No authenticated worker records were returned."]).join(" ");
      workerCards.append(empty);
    }
  }

  function renderHeartbeat() {
    const totals = snapshot?.totals || {};
    heartbeatMetrics.replaceChildren(
      metric("Registered workers", totals.registeredWorkers || 0, "Authenticated EIOS records"),
      metric("Healthy heartbeat", totals.healthyWorkers || 0, "Fresh within 60 seconds"),
      metric("Active jobs", totals.activeJobs || 0),
      metric("Queued jobs", totals.queuedJobs || 0),
      metric("Worker control", snapshot?.available ? "CONNECTED" : "UNAVAILABLE", snapshot?.sourceUrl || "EIOS connector"),
      metric("Last successful refresh", snapshot?.lastSuccessfulAt ? time(snapshot.lastSuccessfulAt) : "Never"),
    );
    heartbeatStatus.textContent = snapshot?.available
      ? `${totals.healthyWorkers || 0} of ${totals.registeredWorkers || 0} registered AI workers have a fresh authenticated heartbeat. ${snapshot.claimBoundary || ""}`
      : `AI worker heartbeat is ${snapshot?.status || "unavailable"}. ${(snapshot?.blockers || []).join(" ")}`;
    heartbeatLegend.textContent = "Green pulse: current authenticated heartbeat · amber: stale or provisioning · red: failed or missing · flat line: no verified evidence";
    renderWorkers();
    drawEkg();
  }

  function renderUsage() {
    if (!usageMetrics || !usageProviders || !usageTasks || !usageStatus) return;
    const totals = snapshot?.totals || {};
    const credits = snapshot?.creditAccounts || [];
    const tasks = snapshot?.tasks || [];
    const utilization = Number(totals.tokenBudget || 0) > 0
      ? Math.round((Number(totals.tokensUsed || 0) / Number(totals.tokenBudget)) * 100)
      : 0;
    usageMetrics.replaceChildren(
      metric("Tokens used", number(totals.tokensUsed || 0)),
      metric("Token budget", number(totals.tokenBudget || 0)),
      metric("Budget utilization", `${utilization}%`),
      metric("Estimated cost", money(totals.estimatedCostUsd || 0)),
      metric("Actual cost", money(totals.actualCostUsd || 0)),
      metric("Provider accounts", credits.length),
    );
    usageStatus.textContent = snapshot?.available
      ? `AI usage and cost values are reported by EIOS tasks and provider-credit records as of ${time(snapshot.checkedAt)}.`
      : `AI usage is unavailable. ${(snapshot?.blockers || []).join(" ")}`;

    usageProviders.replaceChildren();
    for (const account of credits) {
      const item = document.createElement("article");
      item.className = `gapItem ${stateClass(account.status)}`;
      const title = document.createElement("strong");
      title.textContent = `${account.provider || "Provider"} · ${account.status || "unknown"}`;
      const detail = document.createElement("span");
      detail.textContent = `Balance ${account.balance_usd === null || account.balance_usd === undefined ? "unavailable" : money(account.balance_usd)} · daily spend ${money(account.daily_spend_usd)} · monthly spend ${money(account.monthly_spend_usd)} · adapter ${account.adapter_status || "unknown"} · checked ${time(account.checked_at)}`;
      item.append(title, detail);
      if (account.last_error) {
        const error = document.createElement("em");
        error.textContent = account.last_error;
        item.append(error);
      }
      usageProviders.append(item);
    }
    if (!credits.length) {
      const empty = document.createElement("article");
      empty.className = "gapItem medium";
      empty.textContent = "No authenticated provider-credit account record is available.";
      usageProviders.append(empty);
    }

    usageTasks.replaceChildren();
    for (const task of tasks.slice().sort((left, right) => Number(right.tokens_used || 0) - Number(left.tokens_used || 0)).slice(0, 50)) {
      const item = document.createElement("article");
      item.className = `gapItem ${stateClass(task.state)}`;
      const title = document.createElement("strong");
      title.textContent = `${task.title || task.task_id} · ${task.state || "unknown"}`;
      const detail = document.createElement("span");
      detail.textContent = `Tokens ${number(task.tokens_used || 0)} of ${number(task.token_budget || 0)} · actual ${money(task.actual_cost_usd || 0)} · estimated ${money(task.estimated_cost_usd || 0)} · progress ${task.progress_percent || 0}%`;
      item.append(title, detail);
      usageTasks.append(item);
    }
    if (!tasks.length) {
      const empty = document.createElement("article");
      empty.className = "gapItem medium";
      empty.textContent = "No durable worker task or AI-usage record is available.";
      usageTasks.append(empty);
    }
  }

  function renderAll() {
    renderHeartbeat();
    renderUsage();
  }

  async function refresh({ force = false } = {}) {
    if (busy) return;
    busy = true;
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Refreshing worker telemetry…";
    }
    if (usageRefresh) {
      usageRefresh.disabled = true;
      usageRefresh.textContent = "Refreshing usage…";
    }
    try {
      snapshot = force
        ? await window.obserraOwner.refreshWorkerFleet()
        : await window.obserraOwner.getWorkerFleetSnapshot();
      renderAll();
    } catch (error) {
      heartbeatStatus.textContent = `Worker heartbeat could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
      notify(heartbeatStatus.textContent, "error");
    } finally {
      busy = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh worker heartbeat";
      }
      if (usageRefresh) {
        usageRefresh.disabled = false;
        usageRefresh.textContent = "Refresh AI usage";
      }
    }
  }

  refreshButton?.addEventListener("click", () => void refresh({ force: true }));
  usageRefresh?.addEventListener("click", () => void refresh({ force: true }));
  window.addEventListener("resize", () => {
    if (document.body.dataset.activePage === "workers") drawEkg();
  });
  window.addEventListener("obserra:page-changed", (event) => {
    if (["workers", "ai-usage"].includes(event.detail?.page)) void refresh({ force: true });
  });

  void refresh({ force: true });
  window.setInterval(() => {
    if (["workers", "ai-usage"].includes(document.body.dataset.activePage)) {
      void refresh({ force: true });
    }
  }, REFRESH_INTERVAL_MS);
})();
