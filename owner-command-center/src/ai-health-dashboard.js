(() => {
  "use strict";

  const status = document.getElementById("aiHealthStatus");
  const metrics = document.getElementById("aiHealthMetrics");
  const sources = document.getElementById("aiSourceHealth");
  const analyzeButton = document.getElementById("aiAnalyzeAll");
  if (!status || !metrics || !sources || !analyzeButton || !window.obserraOwner) return;

  let busy = false;

  function notify(message, state = "info") {
    if (typeof window.obserraNotify === "function") window.obserraNotify(message, state);
  }

  function metric(label, value, detail = "") {
    const card = document.createElement("div");
    card.className = "metric";
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = String(value ?? "Unavailable");
    card.append(labelNode, valueNode);
    if (detail) {
      const detailNode = document.createElement("small");
      detailNode.textContent = detail;
      card.append(detailNode);
    }
    return card;
  }

  function normalizedConnector(connector) {
    if (!connector) return null;
    return connector.status ? connector : { ...connector, ...(connector.lastStatus || {}) };
  }

  function sourceRow(name, detail, healthy) {
    const item = document.createElement("article");
    item.className = `gapItem ${healthy ? "clear" : "high"}`;
    const title = document.createElement("strong");
    title.textContent = name;
    const text = document.createElement("span");
    text.textContent = detail;
    item.append(title, text);
    return item;
  }

  async function refresh() {
    try {
      const [ownerAI, runtime, connectors, endpoint, network] = await Promise.all([
        window.obserraOwner.getOwnerAISnapshot(),
        window.obserraOwner.getRuntimeHealth(),
        window.obserraOwner.listConnectors(),
        window.obserraOwner.getEndpointSnapshot(),
        window.obserraOwner.getNetworkSnapshot(),
      ]);
      const localAI = normalizedConnector(
        (connectors || []).find((connector) => connector.id === "localAi"),
      );
      const sourceHealth = ownerAI.sourceHealth || {};
      const localModelConnected = localAI?.status === "connected";
      const engineLive = ownerAI.status === "live";
      const endpointReady = endpoint.endpointReady === true;
      const networkReachable = (network.services || []).filter(
        (service) => service.status === "reachable",
      ).length;
      const overall = engineLive && endpointReady ? "Operational" : engineLive ? "Degraded" : "Unavailable";

      metrics.replaceChildren(
        metric("Owner AI engine", overall, "Deterministic executive intelligence engine"),
        metric("Analysis cycles", ownerAI.cycleCount || 0),
        metric("Last analysis", ownerAI.lastAnalyzedAt ? new Date(ownerAI.lastAnalyzedAt).toLocaleTimeString() : "Not run"),
        metric("AI operating mode", ownerAI.model?.mode || "Not reported"),
        metric("Configured local model", ownerAI.model?.localModel || "Not configured"),
        metric("Local AI runtime", localModelConnected ? "Connected" : localAI?.status || "Not checked", localAI?.error || localAI?.url || "Optional private model endpoint"),
        metric("Healthy AI sources", Object.keys(sourceHealth).length),
        metric("Open recommendations", ownerAI.recommendationCount || 0),
        metric("Pending approvals", ownerAI.pendingApprovalCount || 0),
        metric("Endpoint authority", endpointReady ? "Ready" : "Blocked"),
        metric("Approved network services", `${networkReachable}/${(network.services || []).length}`),
        metric("Runtime uptime", `${runtime.process?.uptimeSeconds || 0}s`, `${runtime.process?.platform || "unknown"} ${runtime.process?.arch || ""}`),
      );

      status.textContent = engineLive
        ? `Owner AI is ${overall.toLowerCase()}. The deterministic intelligence engine is active${localModelConnected ? " and the optional local model endpoint is connected" : "; the optional local model endpoint is not currently verified"}.`
        : "Owner AI runtime health is unavailable.";

      sources.replaceChildren();
      sources.append(
        sourceRow(
          "Owner AI analysis engine",
          engineLive
            ? `Live · ${ownerAI.cycleCount || 0} analysis cycles · ${ownerAI.eventCount || 0} evidence events`
            : "No live Owner AI snapshot was returned.",
          engineLive,
        ),
        sourceRow(
          "Local AI model endpoint",
          localModelConnected
            ? `${localAI.name || "Local AI"} returned a healthy response at ${localAI.checkedAt ? new Date(localAI.checkedAt).toLocaleTimeString() : "the latest check"}.`
            : `${localAI?.error || "The local model endpoint has not returned a healthy response."} Deterministic Owner AI remains available without the optional local model.`,
          localModelConnected,
        ),
        sourceRow(
          "Device identity and heartbeat",
          endpointReady
            ? `Enrolled device ${endpoint.deviceId || "unknown"} is heartbeat-current.`
            : (endpoint.blockers || []).join(" ") || "Endpoint enrollment is not ready.",
          endpointReady,
        ),
        sourceRow(
          "Approved connection analysis",
          `${networkReachable} of ${(network.services || []).length} approved services are transport reachable.`,
          networkReachable > 0 && networkReachable === (network.services || []).length,
        ),
      );

      const sourceEntries = Object.entries(sourceHealth)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 40);
      for (const [name, evidence] of sourceEntries) {
        sources.append(sourceRow(
          name,
          `Observed ${evidence?.observedAt ? new Date(evidence.observedAt).toLocaleString() : "at an unknown time"} · evidence ${String(evidence?.fingerprint || "unavailable").slice(0, 16)}`,
          Boolean(evidence?.observedAt),
        ));
      }
    } catch (caught) {
      status.textContent = `AI health could not be loaded: ${caught instanceof Error ? caught.message : String(caught)}`;
      notify(status.textContent, "error");
    }
  }

  analyzeButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    analyzeButton.disabled = true;
    analyzeButton.textContent = "Analyzing AI, connections, webpages, and network…";
    status.textContent = "Running a complete governed owner analysis cycle…";
    try {
      const results = await Promise.allSettled([
        window.obserraOwner.analyzeOwnerAINow(),
        window.obserraOwner.scanWebpages(),
        window.obserraOwner.analyzeNetwork(),
      ]);
      const failures = results.filter((result) => result.status === "rejected");
      await refresh();
      if (failures.length) {
        notify(`${failures.length} analysis component(s) reported a failure. The detailed health cards were refreshed.`, "error");
      } else {
        notify("Owner AI, approved connections, HTTPS webpages, HTML responses, DNS, and TLS analysis completed.", "ok");
      }
    } finally {
      busy = false;
      analyzeButton.disabled = false;
      analyzeButton.textContent = "Analyze AI, connections, webpages, and network";
    }
  });

  void refresh();
  window.setInterval(() => {
    if (document.body.dataset.activePage === "ai") void refresh();
  }, 30000);
})();
