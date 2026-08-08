import fs from "node:fs";
import path from "node:path";
import { requiredFinalAssessmentQuestions } from "../../studio/academy-authoring-quality-contract.mjs";

const root = process.cwd();
const courseId = process.argv[2];
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) throw new Error("Usage: node .github/scripts/validate-zero-cost-course.mjs <course-id>");
const courseDir = path.join(root, "courses", courseId);
const manifest = JSON.parse(fs.readFileSync(path.join(courseDir, "course-manifest.json"), "utf8"));
const envelope = JSON.parse(fs.readFileSync(path.join(courseDir, "generated", "authoring", "course-package.json"), "utf8"));
const research = JSON.parse(fs.readFileSync(path.join(courseDir, "generated", "research", "authoritative-source-research.json"), "utf8"));
const content = envelope.content || {};
const findings = [];
const words = (value) => String(value ?? "").trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
const add = (condition, code) => { if (!condition) findings.push(code); };

const manifestModules = Array.isArray(manifest.course?.modules) ? manifest.course.modules : [];
const authoredModules = Array.isArray(content.modules) ? content.modules : [];
const byId = new Map(authoredModules.map((module) => [String(module.id), module]));
add(envelope.provider === "local", "package-provider-not-local");
add(research.provider === "local" && research.passed === true, "research-not-local-or-not-passed");
add((research.unresolvedTopics || []).length === 0, "research-unresolved-topics");
add(Number(research.documentedCaseCount || research.research?.documentedCases?.length || 0) >= 2, "fewer-than-two-documented-cases");
add(authoredModules.length === manifestModules.length, `module-count-${authoredModules.length}-expected-${manifestModules.length}`);

const sourceRegister = Array.isArray(content.sourceRegister) ? content.sourceRegister : [];
add(sourceRegister.length >= Math.max(4, manifestModules.length), "insufficient-source-register");
for (const source of sourceRegister) {
  add(Boolean(source.id), "source-missing-id");
  add(/^https:\/\//.test(String(source.locator || "")), `source-${source.id || "unknown"}-invalid-locator`);
  add(source.verificationStatus === "verified-from-supplied-source", `source-${source.id || "unknown"}-not-verified`);
  add(Array.isArray(source.appliesWhen) && source.appliesWhen.length > 0, `source-${source.id || "unknown"}-missing-applies-when`);
  add(Array.isArray(source.doesNotApplyWhen) && source.doesNotApplyWhen.length > 0, `source-${source.id || "unknown"}-missing-does-not-apply-when`);
  add(Array.isArray(source.limitations) && source.limitations.length > 0, `source-${source.id || "unknown"}-missing-limitations`);
}

for (const manifestModule of manifestModules) {
  const module = byId.get(String(manifestModule.id));
  if (!module) { findings.push(`module-${manifestModule.id}-missing`); continue; }
  add(String(module.title || "").trim() === String(manifestModule.title || "").trim(), `module-${manifestModule.id}-title-mismatch`);
  add(String(module.duration || "").trim() === String(manifestModule.duration || "").trim(), `module-${manifestModule.id}-duration-mismatch`);
  add(String(module.format || "").trim() === String(manifestModule.format || "").trim(), `module-${manifestModule.id}-format-mismatch`);
  add(words(module.lessonNarrative) >= 1200, `module-${manifestModule.id}-narrative-below-1200`);
  add(Array.isArray(module.learningObjectives) && module.learningObjectives.length >= 6, `module-${manifestModule.id}-objectives-below-6`);
  add(Array.isArray(module.keyConcepts) && module.keyConcepts.length >= 6, `module-${manifestModule.id}-key-concepts-below-6`);
  add(words(module.executiveExample) >= 60, `module-${manifestModule.id}-executive-example-too-thin`);
  add(words(module.operationalExample) >= 60, `module-${manifestModule.id}-operational-example-too-thin`);
  add(words(module.scenario?.situation) >= 80, `module-${manifestModule.id}-scenario-too-thin`);
  add(words(module.scenario?.recommendedApproach) >= 80, `module-${manifestModule.id}-recommended-approach-too-thin`);
  add(words(module.scenario?.debrief) >= 80, `module-${manifestModule.id}-debrief-too-thin`);
  add(Boolean(module.exercise?.instructions) && Boolean(module.exercise?.deliverable) && Array.isArray(module.exercise?.rubric) && module.exercise.rubric.length > 0, `module-${manifestModule.id}-exercise-deficient`);
  add(Array.isArray(module.knowledgeChecks) && module.knowledgeChecks.length >= 4, `module-${manifestModule.id}-knowledge-checks-below-4`);
  add((module.knowledgeChecks || []).every((item) => Array.isArray(item.options) && item.options.length >= 3 && Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < item.options.length && words(item.rationale) >= 8), `module-${manifestModule.id}-knowledge-check-quality-deficiency`);
  add(Array.isArray(module.slideNarrative) && module.slideNarrative.length >= 10, `module-${manifestModule.id}-slides-below-10`);
  add((module.slideNarrative || []).every((slide) => Boolean(slide.title) && Array.isArray(slide.content) && slide.content.length > 0 && Boolean(slide.speakerNotes) && Boolean(slide.visualDirection)), `module-${manifestModule.id}-slide-quality-deficiency`);
  add(Array.isArray(module.referenceApplications) && module.referenceApplications.length >= 3, `module-${manifestModule.id}-reference-applications-below-3`);
  add(Array.isArray(module.videoScript?.scenes) && module.videoScript.scenes.length >= 8, `module-${manifestModule.id}-video-scenes-below-8`);
  add((module.videoScript?.scenes || []).every((scene) => words(scene.narration) >= 20 && Boolean(scene.visual || scene.altDescription) && Array.isArray(scene.sourceIds) && scene.sourceIds.length > 0), `module-${manifestModule.id}-video-scene-quality-deficiency`);
  add(Array.isArray(module.accessibilityNotes) && module.accessibilityNotes.length >= 4, `module-${manifestModule.id}-accessibility-notes-below-4`);
}

const assessment = Array.isArray(content.finalAssessment) ? content.finalAssessment : [];
const requiredQuestions = requiredFinalAssessmentQuestions(manifest);
add(assessment.length >= requiredQuestions, `assessment-${assessment.length}-minimum-${requiredQuestions}`);
add(assessment.every((item) => Array.isArray(item.options) && item.options.length >= 3 && Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < item.options.length && Array.isArray(item.sourceIds) && item.sourceIds.length > 0 && words(item.rationale) >= 10 && Boolean(item.moduleId)), "assessment-quality-deficiency");
add(Array.isArray(content.learnerWorkbook) && content.learnerWorkbook.length === manifestModules.length, "learner-workbook-coverage-deficiency");
add(Boolean(content.instructorGuide) && Array.isArray(content.instructorGuide.facilitationNotes) && content.instructorGuide.facilitationNotes.length > 0, "instructor-guide-deficiency");
add(Boolean(content.certificatePackage) && content.certificatePackage.isProfessionalCertification === false && content.certificatePackage.isComplianceEvidence === false, "certificate-boundary-deficiency");
add(Boolean(content.accessibilityPlan), "missing-accessibility-plan");
add(Boolean(content.rightsAndLicensingPlan), "missing-rights-plan");

const report = { schemaVersion: "1.0", generatedAt: new Date().toISOString(), courseId, passed: findings.length === 0, findings };
const output = path.join(courseDir, "generated", "quality", "deterministic-local-course-gate.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Deterministic local course gate ${report.passed ? "PASSED" : "FAILED"} for ${courseId} with ${findings.length} finding(s).`);
if (!report.passed) {
  for (const finding of findings.slice(0, 100)) console.error(`[Academy Studio] ${courseId}: ${finding}`);
  process.exit(2);
}
