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
const allocation = assertAcademyWorkerAllocation();
const provider = providerName === "heygen" ? generateWithHeyGen : generateWithSynthesia;

if (!fs.existsSync(compliancePath)) {
  throw new Error(`Cinematic compliance staging report not found: ${compliancePath}`);
}
if (!["synthesia", "heygen"].includes(providerName)) {
  throw new Error(`Unsupported Academy video provider: ${providerName}`);
}

const compliance = JSON.parse(fs.readFileSync(compliancePath, "utf8"));
const eligibleCourses = (compliance.courses ?? []).filter((course) => course.readyForComplianceStaging === true);
const jobs = [];
for (const course of eligibleCourses) {
  const courseDir = path.join(coursesRoot, course.courseId);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  for (const module of envelope.content?.modules ?? []) {
    const videoScript = module.videoScript ?? {};
    const narration = [
      videoScript.opening,
      ...(videoScript.scenes ?? []).map((scene) => scene.narration),
      videoScript.closing,
    ].filter(Boolean).join("\n\n");
    jobs.push({
      courseId: course.courseId,
      courseTitle: manifest.course?.title ?? course.title,
      lessonId: module.id,
      lessonTitle: module.title,
      script: narration,
      outputDirectory: path.join(courseDir, "generated", "video-jobs"),
      sourceIds: [...new Set((videoScript.scenes ?? []).flatMap((scene) => scene.sourceIds ?? []))],
      accessibilityPlan: {
        captionPlan: videoScript.captionPlan ?? [],
        transcriptPlan: videoScript.transcriptPlan ?? [],
        audioDescriptionPlan: videoScript.audioDescriptionPlan ?? [],
        reducedMotionAlternative: videoScript.reducedMotionAlternative ?? [],
      },
      rightsPlan: envelope.content?.rightsAndLicensingPlan ?? null,
    });
  }
}

const queue = [...jobs];
const results = [];
const workerCount = Math.min(allocation.concurrency, Math.max(1, jobs.length));

async function mediaWorker(workerId) {
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    const descriptor = workerDescriptor(
      workerId,
      interchangeableCourseRoles.includes("storyboard-and-shot-planning")
        ? "storyboard-and-shot-planning"
        : interchangeableCourseRoles[0],
    );
    try {
      const result = await provider({
        courseId: job.courseId,
        courseTitle: job.courseTitle,
        lessonId: job.lessonId,
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
      results.push({
        workerId: descriptor.workerId,
        workerName: descriptor.workerName,
        courseId: job.courseId,
        lessonId: job.lessonId,
        provider: providerName,
        sourceIds: job.sourceIds,
        accessibilityPlan: job.accessibilityPlan,
        status: result.status,
        externalId: result.externalId,
        files: result.files,
        metadata: result.metadata,
      });
      console.log(`[Academy Studio] ${descriptor.workerName} submitted ${job.courseId}/${job.lessonId} to ${providerName}: ${result.status}.`);
    } catch (error) {
      results.push({
        workerId: descriptor.workerId,
        workerName: descriptor.workerName,
        courseId: job.courseId,
        lessonId: job.lessonId,
        provider: providerName,
        status: "failed",
        error: String(error?.message ?? error).slice(0, 1600),
      });
    }
  }
}

if (jobs.length > 0) {
  await Promise.all(Array.from({ length: workerCount }, (_, index) => mediaWorker(index + 1)));
}

const submitted = results.filter((result) => result.status === "submitted");
const configurationRequired = results.filter((result) => result.status === "configuration-required");
const failed = results.filter((result) => result.status === "failed");
const summary = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  provider: providerName,
  allocation,
  eligibleCourses: eligibleCourses.length,
  requestedVideoJobs: jobs.length,
  submittedVideoJobs: submitted.length,
  configurationRequiredVideoJobs: configurationRequired.length,
  failedVideoJobs: failed.length,
  allJobsSubmitted: jobs.length > 0 && submitted.length === jobs.length,
  publicationAuthorized: false,
  results,
  claimBoundary: "A submitted provider job is not a mastered instructional video. Final media requires provider completion, asset retrieval, audible narration verification, source cards, captions, transcripts, audio description or approved alternatives, rights evidence, technical quality control, and owner acceptance.",
};
fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(`[Academy Studio] Cinematic media submission requested ${jobs.length} job(s): ${submitted.length} submitted, ${configurationRequired.length} configuration required, ${failed.length} failed.`);
if (strict && (!summary.allJobsSubmitted || failed.length > 0 || configurationRequired.length > 0)) {
  process.exit(2);
}
