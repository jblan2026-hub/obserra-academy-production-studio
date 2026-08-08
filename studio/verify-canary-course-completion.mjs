import "./academy-zero-cost-lock.mjs";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course");
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error("Usage: node studio/verify-canary-course-completion.mjs --course <course-id>");
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error(`Canary manifest not found for ${courseId}.`);

function run(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function words(value) {
  return String(value ?? "").trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function evidence(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return {
    path: path.relative(root, filePath).replaceAll("\\", "/"),
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  };
}

function add(findings, condition, code) {
  if (!condition) findings.push(code);
}

function parseRate(value) {
  const [numerator, denominator] = String(value || "0/1").split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

function inspectVideo(filePath) {
  const findings = [];
  const probe = run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels:format=duration",
    "-of", "json",
    filePath,
  ]);
  if (probe.status !== 0) {
    return { passed: false, findings: ["ffprobe-failed"], stderr: String(probe.stderr || "").slice(-2000) };
  }

  let payload;
  try { payload = JSON.parse(probe.stdout || "{}"); }
  catch { return { passed: false, findings: ["ffprobe-invalid-json"] }; }

  const video = (payload.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (payload.streams || []).find((stream) => stream.codec_type === "audio");
  const duration = Number(payload.format?.duration || 0);
  const frameRate = parseRate(video?.avg_frame_rate);
  add(findings, Boolean(video), "missing-video-stream");
  add(findings, Boolean(audio), "missing-audio-stream");
  add(findings, Number(video?.width || 0) >= 1920, `video-width-${video?.width || 0}-minimum-1920`);
  add(findings, Number(video?.height || 0) >= 1080, `video-height-${video?.height || 0}-minimum-1080`);
  add(findings, Number(audio?.sample_rate || 0) === 48000, `audio-sample-rate-${audio?.sample_rate || 0}-expected-48000`);
  add(findings, duration >= 30, `video-duration-${duration}-minimum-30-seconds`);
  add(findings, frameRate >= 23 && frameRate <= 60, `frame-rate-${frameRate}-outside-23-60`);

  const decode = run("ffmpeg", [
    "-v", "error", "-i", filePath,
    "-map", "0:v:0", "-map", "0:a:0",
    "-f", "null", "-",
  ]);
  add(findings, decode.status === 0, "video-decode-or-playback-check-failed");

  const audioCheck = run(process.execPath, ["studio/verify-media-audio.mjs", "--file", filePath]);
  add(findings, audioCheck.status === 0, "audio-quality-verification-failed");

  return {
    passed: findings.length === 0,
    findings,
    codec: video?.codec_name || null,
    width: Number(video?.width || 0) || null,
    height: Number(video?.height || 0) || null,
    frameRate,
    durationSeconds: duration,
    audioCodec: audio?.codec_name || null,
    audioSampleRate: Number(audio?.sample_rate || 0) || null,
    audioChannels: Number(audio?.channels || 0) || null,
  };
}

const findings = [];
const deterministic = run(process.execPath, [".github/scripts/validate-zero-cost-course.mjs", courseId]);
add(findings, deterministic.status === 0, "deterministic-course-quality-gate-failed");

const manifest = readJson(manifestPath);
const researchPath = path.join(courseDir, "generated", "research", "authoritative-source-research.json");
const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
const reviewPath = path.join(courseDir, "generated", "quality", "independent-course-quality-review.json");
const stageDir = path.join(courseDir, "generated", "production-stage");

add(findings, fs.existsSync(researchPath), "missing-authoritative-research-evidence");
add(findings, fs.existsSync(packagePath), "missing-authored-course-package");
add(findings, fs.existsSync(reviewPath), "missing-independent-quality-review");

const research = fs.existsSync(researchPath) ? readJson(researchPath) : null;
const envelope = fs.existsSync(packagePath) ? readJson(packagePath) : null;
const review = fs.existsSync(reviewPath) ? readJson(reviewPath) : null;

add(findings, research?.provider === "local", "research-provider-not-local");
add(findings, research?.passed === true, "research-not-passed");
add(findings, Array.isArray(research?.unresolvedTopics) && research.unresolvedTopics.length === 0, "research-has-unresolved-topics");
add(findings, Number(research?.documentedCaseCount || research?.research?.documentedCases?.length || 0) >= 2, "fewer-than-two-primary-source-cases");
add(findings, envelope?.provider === "local", "authoring-provider-not-local");
add(findings, envelope?.estimatedModelCostUsd === 0, "authoring-cost-not-zero");
add(findings, envelope?.publicationAuthorized === false, "package-improperly-authorizes-publication");
add(findings, review?.provider === "local", "review-provider-not-local");
add(findings, review?.passed === true && review?.review?.passed === true, "independent-review-not-passed");

const reviewScores = Object.values(review?.review?.scores || {});
add(findings, reviewScores.length === 10, "independent-review-score-count-not-10");
add(findings, reviewScores.every((score) => Number.isInteger(score) && score >= 90 && score <= 100), "independent-review-score-below-90");
add(findings, Array.isArray(review?.review?.criticalFindings) && review.review.criticalFindings.length === 0, "critical-review-findings-present");
add(findings, Array.isArray(review?.review?.requiredCorrections) && review.review.requiredCorrections.length === 0, "required-review-corrections-present");

const requiredMaterialFiles = [
  "artifact-manifest.json",
  "instructor-manuscript.md",
  "learner-guide.md",
  "learner-workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "source-register.json",
  "applicability-matrix.json",
  "framework-alignment.json",
  "media-production-plan.json",
  "accessibility-plan.json",
  "rights-and-licensing-plan.json",
  "certificate/certificate-policy.json",
  "certificate/certificate-template.html",
  "certificate/certificate-template.svg",
  "learner-experience.json",
];

const materialEvidence = {};
for (const relative of requiredMaterialFiles) {
  const filePath = path.join(stageDir, relative);
  add(findings, fs.existsSync(filePath) && fs.statSync(filePath).size > 20, `missing-or-empty-material-${relative.replaceAll("/", "-")}`);
  if (fs.existsSync(filePath)) materialEvidence[relative] = evidence(filePath);
}

const certificatePolicyPath = path.join(stageDir, "certificate", "certificate-policy.json");
if (fs.existsSync(certificatePolicyPath)) {
  const certificatePolicy = readJson(certificatePolicyPath);
  add(findings, certificatePolicy.isProfessionalCertification === false, "certificate-improperly-claims-professional-certification");
  add(findings, certificatePolicy.isComplianceEvidence === false, "certificate-improperly-claims-compliance-evidence");
}

const modules = Array.isArray(manifest.course?.modules) ? manifest.course.modules : [];
const videoResults = [];
for (const module of modules) {
  const mediaDir = path.join(root, "releases", courseId, "FINAL", "media");
  const files = {
    video: path.join(mediaDir, `${module.id}.mp4`),
    captions: path.join(mediaDir, `${module.id}.vtt`),
    transcript: path.join(mediaDir, `${module.id}-transcript.md`),
    audioDescription: path.join(mediaDir, `${module.id}-audio-description.md`),
    rights: path.join(mediaDir, `${module.id}-rights-ledger.json`),
  };
  const moduleFindings = [];
  for (const [kind, filePath] of Object.entries(files)) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) moduleFindings.push(`missing-or-empty-${kind}`);
  }

  const technical = fs.existsSync(files.video) ? inspectVideo(files.video) : null;
  if (technical && !technical.passed) moduleFindings.push(...technical.findings);

  if (fs.existsSync(files.captions)) {
    const captions = fs.readFileSync(files.captions, "utf8");
    if (!captions.startsWith("WEBVTT") || !captions.includes("-->")) moduleFindings.push("invalid-captions");
  }
  if (fs.existsSync(files.transcript) && words(fs.readFileSync(files.transcript, "utf8")) < 100) {
    moduleFindings.push("transcript-below-100-words");
  }
  if (fs.existsSync(files.audioDescription) && words(fs.readFileSync(files.audioDescription, "utf8")) < 20) {
    moduleFindings.push("audio-description-below-20-words");
  }
  if (fs.existsSync(files.rights)) {
    try {
      const rights = readJson(files.rights);
      if (rights.originalCourseProduction !== true) moduleFindings.push("rights-original-production-not-confirmed");
      if (rights.thirdPartyStockAssetsUsed !== false) moduleFindings.push("unapproved-third-party-stock-assets");
      if (!Array.isArray(rights.scriptHashes) || rights.scriptHashes.length === 0) moduleFindings.push("rights-missing-script-hashes");
      if (!Array.isArray(rights.sourceIds) || rights.sourceIds.length === 0) moduleFindings.push("rights-missing-source-ids");
    } catch {
      moduleFindings.push("invalid-rights-json");
    }
  }

  for (const finding of moduleFindings) findings.push(`video-${module.id}-${finding}`);
  videoResults.push({
    moduleId: module.id,
    title: module.title,
    passed: moduleFindings.length === 0,
    findings: moduleFindings,
    technical,
    evidence: Object.fromEntries(Object.entries(files).map(([name, filePath]) => [name, evidence(filePath)])),
  });
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  objective: "complete-one-course-before-portfolio-fanout",
  courseId,
  title: manifest.course?.title || courseId,
  providerMode: "local-only-zero-commercial-api-cost",
  estimatedCommercialModelApiCostUsd: 0,
  paidFallbackAllowed: false,
  passed: findings.length === 0,
  findings,
  qualityEvidence: {
    deterministicGate: {
      passed: deterministic.status === 0,
      stdout: String(deterministic.stdout || "").slice(-4000),
      stderr: String(deterministic.stderr || "").slice(-4000),
    },
    reviewScores: review?.review?.scores || {},
  },
  evidence: {
    manifest: evidence(manifestPath),
    research: evidence(researchPath),
    package: evidence(packagePath),
    independentReview: evidence(reviewPath),
    materials: materialEvidence,
  },
  videos: videoResults,
};

const catalogDir = path.join(root, "catalog");
fs.mkdirSync(catalogDir, { recursive: true });
fs.writeFileSync(
  path.join(catalogDir, "academy-canary-course-completion-evidence.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600 },
);

console.log(`[Academy Studio] Canary completion evidence for ${courseId}: ${report.passed ? "PASS" : "FAIL"}; findings=${findings.length}; videos=${videoResults.filter((item) => item.passed).length}/${videoResults.length}.`);
if (!report.passed) {
  for (const finding of findings.slice(0, 200)) console.error(`[Academy Studio] ${courseId}: ${finding}`);
  process.exit(2);
}
