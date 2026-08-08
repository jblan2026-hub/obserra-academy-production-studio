import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

const index = read("src", "index.html");
const styles = read("src", "styles.css");
const navigation = read("src", "navigation.js");
const runtimeUi = read("src", "runtime-ui.js");
const aiHealth = read("src", "ai-health-dashboard.js");
const webNetworkUi = read("src", "web-network-dashboard.js");
const academyPreviewUi = read("src", "academy-preview-ui.js");
const preload = read("electron", "preload.cjs");
const webNetworkRuntime = read("electron", "web-network-monitor.cjs");
const mainWithRemediation = read("electron", "main-with-remediation.cjs");

const pages = [
  "overview",
  "devices",
  "web-network",
  "ai",
  "security",
  "academy",
  "connections",
];
for (const page of pages) {
  assert.match(index, new RegExp(`data-page-target=["']${page}["']`));
  assert.match(index, new RegExp(`class=["']appPage["'][^>]*data-page=["']${page}["']`));
}

for (const requiredId of [
  "runtimeBadge",
  "runtimeNotifications",
  "endpointEnrollmentPanel",
  "endpointEnroll",
  "webMonitorStatus",
  "webMonitorCards",
  "webScanAll",
  "networkMonitorStatus",
  "networkAnalyze",
  "aiHealthStatus",
  "aiHealthMetrics",
  "aiSourceHealth",
  "aiAnalyzeAll",
  "academyCourses",
  "academyPreviewDialog",
  "securityPanel",
  "remediationPanel",
  "connectors",
  "exportConfig",
  "importConfig",
]) {
  assert.ok(index.includes(`id="${requiredId}"`), `Dashboard surface is missing ${requiredId}.`);
}

for (const script of [
  "runtime-ui.js",
  "endpoint-enrollment-ui.js",
  "app.js",
  "website-dashboard.js",
  "academy-batch.js",
  "academy-github-evidence.js",
  "academy-preview-ui.js",
  "security-dashboard.js",
  "remediation-dashboard.js",
  "web-network-dashboard.js",
  "ai-health-dashboard.js",
  "navigation.js",
]) {
  assert.ok(index.includes(`src="${script}"`), `Dashboard does not load ${script}.`);
}

assert.match(index, /connect-src 'none'/);
assert.match(styles, /\.pageTabs/);
assert.match(styles, /\.appPage/);
assert.match(styles, /\.monitorGrid/);
assert.match(styles, /\.runtimeNotifications/);
assert.match(navigation, /window\.dispatchEvent\(new CustomEvent\("obserra:page-changed"/);
assert.match(navigation, /history\.replaceState/);
assert.match(runtimeUi, /unhandledrejection/);
assert.match(runtimeUi, /window\.obserraNotify/);

for (const bridgeMethod of [
  "getRuntimeHealth",
  "getEndpointSnapshot",
  "enrollEndpoint",
  "getWebpageSnapshot",
  "scanWebpages",
  "scanWebpage",
  "addMonitoredWebpage",
  "removeMonitoredWebpage",
  "getNetworkSnapshot",
  "analyzeNetwork",
  "getAcademySnapshot",
  "previewAcademyCourse",
  "previewAcademyMaterials",
  "previewAcademyCertificate",
  "getOwnerAISnapshot",
  "getSecuritySnapshot",
]) {
  assert.ok(preload.includes(`${bridgeMethod}:`), `Secure preload bridge is missing ${bridgeMethod}.`);
}

assert.match(aiHealth, /Owner AI engine/);
assert.match(aiHealth, /Local AI runtime/);
assert.match(aiHealth, /Analyze AI, connections, webpages, and network/);
assert.match(webNetworkUi, /Healthy HTTPS \+ HTML/);
assert.match(webNetworkUi, /Analyze connections and network/);
assert.match(webNetworkRuntime, /Monitored webpages must use HTTPS/);
assert.match(webNetworkRuntime, /response did not contain an HTML document/);
assert.match(webNetworkRuntime, /unrestrictedPortScanning: false/);
assert.match(mainWithRemediation, /webpages:scanAll/);
assert.match(mainWithRemediation, /network:analyzeNow/);
assert.match(mainWithRemediation, /runtime:getHealth/);

for (const requiredReviewTerm of [
  "academyReviewQueuePanel",
  "Pending courses and materials",
  "Pending owner review",
  "Review course",
  "Review materials",
  "Review certificate",
  "Open production controls",
  "materialInventory",
  "courseReviewStage",
]) {
  assert.ok(
    academyPreviewUi.includes(requiredReviewTerm),
    `Academy owner review queue is missing ${requiredReviewTerm}.`,
  );
}

console.log(JSON.stringify({
  gate: "owner-command-center-dashboard-navigation",
  categoryPages: pages,
  categoryPageCount: pages.length,
  endpointEnrollmentSurface: true,
  aiHealthSurface: true,
  httpsAndHtmlMonitoring: true,
  approvedNetworkAnalysis: true,
  pendingAcademyCourseList: true,
  academyMaterialReviewControls: true,
  rendererNetworkDisabled: true,
  securePreloadBridge: true,
  passed: true,
}, null, 2));
