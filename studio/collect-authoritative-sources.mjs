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
const coursesRoot = path.join(root, "courses");
const reportPath = path.join(root, "catalog", "authoritative-source-resolution-queue.json");
const failOnUnresolved = process.argv.includes("--fail-on-unresolved");
const internalClassifications = new Set([
  "original-obserra-instruction",
  "synthetic-scenario",
]);

function text(value) {
  return String(value ?? "").trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sourceRegisterForCourse(courseDir) {
  const materializedPath = path.join(courseDir, "source-register.json");
  if (fs.existsSync(materializedPath)) return readJson(materializedPath);
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(packagePath)) return null;
  return readJson(packagePath).content?.sourceRegister ?? null;
}

function validateVerifiedSource(source, prefix, errors) {
  for (const field of [
    "sourceTitle",
    "issuingAuthority",
    "versionOrPublicationDate",
    "urlOrLocator",
    "retrievalOrVerificationDate",
    "jurisdictionOrScope",
    "requirementClassification",
    "limitations",
    "usageBoundary",
  ]) {
    if (!text(source?.[field])) errors.push(`${prefix}:verified-source-missing-${field}`);
  }
  if (text(source?.urlOrLocator).toLowerCase() === "to-be-resolved") {
    errors.push(`${prefix}:verified-source-has-unresolved-locator`);
  }
  try {
    const locator = new URL(text(source?.urlOrLocator));
    if (!['https:', 'http:'].includes(locator.protocol)) {
      errors.push(`${prefix}:verified-source-locator-not-http`);
    }
  } catch {
    errors.push(`${prefix}:verified-source-locator-invalid`);
  }
}

if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
const unresolved = [];
const verified = [];
const internal = [];
const errors = [];
const courseSummaries = [];

for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  if (["retired", "archived"].includes(String(manifest.release?.status ?? "draft"))) continue;
  const courseId = manifest.course?.id ?? entry.name;
  const sources = sourceRegisterForCourse(courseDir);
  if (!Array.isArray(sources) || sources.length === 0) {
    errors.push(`${courseId}:source-register-missing`);
    courseSummaries.push({ courseId, total: 0, verified: 0, internal: 0, unresolved: 0, errors: 1 });
    continue;
  }

  let courseVerified = 0;
  let courseInternal = 0;
  let courseUnresolved = 0;
  const seen = new Set();
  for (const [index, source] of sources.entries()) {
    const sourceId = text(source?.id);
    const prefix = `${courseId}/source-${index + 1}`;
    if (!sourceId) {
      errors.push(`${prefix}:missing-id`);
      continue;
    }
    if (seen.has(sourceId)) errors.push(`${courseId}/${sourceId}:duplicate-id`);
    seen.add(sourceId);

    const record = {
      courseId,
      courseTitle: manifest.course?.title ?? courseId,
      sourceId,
      citationStatus: source.citationStatus ?? "missing",
      sourceType: source.sourceType ?? null,
      sourceTitle: source.sourceTitle ?? null,
      issuingAuthority: source.issuingAuthority ?? null,
      versionOrPublicationDate: source.versionOrPublicationDate ?? null,
      urlOrLocator: source.urlOrLocator ?? null,
      retrievalOrVerificationDate: source.retrievalOrVerificationDate ?? null,
      jurisdictionOrScope: source.jurisdictionOrScope ?? null,
      requirementClassification: source.requirementClassification ?? null,
      claimOrTopic: source.claimOrTopic ?? null,
      moduleIds: source.moduleIds ?? [],
      claimIds: source.claimIds ?? [],
      applicability: source.applicability ?? null,
      limitations: source.limitations ?? null,
      verificationInstruction: source.verificationInstruction ?? null,
      usageBoundary: source.usageBoundary ?? null,
    };

    if (internalClassifications.has(source.requirementClassification)) {
      if (source.citationStatus !== "not-external-source") {
        errors.push(`${courseId}/${sourceId}:internal-source-status-must-be-not-external-source`);
      }
      internal.push(record);
      courseInternal += 1;
    } else if (source.citationStatus === "verified") {
      validateVerifiedSource(source, `${courseId}/${sourceId}`, errors);
      verified.push(record);
      courseVerified += 1;
    } else {
      if (source.citationStatus !== "verification-required") {
        errors.push(`${courseId}/${sourceId}:external-source-invalid-citation-status`);
      }
      if (!text(source.verificationInstruction)) {
        errors.push(`${courseId}/${sourceId}:verification-instruction-missing`);
      }
      unresolved.push(record);
      courseUnresolved += 1;
    }
  }
  courseSummaries.push({
    courseId,
    total: sources.length,
    verified: courseVerified,
    internal: courseInternal,
    unresolved: courseUnresolved,
    errors: errors.filter((error) => error.startsWith(`${courseId}:`) || error.startsWith(`${courseId}/`)).length,
  });
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  totalSources: verified.length + internal.length + unresolved.length,
  verifiedExternalSources: verified.length,
  originalOrSyntheticInternalSources: internal.length,
  unresolvedExternalSources: unresolved.length,
  validationErrorCount: errors.length,
  commercialReleaseBlocked: unresolved.length > 0 || errors.length > 0,
  courses: courseSummaries,
  verified,
  internal,
  unresolved,
  errors,
  claimBoundary:
    "This queue inventories source-resolution work and validates supplied source metadata. It does not independently verify a source merely because a record is marked verified. Human or governed independent source review and release evidence remain required.",
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  totalSources: report.totalSources,
  verifiedExternalSources: report.verifiedExternalSources,
  originalOrSyntheticInternalSources: report.originalOrSyntheticInternalSources,
  unresolvedExternalSources: report.unresolvedExternalSources,
  validationErrorCount: report.validationErrorCount,
  commercialReleaseBlocked: report.commercialReleaseBlocked,
}, null, 2));
if (errors.length > 0 || (failOnUnresolved && unresolved.length > 0)) process.exit(2);
