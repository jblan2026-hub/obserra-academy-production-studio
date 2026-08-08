const connectorContainer = document.getElementById("connectors");
const connectorTemplate = document.getElementById("connectorTemplate");
const courseOpsTemplate = document.getElementById("courseOpsTemplate");
const metrics = document.getElementById("metrics");
const localBadge = document.getElementById("localBadge");
const refreshBadge = document.getElementById("refreshBadge");
const securitySummary = document.getElementById("securitySummary");
const gapContainer = document.getElementById("gaps");
const gapCount = document.getElementById("gapCount");
const academyWorkspace = document.getElementById("academyWorkspace");
const academyMetrics = document.getElementById("academyMetrics");
const academyCourses = document.getElementById("academyCourses");
const academyGaps = document.getElementById("academyGaps");
const academyActionLog = document.getElementById("academyActionLog");
const academySearch = document.getElementById("academySearch");
const academyFilter = document.getElementById("academyFilter");
const REFRESH_INTERVAL_MS = 15000;
let snapshot;
let connectorState = [];
let academyState = { available: false, courses: [], summary: {} };
let refreshTimer;
let refreshInFlight = false;
let academyActionInFlight = false;

function statusLabel(status) {
  return ({ connected: "Connected", degraded: "Degraded", failed: "Unavailable", unconfigured: "Needs authorization" })[status] || "Not checked";
}

function gapForConnector(connector) {
  if (connector.status === "connected" && connector.controlEnabled) return null;
  if (connector.status === "connected") return { severity: "medium", title: `${connector.name}: monitoring only`, detail: "The service is reachable, but privileged owner control is not authorized.", action: connector.credentialKey ? "Provide the owner credential and re-run verification." : "Review the connector control policy." };
  if (connector.status === "unconfigured") return { severity: "high", title: `${connector.name}: authorization required`, detail: "The connector cannot validate privileged operations because its owner credential is missing.", action: "Select Authorize / configure and store the credential using Windows device encryption." };
  if (connector.status === "degraded") return { severity: "high", title: `${connector.name}: degraded`, detail: `The endpoint responded with HTTP ${connector.httpStatus || "an unhealthy status"}.`, action: "Inspect the service health endpoint, identity configuration, and current deployment logs." };
  return { severity: "critical", title: `${connector.name}: unavailable`, detail: connector.error || "The endpoint could not be reached or verified.", action: "Confirm endpoint, network reachability, service deployment, and credentials." };
}

function metricCard(label, value) {
  const element = document.createElement("div");
  element.className = "metric";
  const l = document.createElement("span");
  l.textContent = label;
  const v = document.createElement("strong");
  v.textContent = value;
  element.append(l, v);
  return element;
}

function renderMetrics() {
  const connected = connectorState.filter((item) => item.status === "connected").length;
  const degraded = connectorState.filter((item) => item.status === "degraded").length;
  const failed = connectorState.filter((item) => item.status === "failed").length;
  const controlEnabled = connectorState.filter((item) => item.controlEnabled).length;
  const cards = [["Connected services", `${connected}/${connectorState.length}`], ["Degraded services", String(degraded)], ["Unavailable services", String(failed)], ["Control-enabled", String(controlEnabled)], ["Logical processors", String(snapshot.logicalProcessors)], ["Memory available", `${snapshot.freeMemoryGb} GB`], ["Windows encryption", snapshot.windowsEncryption ? "Available" : "Unavailable"]];
  metrics.replaceChildren(...cards.map(([label, value]) => metricCard(label, value)));
}

function renderGaps() {
  const gaps = connectorState.map(gapForConnector).filter(Boolean);
  gapCount.textContent = `${gaps.length} active gap${gaps.length === 1 ? "" : "s"}`;
  gapCount.className = gaps.length === 0 ? "gapCount clear" : "gapCount";
  gapContainer.replaceChildren();
  if (gaps.length === 0) {
    const clear = document.createElement("div");
    clear.className = "gapItem clear";
    clear.innerHTML = "<strong>No active connector gaps.</strong><span>All approved services are connected and owner-control authorization is verified.</span>";
    gapContainer.append(clear);
    return;
  }
  for (const gap of gaps) {
    const item = document.createElement("article");
    item.className = `gapItem ${gap.severity}`;
    const title = document.createElement("strong");
    title.textContent = gap.title;
    const detail = document.createElement("span");
    detail.textContent = gap.detail;
    const action = document.createElement("em");
    action.textContent = `Required action: ${gap.action}`;
    item.append(title, detail, action);
    gapContainer.append(item);
  }
}

function renderSecurity() {
  const enabled = connectorState.filter((item) => item.controlEnabled).length;
  securitySummary.replaceChildren();
  const rows = [["Local security boundary", snapshot.localOnly ? "Enforced" : "Not verified"], ["Windows credential encryption", snapshot.windowsEncryption ? "Available" : "Unavailable"], ["Control authorization", `${enabled} connector(s) verified and enabled`], ["Continuous monitoring", `Automatic refresh every ${REFRESH_INTERVAL_MS / 1000} seconds`], ["Studio command policy", "Generate, build, catalog, and verify actions only"], ["Fail-safe mode", "Unverified or unhealthy connectors cannot execute write actions"]];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    row.append(strong, document.createTextNode(value));
    securitySummary.append(row);
  }
}

function renderConnectors() {
  connectorContainer.replaceChildren();
  for (const connector of connectorState) {
    const fragment = connectorTemplate.content.cloneNode(true);
    fragment.querySelector("h3").textContent = connector.name;
    fragment.querySelector(".endpoint").textContent = connector.url;
    fragment.querySelector(".description").textContent = connector.description;
    const status = fragment.querySelector(".status");
    status.textContent = statusLabel(connector.status);
    status.className = `status ${connector.status || "unconfigured"}`;
    fragment.querySelector(".connectorMeta").textContent = connector.controlEnabled ? `Verified · owner control enabled · checked ${connector.checkedAt || "now"}` : connector.error || (connector.configured ? "Reachable or configured, but privileged control is not yet verified" : "Credential or owner authorization required");
    fragment.querySelector(".configure").addEventListener("click", async () => {
      const url = window.prompt(`${connector.name} endpoint`, connector.url);
      if (url === null) return;
      const secret = connector.credentialKey ? window.prompt(`${connector.name} owner credential. It will be encrypted by Windows.`) : undefined;
      try {
        const updated = await window.obserraOwner.configureConnector({ id: connector.id, url, secret });
        connectorState = connectorState.map((item) => item.id === updated.id ? updated : item);
        renderAll();
      } catch (error) { window.alert(error.message || String(error)); }
    });
    connectorContainer.append(fragment);
  }
}

function courseMatchesFilter(course) {
  const q = academySearch.value.trim().toLowerCase();
  const haystack = [course.title, course.department, course.track, course.level, course.releaseStatus, course.description].join(" ").toLowerCase();
  if (q && !haystack.includes(q)) return false;
  const filter = academyFilter.value;
  if (filter === "not-generated") return course.generation !== "generated";
  if (filter === "generated") return course.generation === "generated";
  if (filter === "review") return course.reviewCompletion < 100 || course.missingArtifacts.length > 0;
  if (filter === "publishable") return course.generation === "generated" && course.reviewCompletion === 100 && course.missingArtifacts.length === 0;
  if (filter === "published") return course.publishToAcademy;
  return true;
}

function appendActionLog(message, state = "info") {
  const entry = document.createElement("div");
  entry.className = `logEntry ${state}`;
  entry.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  academyActionLog.prepend(entry);
}

async function runAcademyAction(action, courseId) {
  if (academyActionInFlight) return;
  academyActionInFlight = true;
  appendActionLog(`Started ${action}${courseId ? ` for ${courseId}` : ""}.`);
  try {
    const result = await window.obserraOwner.runAcademyAction({ action, courseId });
    appendActionLog(`${action} ${result.ok ? "completed" : "failed"}${result.exitCode === null ? "" : ` with exit code ${result.exitCode}`}.`, result.ok ? "ok" : "error");
    if (result.stderr) appendActionLog(result.stderr.slice(-1000), "error");
    if (result.stdout) appendActionLog(result.stdout.slice(-1000), "info");
    await refreshAcademy();
  } catch (error) { appendActionLog(error.message || String(error), "error"); }
  finally { academyActionInFlight = false; }
}

async function editCourse(course) {
  const title = window.prompt("Course title", course.title);
  if (title === null) return;
  const description = window.prompt("Course description", course.description);
  if (description === null) return;
  const duration = window.prompt("Course duration", course.duration);
  if (duration === null) return;
  const priceText = window.prompt("Course price", String(course.price ?? 0));
  if (priceText === null) return;
  const releaseStatus = window.prompt("Release status: draft, in-review, approved, published, or retired", course.releaseStatus);
  if (releaseStatus === null) return;
  try {
    const updated = await window.obserraOwner.updateAcademyCourse({ courseId: course.id, updates: { title, description, duration, price: Number(priceText), releaseStatus } });
    academyState.courses = academyState.courses.map((item) => item.id === updated.id ? updated : item);
    appendActionLog(`Updated ${updated.title}.`, "ok");
    renderAcademy();
  } catch (error) { window.alert(error.message || String(error)); }
}

function renderAcademy() {
  academyWorkspace.textContent = academyState.available ? `Live workspace: ${academyState.root} · checked ${new Date(academyState.checkedAt).toLocaleTimeString()}` : "Studio workspace unavailable. Set OBSERRA_ACADEMY_STUDIO_ROOT on machine obserra.";
  const summary = academyState.summary || {};
  academyMetrics.replaceChildren(...[["Courses", summary.total || 0], ["AI generated", summary.generated || 0], ["Review ready", summary.reviewReady || 0], ["Published", summary.published || 0], ["Open recommendations", summary.gaps || 0]].map(([label, value]) => metricCard(label, String(value))));
  academyGaps.replaceChildren();
  for (const gap of academyState.gaps || []) {
    const item = document.createElement("article");
    item.className = "gapItem high";
    const title = document.createElement("strong");
    title.textContent = "Academy production gap";
    const detail = document.createElement("span");
    detail.textContent = gap;
    item.append(title, detail);
    academyGaps.append(item);
  }
  academyCourses.replaceChildren();
  const courses = (academyState.courses || []).filter(courseMatchesFilter);
  for (const course of courses) {
    const fragment = courseOpsTemplate.content.cloneNode(true);
    fragment.querySelector(".courseDepartment").textContent = `${course.department} · ${course.level} · ${course.track}`;
    fragment.querySelector(".courseTitle").textContent = course.title;
    fragment.querySelector(".courseDescription").textContent = course.description;
    const status = fragment.querySelector(".courseStatus");
    status.textContent = course.publishToAcademy ? "Published" : course.generation === "generated" ? "Generated" : "Not generated";
    status.className = `status courseStatus ${course.publishToAcademy ? "connected" : course.generation === "generated" ? "degraded" : "failed"}`;
    fragment.querySelector(".courseFacts").textContent = `${course.duration} · ${course.currency} ${course.price ?? "N/A"} · ${course.moduleCount} modules · v${course.version}`;
    fragment.querySelector(".courseProgress").textContent = `Reviews ${course.reviewCompletion}% · ${course.missingArtifacts.length} missing artifact(s) · release ${course.releaseStatus}`;
    const recommendations = fragment.querySelector(".courseRecommendations");
    if (course.recommendations.length) {
      const heading = document.createElement("strong");
      heading.textContent = "Recommended changes";
      recommendations.append(heading);
      for (const recommendation of course.recommendations) {
        const row = document.createElement("span");
        row.textContent = recommendation;
        recommendations.append(row);
      }
    } else recommendations.textContent = "No blocking recommendations.";
    fragment.querySelector('[data-action="author"]').disabled = academyActionInFlight;
    fragment.querySelector('[data-action="author"]').addEventListener("click", () => runAcademyAction("author", course.id));
    fragment.querySelector('[data-action="build"]').disabled = academyActionInFlight;
    fragment.querySelector('[data-action="build"]').addEventListener("click", () => runAcademyAction("build", course.id));
    fragment.querySelector('[data-action="edit"]').addEventListener("click", () => editCourse(course));
    academyCourses.append(fragment);
  }
  if (!courses.length) {
    const empty = document.createElement("div");
    empty.className = "gapItem medium";
    empty.textContent = academyState.available ? "No courses match the current search and filter." : "Academy Studio is not connected to a local workspace.";
    academyCourses.append(empty);
  }
}

async function refreshAcademy() {
  try { academyState = await window.obserraOwner.getAcademySnapshot(); renderAcademy(); }
  catch (error) { academyState = { available: false, courses: [], summary: {}, gaps: [error.message || String(error)] }; renderAcademy(); }
}

function renderAll() { renderMetrics(); renderGaps(); renderConnectors(); renderSecurity(); }

async function probeAll({ manual = false } = {}) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const button = document.getElementById("connectAll");
  button.disabled = true;
  button.textContent = manual ? "Refreshing…" : "Checking…";
  refreshBadge.textContent = "Live status checking…";
  refreshBadge.classList.remove("ok", "warn");
  try {
    [connectorState] = await Promise.all([window.obserraOwner.probeAllConnectors(), refreshAcademy()]);
    const unhealthy = connectorState.filter((item) => item.status !== "connected").length;
    refreshBadge.textContent = `Updated ${new Date().toLocaleTimeString()} · ${unhealthy} service gap${unhealthy === 1 ? "" : "s"}`;
    refreshBadge.classList.toggle("ok", unhealthy === 0);
    refreshBadge.classList.toggle("warn", unhealthy > 0);
    renderAll();
  } catch {
    refreshBadge.textContent = "Live refresh failed";
    refreshBadge.classList.add("warn");
  } finally {
    button.disabled = false;
    button.textContent = "Refresh all now";
    refreshInFlight = false;
  }
}

document.getElementById("connectAll").addEventListener("click", () => probeAll({ manual: true }));
document.getElementById("academyRefresh").addEventListener("click", refreshAcademy);
document.getElementById("academyVerify").addEventListener("click", () => runAcademyAction("verify"));
document.getElementById("academyCatalog").addEventListener("click", () => runAcademyAction("catalog"));
academySearch.addEventListener("input", renderAcademy);
academyFilter.addEventListener("change", renderAcademy);
document.getElementById("exportConfig").addEventListener("click", async () => {
  const passphrase = window.prompt("Create a recovery passphrase of at least 14 characters.");
  if (!passphrase) return;
  try { const result = await window.obserraOwner.exportRecoveryBundle(passphrase); if (result.exported) window.alert("Encrypted owner recovery bundle exported successfully."); }
  catch (error) { window.alert(error.message || String(error)); }
});
document.getElementById("importConfig").addEventListener("click", async () => {
  const passphrase = window.prompt("Enter the recovery bundle passphrase.");
  if (!passphrase) return;
  try { const result = await window.obserraOwner.importRecoveryBundle(passphrase); if (result.imported) { connectorState = result.connectors; renderAll(); } }
  catch (error) { window.alert(error.message || String(error)); }
});

(async () => {
  snapshot = await window.obserraOwner.getSystemSnapshot();
  localBadge.textContent = snapshot.localOnly ? `Local only · ${snapshot.hostname}` : "Security boundary not verified";
  localBadge.classList.toggle("ok", snapshot.localOnly);
  connectorState = await window.obserraOwner.listConnectors();
  await refreshAcademy();
  renderAll();
  await probeAll();
  refreshTimer = window.setInterval(() => probeAll(), REFRESH_INTERVAL_MS);
  window.addEventListener("beforeunload", () => window.clearInterval(refreshTimer), { once: true });
})();
