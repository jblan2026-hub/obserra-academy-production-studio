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
const coursesRoot = path.join(root, "courses");
const reportPath = path.join(root, "catalog", "commercial-release-readiness.json");
const courseArgIndex = process.argv.indexOf("--course");
const requestedCourse = courseArgIndex >= 0 ? process.argv[courseArgIndex + 1] : null;
const expectedCourses = Number(process.env.ACADEMY_EXPECTED_REVIEW_COURSES || 60);
const allowedInternalClassifications = new Set([
  "original-obserra-instruction",
  "synthetic-scenario",
]);
const requiredMediaAssetKinds = [
  "mezzanine-video",
  "web-delivery-video",
  "caption-track",
  "verbatim-transcript",
  "audio-description-or-approved-equivalent",
  "reduced-motion-alternative",
  "lesson-rights-record",
  "technical-qc-report",
  "editorial-qc-report",
];
const requiredApprovalRoles = [
  "editorial",
  "visual",
  "audio",
  "accessibility",
  "rights",
  "reference-applicability",
  "security-privacy",
];

function text(value) {
  return String(value ?? "").trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeResolve(base, relativePath, label) {
  if (!text(relativePath)) throw new Error(`${label} path is missing.`);
  const resolved = path.resolve(base, relativePath);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} path escapes the governed course directory.`);
  }
  return resolved;
}

function verifyFileReference(courseDir, reference, label, blockers) {
  try {
    const filePath = safeResolve(courseDir, reference?.path, label);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      blockers.push(`${label}:file-missing`);
      return;
    }
    const sizeBytes = fs.statSync(filePath).size;
    if (sizeBytes <= 0) blockers.push(`${label}:file-empty`);
    if (!/^[a-f0-9]{64}$/i.test(text(reference?.sha256))) {
      blockers.push(`${label}:sha256-missing-or-invalid`);
    } else if (sha256(filePath) !== text(reference.sha256).toLowerCase()) {
      blockers.push(`${label}:sha256-mismatch`);
    }
    if (Number(reference?.sizeBytes) !== sizeBytes) blockers.push(`${label}:size-mismatch`);
  } catch (error) {
    blockers.push(`${label}:${error instanceof Error ? error.message : String(error)}`);
  }
}

function verifySourceResolution(courseId, sources, matrix, blockers) {
  const sourceIds = new Set();
  for (const [index, source] of sources.entries()) {
    const prefix = `${courseId}/source-${index + 1}`;
    const sourceId = text(source?.id);
    if (!sourceId) blockers.push(`${prefix}:missing-id`);
    else if (sourceIds.has(sourceId)) blockers.push(`${prefix}:duplicate-id`);
    else sourceIds.add(sourceId);

    const external = !allowedInternalClassifications.has(source?.requirementClassification);
    if (external && source?.citationStatus !== "verified") blockers.push(`${prefix}:external-source-not-verified`);
    if (external && (!text(source?.urlOrLocator) || text(source.urlOrLocator).toLowerCase() === "to-be-resolved")) {
      blockers.push(`${prefix}:authoritative-locator-unresolved`);
    }
    if (external && !text(source?.retrievalOrVerificationDate)) blockers.push(`${prefix}:verification-date-missing`);
    for (const field of [
      "sourceTitle",
      "issuingAuthority",
      "versionOrPublicationDate",
      "jurisdictionOrScope",
      "requirementClassification",
      "claimOrTopic",
      "limitations",
      "verificationInstruction",
      "usageBoundary",
    ]) {
      if (!text(source?.[field])) blockers.push(`${prefix}:missing-${field}`);
    }
    for (const field of [
      "appliesTo",
      "appliesWhen",
      "doesNotApplyWhen",
      "roles",
      "industries",
      "geographies",
      "systemsOrProcesses",
      "lifecyclePhases",
    ]) {
      if (!Array.isArray(source?.applicability?.[field]) || source.applicability[field].length === 0) {
        blockers.push(`${prefix}:missing-applicability-${field}`);
      }
    }
  }

  const mappedSources = new Set();
  for (const [index, entry] of matrix.entries()) {
    const prefix = `${courseId}/reference-matrix-${index + 1}`;
    if (!sourceIds.has(entry?.sourceId)) blockers.push(`${prefix}:invalid-source-id`);
    else mappedSources.add(entry.sourceId);
    for (const field of ["claimIds", "moduleIds", "learningObjectiveIds", "assessmentItemIds", "videoSceneIds"]) {
      if (!Array.isArray(entry?.[field])) blockers.push(`${prefix}:missing-${field}`);
    }
    if (!text(entry?.applicationSummary)) blockers.push(`${prefix}:missing-application-summary`);
    if (!text(entry?.exclusionsAndLimitations)) blockers.push(`${prefix}:missing-exclusions-and-limitations`);
  }
  for (const sourceId of sourceIds) {
    if (!mappedSources.has(sourceId)) blockers.push(`${courseId}:source-not-mapped-${sourceId}`);
  }
}

function verifyMediaModule(courseDir, courseId, module, blockers, inventory) {
  const modulePrefix = `${courseId}/${module.id}`;
  const manifestPath = path.join(courseDir, "media", module.id, "media-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    blockers.push(`${modulePrefix}:media-manifest-missing`);
    return;
  }
  let media;
  try {
    media = readJson(manifestPath);
  } catch {
    blockers.push(`${modulePrefix}:media-manifest-invalid-json`);
    return;
  }
  if (media.schemaVersion !== "1.0" || media.courseId !== courseId || media.moduleId !== module.id) {
    blockers.push(`${modulePrefix}:media-manifest-identity-mismatch`);
  }
  if (media.productionStandardId !== commercialProductionStandard.standardId
      || media.productionStandardHash !== commercialProductionStandardHash()) {
    blockers.push(`${modulePrefix}:media-production-standard-mismatch`);
  }

  const assets = new Map((media.assets ?? []).map((asset) => [asset.kind, asset]));
  for (const kind of requiredMediaAssetKinds) {
    const asset = assets.get(kind);
    if (!asset) blockers.push(`${modulePrefix}:missing-${kind}`);
    else verifyFileReference(courseDir, asset, `${modulePrefix}/${kind}`, blockers);
  }

  const picture = media.technicalQc?.picture ?? {};
  const width = Number(picture.width);
  const height = Number(picture.height);
  const approvedEquivalent = picture.approvedEquivalent?.approved === true
    && text(picture.approvedEquivalent?.reason)
    && text(picture.approvedEquivalent?.approvedBy)
    && text(picture.approvedEquivalent?.approvedAt);
  if (!((width >= 3840 && height >= 2160) || approvedEquivalent)) {
    blockers.push(`${modulePrefix}:picture-master-below-standard-without-approved-equivalent`);
  }
  if (picture.mezzanineMasterVerified !== true) blockers.push(`${modulePrefix}:mezzanine-master-not-verified`);
  if (picture.webDerivativeVerified !== true) blockers.push(`${modulePrefix}:web-derivative-not-verified`);
  if (picture.colorReviewPassed !== true) blockers.push(`${modulePrefix}:color-review-not-passed`);
  if (picture.motionGraphicsReviewPassed !== true) blockers.push(`${modulePrefix}:motion-graphics-review-not-passed`);
  if (picture.titleSafeReviewPassed !== true) blockers.push(`${modulePrefix}:title-safe-review-not-passed`);

  const audio = media.technicalQc?.audio ?? {};
  if (audio.audioPresent !== true) blockers.push(`${modulePrefix}:audio-missing`);
  if (Number(audio.sampleRateHz) !== 48000) blockers.push(`${modulePrefix}:audio-sample-rate-not-48000`);
  if (Number(audio.bitDepth) < 24) blockers.push(`${modulePrefix}:audio-bit-depth-below-24`);
  const loudness = Number(audio.integratedLufs);
  if (!Number.isFinite(loudness) || loudness < -17 || loudness > -15) blockers.push(`${modulePrefix}:audio-loudness-outside-target`);
  if (!Number.isFinite(Number(audio.truePeakDbtp)) || Number(audio.truePeakDbtp) > -1) blockers.push(`${modulePrefix}:audio-true-peak-above-limit`);
  if (audio.dialogueIntelligibilityReviewPassed !== true) blockers.push(`${modulePrefix}:dialogue-intelligibility-not-passed`);
  if (audio.noiseAndArtifactReviewPassed !== true) blockers.push(`${modulePrefix}:audio-artifact-review-not-passed`);
  if (audio.professionalNarrationApproved !== true) blockers.push(`${modulePrefix}:narration-not-approved`);

  const accessibility = media.technicalQc?.accessibility ?? {};
  if (accessibility.captionsHumanReviewed !== true) blockers.push(`${modulePrefix}:captions-not-human-reviewed`);
  if (accessibility.transcriptVerbatimVerified !== true) blockers.push(`${modulePrefix}:transcript-not-verbatim-verified`);
  if (accessibility.audioDescriptionOrEquivalentApproved !== true) blockers.push(`${modulePrefix}:audio-description-or-equivalent-not-approved`);
  if (accessibility.reducedMotionAlternativeApproved !== true) blockers.push(`${modulePrefix}:reduced-motion-alternative-not-approved`);
  if (accessibility.nonVideoLearningAlternativeApproved !== true) blockers.push(`${modulePrefix}:non-video-alternative-not-approved`);

  const approvals = new Map((media.approvals ?? []).map((approval) => [approval.role, approval]));
  for (const role of requiredApprovalRoles) {
    const approval = approvals.get(role);
    if (!approval
        || approval.status !== "approved"
        || !text(approval.approvedBy)
        || !text(approval.approvedAt)
        || !text(approval.evidenceReference)) {
      blockers.push(`${modulePrefix}:missing-${role}-approval`);
    }
  }

  inventory.push({
    moduleId: module.id,
    manifestPath: path.relative(courseDir, manifestPath),
    assetKinds: [...assets.keys()],
    picture: { width, height, approvedEquivalent: Boolean(approvedEquivalent) },
    audio: {
      sampleRateHz: Number(audio.sampleRateHz),
      bitDepth: Number(audio.bitDepth),
      integratedLufs: loudness,
      truePeakDbtp: Number(audio.truePeakDbtp),
    },
  });
}

function verifyReleaseEvidence(courseDir, courseId, blockers) {
  const evidencePath = path.join(courseDir, "commercial-release-evidence.json");
  if (!fs.existsSync(evidencePath)) {
    blockers.push(`${courseId}:commercial-release-evidence-missing`);
    return null;
  }
  let evidence;
  try {
    evidence = readJson(evidencePath);
  } catch {
    blockers.push(`${courseId}:commercial-release-evidence-invalid-json`);
    return null;
  }
  if (evidence.schemaVersion !== "1.0"
      || evidence.courseId !== courseId
      || evidence.contractId !== workerPoolContract.contractId
      || evidence.contractHash !== contractHash()
      || evidence.productionStandardId !== commercialProductionStandard.standardId
      || evidence.productionStandardHash !== commercialProductionStandardHash()) {
    blockers.push(`${courseId}:commercial-release-evidence-identity-mismatch`);
  }
  const byId = new Map((evidence.items ?? []).map((item) => [item.id, item]));
  for (const required of commercialProductionStandard.requiredReleaseEvidence) {
    const item = byId.get(required);
    if (!item
        || item.status !== "passed"
        || !text(item.evidenceReference)
        || !text(item.verifiedBy)
        || !text(item.verifiedAt)) {
      blockers.push(`${courseId}:release-evidence-incomplete-${required}`);
    }
  }
  if (evidence.ownerAcceptance?.decision !== "approved"
      || !text(evidence.ownerAcceptance?.approvedBy)
      || !text(evidence.ownerAcceptance?.approvedAt)
      || !text(evidence.ownerAcceptance?.evidenceReference)) {
    blockers.push(`${courseId}:owner-acceptance-incomplete`);
  }
  if (evidence.accepted !== true) blockers.push(`${courseId}:commercial-release-not-accepted`);
  return evidence;
}

if (requestedCourse && !/^[a-z0-9][a-z0-9-]{1,120}$/.test(requestedCourse)) {
  throw new Error("Invalid --course identifier.");
}
if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);

const courseDirectories = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => !requestedCourse || entry.name === requestedCourse)
  .sort((left, right) => left.name.localeCompare(right.name));
const courseReports = [];
const globalBlockers = [];

for (const entry of courseDirectories) {
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  if (["archived", "retired"].includes(String(manifest.release?.status ?? "draft"))) continue;
  const courseId = manifest.course?.id ?? entry.name;
  const blockers = [];
  const mediaInventory = [];

  for (const requiredFile of [
    "instructor-manuscript.md",
    "learner-guide.md",
    "workbook.md",
    "assessment-bank.json",
    "answer-key.json",
    "visual-brief.md",
    "source-register.json",
    "reference-applicability-matrix.json",
    "course-production-bible.json",
    "commercial-production-plan.json",
    "certificate-package.json",
    "commercial-course-stage.json",
  ]) {
    const filePath = path.join(courseDir, requiredFile);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
      blockers.push(`${courseId}:required-file-missing-${requiredFile}`);
    }
  }

  let sources = [];
  let matrix = [];
  try {
    sources = readJson(path.join(courseDir, "source-register.json"));
    matrix = readJson(path.join(courseDir, "reference-applicability-matrix.json"));
  } catch {
    blockers.push(`${courseId}:source-or-applicability-register-invalid`);
  }
  if (Array.isArray(sources) && Array.isArray(matrix)) {
    verifySourceResolution(courseId, sources, matrix, blockers);
  }

  const instructionalModules = (manifest.course?.modules ?? []).filter(
    (module) => String(module.format ?? "").toLowerCase() !== "assessment",
  );
  for (const module of instructionalModules) {
    verifyMediaModule(courseDir, courseId, module, blockers, mediaInventory);
  }

  const evidence = verifyReleaseEvidence(courseDir, courseId, blockers);
  if (evidence) {
    if (Number(evidence.referenceResolution?.unresolvedExternalReferences) !== 0) {
      blockers.push(`${courseId}:evidence-reports-unresolved-references`);
    }
    if (Number(evidence.mediaInventory?.missingRequiredAssets) !== 0) {
      blockers.push(`${courseId}:evidence-reports-missing-media-assets`);
    }
    if (Number(evidence.mediaInventory?.instructionalModules) !== instructionalModules.length) {
      blockers.push(`${courseId}:evidence-media-module-count-mismatch`);
    }
  }

  const ready = blockers.length === 0;
  courseReports.push({
    courseId,
    title: manifest.course?.title ?? courseId,
    ready,
    blockerCount: blockers.length,
    blockers,
    instructionalModuleCount: instructionalModules.length,
    mediaInventory,
  });
  globalBlockers.push(...blockers);
}

if (!requestedCourse && courseReports.length !== expectedCourses) {
  globalBlockers.push(`academy:expected-${expectedCourses}-commercial-courses-found-${courseReports.length}`);
}
if (requestedCourse && courseReports.length !== 1) {
  globalBlockers.push(`academy:requested-course-not-found-${requestedCourse}`);
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  requestedCourse,
  expectedCourses: requestedCourse ? 1 : expectedCourses,
  evaluatedCourses: courseReports.length,
  readyCourses: courseReports.filter((course) => course.ready).length,
  blockerCount: globalBlockers.length,
  ready: globalBlockers.length === 0,
  courses: courseReports,
  blockers: globalBlockers,
  claimBoundary: "A passing result proves that repository evidence, referenced media files, hashes, technical QC values, human approvals, source applicability, release evidence, and owner acceptance satisfy the governed internal release contract. It does not establish external accreditation, certification, guild approval, regulatory compliance, or legal sufficiency.",
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${report.ready}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready_courses=${report.readyCourses}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `blocker_count=${report.blockerCount}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    "## Commercial cinematic Academy release gate",
    "",
    `- Ready: ${report.ready}`,
    `- Courses: ${report.readyCourses}/${report.evaluatedCourses}`,
    `- Blockers: ${report.blockerCount}`,
    `- Production standard: ${report.productionStandardId}`,
    `- Standard hash: ${report.productionStandardHash}`,
    "",
    report.claimBoundary,
  ].join("\n") + "\n");
}
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(2);
