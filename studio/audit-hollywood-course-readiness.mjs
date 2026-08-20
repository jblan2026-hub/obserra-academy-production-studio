import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_POLICY_VERSION,
  PRODUCTION_CONTRACT_VERSION,
  authoringSourceHash,
} from "./academy-hollywood-checkpoints.mjs";
import { academySurgePortfolio } from "./academy-course-portfolio.mjs";
import { assertAcademyWorkerAllocation } from "./academy-worker-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const allocation = assertAcademyWorkerAllocation();
const portfolio = academySurgePortfolio();
const courses = [];
const findings = [];

for (const item of portfolio.selectedCourses) {
  const manifest = item.manifest;
  const courseId = item.courseId;
  const courseFindings = [];
  const blockingFindings = [];

  if (courseId !== item.directoryName) blockingFindings.push("directory-course-id-mismatch");
  if (!String(manifest.course?.title ?? "").trim()) blockingFindings.push("missing-course-title");
  if (!Array.isArray(manifest.course?.modules) || manifest.course.modules.length === 0) blockingFindings.push("missing-course-modules");
  if (manifest.completion?.allLessonsRequired !== true) blockingFindings.push("all-lessons-not-required");
  if (manifest.completion?.assessmentRequired !== true) blockingFindings.push("assessment-not-required");
  if (manifest.completion?.certificateIssued !== true) blockingFindings.push("certificate-not-enabled");
  if (manifest.release?.publishToAcademy === true && !["approved", "published"].includes(item.releaseStatus)) {
    blockingFindings.push("publication-enabled-without-approved-status");
  }

  const packagePath = path.join(item.courseDir, "generated", "authoring", "course-package.json");
  const expectedSourceManifestHash = authoringSourceHash(manifest);
  let packageState = "missing";
  let authored = null;
  if (!fs.existsSync(packagePath)) {
    courseFindings.push("missing-hollywood-course-package");
  } else {
    try {
      authored = readJson(packagePath);
      packageState = "available";
      if (authored.schemaVersion !== "2.0") courseFindings.push("unsupported-hollywood-package-schema");
      if (authored.authoringPolicyVersion !== AUTHORING_POLICY_VERSION) courseFindings.push("outdated-hollywood-authoring-policy");
      if (authored.productionContractVersion !== PRODUCTION_CONTRACT_VERSION) courseFindings.push("outdated-hollywood-production-contract");
      if (authored.sourceManifestHash !== expectedSourceManifestHash) courseFindings.push("stale-hollywood-course-package");
      if (authored.publicationAuthorized !== false) blockingFindings.push("generated-package-grants-publication-authority");
      if (authored.reviewStatus !== "draft-ai-generated-compliance-staging") courseFindings.push("invalid-hollywood-review-status");
    } catch (error) {
      packageState = "invalid";
      courseFindings.push("invalid-hollywood-course-package-json");
      courseFindings.push(`package-read-error-${String(error?.message ?? error).slice(0, 120).replace(/[^a-zA-Z0-9-]+/g, "-")}`);
    }
  }

  courses.push({
    courseId,
    title: manifest.course?.title ?? courseId,
    releaseStatus: item.releaseStatus,
    publicationEnabled: manifest.release?.publishToAcademy === true,
    moduleCount: Array.isArray(manifest.course?.modules) ? manifest.course.modules.length : 0,
    expectedSourceManifestHash,
    packageState,
    packageAuthoringPolicyVersion: authored?.authoringPolicyVersion ?? null,
    packageProductionContractVersion: authored?.productionContractVersion ?? null,
    findings: [...blockingFindings, ...courseFindings],
    blockingFindings,
    authoringRequired: courseFindings.length > 0,
  });

  for (const finding of blockingFindings) findings.push({ courseId, finding, blocking: true });
  for (const finding of courseFindings) findings.push({ courseId, finding, blocking: false });
}

const blockingFindings = findings.filter((finding) => finding.blocking);
const authoringTargets = courses.filter((course) => course.authoringRequired);
const report = {
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  authoringPolicyVersion: AUTHORING_POLICY_VERSION,
  productionContractVersion: PRODUCTION_CONTRACT_VERSION,
  allocation,
  portfolio: {
    expectedCourses: portfolio.expectedCourses,
    selectedCourseIds: portfolio.selectedCourseIds,
    excludedCourseIds: portfolio.excludedCourseIds,
    excludedCourses: portfolio.excludedCourses.map((course) => ({
      courseId: course.courseId,
      title: course.manifest.course?.title ?? course.courseId,
      reason: "separate-course-specific-production-contract",
    })),
    policy: portfolio.policy,
  },
  totals: {
    discoveredManifests: portfolio.discoveredManifests,
    selectedForSurge: courses.length,
    authoringTargets: authoringTargets.length,
    blockingFindings: blockingFindings.length,
    publicationEnabled: courses.filter((course) => course.publicationEnabled).length,
  },
  authoringRequired: authoringTargets.length > 0,
  targetCourseIds: authoringTargets.map((course) => course.courseId),
  findings,
  courses,
  claimBoundary: "This audit selects exactly 60 standard Academy courses and identifies structural manifests and protected cinematic authoring requirements. The PMP course remains governed by its separate course-specific contract. This audit does not establish source verification, mastered media, review approval, LCMS loading, purchase readiness, or publication authorization.",
};

fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-course-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
writeOutput("authoring_required", String(report.authoringRequired));
writeOutput("authoring_targets", String(authoringTargets.length));
writeOutput("blocking_findings", String(blockingFindings.length));
writeOutput("surge_courses", String(courses.length));

console.log(`[Academy Studio] Cinematic audit selected exactly ${courses.length} standard Academy course(s), excluded ${portfolio.excludedCourseIds.join(", ")}, and identified ${authoringTargets.length} authoring target(s).`);
if (blockingFindings.length > 0) {
  for (const finding of blockingFindings.slice(0, 100)) {
    console.error(`[Academy Studio] ${finding.courseId}: ${finding.finding}`);
  }
  process.exitCode = 2;
}
