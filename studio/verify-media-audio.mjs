import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const explicitFile = arg("--file");
const courseId = arg("--course");
const minimumIntegratedLufs = Number(arg("--minimum-lufs") ?? -18);
const maximumIntegratedLufs = Number(arg("--maximum-lufs") ?? -14);
const maximumTruePeakDbfs = Number(arg("--maximum-true-peak") ?? -1.0);
const requiredSampleRate = Number(arg("--sample-rate") ?? 48000);

function fail(message) {
  console.error(`[Academy Studio] ${message}`);
  process.exitCode = 1;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${command} is required for media audio verification: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function findMp4Files(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findMp4Files(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")) files.push(fullPath);
  }
  return files;
}

function parseLastNumber(text, expression, label) {
  const matches = [...text.matchAll(expression)];
  if (!matches.length) throw new Error(`Unable to measure ${label}`);
  return Number(matches.at(-1)[1]);
}

function inspectVideo(filePath) {
  const probe = run("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=index,codec_name,codec_type,sample_rate,channels,channel_layout:stream_tags=language",
    "-of", "json",
    filePath,
  ]);
  if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr.trim()}`);
  const probeJson = JSON.parse(probe.stdout || "{}");
  const audio = probeJson.streams?.[0];
  if (!audio || audio.codec_type !== "audio") {
    return { filePath, pass: false, findings: ["missing-audio-stream"] };
  }

  const measurement = run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", filePath,
    "-map", "0:a:0",
    "-af", "ebur128=peak=true",
    "-f", "null", "-",
  ]);
  const output = `${measurement.stdout}\n${measurement.stderr}`;
  const integratedLufs = parseLastNumber(output, /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g, "integrated loudness");
  const truePeakDbfs = parseLastNumber(output, /Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/g, "true peak");
  const sampleRate = Number(audio.sample_rate);
  const channels = Number(audio.channels);
  const findings = [];

  if (sampleRate !== requiredSampleRate) findings.push(`sample-rate-${sampleRate}-expected-${requiredSampleRate}`);
  if (!Number.isFinite(channels) || channels < 1) findings.push("invalid-channel-count");
  if (integratedLufs < minimumIntegratedLufs) findings.push(`audio-too-quiet-${integratedLufs}-lufs`);
  if (integratedLufs > maximumIntegratedLufs) findings.push(`audio-too-loud-${integratedLufs}-lufs`);
  if (truePeakDbfs > maximumTruePeakDbfs) findings.push(`true-peak-too-high-${truePeakDbfs}-dbfs`);

  return {
    filePath,
    pass: findings.length === 0,
    codec: audio.codec_name,
    sampleRate,
    channels,
    channelLayout: audio.channel_layout ?? null,
    integratedLufs,
    truePeakDbfs,
    findings,
  };
}

const scanRoot = courseId
  ? path.join(root, "courses", courseId)
  : path.join(root, "courses");
const candidates = explicitFile
  ? [path.resolve(explicitFile)]
  : findMp4Files(scanRoot);

if (!candidates.length) {
  console.log("[Academy Studio] No MP4 course media found; audio verification has no files to inspect.");
  process.exit(0);
}

const results = [];
for (const filePath of candidates) {
  try {
    results.push(inspectVideo(filePath));
  } catch (error) {
    results.push({
      filePath,
      pass: false,
      findings: [`verification-error-${error instanceof Error ? error.message : String(error)}`],
    });
  }
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  policy: {
    integratedLoudnessRangeLufs: [minimumIntegratedLufs, maximumIntegratedLufs],
    maximumTruePeakDbfs,
    requiredSampleRate,
    audioStreamRequired: true,
  },
  results,
};
const reportDirectory = courseId
  ? path.join(root, "courses", courseId, "generated", "media-qa")
  : path.join(root, "catalog");
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(
  path.join(reportDirectory, "audio-verification.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

for (const result of results) {
  const relative = path.relative(root, result.filePath);
  if (result.pass) {
    console.log(`[Academy Studio] PASS ${relative}: ${result.integratedLufs} LUFS, ${result.truePeakDbfs} dBFS peak, ${result.sampleRate} Hz, ${result.channels} channel(s).`);
  } else {
    fail(`${relative}: ${result.findings.join(", ")}`);
  }
}
