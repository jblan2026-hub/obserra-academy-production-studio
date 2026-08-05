import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course");
if (!courseId) {
  console.error("Usage: node studio/quality-gate.mjs --course <course-id>");
  process.exit(1);
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
if (!fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) {
  console.error(`[Academy Studio] Missing manifest or AI authored package for ${courseId}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const content = envelope.content || {};
const failures = [];
const warnings = [];
const score = { structure: 0, depth: 0, assessment: 0, originality: 0, accessibility: 0, branding: 0, release: 0 };

const words = (value) => String(value || "").trim().split(/\s+/).filter(Boolean).length;
const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const overlap = (a, b) => {
  const left = new Set(normalized(a).split(" ").filter((token) => token.length > 4));
  const right = new Set(normalized(b).split(" ").filter((token) => token.length > 4));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.min(left.size, right.size);
};

const modules = Array.isArray(content.modules) ? content.modules : [];
if (modules.length !== manifest.course.modules.length) failures.push("Generated module count does not match the course manifest.");
else score.structure += 20;

const manifestIds = new Set(manifest.course.modules.map((module) => module.id));
const generatedIds = new Set(modules.map((module) => module.id));
for (const id of manifestIds) if (!generatedIds.has(id)) failures.push(`Missing generated module: ${id}`);
for (const module of modules) {
  if (!manifestIds.has(module.id)) failures.push(`Unexpected generated module: ${module.id}`);
  if (words(module.lessonNarrative) < 700) failures.push(`${module.id}: lesson narrative is below 700 words.`);
  if (!Array.isArray(module.keyConcepts) || module.keyConcepts.length < 4) failures.push(`${module.id}: fewer than four key concepts.`);
  if (!module.executiveExample || !module.operationalExample) failures.push(`${module.id}: executive or operational example missing.`);
  if (!module.scenario?.situation || !module.scenario?.decisionPrompt || !module.scenario?.debrief) failures.push(`${module.id}: scenario is incomplete.`);
  if (!module.exercise?.instructions || !module.exercise?.deliverable || !Array.isArray(module.exercise?.rubric) || module.exercise.rubric.length < 3) failures.push(`${module.id}: applied exercise or rubric is incomplete.`);
  if (!Array.isArray(module.knowledgeChecks) || module.knowledgeChecks.length < 4) failures.push(`${module.id}: fewer than four knowledge checks.`);
  if (!Array.isArray(module.slideNarrative) || module.slideNarrative.length < 8) failures.push(`${module.id}: fewer than eight slide narratives.`);
  if (!module.videoScript?.opening || !Array.isArray(module.videoScript?.segments) || module.videoScript.segments.length < 4 || !module.videoScript?.closing) failures.push(`${module.id}: video script is incomplete.`);
  if (!Array.isArray(module.accessibilityNotes) || module.accessibilityNotes.length < 2) failures.push(`${module.id}: accessibility notes are insufficient.`);
  if (!Array.isArray(module.sourcePlaceholders)) failures.push(`${module.id}: source placeholder list is missing.`);
}
if (!failures.some((item) => item.includes("lesson narrative") || item.includes("key concepts") || item.includes("example") || item.includes("scenario") || item.includes("exercise"))) score.depth = 20;
if (!failures.some((item) => item.includes("slide") || item.includes("video") || item.includes("accessibility"))) score.accessibility = 10;

const assessment = Array.isArray(content.finalAssessment) ? content.finalAssessment : [];
if (assessment.length < 25) failures.push("Final assessment contains fewer than 25 questions.");
const assessmentModules = new Set(assessment.map((question) => question.moduleId));
for (const id of manifestIds) if (!assessmentModules.has(id)) failures.push(`Final assessment does not cover module ${id}.`);
for (const question of assessment) {
  if (!question.question || !Array.isArray(question.options) || question.options.length < 4) failures.push("An assessment question is structurally incomplete.");
  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex >= question.options.length) failures.push("An assessment answer index is invalid.");
  if (words(question.rationale) < 8) warnings.push("An assessment rationale may be too shallow.");
}
if (!failures.some((item) => item.includes("assessment") || item.includes("Final assessment"))) score.assessment = 15;

for (let i = 0; i < modules.length; i += 1) {
  for (let j = i + 1; j < modules.length; j += 1) {
    const similarity = overlap(modules[i].lessonNarrative, modules[j].lessonNarrative);
    if (similarity > 0.62) failures.push(`High narrative duplication between ${modules[i].id} and ${modules[j].id}.`);
    else if (similarity > 0.5) warnings.push(`Moderate narrative similarity between ${modules[i].id} and ${modules[j].id}.`);
  }
}
if (!failures.some((item) => item.includes("duplication"))) score.originality = 10;

const brand = content.brand || {};
if (brand.legalName !== "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC") failures.push("Official legal company name is missing from the generated package.");
if (brand.proprietaryNotice !== "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.") failures.push("Required proprietary handling notice is missing.");
if (!String(brand.visualSystem || "").toLowerCase().includes("gold")) failures.push("Official Obserra visual system is not declared.");
if (!failures.some((item) => item.includes("legal company") || item.includes("proprietary") || item.includes("visual system"))) score.branding = 10;

const reviews = manifest.reviews || {};
const requiredReviews = Object.entries(reviews).filter(([, review]) => review.required);
const outstanding = requiredReviews.filter(([, review]) => review.status !== "approved");
if (outstanding.length) warnings.push(`Outstanding required reviews: ${outstanding.map(([name]) => name).join(", ")}.`);
else score.release += 15;

if (manifest.commerce?.model !== "one-time-payment") failures.push("Course commerce model must be one-time-payment.");
if (manifest.commerce?.accessPolicy !== "until-completion") failures.push("Course access policy must be until-completion.");
if (manifest.completion?.certificateIssued !== true) failures.push("Certificate issuance must be enabled.");
if (manifest.completion?.passingScore < 70 || manifest.completion?.passingScore > 100) failures.push("Passing score is outside the permitted range.");
if (!failures.some((item) => item.includes("commerce") || item.includes("access policy") || item.includes("Certificate") || item.includes("Passing score"))) score.release += 10;

const totalScore = Object.values(score).reduce((sum, value) => sum + value, 0);
const passed = failures.length === 0 && totalScore >= 85;
const report = {
  schemaVersion: "1.0",
  courseId,
  generatedAt: new Date().toISOString(),
  passed,
  totalScore,
  score,
  failures,
  warnings,
  releaseEligible: passed && outstanding.length === 0,
  proprietaryNotice: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.",
};
const outputDir = path.join(courseDir, "generated", "quality");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "quality-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Quality gate ${passed ? "PASSED" : "FAILED"} for ${courseId} with score ${totalScore}`);
if (!passed) process.exit(1);
