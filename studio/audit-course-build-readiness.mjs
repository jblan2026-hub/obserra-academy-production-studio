import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");
const requiredGeneratedFiles = [
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "visual-brief.md",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseDurationMinutes(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const hours = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:hour|hours|hr|hrs)/);
  const minutes = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:minute|minutes|min|mins)/);
  if (hours || minutes) return Math.round(Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0));
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.round(numeric) : NaN;
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);

const findings = [];
const courses = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = readJson(manifestPath);
  const course = manifest.course ?? {};
  const courseId = course.id ?? entry.name;
  const modules = Array.isArray(course.modules) ? course.modules : [];
  const courseFindings = [];

  if (courseId !== entry.name) courseFindings.push("directory-course-id-mismatch");
  for (const field of ["id", "title", "description", "duration", "department", "level", "track", "audience"]) {
    if (!String(course[field] ?? "").trim()) courseFindings.push(`missing-course-${field}`);
  }
  if (!Array.isArray(course.outcomes) || course.outcomes.length === 0) courseFindings.push("missing-course-outcomes");
  if (modules.length === 0) courseFindings.push("missing-course-modules");

  const moduleIds = new Set();
  let lessonMinutes = 0;
  for (const [index, module] of modules.entries()) {
    for (const field of ["id", "title", "description", "duration", "format"]) {
      if (!String(module?.[field] ?? "").trim()) courseFindings.push(`module-${index + 1}-missing-${field}`);
    }
    if (moduleIds.has(module.id)) courseFindings.push(`module-${index + 1}-duplicate-id`);
    moduleIds.add(module.id);
    const minutes = parseDurationMinutes(module.duration);
    if (!Number.isFinite(minutes) || minutes <= 0) courseFindings.push(`module-${index + 1}-invalid-duration`);
    else lessonMinutes += minutes;
  }

  const advertisedMinutes = parseDurationMinutes(course.duration);
  if (!Number.isFinite(advertisedMinutes) || advertisedMinutes <= 0) courseFindings.push("invalid-course-duration");
  else if (lessonMinutes !== advertisedMinutes) courseFindings.push(`duration-mismatch-${lessonMinutes}-vs-${advertisedMinutes}`);

  if (!manifest.commerce || !Number.isFinite(Number(manifest.commerce.price)) || Number(manifest.commerce.price) <= 0) courseFindings.push("invalid-commerce-price");
  if (!manifest.completion?.allLessonsRequired) courseFindings.push("all-lessons-not-required");
  if (!manifest.completion?.assessmentRequired) courseFindings.push("assessment-not-required");
  if (!Number.isFinite(Number(manifest.completion?.passingScore)) || Number(manifest.completion.passingScore) < 1) courseFindings.push("invalid-passing-score");
  if (manifest.completion?.certificateIssued !== true) courseFindings.push("certificate-not-enabled");
  if (manifest.branding?.logoAsset !== "/brand/obserra-logo.png") courseFindings.push("official-logo-mismatch");

  const missingGenerated = requiredGeneratedFiles.filter((name) => !fs.existsSync(path.join(courseDir, name)));
  if (missingGenerated.length) courseFindings.push(...missingGenerated.map((name) => `missing-generated-${name}`));

  const authoringPath = path.join(courseDir, "generated", "authoring", "course-package.json");
  const authoringMissing = !fs.existsSync(authoringPath);
  if (authoringMissing) courseFindings.push("missing-ai-course-package");

  const manifestHash = stableHash(manifest);
  let packageManifestHash = null;
  if (!authoringMissing) {
    const authored = readJson(authoringPath);
    packageManifestHash = authored.sourceManifestHash ?? authored.manifestHash ?? null;
    if (packageManifestHash && packageManifestHash !== manifestHash) courseFindings.push("stale-ai-course-package");
  }

  const approved = manifest.release?.publishToAcademy === true && ["approved", "published"].includes(manifest.release?.status);
  courses.push({
    courseId,
    title: course.title,
    approved,
    lessonCount: modules.length,
    lessonMinutes,
    advertisedMinutes,
    manifestHash,
    packageManifestHash,
    authoringMissing,
    findings: courseFindings,
  });
  for (const finding of courseFindings) findings.push({ courseId, finding });
}

const approvedCourses = courses.filter((course) => course.approved);
const authoringRequired = approvedCourses.some((course) => course.authoringMissing || course.findings.includes("stale-ai-course-package"));
const buildRequired = approvedCourses.some((course) => course.findings.length > 0);
const blockingFindings = findings.filter(({ finding }) => !["missing-ai-course-package", "stale-ai-course-package", ...requiredGeneratedFiles.map((name) => `missing-generated-${name}`)].includes(finding));

fs.mkdirSync(catalogRoot, { recursive: true });
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  policy: {
    lessonCount: "manifest-defined-per-course",
    duration: "sum-of-manifest-module-durations-must-equal-advertised-course-duration",
    authoring: "approved-missing-or-stale-packages-trigger-ai-authoring",
    build: "approved-missing-or-stale-assets-trigger-governed-build",
    directProductionPublish: false,
  },
  totals: {
    discovered: courses.length,
    approved: approvedCourses.length,
    findings: findings.length,
    blockingFindings: blockingFindings.length,
  },
  authoringRequired,
  buildRequired,
  courses,
};
fs.writeFileSync(path.join(catalogRoot, "continuous-course-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
writeOutput("authoring_required", String(authoringRequired));
writeOutput("build_required", String(buildRequired));
writeOutput("blocking_findings", String(blockingFindings.length));
writeOutput("approved_courses", String(approvedCourses.length));

console.log(`[Academy Studio] Audited ${courses.length} course manifests, including ${approvedCourses.length} approved course(s).`);
console.log(`[Academy Studio] AI authoring required: ${authoringRequired}. Governed build required: ${buildRequired}. Blocking findings: ${blockingFindings.length}.`);
if (blockingFindings.length > 0) {
  for (const item of blockingFindings.slice(0, 100)) console.error(`[Academy Studio] ${item.courseId}: ${item.finding}`);
  process.exitCode = 2;
}
