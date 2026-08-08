import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const releasesRoot = path.join(root, "releases");
const expectedCourses = Number(process.env.ACADEMY_EXPECTED_SURGE_COURSES || 61);
const voiceModel = String(process.env.ACADEMY_LOCAL_TTS_MODEL || "en_US-joe-medium").trim();
const voiceDataDir = String(process.env.ACADEMY_LOCAL_TTS_DATA_DIR || path.join(os.tmpdir(), "academy-piper-voices")).trim();
const legalName = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";
const proprietaryNotice = "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
    ...options,
  });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}: ${String(result.stderr || result.stdout || "").slice(-5000)}`);
  }
  return result;
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function words(value) { return String(value || "").trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0; }
function unique(values) { return [...new Set(values.filter(Boolean).map(String))]; }
function cleanText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function ensureDirectory(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }

function ffprobeDuration(filePath) {
  const result = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath]);
  const duration = Number(String(result.stdout || "").trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Unable to determine media duration for ${filePath}`);
  return duration;
}

function parseLoudnorm(stderr) {
  const text = String(stderr || "");
  const start = text.lastIndexOf("{\n");
  const end = text.indexOf("}\n", start);
  if (start < 0 || end < 0) throw new Error("Unable to parse loudnorm first-pass JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

function loudnessNormalize(inputWav, outputWav) {
  const first = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-y", "-i", inputWav,
    "-af", "loudnorm=I=-16:TP=-2:LRA=11:print_format=json",
    "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (first.status !== 0) throw new Error(`loudnorm first pass failed: ${String(first.stderr || "").slice(-3000)}`);
  const stats = parseLoudnorm(first.stderr);
  const filter = [
    "loudnorm=I=-16:TP=-2:LRA=11",
    `measured_I=${stats.input_i}`,
    `measured_LRA=${stats.input_lra}`,
    `measured_TP=${stats.input_tp}`,
    `measured_thresh=${stats.input_thresh}`,
    `offset=${stats.target_offset}`,
    "linear=true",
    "print_format=summary",
  ].join(":");
  run("ffmpeg", [
    "-hide_banner", "-nostats", "-y", "-i", inputWav,
    "-af", `${filter},aresample=48000`,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", outputWav,
  ]);
}

function timestamp(seconds, separator = ".") {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function assTimestamp(seconds) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function assEscape(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function sceneRecords(module) {
  const scenes = Array.isArray(module.videoScript?.scenes) ? module.videoScript.scenes : [];
  if (scenes.length) return scenes.map((scene, index) => ({
    sceneId: scene.sceneId || `scene-${index + 1}`,
    narration: cleanText(scene.narration),
    captionText: cleanText(scene.captionText || (scene.onScreenText || []).join(" • ") || scene.narration),
    visual: cleanText(scene.altDescription || scene.visual || (scene.onScreenText || []).join("; ")),
    sourceIds: Array.isArray(scene.sourceIds) ? scene.sourceIds : [],
  }));
  return [];
}

function narrationFor(module) {
  const scenes = sceneRecords(module);
  const parts = [cleanText(module.videoScript?.opening), ...scenes.map((scene) => scene.narration), cleanText(module.videoScript?.closing)].filter(Boolean);
  let narration = parts.join(" ");
  if (words(narration) < 120) {
    const additions = [
      cleanText(module.openingContext),
      ...(module.keyConcepts || []).map((item) => cleanText(`${item.term}. ${item.explanation}`)),
      cleanText(module.executiveExample),
      cleanText(module.operationalExample),
    ].filter(Boolean);
    narration = `${narration} ${additions.join(" ")}`.trim();
  }
  return { scenes, narration };
}

function distributeSceneTimes(scenes, duration) {
  const effective = scenes.length ? scenes : [{ sceneId: "scene-1", narration: "", captionText: "Obserra Academy", visual: "Obserra Academy instructional scene", sourceIds: [] }];
  const weights = effective.map((scene) => Math.max(8, words(scene.narration || scene.captionText)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  return effective.map((scene, index) => {
    const end = index === effective.length - 1 ? duration : cursor + (duration * weights[index] / total);
    const record = { ...scene, start: cursor, end };
    cursor = end;
    return record;
  });
}

function writeVtt(filePath, scenes) {
  const lines = ["WEBVTT", ""];
  scenes.forEach((scene, index) => {
    lines.push(String(index + 1));
    lines.push(`${timestamp(scene.start)} --> ${timestamp(scene.end)}`);
    lines.push(cleanText(scene.captionText || scene.narration || `Scene ${index + 1}`));
    lines.push("");
  });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

function writeAss(filePath, courseTitle, moduleTitle, scenes) {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Title,DejaVu Sans,52,&H00E8D28A,&H000000FF,&H00102030,&H90000000,-1,0,0,0,100,100,0,0,1,2,1,8,110,110,80,1\nStyle: Body,DejaVu Sans,42,&H00FFFFFF,&H000000FF,&H00102030,&H90000000,0,0,0,0,100,100,0,0,1,2,1,2,140,140,105,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const events = [];
  events.push(`Dialogue: 0,0:00:00.00,${assTimestamp(Math.min(8, scenes.at(-1)?.end || 8))},Title,,0,0,0,,${assEscape(courseTitle)}\\N${assEscape(moduleTitle)}`);
  for (const scene of scenes) {
    const display = cleanText(scene.captionText || scene.narration).slice(0, 360);
    events.push(`Dialogue: 0,${assTimestamp(scene.start)},${assTimestamp(scene.end)},Body,,0,0,0,,${assEscape(display)}`);
  }
  fs.writeFileSync(filePath, `${header}${events.join("\n")}\n`, { mode: 0o600 });
}

function audioDescription(module, scenes) {
  const planned = Array.isArray(module.videoScript?.audioDescriptionPlan) ? module.videoScript.audioDescriptionPlan.map((item) => typeof item === "string" ? item : JSON.stringify(item)) : [];
  const visuals = scenes.map((scene, index) => `Scene ${index + 1}: ${scene.visual || "A branded instructional scene presents the current concept and supporting evidence in readable on-screen text."}`);
  let text = [...planned, ...visuals].map(cleanText).filter(Boolean).join("\n\n");
  if (words(text) < 20) text += "\n\nThe visual presentation uses readable titles, restrained motion, high contrast, and on-screen instructional text that mirrors the narrated learning content.";
  return text.trim();
}

function sourceIdsFor(module, scenes) {
  return unique([
    ...scenes.flatMap((scene) => scene.sourceIds || []),
    ...(module.sourcePlaceholders || []),
    ...(module.referenceApplications || []).flatMap((item) => item.sourceIds || []),
    ...(module.knowledgeChecks || []).flatMap((item) => item.sourceIds || []),
  ]);
}

function renderModule(courseId, courseTitle, module) {
  const { scenes, narration } = narrationFor(module);
  if (words(narration) < 100) throw new Error(`${courseId}/${module.id} narration is below 100 words.`);

  const workDir = path.join(coursesRoot, courseId, "generated", "local-media-work", module.id);
  const mediaDir = path.join(releasesRoot, courseId, "FINAL", "media");
  ensureDirectory(workDir);
  ensureDirectory(mediaDir);

  const narrationPath = path.join(workDir, "narration.txt");
  const rawWav = path.join(workDir, "narration-raw.wav");
  const masteredWav = path.join(workDir, "narration-mastered.wav");
  const assPath = path.join(workDir, "visual-captions.ass");
  fs.writeFileSync(narrationPath, `${narration}\n`, { mode: 0o600 });

  run("python3", ["-m", "piper", "-m", voiceModel, "--data-dir", voiceDataDir, "-f", rawWav, "--input-file", narrationPath]);
  loudnessNormalize(rawWav, masteredWav);
  const duration = ffprobeDuration(masteredWav);
  if (duration < 30) throw new Error(`${courseId}/${module.id} mastered narration is only ${duration.toFixed(1)} seconds.`);
  const timedScenes = distributeSceneTimes(scenes, duration);
  writeAss(assPath, courseTitle, module.title, timedScenes);

  const mp4Path = path.join(mediaDir, `${module.id}.mp4`);
  const vf = `noise=alls=5:allf=t+u,drawgrid=width=160:height=90:thickness=1:color=white@0.045,subtitles=${assPath.replace(/\\/g, "/").replace(/:/g, "\\:")}`;
  run("ffmpeg", [
    "-hide_banner", "-nostats", "-y",
    "-f", "lavfi", "-i", "color=c=0x17324d:s=1920x1080:r=30",
    "-i", masteredWav,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "1",
    "-shortest", "-movflags", "+faststart", mp4Path,
  ]);

  const vttPath = path.join(mediaDir, `${module.id}.vtt`);
  writeVtt(vttPath, timedScenes);

  const transcriptPath = path.join(mediaDir, `${module.id}-transcript.md`);
  fs.writeFileSync(transcriptPath, `# ${module.title} Transcript\n\n${proprietaryNotice}\n\n${narration}\n`, { mode: 0o600 });

  const audioDescriptionPath = path.join(mediaDir, `${module.id}-audio-description.md`);
  fs.writeFileSync(audioDescriptionPath, `# ${module.title} Audio Description\n\n${audioDescription(module, timedScenes)}\n`, { mode: 0o600 });

  const scriptHash = sha256(Buffer.from(narration));
  const sourceIds = sourceIdsFor(module, timedScenes);
  if (!sourceIds.length) throw new Error(`${courseId}/${module.id} has no source identifiers for media rights linkage.`);
  const rightsPath = path.join(mediaDir, `${module.id}-rights-ledger.json`);
  const rights = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    courseId,
    moduleId: module.id,
    originalCourseProduction: true,
    syntheticNarration: true,
    narrationEngine: {
      name: "Piper TTS",
      package: "piper-tts",
      pinnedVersion: "1.5.0",
      engineLicense: "GPL-3.0-or-later",
      distributionBoundary: "Production tool only; engine is not bundled with the learner media package.",
    },
    voiceModel: {
      id: voiceModel,
      repository: "rhasspy/piper-voices",
      repositoryLicense: "MIT",
      sourceDatasetLicense: "CC0",
      sourceDatasetLicenseEvidence: "en/en_US/joe/medium/MODEL_CARD",
    },
    visualProduction: "Original Obserra motion-graphic render generated locally with FFmpeg from course-owned text and governed source references.",
    thirdPartyStockAssetsUsed: false,
    musicUsed: false,
    scriptHashes: [scriptHash],
    sourceIds,
    proprietaryNotice,
    issuer: legalName,
  };
  fs.writeFileSync(rightsPath, `${JSON.stringify(rights, null, 2)}\n`, { mode: 0o600 });

  run(process.execPath, ["studio/verify-media-audio.mjs", "--file", mp4Path]);
  const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,sample_rate:format=duration", "-of", "json", mp4Path]).stdout || "{}");
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (probe.streams || []).find((stream) => stream.codec_type === "audio");
  if (Number(video?.width || 0) < 1920 || Number(video?.height || 0) < 1080 || Number(audio?.sample_rate || 0) !== 48000) {
    throw new Error(`${courseId}/${module.id} failed local mastered-media dimensions or sample-rate validation.`);
  }

  return {
    courseId,
    moduleId: module.id,
    title: module.title,
    passed: true,
    durationSeconds: Number(probe.format?.duration || duration),
    video: path.relative(root, mp4Path).replaceAll("\\", "/"),
    captions: path.relative(root, vttPath).replaceAll("\\", "/"),
    transcript: path.relative(root, transcriptPath).replaceAll("\\", "/"),
    audioDescription: path.relative(root, audioDescriptionPath).replaceAll("\\", "/"),
    rights: path.relative(root, rightsPath).replaceAll("\\", "/"),
    scriptSha256: scriptHash,
    sourceIds,
    estimatedApiCostUsd: 0,
  };
}

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .sort();
if (courseIds.length !== expectedCourses) throw new Error(`Local media renderer expected ${expectedCourses} courses; discovered ${courseIds.length}.`);

const results = [];
for (const [courseIndex, courseId] of courseIds.entries()) {
  const manifest = readJson(path.join(coursesRoot, courseId, "course-manifest.json"));
  const envelope = readJson(path.join(coursesRoot, courseId, "generated", "authoring", "course-package.json"));
  const modules = Array.isArray(envelope?.content?.modules) ? envelope.content.modules : [];
  if (!modules.length) throw new Error(`No authored modules found for ${courseId}.`);
  console.log(`[Academy Studio] Local media rendering course ${courseIndex + 1}/${courseIds.length}: ${courseId} (${modules.length} modules).`);
  for (const module of modules) results.push(renderModule(courseId, manifest.course?.title || courseId, module));
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  objective: "final-mastered-academy-media-zero-commercial-api-cost",
  expectedCourses,
  renderedCourses: new Set(results.map((item) => item.courseId)).size,
  renderedModules: results.length,
  passedModules: results.filter((item) => item.passed).length,
  provider: "local-ffmpeg-plus-piper",
  ttsModel: voiceModel,
  estimatedApiCostUsd: 0,
  externalPaidMediaProviderUsed: false,
  results,
};
ensureDirectory(path.join(root, "catalog"));
fs.writeFileSync(path.join(root, "catalog", "academy-61-local-media-render-summary.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Local mastered media rendered for ${report.renderedCourses}/${expectedCourses} courses and ${report.passedModules}/${report.renderedModules} modules at $0 external media API cost.`);
