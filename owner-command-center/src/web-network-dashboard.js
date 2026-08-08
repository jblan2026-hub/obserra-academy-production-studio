(() => {
  "use strict";

  const webMetrics = document.getElementById("webMonitorMetrics");
  const webList = document.getElementById("webSurfaceList");
  const webRefresh = document.getElementById("webMonitorRefresh");
  const webStatus = document.getElementById("webMonitorStatus");
  const networkMetrics = document.getElementById("networkMetrics");
  const networkList = document.getElementById("networkNodeList");
  const networkRefresh = document.getElementById("networkRefresh");
  const detail = document.getElementById("webNetworkDetail");

  let webSnapshot = null;
  let networkSnapshot = null;
  let busy = false;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function metric(label, value, detailText, state = "neutral") {
    const card = node("article", "operationMetric");
    card.dataset.state = state;
    card.append(
      node("span", "operationMetricLabel", label),
      node("strong", "operationMetricValue", value),
      node("small", "operationMetricDetail", detailText),
    );
    return card;
  }

  function renderDetail(title, payload) {
    detail.replaceChildren();
    const header = node("div", "detailDrawerHeader");
    header.append(node("h3", null, title), node("span", "detailTimestamp", `Reviewed ${new Date().toLocaleTimeString()}`));
    const pre = node("pre", "detailJson", JSON.stringify(payload, null, 2));
    detail.append(header, pre);
  }

  function surfaceState(surface) {
    if (surface.protocolCompliant && surface.htmlReady && surface.healthReady && !surface.error) return "good";
    if (surface.protocolCompliant && (surface.htmlReady || surface.healthReady)) return "warning";
    return "critical";
  }

  function renderWeb(next) {
    webSnapshot = next;
    const totals = next.totals || {};
    webMetrics.replaceChildren(
      metric("Monitored surfaces", totals.surfaces || 0, "Website, Academy, store, LCMS, and EIOS", totals.surfaces ? "good" : "warning"),
      metric("HTTPS compliant", `${totals.httpsCompliant || 0}/${totals.surfaces || 0}`, "Public surfaces must remain encrypted", totals.httpsCompliant === totals.surfaces && totals.surfaces > 0 ? "good" : "critical"),
      metric("HTML ready", `${totals.htmlReady || 0}/${totals.surfaces || 0}`, "Root page returned HTML or XHTML", totals.htmlReady === totals.surfaces && totals.surfaces > 0 ? "good" : "warning"),
      metric("Health endpoints", `${totals.healthReady || 0}/${totals.surfaces || 0}`, "Authenticated health route verification", totals.healthReady === totals.surfaces && totals.surfaces > 0 ? "good" : "warning"),
      metric("Failed checks", totals.failed || 0, `${(next.blockers || []).length} active blocker(s)`, totals.failed ? "critical" : "good"),
    );
    webStatus.textContent = `${totals.httpsCompliant || 0} HTTPS compliant · ${totals.htmlReady || 0} HTML ready · ${totals.healthReady || 0} health endpoints ready · ${totals.failed || 0} failed.`;
    webStatus.dataset.state = totals.failed ? "warning" : "good";

    webList.replaceChildren();
    for (const surface of next.surfaces || []) {
      const card = node("article", "webSurfaceCard");
      const state = surfaceState(surface);
      card.dataset.state = state;
      const header = node("div", "webSurfaceHeader");
      const identity = node("div", null);
      identity.append(node("strong", null, surface.name), node("code", null, surface.url));
      const status = node("span", "webSurfaceState", state === "good" ? "Verified" : state === "warning" ? "Degraded" : "Failed");
      status.dataset.state = state;
      header.append(identity, status);

      const checks = node("div", "webCheckGrid");
      const rows = [
        ["Protocol", surface.protocolCompliant ? surface.protocol.toUpperCase() : "Noncompliant", surface.protocolCompliant],
        ["HTML", surface.htmlReady ? surface.contentType || "HTML" : "Not verified", surface.htmlReady],
        ["Root response", surface.rootStatus || "No response", Number(surface.rootStatus) >= 200 && Number(surface.rootStatus) < 400],
        ["Health", surface.healthStatus || "No response", surface.healthReady],
        ["Latency", surface.latencyMs === null ? "Unavailable" : `${surface.latencyMs} ms`, surface.latencyMs !== null],
        ["Checked", new Date(surface.checkedAt).toLocaleTimeString(), true],
      ];
      for (const [label, value, passed] of rows) {
        const item = node("div", "webCheck");
        item.dataset.state = passed ? "good" : "critical";
        item.append(node("span", null, label), node("strong", null, value));
        checks.append(item);
      }

      const actions = node("div", "actions");
      const details = node("button", "secondary", "Details");
      details.type = "button";
      details.addEventListener("click", () => renderDetail(surface.name, surface));
      const recheck = node("button", "secondary", "Recheck");
      recheck.type = "button";
      recheck.addEventListener("click", () => refreshWeb({ force: true }));
      const scan = node("button", null, "Security scan");
      scan.type = "button";
      scan.addEventListener("click", async () => {
        window.obserraMission?.setCommandStatus(`Running full site security scan from ${surface.name}.`, "working");
        try {
          const result = await window.obserraOwner.runFullSecurityScan();
          renderDetail(`${surface.name} security scan`, result);
          window.obserraMission?.setCommandStatus("Full site security scan completed.", "success");
        } catch (error) {
          window.obserraMission?.setCommandStatus(`Security scan failed: ${error.message || String(error)}`, "error");
        }
      });
      const configure = node("button", "secondary", "Authorize connector");
      configure.type = "button";
      configure.addEventListener("click", () => {
        window.obserraMission?.openPage("devices");
        window.setTimeout(() => {
          const target = [...document.querySelectorAll(".connectorCard")]
            .find((cardNode) => cardNode.querySelector("h3")?.textContent?.includes(surface.name.replace("Obserra ", "")));
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          target?.querySelector(".configure")?.focus();
        }, 100);
      });
      actions.append(details, recheck, scan, configure);

      if (surface.error) card.append(header, checks, node("p", "webSurfaceError", surface.error), actions);
      else card.append(header, checks, actions);
      webList.append(card);
    }
    if (!(next.surfaces || []).length) webList.append(node("div", "emptyState", "No governed web surfaces are configured."));
  }

  function renderNetwork(next) {
    networkSnapshot = next;
    const totals = next.totals || {};
    networkMetrics.replaceChildren(
      metric("Network nodes", totals.nodes || 0, `Local host ${next.localHostname || "unknown"}`, totals.nodes ? "good" : "warning"),
      metric("Resolved hosts", `${totals.resolved || 0}/${totals.nodes || 0}`, `${totals.unresolved || 0} unresolved`, totals.unresolved ? "warning" : "good"),
      metric("HTTPS endpoints", totals.https || 0, `${totals.loopback || 0} loopback service(s)`, totals.https > 0 ? "good" : "warning"),
    );

    networkList.replaceChildren();
    for (const endpoint of next.nodes || []) {
      const card = node("button", "networkNode");
      card.type = "button";
      card.dataset.state = endpoint.addresses?.length ? "good" : "critical";
      card.append(
        node("strong", null, endpoint.name),
        node("span", null, `${endpoint.protocol.toUpperCase()} · ${endpoint.hostname}:${endpoint.port || "default"}`),
        node("small", null, endpoint.addresses?.length
          ? endpoint.addresses.map((address) => `${address.address}/${address.family}`).join(" · ")
          : endpoint.error || "DNS resolution unavailable"),
      );
      card.addEventListener("click", () => renderDetail(endpoint.name, endpoint));
      networkList.append(card);
    }
    if (!(next.nodes || []).length) networkList.append(node("div", "emptyState", "No network connector nodes are configured."));
  }

  async function refreshWeb({ force = false } = {}) {
    if (busy) return;
    busy = true;
    webRefresh.disabled = true;
    webRefresh.textContent = "Checking HTTPS and HTML…";
    try {
      renderWeb(await window.obserraOwner.getWebMonitorSnapshot({ force }));
    } catch (error) {
      webStatus.textContent = `Web monitoring failed: ${error.message || String(error)}`;
      webStatus.dataset.state = "critical";
    } finally {
      busy = false;
      webRefresh.disabled = false;
      webRefresh.textContent = "Refresh web monitoring";
    }
  }

  async function refreshNetwork() {
    if (busy) return;
    busy = true;
    networkRefresh.disabled = true;
    networkRefresh.textContent = "Resolving network…";
    try {
      renderNetwork(await window.obserraOwner.getNetworkSnapshot());
    } catch (error) {
      networkList.replaceChildren(node("div", "errorState", error.message || String(error)));
    } finally {
      busy = false;
      networkRefresh.disabled = false;
      networkRefresh.textContent = "Refresh network map";
    }
  }

  webRefresh.addEventListener("click", () => refreshWeb({ force: true }));
  networkRefresh.addEventListener("click", refreshNetwork);
  window.addEventListener("obserra:mission-snapshot", (event) => {
    if (event.detail?.web) renderWeb(event.detail.web);
    if (event.detail?.network) renderNetwork(event.detail.network);
  });
  refreshWeb().catch(() => {});
  refreshNetwork().catch(() => {});
  window.setInterval(() => refreshWeb().catch(() => {}), 30000);
})();
