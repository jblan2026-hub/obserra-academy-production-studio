import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { requiredFinalAssessmentQuestions } from "./academy-authoring-quality-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function words(value) { return String(value ?? "").trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0; }
function sha256(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function evidenceFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return { path: path.relative(root, filePath).replaceAll("\\", "/"), bytes: fs.statSync(filePath).size, sha256: sha256(filePath) };
}
function add(findings, condition, code) { if (!condition) findings.push(code); }
function run(command, args) { return spawnSync(command, args, { cwd: root, encoding: "utf8", env: process.env }); }
function parseRate(value) {
  const [n, d] = String(value || "0/1").split("/").map(Number);
  return d ? n / d : 0;
}
function inspectVideo(filePath) {
  const findings = [];
  const probe = run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels:format=duration", "-of", "json", filePath]);
  if (probe.status !== 0) return { passed: false, findings: ["ffprobe-failed"], stderr: String(probe.stderr || "").slice(-2000) };
  let payload;
  try { payload = JSON.parse(probe.stdout || "{}"); } catch { return { passed: false, findings: ["ffprobe-invalid-json"] }; }
  const video = (payload.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (payload.streams || []).find((stream) => stream.codec_type === "audio");
  const duration = Number(payload.format?.duration || 0);
  const frameRate = parseRate(video?.avg_frame_rate);
  add(findings, Boolean(video), "missing-video-stream");
  add(findings, Boolean(audio), "missing-audio-stream");
  add(findings, Number(video?.width || 0) >= 1920, `video-width-${video?.width || 0}-minimum-1920`);
  add(findings, Number(video?.height || 0) >= 1080, `video-height-${video?.height || 0}-minimum-1080`);
  add(findings, duration >= 30, `video-duration-${duration}-minimum-30-seconds`);
  add(findings, frameRate >= 23 && frameRate <= 60, `frame-rate-${frameRate}-outside-23-60`);
  const decode = run("ffmpeg", ["-v", "error", "-i", filePath, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"]);
  add(findings, decode.status === 0, "video-decode-or-playback-check-failed");
  const audioCheck = run(process.execPath, ["studio/verify-media-audio.mjs", "--file", filePath]);
  add(findings, audioCheck.status === 0, "audio-quality-verification-failed");
  const black = run("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-vf", "blackdetect=d=3:pix_th=0.10", "-an", "-f", "null", "-"]);
  const blackOutput = `${black.stdout || ""}\n${black.stderr || ""}`;
  const longBlack = [...blackOutput.matchAll(/black_duration:([0-9.]+)/g)].some((match) => Number(match[1]) >= 5);
  add(findings, !longBlack, "extended-black-video-detected");
  const freeze = run("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-vf", "freezedetect=n=-50dB:d=8", "-an", "-f", "null", "-"]);
  const freezeOutput = `${freeze.stdout || ""}\n${freeze.stderr || ""}`;
  add(findings, !/freeze_duration:\s*(?:[89]|[1-9][0-9])(?:\.|\s|$)/.test(freezeOutput), "extended-frozen-video-detected");
  return {
    passed: findings.length === 0,
    findings,
    codec: video?.codec_name || null,
    width: video?.width || null,
    height: video?.height || null,
    frameRate,
    durationSeconds: duration,
    audioCodec: audio?.codec_name || null,
    audioSampleRate: Number(audio?.sample_rate || 0) || null,
    audioChannels: Number(audio?.channels || 0) || null
  };
}

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .sort();
if (courseIds.length !== 61) throw new Error(`Completion evidence requires exactly 61 course manifests; discovered ${courseIds.length}.`);

const courseResults = [];
let expectedVideos = 0;
let verifiedVideos = 0;

for (const courseId of courseIds) {
  const findings = [];
  const courseDir = path.join(coursesRoot, courseId);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  const researchPath = path.join(courseDir, "generated", "research", "authoritative-source-research.json");
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  const reviewPath = path.join(courseDir, "generated", "quality", "independent-course-quality-review.json");
  const stageDir = path.join(courseDir, "generated", "production-stage");
  const manifest = readJson(manifestPath);
  const title = manifest.course?.title || courseId;
  const modules = Array.isArray(manifest.course?.modules) ? manifest.course.modules : [];
  expectedVideos += modules.length;

  add(findings, fs.existsSync(researchPath), "missing-authoritative-research-evidence");
  add(findings, fs.existsSync(packagePath), "missing-authored-course-package");
  add(findings, fs.existsSync(reviewPath), "missing-independent-quality-review");

  let research = null;
  let envelope = null;
  let review = null;
  if (fs.existsSync(researchPath)) {
    research = readJson(researchPath);
    add(findings, research.passed === true, "authoritative-research-not-passed");
    add(findings, (research.unresolvedTopics || []).length === 0, "authoritative-research-has-unresolved-topics");
    add(findings, Number(research.documentedCaseCount || research.research?.documentedCases?.length || 0) >= 2, "fewer-than-two-documented-real-world-cases");
  }
  if (fs.existsSync(reviewPath)) {
    review = readJson(reviewPath);
    add(findings, review.passed === true, "independent-quality-review-not-passed");
  }
  if (fs.existsSync(packagePath)) {
    envelope = readJson(packagePath);
    add(findings, envelope.schemaVersion === "2.0", "invalid-cinematic-package-schema");
    add(findings, envelope.productionStandard === "premium-documentary-cinematic", "missing-premium-documentary-cinematic-standard");
    add(findings, envelope.publicationAuthorized === false, "course-package-improperly-authorizes-publication");
    const content = envelope.content || {};
    const authoredModules = Array.isArray(content.modules) ? content.modules : [];
    add(findings, authoredModules.length === modules.length, `module-count-${authoredModules.length}-expected-${modules.length}`);
    const authoredById = new Map(authoredModules.map((module) => [String(module.id), module]));
    const sourceRegister = Array.isArray(content.sourceRegister) ? content.sourceRegister : [];
    add(findings, sourceRegister.length >= Math.max(4, modules.length), "insufficient-source-register");
    for (const source of sourceRegister) {
      add(findings, source.verificationStatus === "verified-from-supplied-source", `source-${source.id || "unknown"}-not-verified`);
      add(findings, String(source.locator || "") !== "verification-required" && /^https:\/\//.test(String(source.locator || "")), `source-${source.id || "unknown"}-invalid-locator`);
      add(findings, Array.isArray(source.appliesWhen) && source.appliesWhen.length > 0, `source-${source.id || "unknown"}-missing-applicability`);
      add(findings, Array.isArray(source.doesNotApplyWhen) && source.doesNotApplyWhen.length > 0, `source-${source.id || "unknown"}-missing-nonapplicability`);
      add(findings, Array.isArray(source.limitations) && source.limitations.length > 0, `source-${source.id || "unknown"}-missing-limitations`);
    }
    const moduleResearch = new Map((research?.research?.moduleResearch || []).map((item) => [String(item.moduleId), item]));
    for (const moduleManifest of modules) {
      const module = authoredById.get(String(moduleManifest.id));
      if (!module) { findings.push(`module-${moduleManifest.id}-missing`); continue; }
      add(findings, words(module.lessonNarrative) >= 1200, `module-${moduleManifest.id}-narrative-below-1200`);
      add(findings, words(module.executiveExample) >= 60, `module-${moduleManifest.id}-executive-example-too-thin`);
      add(findings, words(module.operationalExample) >= 60, `module-${moduleManifest.id}-operational-example-too-thin`);
      add(findings, words(module.scenario?.situation) >= 80, `module-${moduleManifest.id}-scenario-too-thin`);
      add(findings, words(module.scenario?.recommendedApproach) >= 80, `module-${moduleManifest.id}-recommendation-too-thin`);
      add(findings, words(module.scenario?.debrief) >= 80, `module-${moduleManifest.id}-lessons-debrief-too-thin`);
      add(findings, Array.isArray(module.referenceApplications) && module.referenceApplications.length >= 3, `module-${moduleManifest.id}-fewer-than-three-reference-applications`);
      for (const application of module.referenceApplications || []) {
        add(findings, words(application.learnerAction) >= 10, `module-${moduleManifest.id}-reference-application-missing-action`);
        add(findings, Array.isArray(application.sourceIds) && application.sourceIds.length > 0, `module-${moduleManifest.id}-reference-application-missing-source`);
      }
      add(findings, Array.isArray(module.videoScript?.scenes) && module.videoScript.scenes.length >= 8, `module-${moduleManifest.id}-video-script-insufficient-scenes`);
      add(findings, (module.videoScript?.scenes || []).every((scene) => words(scene.narration) >= 20), `module-${moduleManifest.id}-video-scene-narration-too-thin`);
      const researchItem = moduleResearch.get(String(moduleManifest.id));
      add(findings, Boolean(researchItem), `module-${moduleManifest.id}-missing-research-map`);
      add(findings, Array.isArray(researchItem?.sourceIds) && researchItem.sourceIds.length > 0, `module-${moduleManifest.id}-missing-research-sources`);
      add(findings, Array.isArray(researchItem?.lessonsLearned) && researchItem.lessonsLearned.length > 0, `module-${moduleManifest.id}-missing-lessons-learned`);
      add(findings, Array.isArray(researchItem?.implementationRecommendations) && researchItem.implementationRecommendations.length > 0, `module-${moduleManifest.id}-missing-implementation-recommendations`);
    }
    const assessment = Array.isArray(content.finalAssessment) ? content.finalAssessment : [];
    const requiredQuestions = requiredFinalAssessmentQuestions(manifest);
    add(findings, assessment.length >= requiredQuestions, `assessment-${assessment.length}-minimum-${requiredQuestions}`);
    add(findings, assessment.every((item) => Array.isArray(item.sourceIds) && item.sourceIds.length > 0 && words(item.rationale) >= 10), "assessment-source-or-rationale-deficiency");
    add(findings, Array.isArray(content.learnerWorkbook) && content.learnerWorkbook.length === modules.length, "learner-workbook-module-coverage-deficiency");
    add(findings, Boolean(content.instructorGuide) && Array.isArray(content.instructorGuide.facilitationNotes) && content.instructorGuide.facilitationNotes.length > 0, "instructor-guide-deficiency");
  }

  const requiredStageFiles = [
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
    "learner-experience.json"
  ];
  const materialEvidence = {};
  for (const relative of requiredStageFiles) {
    const filePath = path.join(stageDir, relative);
    add(findings, fs.existsSync(filePath) && fs.statSync(filePath).size > 20, `missing-or-empty-material-${relative.replaceAll("/", "-")}`);
    if (fs.existsSync(filePath)) materialEvidence[relative] = evidenceFile(filePath);
  }

  const videoResults = [];
  for (const module of modules) {
    const mediaDir = path.join(root, "releases", courseId, "FINAL", "media");
    const files = {
      video: path.join(mediaDir, `${module.id}.mp4`),
      captions: path.join(mediaDir, `${module.id}.vtt`),
      transcript: path.join(mediaDir, `${module.id}-transcript.md`),
      audioDescription: path.join(mediaDir, `${module.id}-audio-description.md`),
      rights: path.join(mediaDir, `${module.id}-rights-ledger.json`)
    };
    const moduleFindings = [];
    for (const [kind, filePath] of Object.entries(files)) if (!fs.existsSync(filePath)) moduleFindings.push(`missing-${kind}`);
    let technical = null;
    if (fs.existsSync(files.video)) technical = inspectVideo(files.video);
    if (technical && !technical.passed) moduleFindings.push(...technical.findings);
    if (fs.existsSync(files.captions)) {
      const captions = fs.readFileSync(files.captions, "utf8");
      if (!captions.startsWith("WEBVTT") || !captions.includes("-->")) moduleFindings.push("invalid-captions");
    }
    if (fs.existsSync(files.transcript) && words(fs.readFileSync(files.transcript, "utf8")) < 100) moduleFindings.push("transcript-below-100-words");
    if (fs.existsSync(files.audioDescription) && words(fs.readFileSync(files.audioDescription, "utf8")) < 20) moduleFindings.push("audio-description-below-20-words");
    if (fs.existsSync(files.rights)) {
      try {
        const rights = readJson(files.rights);
        if (rights.originalCourseProduction !== true) moduleFindings.push("rights-original-production-not-confirmed");
        if (!Array.isArray(rights.scriptHashes) || rights.scriptHashes.length === 0) moduleFindings.push("rights-missing-script-hashes");
        if (!Array.isArray(rights.sourceIds) || rights.sourceIds.length === 0) moduleFindings.push("rights-missing-source-ids");
      } catch { moduleFindings.push("invalid-rights-json"); }
    }
    if (moduleFindings.length === 0) verifiedVideos += 1;
    for (const finding of moduleFindings) findings.push(`video-${module.id}-${finding}`);
    videoResults.push({
      moduleId: module.id,
      title: module.title,
      passed: moduleFindings.length === 0,
      findings: moduleFindings,
      technical,
      evidence: Object.fromEntries(Object.entries(files).map(([kind, filePath]) => [kind, evidenceFile(filePath)]))
    });
  }

  const evidence = {
    manifest: evidenceFile(manifestPath),
    research: evidenceFile(researchPath),
    authoredPackage: evidenceFile(packagePath),
    independentReview: evidenceFile(reviewPath),
    materials: materialEvidence
  };
  const passed = findings.length === 0;
  courseResults.push({
    courseId,
    title,
    moduleCount: modules.length,
    expectedAssessmentQuestions: requiredFinalAssessmentQuestions(manifest),
    passed,
    findingCount: findings.length,
    findings,
    evidence,
    videos: videoResults
  });
}

const passedCourses = courseResults.filter((course) => course.passed).length;
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  objective: "All 61 Obserra Academy courses and required materials complete to governed standard",
  expectedCourses: 61,
  verifiedCourses: passedCourses,
  expectedVideos,
  verifiedVideos,
  passed: passedCourses === 61 && verifiedVideos === expectedVideos,
  acceptanceRules: {
    authoritativeResearchPassed: true,
    unresolvedFactualTopicsAllowed: false,
    documentedPrimarySourceCasesPerCourseMinimum: 2,
    independentQualityScoreMinimum: 90,
    narrativeWordsPerModuleMinimum: 1200,
    executiveAndOperationalExamplesRequired: true,
    lessonsLearnedRequired: true,
    implementationRecommendationsRequired: true,
    assessmentMinimum: "manifest-derived, minimum 30; PMP 180 when defined by manifest",
    completeLearnerAndInstructorMaterialsRequired: true,
    videoMinimumResolution: "1920x1080",
    playableDecodeRequired: true,
    audioQualityRequired: true,
    captionsTranscriptAudioDescriptionRequired: true,
    rightsAndSourceLinkageRequired: true
  },
  courses: courseResults
};
fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(path.join(catalogRoot, "academy-61-completion-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  "# Obserra Academy 61 Course Completion Evidence",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  `Overall: ${report.passed ? "PASS" : "FAIL"}`,
  `Courses: ${passedCourses}/61`,
  `Videos: ${verifiedVideos}/${expectedVideos}`,
  "",
  "| # | Course | Modules | Assessment minimum | Content and sources | Materials | Videos | Overall |",
  "|---:|---|---:|---:|---|---|---|---|"
];
courseResults.forEach((course, index) => {
  const contentPass = !course.findings.some((finding) => !finding.startsWith("missing-or-empty-material-") && !finding.startsWith("video-"));
  const materialsPass = !course.findings.some((finding) => finding.startsWith("missing-or-empty-material-"));
  const videosPass = course.videos.every((video) => video.passed);
  lines.push(`| ${index + 1} | ${course.title.replaceAll("|", "\\|")} | ${course.moduleCount} | ${course.expectedAssessmentQuestions} | ${contentPass ? "PASS" : "FAIL"} | ${materialsPass ? "PASS" : "FAIL"} | ${videosPass ? "PASS" : "FAIL"} | ${course.passed ? "PASS" : "FAIL"} |`);
});
lines.push("", "## Course evidence details", "");
for (const course of courseResults) {
  lines.push(`### ${course.title}`, "", `Course ID: ${course.courseId}`, `Status: ${course.passed ? "PASS" : "FAIL"}`, `Modules: ${course.moduleCount}`, `Required assessment questions: ${course.expectedAssessmentQuestions}`);
  if (course.findings.length) lines.push("", "Findings:", ...course.findings.map((finding) => `* ${finding}`));
  lines.push("", "Evidence:");
  for (const [name, value] of Object.entries(course.evidence)) {
    if (name === "materials") continue;
    lines.push(`* ${name}: ${value ? `${value.path} | ${value.sha256}` : "missing"}`);
  }
  for (const [name, value] of Object.entries(course.evidence.materials || {})) lines.push(`* material ${name}: ${value.path} | ${value.sha256}`);
  for (const video of course.videos) lines.push(`* video ${video.moduleId}: ${video.passed ? "PASS" : "FAIL"} | ${video.evidence.video?.path || "missing"} | ${video.evidence.video?.sha256 || "no-hash"}`);
  lines.push("");
}
fs.writeFileSync(path.join(catalogRoot, "ACADEMY-61-COMPLETION-EVIDENCE.md"), `${lines.join("\n")}\n`);
console.log(`[Academy Studio] Completion evidence: ${passedCourses}/61 courses and ${verifiedVideos}/${expectedVideos} videos passed.`);
if (!report.passed) process.exit(2);
