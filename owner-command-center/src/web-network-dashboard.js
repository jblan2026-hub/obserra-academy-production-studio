(() => {
  "use strict";

  const webStatus = document.getElementById("webMonitorStatus");
  const webMetrics = document.getElementById("webMonitorMetrics");
  const webCards = document.getElementById("webMonitorCards");
  const scanAllButton = document.getElementById("webScanAll");
  const addPageButton = document.getElementById("webAddPage");
  const networkStatus = document.getElementById("networkMonitorStatus");
  const networkMetrics = document.getElementById("networkMonitorMetrics");
  const networkServices = document.getElementById("networkServices");
  const networkInterfaces = document.getElementById("networkInterfaces");
  const analyzeNetworkButton = document.getElementById("networkAnalyze");

  if (!webStatus || !window.obserraOwner) return;

  let webSnapshot = null;
  let networkSnapshot = null;
  let webBusy = false;
  let networkBusy = false;

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

  function statusText(status) {
    return ({
      healthy: "Healthy",
      degraded: "Degraded",
      failed: "Failed",
      reachable: "Reachable",
      "not-checked": "Not checked",
    })[status] || "Unknown";
  }

  function setWebBusy(value) {
    webBusy = value;
    scanAllButton.disabled = value;
    addPageButton.disabled = value;
    scanAllButton.textContent = value ? "Checking HTTPS and HTML…" : "Scan all webpages";
  }

  function setNetworkBusy(value) {
    networkBusy = value;
    analyzeNetworkButton.disabled = value;
    analyzeNetworkButton.textContent = value ? "Analyzing approved services…" : "Analyze connections and network";
  }

  function renderWebpages() {
    const pages = webSnapshot?.pages || [];
    webMetrics.replaceChildren(
      metric("Monitored webpages", webSnapshot?.total || 0, "Managed and owner-added HTTPS pages"),
      metric("Healthy HTTPS + HTML", webSnapshot?.healthy || 0, "Successful HTTPS response and valid HTML document"),
      metric("Degraded", webSnapshot?.degraded || 0, "Reachable but failed an HTTP, HTTPS, or HTML check"),
      metric("Failed", webSnapshot?.failed || 0, "No verified response"),
      metric("Unchecked", webSnapshot?.unchecked || 0, "Waiting for first monitored check"),
      metric("Last complete scan", webSnapshot?.checkedAt ? new Date(webSnapshot.checkedAt).toLocaleTimeString() : "Not run"),
    );
    webStatus.textContent = webSnapshot?.contract || "HTTPS and HTML webpage monitoring is initializing.";
    webCards.replaceChildren();

    for (const page of pages) {
      const result = page.result;
      const card = document.createElement("article");
      card.className = `monitorCard ${result?.status || "not-checked"}`;
      const header = document.createElement("div");
      header.className = "monitorCardHeader";
      const heading = document.createElement("div");
      const category = document.createElement("p");
      category.className = "eyebrow";
      category.textContent = page.category || "webpage";
      const title = document.createElement("h3");
      title.textContent = page.name;
      heading.append(category, title);
      const badge = document.createElement("span");
      badge.className = `status ${result?.status === "healthy" ? "connected" : result?.status === "degraded" ? "degraded" : "failed"}`;
      badge.textContent = statusText(result?.status || "not-checked");
      header.append(heading, badge);

      const url = document.createElement("code");
      url.className = "monitorUrl";
      url.textContent = page.url;
      const facts = document.createElement("div");
      facts.className = "monitorFacts";
      const factValues = [
        ["HTTPS", result ? (result.https ? "Verified" : "Failed") : "Not checked"],
        ["HTML", result ? (result.html ? "Verified" : "Failed") : "Not checked"],
        ["HTTP", result?.httpStatus ?? "N/A"],
        ["Latency", result ? `${result.latencyMs} ms` : "N/A"],
        ["Title", result?.title || "Not reported"],
        ["Security headers", result ? `${result.securityHeaderCount}/6` : "N/A"],
      ];
      for (const [label, value] of factValues) {
        const row = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = `${label}: `;
        row.append(strong, document.createTextNode(String(value)));
        facts.append(row);
      }
      const error = document.createElement("p");
      error.className = "monitorError";
      error.textContent = result?.error || "No active HTTPS or HTML blocker reported.";
      const actions = document.createElement("div");
      actions.className = "actions";
      const scan = document.createElement("button");
      scan.className = "secondary";
      scan.textContent = "Scan page now";
      scan.disabled = webBusy;
      scan.addEventListener("click", async () => {
        setWebBusy(true);
        try {
          await window.obserraOwner.scanWebpage(page.id);
          webSnapshot = await window.obserraOwner.getWebpageSnapshot();
          renderWebpages();
          notify(`${page.name} HTTPS and HTML check completed.`, "ok");
        } catch (caught) {
          notify(caught instanceof Error ? caught.message : String(caught), "error");
        } finally {
          setWebBusy(false);
        }
      });
      actions.append(scan);
      if (!page.managed) {
        const remove = document.createElement("button");
        remove.className = "secondary dangerButton";
        remove.textContent = "Remove";
        remove.disabled = webBusy;
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Remove ${page.name} from webpage monitoring?`)) return;
          setWebBusy(true);
          try {
            const response = await window.obserraOwner.removeMonitoredWebpage(page.id);
            webSnapshot = response.snapshot;
            renderWebpages();
          } catch (caught) {
            notify(caught instanceof Error ? caught.message : String(caught), "error");
          } finally {
            setWebBusy(false);
          }
        });
        actions.append(remove);
      }
      card.append(header, url, facts, error, actions);
      webCards.append(card);
    }
  }

  function renderNetwork() {
    const services = networkSnapshot?.services || [];
    const interfaces = networkSnapshot?.topology?.interfaces || [];
    const reachable = services.filter((service) => service.status === "reachable").length;
    const tlsVerified = services.filter((service) => service.tlsAuthorized === true).length;
    const failed = services.filter((service) => service.status === "failed").length;
    networkMetrics.replaceChildren(
      metric("Approved services", services.length, "No unrestricted port scanning"),
      metric("Transport reachable", reachable),
      metric("TLS authorized", tlsVerified, "Verified certificate chain for HTTPS endpoints"),
      metric("Connection failures", failed),
      metric("Local interfaces", interfaces.length),
      metric("Last network analysis", networkSnapshot?.checkedAt ? new Date(networkSnapshot.checkedAt).toLocaleTimeString() : "Not run"),
    );
    networkStatus.textContent = networkSnapshot?.contract || "Approved network analysis is initializing.";

    networkServices.replaceChildren();
    for (const service of services) {
      const item = document.createElement("article");
      item.className = `gapItem ${service.status === "reachable" ? "clear" : "high"}`;
      const title = document.createElement("strong");
      title.textContent = `${service.name || service.id} · ${statusText(service.status)}`;
      const detail = document.createElement("span");
      const addresses = (service.addresses || []).map((address) => address.address).join(", ") || "DNS not verified";
      detail.textContent = `${service.protocol || ""}//${service.hostname || "unknown"}:${service.port || ""} · DNS ${addresses} · transport ${service.transportConnected ? "connected" : "failed"} · TLS ${service.tlsAuthorized === null || service.tlsAuthorized === undefined ? "not applicable" : service.tlsAuthorized ? "authorized" : "failed"} · application ${service.applicationStatus || "not checked"}${service.error ? ` · ${service.error}` : ""}`;
      item.append(title, detail);
      networkServices.append(item);
    }
    if (!services.length) {
      const item = document.createElement("article");
      item.className = "gapItem medium";
      item.textContent = "Run approved network analysis to collect connection, DNS, and TLS evidence.";
      networkServices.append(item);
    }

    networkInterfaces.replaceChildren();
    for (const entry of interfaces) {
      const item = document.createElement("article");
      item.className = "gapItem medium";
      const title = document.createElement("strong");
      title.textContent = `${entry.name} · ${entry.family}`;
      const detail = document.createElement("span");
      detail.textContent = `${entry.address}${entry.cidr ? ` · ${entry.cidr}` : ""}${entry.mac ? ` · ${entry.mac}` : ""}`;
      item.append(title, detail);
      networkInterfaces.append(item);
    }
    if (!interfaces.length) {
      const item = document.createElement("article");
      item.className = "gapItem medium";
      item.textContent = "No non-loopback local network interface was reported.";
      networkInterfaces.append(item);
    }
  }

  async function refreshSnapshots() {
    try {
      [webSnapshot, networkSnapshot] = await Promise.all([
        window.obserraOwner.getWebpageSnapshot(),
        window.obserraOwner.getNetworkSnapshot(),
      ]);
      renderWebpages();
      renderNetwork();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : String(caught), "error");
    }
  }

  scanAllButton.addEventListener("click", async () => {
    if (webBusy) return;
    setWebBusy(true);
    try {
      webSnapshot = await window.obserraOwner.scanWebpages();
      renderWebpages();
      notify("All approved webpages were checked for HTTPS and HTML responses.", "ok");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : String(caught), "error");
    } finally {
      setWebBusy(false);
    }
  });

  addPageButton.addEventListener("click", async () => {
    if (webBusy) return;
    const name = window.prompt("Webpage name");
    if (name === null) return;
    const url = window.prompt("HTTPS webpage URL", "https://");
    if (url === null) return;
    const category = window.prompt("Functional category", "custom");
    if (category === null) return;
    setWebBusy(true);
    try {
      const response = await window.obserraOwner.addMonitoredWebpage({ name, url, category });
      webSnapshot = response.snapshot;
      renderWebpages();
      notify(`${name} was added and checked for HTTPS and HTML.`, "ok");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : String(caught), "error");
    } finally {
      setWebBusy(false);
    }
  });

  analyzeNetworkButton.addEventListener("click", async () => {
    if (networkBusy) return;
    setNetworkBusy(true);
    try {
      networkSnapshot = await window.obserraOwner.analyzeNetwork();
      renderNetwork();
      notify("Approved service connection, DNS, and TLS analysis completed.", "ok");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : String(caught), "error");
    } finally {
      setNetworkBusy(false);
    }
  });

  void refreshSnapshots();
  window.setInterval(() => {
    if (document.body.dataset.activePage === "web-network") void refreshSnapshots();
  }, 30000);
})();
