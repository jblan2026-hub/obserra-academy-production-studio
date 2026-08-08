import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";
import { persistMediaJobCheckpoint } from "./academy-media-checkpoints.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const reportPath = path.join(catalogRoot, "academy-hollywood-media-reconciliation.json");
const providerName = String(process.env.ACADEMY_VIDEO_PROVIDER || "synthesia").trim().toLowerCase();
const strict = String(process.env.ACADEMY_MEDIA_RECONCILIATION_REQUIRED || "true").trim().toLowerCase() === "true";
const projectRef = String(process.env.ACADEMY_SUPABASE_PROJECT_REF || "nwxnyqlyzyufgoadtqxs").trim();
const supabaseUrl = String(process.env.SUPABASE_URL || `https://${projectRef}.supabase.co`).trim().replace(/\/$/, "");
const supabaseSecret = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const storageBucket = String(process.env.ACADEMY_MEDIA_BUCKET || "academy-course-media").trim();
const maximumDownloadBytes = Number(process.env.ACADEMY_MEDIA_MAX_DOWNLOAD_BYTES || 2_000_000_000);
const requestTimeoutMs = Number(process.env.ACADEMY_MEDIA_REQUEST_TIMEOUT_MS || 120_000);
const portfolio = academySurgePortfolio();

if (!["synthesia", "heygen"].includes(providerName)) throw new Error(`Unsupported Academy video provider: ${providerName}`);
if (!supabaseSecret) throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required to archive final Academy media.");
if (!Number.isFinite(maximumDownloadBytes) || maximumDownloadBytes < 10_000_000) throw new Error("ACADEMY_MEDIA_MAX_DOWNLOAD_BYTES is invalid.");

function stableHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, value, { encoding: "utf8", mode: 0o600 });
}

function encodedObjectPath(value) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function providerStatus(job) {
  if (providerName === "synthesia") {
    const apiKey = String(process.env.SYNTHESIA_API_KEY || "").trim();
    if (!apiKey) throw new Error("SYNTHESIA_API_KEY is required to reconcile Synthesia jobs.");
    const response = await fetchWithTimeout(`https://api.synthesia.io/v2/videos/${encodeURIComponent(job.externalId)}`, {
      headers: { Authorization: apiKey, Accept: "application/json" },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Synthesia status request failed with ${response.status}: ${body.slice(0, 1000)}`);
    const payload = JSON.parse(body);
    const status = String(payload.status || payload.generationStatus || "unknown").toLowerCase();
    const downloadUrl = payload.download || payload.downloadUrl || payload.download_url || payload.videoUrl || payload.video_url || null;
    const error = payload.error || payload.errorCode || null;
    return { providerStatus: status, downloadUrl, providerPayload: payload, error };
  }

  const apiKey = String(process.env.HEYGEN_API_KEY || "").trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY is required to reconcile HeyGen jobs.");
  const response = await fetchWithTimeout(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(job.externalId)}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HeyGen status request failed with ${response.status}: ${body.slice(0, 1000)}`);
  const payload = JSON.parse(body);
  const status = String(payload?.data?.status || "unknown").toLowerCase();
  const downloadUrl = payload?.data?.video_url || payload?.data?.videoUrl || null;
  const error = payload?.data?.error || payload?.error || null;
  return { providerStatus: status, downloadUrl, providerPayload: payload, error };
}

async function downloadFile(url, destination) {
  const response = await fetchWithTimeout(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Media download failed with status ${response.status}.`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maximumDownloadBytes) throw new Error(`Media download exceeds configured maximum of ${maximumDownloadBytes} bytes.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.${Date.now()}.partial`;
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { mode: 0o600 }));
  const bytes = fs.statSync(temporary).size;
  if (bytes < 1000) throw new Error("Downloaded media is unexpectedly small.");
  if (bytes > maximumDownloadBytes) throw new Error(`Downloaded media exceeds configured maximum of ${maximumDownloadBytes} bytes.`);
  fs.renameSync(temporary, destination);
  return { bytes, sha256: stableHash(fs.readFileSync(destination)) };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").slice(-2000)}`);
  return result;
}

function mediaDurationSeconds(filePath) {
  const result = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Unable to determine media duration for ${filePath}.`);
  return duration;
}

function vttTime(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function concatenateSegments(segmentPaths, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  if (segmentPaths.length === 1) {
    fs.copyFileSync(segmentPaths[0], outputPath);
    return;
  }
  const listPath = `${outputPath}.concat.txt`;
  writeText(listPath, segmentPaths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  const copy = spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], { encoding: "utf8" });
  if (copy.status !== 0) {
    run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", outputPath]);
  }
  fs.rmSync(listPath, { force: true });
}

async function ensureStorageBucket() {
  const response = await fetchWithTimeout(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseSecret}`,
      apikey: supabaseSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: storageBucket,
      name: storageBucket,
      public: false,
      file_size_limit: maximumDownloadBytes,
      allowed_mime_types: ["video/mp4", "text/vtt", "text/markdown", "application/json"],
    }),
  });
  if (response.ok) return;
  const body = await response.text();
  if (response.status === 400 && /exist|duplicate/i.test(body)) return;
  throw new Error(`Unable to create or verify private media bucket ${storageBucket}: ${response.status} ${body.slice(0, 1000)}`);
}

async function uploadObject(localPath, objectPath, contentType) {
  const bytes = fs.statSync(localPath).size;
  const sha256 = stableHash(fs.readFileSync(localPath));
  const versionedPath = `${objectPath.replace(/\.[^.]+$/, "")}-${sha256.slice(0, 16)}${path.extname(objectPath)}`;
  const response = await fetchWithTimeout(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(storageBucket)}/${encodedObjectPath(versionedPath)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseSecret}`,
      apikey: supabaseSecret,
      "Content-Type": contentType,
      "x-upsert": "false",
      "cache-control": "31536000",
      "x-obserra-sha256": sha256,
    },
    body: fs.createReadStream(localPath),
    duplex: "half",
  });
  const body = await response.text();
  if (!response.ok && !(response.status === 400 && /exist|duplicate/i.test(body))) {
    throw new Error(`Supabase media upload failed for ${versionedPath}: ${response.status} ${body.slice(0, 1000)}`);
  }
  return { bucket: storageBucket, objectPath: versionedPath, storageKey: `supabase://${storageBucket}/${versionedPath}`, bytes, sha256, contentType };
}

function loadSidecars() {
  const jobs = [];
  for (const item of portfolio.selectedCourses) {
    const directory = path.join(item.courseDir, "generated", "video-jobs");
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter((value) => value.endsWith(".academy-media-job.json")).sort()) {
      const sidecarPath = path.join(directory, name);
      jobs.push({ item, sidecarPath, job: readJson(sidecarPath) });
    }
  }
  return jobs;
}

async function registerModuleMediaInLcms(courseId, moduleId, receipts, metadata) {
  if (!process.env.DATABASE_URL || !process.env.STUDIO_OWNER_ORGANIZATION_ID) return { registered: false, reason: "database-not-configured" };
  const module = await import("@prisma/client");
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  if (!PrismaClient) throw new Error("PrismaClient is unavailable for media registration.");
  const prisma = new PrismaClient();
  try {
    const organization = await prisma.organization.findUnique({ where: { clerkOrganizationId: process.env.STUDIO_OWNER_ORGANIZATION_ID } });
    if (!organization) return { registered: false, reason: "organization-not-found" };
    const course = await prisma.course.findUnique({ where: { organizationId_slug: { organizationId: organization.id, slug: courseId } }, include: { lessons: true } });
    if (!course) return { registered: false, reason: "course-not-found" };
    const lesson = course.lessons.find((candidate) => candidate.content?.manifestModuleId === moduleId);
    if (!lesson) return { registered: false, reason: "lesson-not-found" };
    await prisma.mediaAsset.deleteMany({ where: { lessonId: lesson.id, type: { in: ["master-video", "captions", "transcript", "audio-description", "media-rights-ledger"] } } });
    const typeByContent = {
      "video/mp4": "master-video",
      "text/vtt": "captions",
      "text/markdown": "transcript",
      "application/json": "media-rights-ledger",
    };
    for (const receipt of receipts) {
      const inferredType = receipt.objectPath.includes("audio-description") ? "audio-description" : typeByContent[receipt.contentType] || "media-artifact";
      await prisma.mediaAsset.create({
        data: {
          lessonId: lesson.id,
          type: inferredType,
          title: `${moduleId} ${inferredType}`,
          storageKey: receipt.storageKey,
          mimeType: receipt.contentType,
          metadata: { ...metadata, sha256: receipt.sha256, bytes: receipt.bytes, publicationAuthorized: false },
        },
      });
    }
    await prisma.auditEvent.create({
      data: {
        organizationId: organization.id,
        actorType: "service",
        actorId: "academy-media-reconciler",
        action: "academy.course.media.archive",
        resourceType: "Lesson",
        resourceId: lesson.id,
        correlationId: process.env.GITHUB_RUN_ID ?? null,
        outcome: "success",
        metadata: { courseId, moduleId, receipts, publicationAuthorized: false },
      },
    });
    return { registered: true, lessonId: lesson.id };
  } finally {
    await prisma.$disconnect();
  }
}

await ensureStorageBucket();
const entries = loadSidecars();
if (entries.length === 0) throw new Error("No protected cinematic media job checkpoints were restored.");
const statusResults = [];

for (const entry of entries) {
  const { job, sidecarPath, item } = entry;
  if (job.provider !== providerName) {
    statusResults.push({ courseId: job.courseId, segmentId: job.segmentId, status: "provider-mismatch", expectedProvider: providerName, checkpointProvider: job.provider });
    continue;
  }
  if (!job.externalId) {
    statusResults.push({ courseId: job.courseId, segmentId: job.segmentId, status: "missing-external-id" });
    continue;
  }
  try {
    const status = await providerStatus(job);
    const normalized = status.providerStatus;
    const complete = ["complete", "completed"].includes(normalized);
    const failed = ["failed", "error"].includes(normalized);
    if (failed) {
      const updated = { ...job, status: "provider-failed", providerStatus: normalized, providerError: status.error, reconciledAt: new Date().toISOString(), publicationAuthorized: false };
      writeJson(sidecarPath, updated);
      await persistMediaJobCheckpoint(updated);
      statusResults.push({ courseId: job.courseId, segmentId: job.segmentId, status: "provider-failed", error: status.error });
      continue;
    }
    if (!complete || !status.downloadUrl) {
      const updated = { ...job, status: "provider-processing", providerStatus: normalized, reconciledAt: new Date().toISOString(), publicationAuthorized: false };
      writeJson(sidecarPath, updated);
      await persistMediaJobCheckpoint(updated);
      statusResults.push({ courseId: job.courseId, segmentId: job.segmentId, status: "provider-processing", providerStatus: normalized });
      continue;
    }

    const segmentPath = path.join(item.courseDir, "generated", "final-media", "segments", `${job.segmentId}.mp4`);
    const download = fs.existsSync(segmentPath)
      ? { bytes: fs.statSync(segmentPath).size, sha256: stableHash(fs.readFileSync(segmentPath)) }
      : await downloadFile(status.downloadUrl, segmentPath);
    const receipt = await uploadObject(segmentPath, `courses/${job.courseId}/${job.moduleId}/segments/${job.segmentId}.mp4`, "video/mp4");
    const updated = {
      ...job,
      status: "complete-archived",
      providerStatus: normalized,
      reconciledAt: new Date().toISOString(),
      localSegmentPath: path.relative(root, segmentPath).replaceAll("\\", "/"),
      segmentBytes: download.bytes,
      segmentSha256: download.sha256,
      storageReceipt: receipt,
      publicationAuthorized: false,
    };
    writeJson(sidecarPath, updated);
    await persistMediaJobCheckpoint(updated);
    statusResults.push({ courseId: job.courseId, moduleId: job.moduleId, segmentId: job.segmentId, status: "complete-archived", storageKey: receipt.storageKey, sha256: receipt.sha256 });
  } catch (error) {
    statusResults.push({ courseId: job.courseId, moduleId: job.moduleId, segmentId: job.segmentId, status: "reconciliation-error", error: String(error?.message ?? error).slice(0, 1600) });
  }
}

const refreshed = loadSidecars();
const byModule = new Map();
for (const entry of refreshed) {
  const key = `${entry.job.courseId}::${entry.job.moduleId}`;
  if (!byModule.has(key)) byModule.set(key, []);
  byModule.get(key).push(entry);
}

const moduleResults = [];
for (const [key, moduleEntries] of byModule.entries()) {
  moduleEntries.sort((left, right) => Number(left.job.partNumber) - Number(right.job.partNumber));
  const [courseId, moduleId] = key.split("::");
  const complete = moduleEntries.every((entry) => entry.job.status === "complete-archived" && entry.job.localSegmentPath);
  if (!complete) {
    moduleResults.push({ courseId, moduleId, status: "segments-incomplete", completeSegments: moduleEntries.filter((entry) => entry.job.status === "complete-archived").length, expectedSegments: moduleEntries.length });
    continue;
  }
  try {
    const outputDir = path.join(root, "releases", courseId, "FINAL", "media");
    const moduleVideoPath = path.join(outputDir, `${moduleId}.mp4`);
    const segmentPaths = moduleEntries.map((entry) => path.join(root, entry.job.localSegmentPath));
    concatenateSegments(segmentPaths, moduleVideoPath);
    const durations = segmentPaths.map(mediaDurationSeconds);
    let absoluteTime = 0;
    const cues = [];
    const transcriptLines = [`# ${moduleEntries[0].job.moduleTitle || moduleId} Transcript`, "", "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.", ""];
    const audioDescriptionLines = [`# ${moduleEntries[0].job.moduleTitle || moduleId} Audio Description Script`, "", "This script requires accessibility review and final synchronization before publication.", ""];
    const sourceIds = new Set();
    for (let segmentIndex = 0; segmentIndex < moduleEntries.length; segmentIndex += 1) {
      const entry = moduleEntries[segmentIndex].job;
      const duration = durations[segmentIndex];
      const captions = entry.captionEntries ?? [];
      const cueDuration = duration / Math.max(1, captions.length);
      for (let index = 0; index < captions.length; index += 1) {
        const start = absoluteTime + cueDuration * index;
        const end = absoluteTime + cueDuration * (index + 1);
        const text = String(captions[index].captionText ?? "").trim();
        if (text) cues.push(`${cues.length + 1}\n${vttTime(start)} --> ${vttTime(end)}\n${text}\n`);
        transcriptLines.push(`## ${captions[index].sceneId || `Scene ${index + 1}`}`, "", text, "");
      }
      for (const description of entry.alternateDescriptions ?? []) {
        const text = String(description.altDescription ?? "").trim();
        if (text) audioDescriptionLines.push(`## ${description.sceneId}`, "", text, "");
      }
      for (const sourceId of entry.sourceIds ?? []) sourceIds.add(sourceId);
      absoluteTime += duration;
    }
    const captionsPath = path.join(outputDir, `${moduleId}.vtt`);
    const transcriptPath = path.join(outputDir, `${moduleId}-transcript.md`);
    const audioDescriptionPath = path.join(outputDir, `${moduleId}-audio-description.md`);
    const rightsPath = path.join(outputDir, `${moduleId}-rights-ledger.json`);
    writeText(captionsPath, `WEBVTT\n\n${cues.join("\n")}`);
    writeText(transcriptPath, transcriptLines.join("\n"));
    writeText(audioDescriptionPath, audioDescriptionLines.join("\n"));
    writeJson(rightsPath, {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      courseId,
      moduleId,
      provider: providerName,
      providerJobIds: moduleEntries.map((entry) => entry.job.externalId),
      scriptHashes: moduleEntries.map((entry) => entry.job.scriptHash),
      sourceIds: [...sourceIds],
      owner: "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC",
      originalCourseProduction: true,
      providerTermsReviewRequired: true,
      thirdPartyAssetClearanceRequired: true,
      publicationAuthorized: false,
    });
    const receipts = [
      await uploadObject(moduleVideoPath, `courses/${courseId}/${moduleId}/master.mp4`, "video/mp4"),
      await uploadObject(captionsPath, `courses/${courseId}/${moduleId}/captions.vtt`, "text/vtt"),
      await uploadObject(transcriptPath, `courses/${courseId}/${moduleId}/transcript.md`, "text/markdown"),
      await uploadObject(audioDescriptionPath, `courses/${courseId}/${moduleId}/audio-description.md`, "text/markdown"),
      await uploadObject(rightsPath, `courses/${courseId}/${moduleId}/rights-ledger.json`, "application/json"),
    ];
    const lcms = await registerModuleMediaInLcms(courseId, moduleId, receipts, {
      provider: providerName,
      segmentCount: moduleEntries.length,
      durationSeconds: absoluteTime,
      captionsStatus: "machine-timed-review-required",
      transcriptStatus: "script-derived-review-required",
      audioDescriptionStatus: "script-derived-review-required",
      rightsStatus: "provider-and-third-party-review-required",
    });
    moduleResults.push({ courseId, moduleId, status: "assembled-archived", segmentCount: moduleEntries.length, durationSeconds: absoluteTime, receipts, lcms });
  } catch (error) {
    moduleResults.push({ courseId, moduleId, status: "assembly-error", error: String(error?.message ?? error).slice(0, 1600) });
  }
}

const expectedJobs = refreshed.length;
const archivedJobs = refreshed.filter((entry) => entry.job.status === "complete-archived").length;
const expectedModules = byModule.size;
const assembledModules = moduleResults.filter((result) => result.status === "assembled-archived").length;
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  provider: providerName,
  storage: { supabaseUrlFingerprint: stableHash(supabaseUrl).slice(0, 16), bucket: storageBucket, privateBucketRequired: true },
  expectedCourses: portfolio.expectedCourses,
  expectedJobs,
  archivedJobs,
  expectedModules,
  assembledModules,
  allJobsArchived: expectedJobs > 0 && archivedJobs === expectedJobs,
  allModulesAssembled: expectedModules > 0 && assembledModules === expectedModules,
  publicationAuthorized: false,
  statusResults,
  moduleResults,
  claimBoundary: "Archived and assembled media proves provider completion, protected retrieval, private object storage, module assembly, and generated accessibility artifacts. Captions, transcripts, audio descriptions, visual composition, source cards, provider terms, and rights still require governed quality review before publication.",
};
fs.mkdirSync(catalogRoot, { recursive: true });
writeJson(reportPath, report);
console.log(`[Academy Studio] Media reconciliation archived ${archivedJobs}/${expectedJobs} segment(s) and assembled ${assembledModules}/${expectedModules} module video(s).`);
if (strict && (!report.allJobsArchived || !report.allModulesAssembled || statusResults.some((result) => ["provider-failed", "reconciliation-error", "provider-mismatch", "missing-external-id"].includes(result.status)))) process.exit(2);
