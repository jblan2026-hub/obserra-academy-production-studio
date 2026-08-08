import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const courseArgIndex = process.argv.indexOf("--course");
const courseId = courseArgIndex >= 0 ? process.argv[courseArgIndex + 1] : null;
const finalRequested = process.argv.includes("--final");
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  console.error("Usage: node studio/build-course.mjs --course <course-id> [--final]");
  process.exit(1);
}

const sourceDir = path.join(root, "courses", courseId);
const manifestPath = path.join(sourceDir, "course-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`[Academy Studio] Course manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const stageName = finalRequested ? "FINAL" : "STAGED";
const releaseDir = path.join(root, "releases", courseId, stageName);
const authoredPackagePath = path.join(sourceDir, "generated", "authoring", "course-package.json");
const stageRecordPath = path.join(sourceDir, "commercial-course-stage.json");
const evidencePath = path.join(sourceDir, "commercial-release-evidence.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function copyFile(relativePath) {
  const source = path.join(sourceDir, relativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  const target = path.join(releaseDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function copyDirectory(relativePath) {
  const source = path.join(sourceDir, relativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return false;
  const target = path.join(releaseDir, relativePath);
  fs.cpSync(source, target, { recursive: true, force: true });
  return true;
}

function recursiveFiles(directory, relativeRoot = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...recursiveFiles(absolutePath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function assertFinalEvidence(evidence) {
  if (manifest.release?.publishToAcademy !== true
      || !["approved", "published"].includes(manifest.release?.status)) {
    throw new Error("FINAL packaging requires an approved or published manifest with publishToAcademy=true.");
  }
  if (evidence?.schemaVersion !== "1.0"
      || evidence?.courseId !== courseId
      || evidence?.contractId !== workerPoolContract.contractId
      || evidence?.contractHash !== contractHash()
      || evidence?.productionStandardId !== commercialProductionStandard.standardId
      || evidence?.productionStandardHash !== commercialProductionStandardHash()
      || evidence?.accepted !== true
      || evidence?.ownerAcceptance?.decision !== "approved") {
    throw new Error("FINAL packaging requires matching commercial release evidence and explicit owner acceptance.");
  }
  const evidenceById = new Map((evidence.items ?? []).map((item) => [item.id, item]));
  for (const required of commercialProductionStandard.requiredReleaseEvidence) {
    const item = evidenceById.get(required);
    if (!item || item.status !== "passed" || !item.evidenceReference || !item.verifiedAt || !item.verifiedBy) {
      throw new Error(`FINAL packaging is blocked by incomplete evidence: ${required}.`);
    }
  }
  if (evidence.referenceResolution?.unresolvedExternalReferences !== 0) {
    throw new Error("FINAL packaging is blocked by unresolved external references.");
  }
  if (evidence.mediaInventory?.missingRequiredAssets !== 0) {
    throw new Error("FINAL packaging is blocked by missing required media assets.");
  }
}

if (!fs.existsSync(authoredPackagePath)) {
  throw new Error("Protected detailed authoring package is required before course packaging.");
}
if (!fs.existsSync(stageRecordPath)) {
  throw new Error("Commercial course staging record is required before course packaging.");
}

const stageRecord = readJson(stageRecordPath);
if (stageRecord.courseId !== courseId
    || stageRecord.contractHash !== contractHash()
    || stageRecord.productionStandardHash !== commercialProductionStandardHash()
    || stageRecord.status !== "compliance-staged") {
  throw new Error("Commercial course staging record is stale or does not match the current governed contracts.");
}

let releaseEvidence = null;
if (finalRequested) {
  if (!fs.existsSync(evidencePath)) {
    throw new Error("FINAL packaging requires commercial-release-evidence.json.");
  }
  releaseEvidence = readJson(evidencePath);
  assertFinalEvidence(releaseEvidence);
}

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

const requiredFiles = [
  "course-manifest.json",
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "implementation-and-application-guide.md",
  "assessment-bank.json",
  "answer-key.json",
  "visual-brief.md",
  "source-register.json",
  "reference-applicability-matrix.json",
  "documented-real-world-case-register.json",
  "course-implementation-strategy.json",
  "standards-implementation-map.json",
  "prioritized-recommendations.json",
  "implementation-guidance.json",
  "course-production-bible.json",
  "commercial-production-plan.json",
  "certificate-package.json",
  "commercial-course-stage.json",
];
const optionalFiles = [
  "release-notes.md",
  "rights-ledger.json",
  "authoritative-sources.json",
  "lesson-traceability.json",
  "course-qa.json",
  "commercial-release-evidence.json",
];

const missing = [];
for (const relativePath of requiredFiles) {
  if (!copyFile(relativePath)) missing.push(relativePath);
}
for (const relativePath of optionalFiles) copyFile(relativePath);
for (const relativeDirectory of ["media", "video", "captions", "transcripts", "accessibility", "rights"]) {
  copyDirectory(relativeDirectory);
}

if (missing.length) {
  fs.rmSync(releaseDir, { recursive: true, force: true });
  throw new Error(`Missing required detailed production assets: ${missing.join(", ")}`);
}

const fileInventory = recursiveFiles(releaseDir)
  .filter((relativePath) => relativePath !== "release-record.json")
  .sort((left, right) => left.localeCompare(right))
  .map((relativePath) => {
    const filePath = path.join(releaseDir, relativePath);
    return {
      path: relativePath.replaceAll(path.sep, "/"),
      sizeBytes: fs.statSync(filePath).size,
      sha256: sha256(filePath),
    };
  });

const releaseRecord = {
  schemaVersion: "2.1",
  courseId: manifest.course.id,
  title: manifest.course.title,
  version: manifest.release.version,
  packageStage: finalRequested ? "FINAL" : "COMPLIANCE-STAGED",
  manifestReleaseStatus: manifest.release.status,
  publishToAcademy: finalRequested && manifest.release.publishToAcademy === true,
  checkoutAllowed: finalRequested && manifest.release.publishToAcademy === true,
  qualityClaimAllowed: finalRequested,
  commercialQualityStatus: finalRequested
    ? commercialProductionStandard.qualityTier
    : commercialProductionStandard.claimPolicy.interimLabel,
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  commerce: manifest.commerce,
  completion: manifest.completion,
  stageRecord,
  releaseEvidence: finalRequested ? releaseEvidence : null,
  fileCount: fileInventory.length,
  fileInventory,
  generatedAt: new Date().toISOString(),
  claimBoundary: finalRequested
    ? "This record proves that the governed package was assembled after required evidence and owner acceptance. It does not represent external accreditation, certification, guild approval, legal sufficiency, or regulatory approval."
    : "This is a compliance-staged production package. It is not final, learner-ready, publication-ready, purchasable, or authorized for a commercial quality claim.",
};
fs.writeFileSync(path.join(releaseDir, "release-record.json"), `${JSON.stringify(releaseRecord, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(`[Academy Studio] Built ${releaseRecord.packageStage} package for ${manifest.course.title} with ${releaseRecord.fileCount} hashed file(s). Publication=${releaseRecord.publishToAcademy}; checkout=${releaseRecord.checkoutAllowed}; qualityClaim=${releaseRecord.qualityClaimAllowed}.`);
