import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const reconciliationPath = path.join(catalogRoot, "academy-hollywood-media-reconciliation.json");
const reportPath = path.join(catalogRoot, "academy-hollywood-final-media-verification.json");
const portfolio = academySurgePortfolio();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function runAudioVerification(filePath) {
  const result = spawnSync(
    process.execPath,
    ["studio/verify-media-audio.mjs", "--file", filePath],
    { cwd: root, encoding: "utf8", env: process.env },
  );
  return {
    passed: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout ?? "").slice(-4000),
    stderr: String(result.stderr ?? "").slice(-4000),
  };
}

const reconciliation = fs.existsSync(reconciliationPath) ? readJson(reconciliationPath) : null;
const courseResults = [];
const findings = [];
let expectedModules = 0;
let verifiedModules = 0;

for (const item of portfolio.selectedCourses) {
  const modules = Array.isArray(item.manifest.course?.modules) ? item.manifest.course.modules : [];
  expectedModules += modules.length;
  const moduleResults = [];
  for (const module of modules) {
    const mediaDir = path.join(root, "releases", item.courseId, "FINAL", "media");
    const files = {
      video: path.join(mediaDir, `${module.id}.mp4`),
      captions: path.join(mediaDir, `${module.id}.vtt`),
      transcript: path.join(mediaDir, `${module.id}-transcript.md`),
      audioDescription: path.join(mediaDir, `${module.id}-audio-description.md`),
      rights: path.join(mediaDir, `${module.id}-rights-ledger.json`),
    };
    const moduleFindings = [];
    for (const [kind, filePath] of Object.entries(files)) {
      if (!fs.existsSync(filePath)) moduleFindings.push(`missing-${kind}`);
      else if (fs.statSync(filePath).size < (kind === "video" ? 1000 : 20)) moduleFindings.push(`${kind}-asset-too-small`);
    }

    let audioVerification = null;
    if (fs.existsSync(files.video)) {
      audioVerification = runAudioVerification(files.video);
      if (!audioVerification.passed) moduleFindings.push("audio-verification-failed");
    }
    if (fs.existsSync(files.captions)) {
      const captions = fs.readFileSync(files.captions, "utf8");
      if (!captions.startsWith("WEBVTT")) moduleFindings.push("invalid-vtt-header");
      if (!captions.includes("-->")) moduleFindings.push("missing-vtt-cues");
    }
    if (fs.existsSync(files.transcript) && wordCount(fs.readFileSync(files.transcript, "utf8")) < 100) {
      moduleFindings.push("transcript-insufficient-content");
    }
    if (fs.existsSync(files.audioDescription) && wordCount(fs.readFileSync(files.audioDescription, "utf8")) < 20) {
      moduleFindings.push("audio-description-insufficient-content");
    }

    let rights = null;
    if (fs.existsSync(files.rights)) {
      try {
        rights = readJson(files.rights);
        if (rights.publicationAuthorized !== false) moduleFindings.push("rights-record-grants-publication-authority");
        if (rights.originalCourseProduction !== true) moduleFindings.push("rights-record-missing-original-production-state");
        if (!Array.isArray(rights.providerJobIds) || rights.providerJobIds.length === 0) moduleFindings.push("rights-record-missing-provider-job-ids");
        if (!Array.isArray(rights.scriptHashes) || rights.scriptHashes.length === 0) moduleFindings.push("rights-record-missing-script-hashes");
      } catch {
        moduleFindings.push("invalid-rights-record-json");
      }
    }

    const reconciledModule = reconciliation?.moduleResults?.find((candidate) => candidate.courseId === item.courseId && candidate.moduleId === module.id) ?? null;
    if (!reconciledModule || reconciledModule.status !== "assembled-archived") moduleFindings.push("module-not-assembled-and-archived");
    if (reconciledModule?.lcms?.registered !== true) moduleFindings.push("module-media-not-registered-in-lcms");
    if (!Array.isArray(reconciledModule?.receipts) || reconciledModule.receipts.length < 5) moduleFindings.push("private-storage-receipts-incomplete");

    const passed = moduleFindings.length === 0;
    if (passed) verifiedModules += 1;
    for (const finding of moduleFindings) findings.push({ courseId: item.courseId, moduleId: module.id, finding });
    moduleResults.push({
      moduleId: module.id,
      title: module.title,
      passed,
      findings: moduleFindings,
      audioVerification,
      storageReceipts: reconciledModule?.receipts ?? [],
      lcms: reconciledModule?.lcms ?? null,
      rights,
    });
  }
  courseResults.push({
    courseId: item.courseId,
    title: item.manifest.course?.title ?? item.courseId,
    expectedModules: modules.length,
    verifiedModules: moduleResults.filter((module) => module.passed).length,
    passed: moduleResults.every((module) => module.passed),
    modules: moduleResults,
  });
}

const report = {
  schemaVersion: "1.0",
  verifiedAt: new Date().toISOString(),
  expectedCourses: portfolio.expectedCourses,
  verifiedCourses: courseResults.filter((course) => course.passed).length,
  expectedModules,
  verifiedModules,
  passed: findings.length === 0
    && courseResults.length === portfolio.expectedCourses
    && verifiedModules === expectedModules
    && reconciliation?.allJobsArchived === true
    && reconciliation?.allModulesAssembled === true,
  publicationAuthorized: false,
  findingCount: findings.length,
  findings,
  courses: courseResults,
  claimBoundary: "This gate verifies protected final media files, audio properties, generated accessibility artifacts, rights records, private-storage receipts, and LCMS registration. Human review must still confirm visual composition, caption accuracy, transcript accuracy, audio-description adequacy, rights sufficiency, source cards, brand quality, and owner acceptance before publication.",
};
fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Final media verification passed for ${report.verifiedModules}/${report.expectedModules} module(s) across ${report.verifiedCourses}/${report.expectedCourses} course(s).`);
if (!report.passed) {
  for (const finding of findings.slice(0, 300)) console.error(`[Academy Studio] ${finding.courseId}/${finding.moduleId}: ${finding.finding}`);
  process.exit(2);
}
