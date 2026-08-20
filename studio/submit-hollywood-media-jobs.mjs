import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateWithSynthesia } from "./providers/synthesia.mjs";
import { generateWithHeyGen } from "./providers/heygen.mjs";
import {
  assertAcademyWorkerAllocation,
  interchangeableCourseRoles,
  workerDescriptor,
} from "./academy-worker-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");
const compliancePath = path.join(catalogRoot, "academy-hollywood-compliance-staging.json");
const summaryPath = path.join(catalogRoot, "academy-hollywood-media-submission.json");
const providerName = String(process.env.ACADEMY_VIDEO_PROVIDER || "synthesia").trim().toLowerCase();
const strict = String(process.env.ACADEMY_MEDIA_SUBMISSION_REQUIRED || "true").trim().toLowerCase() === "true";
const templateApproved = String(process.env.ACADEMY_CINEMATIC_TEMPLATE_APPROVED || "false").trim().toLowerCase() === "true";
const allocation = assertAcademyWorkerAllocation();
const provider = providerName === "heygen" ? generateWithHeyGen : generateWithSynthesia;

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

const maximumScriptChars = boundedNumber(
  process.env.ACADEMY_MEDIA_MAX_SCRIPT_CHARS,
  providerName === "heygen" ? 4500 : 12000,
  1000,
  20000,
);
const mediaConcurrency = boundedNumber(
  process.env.ACADEMY_MEDIA_SUBMISSION_CONCURRENCY,
  Math.min(12, allocation.courseWorkerAllocation),
  1,
  allocation.courseWorkerAllocation,
);

if (!fs.existsSync(compliancePath)) throw new Error(`Cinematic compliance staging report not found: ${compliancePath}`);
if (!["synthesia", "heygen"].includes(providerName)) throw new Error(`Unsupported Academy video provider: ${providerName}`);
if (!templateApproved) {
  throw new Error("ACADEMY_CINEMATIC_TEMPLATE_APPROVED=true is required before submitting premium course media. A provider template ID alone is not owner approval evidence.");
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function segmentVideoScript(module) {
  const videoScript = module.videoScript ?? {};
  const units = [];
  if (videoScript.opening) units.push({ sceneId: `${module.id}-opening`, narration: videoScript.opening, sourceIds: [] });
  for (const scene of videoScript.scenes ?? []) {
    units.push({
      sceneId: scene.sceneId,
      narration: scene.narration,
      sourceIds: scene.sourceIds ?? [],
      captionText: scene.captionText,
      altDescription: scene.altDescription,
    });
  }
  if (videoScript.closing) units.push({ sceneId: `${module.id}-closing`, narration: videoScript.closing, sourceIds: [] });

  const groups = [];
  let current = [];
  let currentLength = 0;
  for (const unit of units) {
    const narration = String(unit.narration ?? "").trim();
    if (!narration) continue;
    if (narration.length > maximumScriptChars) {
      throw new Error(`${module.id}/${unit.sceneId} narration exceeds the provider segment contract of ${maximumScriptChars} characters.`);
    }
    if (current.length && currentLength + narration.length + 2 > maximumScriptChars) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(unit);
    currentLength += narration.length + 2;
  }
  if (current.length) groups.push(current);
  return groups.map((group, index) => ({
    segmentId: `${module.id}-part-${String(index + 1).padStart(2, "0")}`,
    moduleId: module.id,
    moduleTitle: module.title,
    partNumber: index + 1,
    partCount: groups.length,
    script: group.map((unit) => unit.narration).join("\n\n"),
    sceneIds: group.map((unit) => unit.sceneId),
    sourceIds: [...new Set(group.flatMap((unit) => unit.sourceIds ?? []))],
    captionEntries: group.map((unit) => ({ sceneId: unit.sceneId, captionText: unit.captionText ?? unit.narration })),
    alternateDescriptions: group.map((unit) => ({ sceneId: unit.sceneId, altDescription: unit.altDescription ?? "" })),
  }));
}

function preservedJob(sidecarPath, expectedScriptHash) {
  if (!fs.existsSync(sidecarPath)) return null;
  try {
    const sidecar = readJson(sidecarPath);
    if (sidecar.provider !== providerName || sidecar.scriptHash !== expectedScriptHash || !sidecar.externalId) return null;
    return sidecar;
  } catch {
    return null;
  }
}

const compliance = readJson(compliancePath);
const eligibleCourses = (compliance.courses ?? []).filter((course) => course.complianceStagingReady === true || course.readyForComplianceStaging === true);
if (eligibleCourses.length !== 60) {
  throw new Error(`Media submission requires exactly 60 compliance-staged courses; discovered ${eligibleCourses.length}.`);
}

const jobs = [];
for (const course of eligibleCourses) {
  const courseDir = path.join(coursesRoot, course.courseId);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) throw new Error(`Protected manifest or authored package missing for ${course.courseId}.`);
  const manifest = readJson(manifestPath);
  const envelope = readJson(packagePath);
  for (const module of envelope.content?.modules ?? []) {
    for (const segment of segmentVideoScript(module)) {
      const outputDirectory = path.join(courseDir, "generated", "video-jobs");
      const sidecarPath = path.join(outputDirectory, `${segment.segmentId}.academy-media-job.json`);
      jobs.push({
        ...segment,
        courseId: course.courseId,
        courseTitle: manifest.course?.title ?? course.title,
        lessonTitle: `${module.title} — Part ${segment.partNumber} of ${segment.partCount}`,
        outputDirectory,
        sidecarPath,
        scriptHash: stableHash(segment.script),
        accessibilityPlan: {
          captionPlan: module.videoScript?.captionPlan ?? [],
          transcriptPlan: module.videoScript?.transcriptPlan ?? [],
          audioDescriptionPlan: module.videoScript?.audioDescriptionPlan ?? [],
          reducedMotionAlternative: module.videoScript?.reducedMotionAlternative ?? [],
        },
        rightsPlan: envelope.content?.rightsAndLicensingPlan ?? null,
      });
    }
  }
}

const queue = [...jobs];
const results = [];
const workerCount = Math.min(mediaConcurrency, Math.max(1, jobs.length));

async function mediaWorker(workerId) {
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    const descriptor = workerDescriptor(workerId, "storyboard-and-shot-planning");
    const existing = preservedJob(job.sidecarPath, job.scriptHash);
    if (existing) {
      results.push({ ...existing, status: "preserved-submitted", workerId: descriptor.workerId, workerName: descriptor.workerName });
      console.log(`[Academy Studio] ${descriptor.workerName} preserved existing ${providerName} job ${existing.externalId} for ${job.courseId}/${job.segmentId}.`);
      continue;
    }

    try {
      const result = await provider({
        courseId: job.courseId,
        courseTitle: job.courseTitle,
        lessonId: job.segmentId,
        lessonTitle: job.lessonTitle,
        artifactKind: "training-video",
        script: job.script,
        outputDirectory: job.outputDirectory,
        branding: {
          legalName: "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC",
          logoAsset: "brand/assets/obserra-official-logo.png",
          palette: ["black", "dark navy", "gold", "white", "restrained holographic blue"],
          openingCardRequired: true,
          closingCardRequired: true,
          sourceCardsRequired: true,
          watermark: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.",
        },
        classification: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.",
      });
      const sidecar = {
        schemaVersion: "1.0",
        submittedAt: new Date().toISOString(),
        workerId: descriptor.workerId,
        workerName: descriptor.workerName,
        courseId: job.courseId,
        courseTitle: job.courseTitle,
        moduleId: job.moduleId,
        moduleTitle: job.moduleTitle,
        segmentId: job.segmentId,
        partNumber: job.partNumber,
        partCount: job.partCount,
        sceneIds: job.sceneIds,
        provider: providerName,
        scriptHash: job.scriptHash,
        sourceIds: job.sourceIds,
        captionEntries: job.captionEntries,
        alternateDescriptions: job.alternateDescriptions,
        accessibilityPlan: job.accessibilityPlan,
        rightsPlan: job.rightsPlan,
        status: result.status,
        externalId: result.externalId,
        providerFiles: result.files,
        metadata: result.metadata,
        publicationAuthorized: false,
      };
      if (result.status === "submitted" && !result.externalId) throw new Error(`${providerName} accepted the request but did not return a video identifier.`);
      writeJson(job.sidecarPath, sidecar);
      results.push(sidecar);
      console.log(`[Academy Studio] ${descriptor.workerName} submitted ${job.courseId}/${job.segmentId} to ${providerName}: ${result.status}.`);
    } catch (error) {
      results.push({
        workerId: descriptor.workerId,
        workerName: descriptor.workerName,
        courseId: job.courseId,
        moduleId: job.moduleId,
        segmentId: job.segmentId,
        provider: providerName,
        scriptHash: job.scriptHash,
        status: "failed",
        error: String(error?.message ?? error).slice(0, 1600),
      });
    }
  }
}

if (jobs.length > 0) await Promise.all(Array.from({ length: workerCount }, (_, index) => mediaWorker(index + 1)));

const submitted = results.filter((result) => result.status === "submitted");
const preserved = results.filter((result) => result.status === "preserved-submitted");
const configurationRequired = results.filter((result) => result.status === "configuration-required");
const failed = results.filter((result) => result.status === "failed");
const accepted = submitted.length + preserved.length;
const summary = {
  schemaVersion: "2.0",
  generatedAt: new Date().toISOString(),
  provider: providerName,
  ownerApprovedTemplateRequired: true,
  ownerApprovedTemplateVerified: templateApproved,
  maximumScriptChars,
  mediaConcurrency,
  allocation,
  eligibleCourses: eligibleCourses.length,
  requestedVideoJobs: jobs.length,
  newlySubmittedVideoJobs: submitted.length,
  preservedVideoJobs: preserved.length,
  submittedVideoJobs: accepted,
  configurationRequiredVideoJobs: configurationRequired.length,
  failedVideoJobs: failed.length,
  allJobsSubmitted: jobs.length > 0 && accepted === jobs.length,
  publicationAuthorized: false,
  results,
  claimBoundary: "An accepted provider job is not a mastered instructional video. Final media requires provider completion, asset retrieval, segment assembly where applicable, audible narration verification, source cards, captions, transcripts, audio description or approved alternatives, rights evidence, technical quality control, and owner acceptance.",
};
fs.mkdirSync(catalogRoot, { recursive: true });
writeJson(summaryPath, summary);

console.log(`[Academy Studio] Cinematic media queue reconciled ${jobs.length} job(s): ${submitted.length} new, ${preserved.length} preserved, ${configurationRequired.length} configuration required, ${failed.length} failed.`);
if (strict && (!summary.allJobsSubmitted || failed.length > 0 || configurationRequired.length > 0)) process.exit(2);
