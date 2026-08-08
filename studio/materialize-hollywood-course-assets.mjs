import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const legalName = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";
const proprietaryNotice = "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const requestedCourseId = arg("--course");
const portfolio = academySurgePortfolio();
const targets = requestedCourseId
  ? portfolio.selectedCourses.filter((course) => course.courseId === requestedCourseId)
  : portfolio.selectedCourses;

if (requestedCourseId && targets.length !== 1) {
  throw new Error(`Course ${requestedCourseId} is not part of the exact 60-course Academy surge portfolio.`);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, value, { encoding: "utf8", mode: 0o600 });
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function markdownList(values) {
  return (values ?? []).map((value) => `- ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n");
}

function disclaimerMarkdown(manifest) {
  return `> **${legalName}**  
> **${proprietaryNotice}**  
> ${manifest.disclaimer?.shortText ?? "For educational and informational purposes only."}\n\n`;
}

function sourceCitation(source) {
  const date = source.publicationDate || source.observedAt || "date requires verification";
  return `${source.title}. ${source.issuingAuthority}. ${source.locator}. ${date}.`;
}

function moduleInstructorMarkdown(module, sourceMap) {
  const checks = (module.knowledgeChecks ?? []).map((question, index) => {
    const options = (question.options ?? []).map((option, optionIndex) => `   ${String.fromCharCode(65 + optionIndex)}. ${option}`).join("\n");
    return `### Knowledge check ${index + 1}\n\n${question.question}\n\n${options}\n\n**Correct answer:** ${String.fromCharCode(65 + question.correctIndex)}  
**Rationale:** ${question.rationale}\n\n**Applicability:** ${question.applicabilityContext || "Apply only after organization-specific verification."}\n\n**Sources:** ${(question.sourceIds ?? []).map((id) => sourceMap.get(id) ? sourceCitation(sourceMap.get(id)) : `${id} requires verification`).join("; ")}`;
  }).join("\n\n");

  return `## ${module.title}\n\n**Duration:** ${module.duration}\n\n**Format:** ${module.format}\n\n### Learning objectives\n\n${markdownList(module.learningObjectives)}\n\n### Opening context\n\n${module.openingContext}\n\n### Lesson narrative\n\n${module.lessonNarrative}\n\n### Key concepts\n\n${(module.keyConcepts ?? []).map((concept) => `#### ${concept.term}\n\n${concept.explanation}\n\n**Applicability:** ${concept.applicabilityNote || "Validate in the learner's operating context."}\n\n**Sources:** ${(concept.sourceIds ?? []).join(", ") || "verification required"}`).join("\n\n")}\n\n### Executive example\n\n${module.executiveExample}\n\n### Operational example\n\n${module.operationalExample}\n\n### Applied scenario\n\n**Situation:** ${module.scenario?.situation ?? ""}\n\n**Evidence:**\n\n${markdownList(module.scenario?.evidence)}\n\n**Decision prompt:** ${module.scenario?.decisionPrompt ?? ""}\n\n**Recommended approach:** ${module.scenario?.recommendedApproach ?? ""}\n\n**Debrief:** ${module.scenario?.debrief ?? ""}\n\n### Applied exercise\n\n${module.exercise?.instructions ?? ""}\n\n**Required deliverable:** ${module.exercise?.deliverable ?? ""}\n\n**Rubric:**\n\n${markdownList(module.exercise?.rubric)}\n\n### Reference applications\n\n${(module.referenceApplications ?? []).map((application) => `- **${application.claimOrConcept}:** Apply when ${(application.appliesWhen ?? []).join("; ")}. Do not apply when ${(application.doesNotApplyWhen ?? []).join("; ")}. Limitations: ${(application.limitations ?? []).join("; ")}. Learner action: ${application.learnerAction}. Sources: ${(application.sourceIds ?? []).join(", ")}.`).join("\n")}\n\n${checks}`;
}

function moduleLearnerMarkdown(module) {
  const checks = (module.knowledgeChecks ?? []).map((question, index) => {
    const options = (question.options ?? []).map((option, optionIndex) => `   ${String.fromCharCode(65 + optionIndex)}. ${option}`).join("\n");
    return `### Knowledge check ${index + 1}\n\n${question.question}\n\n${options}`;
  }).join("\n\n");

  return `## ${module.title}\n\n### Learning objectives\n\n${markdownList(module.learningObjectives)}\n\n### Opening context\n\n${module.openingContext}\n\n### Lesson\n\n${module.lessonNarrative}\n\n### Key concepts\n\n${(module.keyConcepts ?? []).map((concept) => `- **${concept.term}:** ${concept.explanation}`).join("\n")}\n\n### Executive example\n\n${module.executiveExample}\n\n### Operational example\n\n${module.operationalExample}\n\n### Scenario\n\n${module.scenario?.situation ?? ""}\n\n**Decision prompt:** ${module.scenario?.decisionPrompt ?? ""}\n\n### Exercise\n\n${module.exercise?.instructions ?? ""}\n\n**Deliverable:** ${module.exercise?.deliverable ?? ""}\n\n${checks}`;
}

function certificateHtml(manifest, content) {
  const title = content.certificatePackage?.title || "Certificate of Course Completion";
  const disclaimer = content.certificatePackage?.disclaimer || "This document records course completion only. It is not professional certification, licensure, accreditation, compliance validation, regulatory approval, or professional qualification.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
@page { size: landscape; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: #04070d; color: #f7f4ea; font-family: Georgia, "Times New Roman", serif; }
.certificate { width: 11in; height: 8.5in; margin: 0 auto; padding: .55in; border: .08in solid #c9a34d; position: relative; background: radial-gradient(circle at top, #10213a 0, #070d18 50%, #03050a 100%); }
.inner { height: 100%; border: .02in solid #e7cc85; padding: .5in; text-align: center; display: flex; flex-direction: column; justify-content: center; }
.brand { letter-spacing: .2em; color: #e7cc85; font-family: Arial, sans-serif; font-size: 14px; }
h1 { font-size: 34px; margin: 24px 0 10px; color: #ffffff; }
.awarded { font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: .12em; font-size: 12px; color: #cbd6e8; }
.learner { font-size: 36px; color: #e7cc85; margin: 20px 0; border-bottom: 1px solid #c9a34d; padding-bottom: 10px; }
.course { font-size: 25px; margin: 14px auto; max-width: 8.5in; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 28px; font-family: Arial, sans-serif; font-size: 12px; }
.meta strong { display: block; color: #e7cc85; margin-bottom: 6px; }
.disclaimer { font-family: Arial, sans-serif; font-size: 9px; line-height: 1.35; margin-top: 28px; color: #b8c2d1; }
.notice { position: absolute; bottom: .15in; left: .3in; right: .3in; font: 8px Arial, sans-serif; letter-spacing: .08em; color: #8896aa; }
</style>
</head>
<body>
<main class="certificate" role="document" aria-label="Certificate of Course Completion">
  <section class="inner">
    <div class="brand">OBSERRA ACADEMY</div>
    <h1>${title}</h1>
    <div class="awarded">This completion record is awarded to</div>
    <div class="learner">{{LEARNER_NAME}}</div>
    <div class="awarded">for completing</div>
    <div class="course">${manifest.course.title}</div>
    <div class="meta">
      <div><strong>Completion date</strong>{{COMPLETION_DATE}}</div>
      <div><strong>Certificate ID</strong>{{CERTIFICATE_ID}}</div>
      <div><strong>Final score</strong>{{FINAL_SCORE}}</div>
    </div>
    <p class="disclaimer">${disclaimer}</p>
  </section>
  <div class="notice">Issued by ${legalName}. ${proprietaryNotice}</div>
</main>
</body>
</html>
`;
}

function certificateSvg(manifest, content) {
  const title = content.certificatePackage?.title || "Certificate of Course Completion";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1584" height="1224" viewBox="0 0 1584 1224" role="img" aria-labelledby="title desc">
<title id="title">${title}</title>
<desc id="desc">Obserra Academy certificate template for ${manifest.course.title}, including learner name, completion date, certificate identifier, and final score placeholders.</desc>
<rect width="1584" height="1224" fill="#04070d"/>
<rect x="48" y="48" width="1488" height="1128" fill="#091324" stroke="#c9a34d" stroke-width="12"/>
<rect x="84" y="84" width="1416" height="1056" fill="none" stroke="#e7cc85" stroke-width="3"/>
<text x="792" y="190" text-anchor="middle" fill="#e7cc85" font-family="Arial" font-size="26" letter-spacing="8">OBSERRA ACADEMY</text>
<text x="792" y="300" text-anchor="middle" fill="#ffffff" font-family="Georgia" font-size="58">${title}</text>
<text x="792" y="380" text-anchor="middle" fill="#cbd6e8" font-family="Arial" font-size="22">THIS COMPLETION RECORD IS AWARDED TO</text>
<text x="792" y="500" text-anchor="middle" fill="#e7cc85" font-family="Georgia" font-size="64">{{LEARNER_NAME}}</text>
<line x1="340" y1="535" x2="1244" y2="535" stroke="#c9a34d" stroke-width="2"/>
<text x="792" y="610" text-anchor="middle" fill="#cbd6e8" font-family="Arial" font-size="22">FOR COMPLETING</text>
<text x="792" y="700" text-anchor="middle" fill="#ffffff" font-family="Georgia" font-size="42">${manifest.course.title}</text>
<text x="300" y="850" text-anchor="middle" fill="#e7cc85" font-family="Arial" font-size="20">COMPLETION DATE</text>
<text x="300" y="895" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="22">{{COMPLETION_DATE}}</text>
<text x="792" y="850" text-anchor="middle" fill="#e7cc85" font-family="Arial" font-size="20">CERTIFICATE ID</text>
<text x="792" y="895" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="22">{{CERTIFICATE_ID}}</text>
<text x="1284" y="850" text-anchor="middle" fill="#e7cc85" font-family="Arial" font-size="20">FINAL SCORE</text>
<text x="1284" y="895" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="22">{{FINAL_SCORE}}</text>
<text x="792" y="1015" text-anchor="middle" fill="#b8c2d1" font-family="Arial" font-size="15">Certificate of course completion only. Not professional certification, licensure, accreditation, compliance validation, or regulatory approval.</text>
<text x="792" y="1105" text-anchor="middle" fill="#8896aa" font-family="Arial" font-size="13">Issued by ${legalName}. ${proprietaryNotice}</text>
</svg>
`;
}

function materialize(item) {
  const packagePath = path.join(item.courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(packagePath)) throw new Error(`Cinematic course package is missing for ${item.courseId}.`);
  const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (envelope.schemaVersion !== "2.0" || envelope.productionStandard !== "premium-documentary-cinematic") {
    throw new Error(`Cinematic package contract mismatch for ${item.courseId}.`);
  }
  const manifest = item.manifest;
  const content = envelope.content ?? {};
  const outputDir = path.join(item.courseDir, "generated", "production-stage");
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const sourceMap = new Map((content.sourceRegister ?? []).map((source) => [source.id, source]));
  const header = `${disclaimerMarkdown(manifest)}# ${manifest.course.title}\n\n`;

  const instructor = `${header}## Instructor Manuscript\n\n**Course level:** ${manifest.course.level}\n\n**Audience:** ${manifest.course.audience}\n\n**Duration:** ${manifest.course.duration}\n\n## Executive value\n\n${content.courseSummary?.executiveValue ?? ""}\n\n## Instructional strategy\n\n${content.courseSummary?.instructionalStrategy ?? ""}\n\n${(content.modules ?? []).map((module) => moduleInstructorMarkdown(module, sourceMap)).join("\n\n")}\n\n## Source register\n\n${(content.sourceRegister ?? []).map((source) => `- **${source.id}:** ${sourceCitation(source)} Applicability: ${source.applicability}. Applies when ${(source.appliesWhen ?? []).join("; ")}. Does not apply when ${(source.doesNotApplyWhen ?? []).join("; ")}. Limitations: ${(source.limitations ?? []).join("; ")}. Verification: ${source.verificationStatus}.`).join("\n")}\n`;
  writeText(path.join(outputDir, "instructor-manuscript.md"), instructor);

  const learner = `${header}## Learner Guide\n\n## Course description\n\n${manifest.course.description}\n\n## Learning outcomes\n\n${markdownList(manifest.course.outcomes)}\n\n${(content.modules ?? []).map(moduleLearnerMarkdown).join("\n\n")}\n\n## Completion requirements\n\nComplete every required lesson and activity and achieve at least ${manifest.completion.passingScore} percent on the governed final assessment. The resulting credential is a certificate of course completion only.\n`;
  writeText(path.join(outputDir, "learner-guide.md"), learner);

  const workbook = `${header}## Learner Workbook\n\n${(content.learnerWorkbook ?? []).map((entry) => `## ${entry.moduleId}\n\n### Reflection prompts\n\n${markdownList(entry.reflectionPrompts)}\n\n### Decision worksheet\n\n${markdownList(entry.decisionWorksheet)}\n\n### Source application prompts\n\n${markdownList(entry.sourceApplicationPrompts)}`).join("\n\n")}\n`;
  writeText(path.join(outputDir, "learner-workbook.md"), workbook);

  const assessmentBank = {
    schemaVersion: "2.0",
    courseId: item.courseId,
    passingScore: manifest.completion.passingScore,
    assessmentBlueprint: content.assessmentBlueprint,
    questions: (content.finalAssessment ?? []).map(({ correctIndex, rationale, ...question }) => question),
    protectedAnswerDataExcluded: true,
  };
  const answerKey = {
    schemaVersion: "2.0",
    courseId: item.courseId,
    proprietaryNotice,
    answers: (content.finalAssessment ?? []).map((question, index) => ({
      questionNumber: index + 1,
      moduleId: question.moduleId,
      correctIndex: question.correctIndex,
      rationale: question.rationale,
      sourceIds: question.sourceIds,
      applicabilityContext: question.applicabilityContext,
    })),
  };
  writeJson(path.join(outputDir, "assessment-bank.json"), assessmentBank);
  writeJson(path.join(outputDir, "answer-key.json"), answerKey);
  writeJson(path.join(outputDir, "source-register.json"), { schemaVersion: "1.0", courseId: item.courseId, sources: content.sourceRegister ?? [] });
  writeJson(path.join(outputDir, "applicability-matrix.json"), { schemaVersion: "1.0", courseId: item.courseId, entries: content.applicabilityMatrix ?? [] });
  writeJson(path.join(outputDir, "framework-alignment.json"), { schemaVersion: "1.0", courseId: item.courseId, mappings: content.frameworkAlignment ?? [] });
  writeJson(path.join(outputDir, "media-production-plan.json"), content.mediaProductionPlan ?? {});
  writeJson(path.join(outputDir, "accessibility-plan.json"), content.accessibilityPlan ?? {});
  writeJson(path.join(outputDir, "rights-and-licensing-plan.json"), content.rightsAndLicensingPlan ?? {});
  writeJson(path.join(outputDir, "certificate", "certificate-policy.json"), content.certificatePackage ?? {});
  writeText(path.join(outputDir, "certificate", "certificate-template.html"), certificateHtml(manifest, content));
  writeText(path.join(outputDir, "certificate", "certificate-template.svg"), certificateSvg(manifest, content));
  writeJson(path.join(outputDir, "learner-experience.json"), {
    schemaVersion: "2.0",
    courseId: item.courseId,
    courseSummary: content.courseSummary,
    modules: content.modules,
    finalAssessment: content.finalAssessment,
    learnerWorkbook: content.learnerWorkbook,
    certificatePackage: content.certificatePackage,
    publicationAuthorized: false,
  });

  for (const module of content.modules ?? []) {
    const moduleDir = path.join(outputDir, "video", module.id);
    writeJson(path.join(moduleDir, "cinematic-treatment.json"), module.cinematicTreatment ?? {});
    writeJson(path.join(moduleDir, "production-script.json"), module.videoScript ?? {});
    writeJson(path.join(moduleDir, "slide-narrative.json"), module.slideNarrative ?? []);
    writeJson(path.join(moduleDir, "caption-script.json"), {
      status: "draft-timing-required-after-master-render",
      scenes: (module.videoScript?.scenes ?? []).map((scene) => ({ sceneId: scene.sceneId, captionText: scene.captionText })),
      captionPlan: module.videoScript?.captionPlan ?? [],
    });
    writeJson(path.join(moduleDir, "transcript-plan.json"), module.videoScript?.transcriptPlan ?? []);
    writeJson(path.join(moduleDir, "audio-description-plan.json"), module.videoScript?.audioDescriptionPlan ?? []);
    writeJson(path.join(moduleDir, "reduced-motion-alternative.json"), module.videoScript?.reducedMotionAlternative ?? []);
  }

  const files = [];
  const stack = [outputDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else {
        const relative = path.relative(outputDir, absolute).replaceAll("\\", "/");
        const buffer = fs.readFileSync(absolute);
        files.push({ path: relative, bytes: buffer.length, sha256: stableHash(buffer) });
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifestRecord = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    courseId: item.courseId,
    sourceManifestHash: envelope.sourceManifestHash,
    authoringPolicyVersion: envelope.authoringPolicyVersion,
    productionContractVersion: envelope.productionContractVersion,
    productionStandard: envelope.productionStandard,
    publicationAuthorized: false,
    artifactCount: files.length,
    files,
    releaseBlockers: [
      "independent-source-verification",
      "final-media-render-and-retrieval",
      "caption-timing-and-quality-control",
      "final-transcript-verification",
      "audio-description-or-approved-alternative",
      "rights-clearance",
      "assessment-review",
      "certificate-runtime-verification",
      "entitlement-and-security-testing",
      "required-reviews",
      "owner-acceptance",
    ],
  };
  writeJson(path.join(outputDir, "artifact-manifest.json"), manifestRecord);
  return { courseId: item.courseId, artifactCount: files.length + 1, outputDir: path.relative(root, outputDir).replaceAll("\\", "/") };
}

const results = targets.map(materialize);
const reportPath = path.join(root, "catalog", "academy-hollywood-materialization.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
writeJson(reportPath, {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  expectedCourses: requestedCourseId ? 1 : portfolio.expectedCourses,
  materializedCourses: results.length,
  publicationAuthorized: false,
  courses: results,
  claimBoundary: "Materialization creates protected learner, instructor, assessment, source, media-planning, accessibility, rights-planning, and certificate assets. It does not create final mastered media or authorize publication.",
});
console.log(`[Academy Studio] Materialized protected production-stage assets for ${results.length} course(s).`);
