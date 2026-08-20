import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const commandCenterRoot = path.resolve(process.cwd());
const repositoryRoot = path.resolve(commandCenterRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(commandCenterRoot, relativePath), "utf8");
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label} is missing required contract text: ${needle}`);
  }
}

const resolver = read("electron/academy-course-control-resolver.cjs");
requireText(resolver, "generation:", "Local lifecycle adapter");
requireText(resolver, "code: result?.exitCode", "Local lifecycle adapter");
requireText(resolver, "local-studio-workspace", "Local lifecycle adapter");
requireText(resolver, "academyStudio.getStudioSnapshot = originalGetStudioSnapshot", "Local lifecycle adapter restoration");
requireText(resolver, "academyStudio.runStudioAction = originalRunStudioAction", "Local lifecycle adapter restoration");

const preview = read("electron/academy-preview.cjs");
requireText(preview, '"generated", "authoring", "course-package.json"', "Course preview");
requireText(preview, "previewMaterials", "Course preview");
requireText(preview, "previewCertificate", "Course preview");

const ui = read("src/academy-reset-ui.js");
for (const label of [
  "Preview course",
  "Preview materials",
  "Preview certificate",
  "Load published website course",
  "Load certificate verification",
  "Approve release",
  "Publish live",
  "Request changes",
  "Reject",
  "Verify paid access",
  "Approval does not publish",
  "Course Version",
]) {
  requireText(ui, label, "Academy reset lifecycle UI");
}
for (const api of [
  "getAcademyControlSnapshot",
  "updateAcademyReview",
  "transitionAcademyCourse",
  "verifyAcademyPurchase",
  "retrieveWebsiteAcademyCourse",
  "retrieveWebsiteAcademyCertificate",
]) {
  requireText(ui, api, "Academy reset lifecycle UI");
}

const index = read("src/index.html");
for (const contract of [
  "Academy Command Center",
  "Private owner review, release, and publication control plane",
  "61-course release queue",
  "Privacy boundary",
  "Redacted by default",
  "academy-reset-ui.js",
  "academy-reset.css",
  "connect-src 'none'",
]) {
  requireText(index, contract, "Owner Command Center shell");
}
if (/academy-control-ui\.js|academy-preview-ui\.js|ACADEMY OPERATIONS CENTER|ACADEMY COURSE LIFECYCLE COMMAND/.test(index)) {
  throw new Error("Owner Command Center shell still contains legacy pre-reset Academy UI contracts.");
}

const preload = read("electron/preload.cjs");
for (const contract of [
  "previewAcademyCourse",
  "previewAcademyMaterials",
  "previewAcademyCertificate",
  "retrieveWebsiteAcademyCourse",
  "retrieveWebsiteAcademyCertificate",
  "verifyAcademyPurchase",
]) requireText(preload, contract, "Preload review contract");

const retrieval = read("electron/academy-website-retrieval.cjs");
for (const contract of [
  'parsed.protocol !== "https:"',
  'redirect: "error"',
  "MAX_RESPONSE_BYTES",
  "certificate-contract-mismatch",
  "courseVersion",
]) requireText(retrieval, contract, "Website readback contract");

const launcherPath = path.join(repositoryRoot, "scripts", "Start-ObserraAcademyReviewDashboard.ps1");
if (!fs.existsSync(launcherPath)) {
  throw new Error("The isolated Windows Academy review dashboard launcher is missing.");
}
const launcher = fs.readFileSync(launcherPath, "utf8");
for (const contract of [
  "C:\\ObserraAcademyProduction",
  "source\\obserra-academy-production-studio",
  "dashboard",
  "Governed courses",
  "The Studio checkout will not be switched, pulled, reset, or stopped by this launcher.",
  "PUBLISH <course-id>",
]) {
  requireText(launcher, contract, "Windows review dashboard launcher");
}

const activeStudioMutationPatterns = [
  /git\s+-C\s+\$StudioRootFull\s+(?:checkout|switch|pull|reset|restore|clean)/i,
  /Invoke-Git\s+-Repository\s+\$StudioRootFull/i,
];
for (const pattern of activeStudioMutationPatterns) {
  if (pattern.test(launcher)) {
    throw new Error(`Launcher violates the active Studio non-disruption boundary: ${pattern}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: "local-academy-review-dashboard-reset-v2",
      isolatedDashboardCheckout: true,
      localStudioBinding: true,
      coursePreview: true,
      ownerReviewDecisions: true,
      explicitPublishConfirmation: true,
      websiteCourseReadback: true,
      websiteCertificateReadback: true,
      securePurchaseVerification: true,
      courseVersionVisible: true,
      providerReadbackRequired: true,
      activeCourseBuildCheckoutMutation: false,
    },
    null,
    2,
  ),
);
