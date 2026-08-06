import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const legalName = officialBrand.legalName;
const proprietaryNotice = officialBrand.ownership.defaultClassification;
const disclaimer = officialBrand.disclaimer;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeGenerated(filePath, content) {
  fs.writeFileSync(filePath, content);
}

function legalNoticeMarkdown() {
  return `## Important informational-use notice\n\n**${disclaimer.shortText}**\n\n${disclaimer.fullText}\n\n## Assumption of risk, release, and limitation of liability\n\n${disclaimer.releaseAndLimitationOfLiability}\n\n**Required acknowledgement:** ${disclaimer.acknowledgementText}\n`;
}

function brandHeader(manifest) {
  return `> **${legalName}**  \\n> **${proprietaryNotice}**  \\n> Official logo: \`${manifest.branding.logoAsset}\`  \\n> ${disclaimer.shortText}\n\n`;
}

function brandFooter() {
  return `\n---\n\n${disclaimer.shortText}\n\n© ${new Date().getUTCFullYear()} ${legalName}. All rights reserved. ${proprietaryNotice}\n`;
}

function moduleManuscript(module, index) {
  return `## Module ${index + 1}: ${module.title}\n\n**Duration:** ${module.duration}\n\n**Format:** ${module.format}\n\n### Purpose\n\n${module.description}\n\n### Learning objective\n\nBy the end of this module, the learner will be able to apply ${module.title.toLowerCase()} to a realistic organizational decision.\n\n### Instructor narrative\n\nExplain the business context, relevant terminology, evidence requirements, decision authority, escalation path, and documentation expectations. Clearly distinguish educational examples from legal, regulatory, compliance, certification, audit, or professional determinations.\n\n### Applied scenario\n\nPresent a realistic situation involving incomplete information, competing priorities, and a time-sensitive decision. Require the learner to identify the decision owner, evidence gaps, affected stakeholders, applicable requirements, and the safest proportionate next action.\n\n### Knowledge check\n\n1. What evidence is required before action?\n2. Who owns the decision and who must be consulted?\n3. Which authoritative requirement may apply?\n4. What should be documented for accountability?\n\n### Module completion evidence\n\nThe learner records a concise decision statement, supporting evidence, selected action, escalation path, and expected outcome. Completion is educational only and is not evidence of certification or compliance.\n`;
}

function buildManuscript(manifest) {
  const course = manifest.course;
  return `${brandHeader(manifest)}# ${course.title}\n\n## Instructor Manuscript\n\n${legalNoticeMarkdown()}\n\n**Department:** ${course.department}\n\n**Track:** ${course.track}\n\n**Level:** ${course.level}\n\n**Audience:** ${course.audience}\n\n**Course length:** ${course.duration}\n\n## Course description\n\n${course.description}\n\n## Learning outcomes\n\n${course.outcomes.map((item) => `- ${item}`).join("\n")}\n\n## Course tags\n\n${Object.entries(manifest.tags).map(([key, values]) => `- **${key}:** ${values.join(", ")}`).join("\n")}\n\n${course.modules.map((module, index) => moduleManuscript(module, index)).join("\n")}\n\n## Completion statement\n\nA passing score records course completion only. It is not professional certification, licensure, accreditation, compliance validation, regulatory approval, or an audit opinion.\n\n${legalNoticeMarkdown()}${brandFooter()}`;
}

function buildLearnerGuide(manifest) {
  const course = manifest.course;
  return `${brandHeader(manifest)}# ${course.title}\n\n## Learner Guide\n\n${legalNoticeMarkdown()}\n\n**Length:** ${course.duration}\n\n**Audience:** ${course.audience}\n\n## Description\n\n${course.description}\n\n## Outcomes\n\n${course.outcomes.map((item) => `- ${item}`).join("\n")}\n\n## Course map\n\n${course.modules.map((module, index) => `${index + 1}. **${module.title}**. ${module.duration}. ${module.description}`).join("\n")}\n\n## Completion requirements\n\n- Complete every module and required activity.\n- Achieve ${manifest.completion.passingScore} percent or higher on the final assessment.\n- Accept the informational-use disclaimer and limitation-of-liability terms.\n\n## Completion record\n\nAny issued document is a certificate of course completion only and does not represent certification, licensure, accreditation, compliance, regulatory approval, or professional qualification.\n\n${legalNoticeMarkdown()}${brandFooter()}`;
}

function buildWorkbook(manifest) {
  const course = manifest.course;
  return `${brandHeader(manifest)}# ${course.title}\n\n## Learner Workbook\n\n${legalNoticeMarkdown()}\n\n${course.modules.map((module, index) => `## Module ${index + 1}: ${module.title}\n\n1. What is the decision or problem?\n2. What facts are verified?\n3. What information is missing?\n4. Which stakeholders are affected?\n5. Which laws, standards, controls, or policies may apply?\n6. Who has decision authority?\n7. What is the proportionate next action?\n8. Which qualified professional or independent assessor should be consulted?\n9. What evidence will demonstrate completion?\n\n`).join("\n")}## Final action plan\n\nSummarize three educational practices to consider. Independently validate all legal, compliance, regulatory, technical, or professional decisions before implementation.\n\n${legalNoticeMarkdown()}${brandFooter()}`;
}

function buildAssessment(manifest) {
  const questions = [];
  let number = 1;
  for (const [moduleIndex, module] of manifest.course.modules.entries()) {
    for (const stem of [
      `Which action best demonstrates accountable application of ${module.title}?`,
      `What should be established first when evaluating a decision related to ${module.title}?`,
      `Which record provides the strongest evidence that ${module.title} was handled appropriately?`,
      `When information is incomplete during ${module.title}, what is the most defensible response?`,
      `Who should own the final decision involving ${module.title}?`,
    ]) {
      questions.push({ id: `q${String(number).padStart(2, "0")}`, moduleId: module.id, moduleIndex, type: "single-choice", question: stem, options: ["Use verified evidence, defined authority, proportionate action, qualified advice, and documented rationale.", "Act immediately without documenting assumptions.", "Treat course completion as proof of compliance or certification.", "Select the most convenient action regardless of policy or impact."], correctOption: 0, rationale: "Course content is informational only; defensible action requires verified evidence, authority, qualified judgment, and documentation." });
      number += 1;
    }
  }
  return {
    courseId: manifest.course.id,
    owner: legalName,
    logoAsset: manifest.branding.logoAsset,
    classification: proprietaryNotice,
    tags: manifest.tags,
    disclaimer,
    credentialType: "certificate-of-course-completion-only",
    passingScore: manifest.completion.passingScore,
    questions,
  };
}

function buildVisualBrief(manifest) {
  const course = manifest.course;
  return `${brandHeader(manifest)}# Visual Production Brief: ${course.title}\n\n${legalNoticeMarkdown()}\n\n## Mandatory brand direction\n\nUse only the owner-approved official Obserra logo at \`${manifest.branding.logoAsset}\` and the official black, dark navy, gold, light gold, restrained holographic blue, and white visual system. No generic substitute marks are permitted.\n\n## Mandatory legal display\n\n- Display \"${disclaimer.shortText}\" on the opening screen or course description.\n- Include the complete disclaimer and liability language in course details or linked terms.\n- Never describe the course as certification, compliance validation, accreditation, regulatory approval, or professional qualification.\n- Any completion document must state \"Certificate of Course Completion Only.\"\n\n## Required visuals\n\n${course.modules.map((module, index) => `- Module ${index + 1}: branded opening visual, explanatory diagram, scenario visual, and decision-summary visual for **${module.title}**.`).join("\n")}\n\n## Video requirements\n\n- Official Obserra branded opening and closing frames.\n- 16:9 1080p master, captions, transcript, and source attribution.\n- Persistent internal-review watermark before approved public release.\n- No asset advances without brand, accessibility, technical, subject-matter, and legal-content review.\n\n${legalNoticeMarkdown()}${brandFooter()}`;
}

if (!fs.existsSync(coursesRoot)) {
  console.error(`[Academy Studio] Courses directory not found: ${coursesRoot}`);
  process.exit(1);
}

const results = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  assertBrandAndTags(manifest, manifestPath);
  const assessment = buildAssessment(manifest);
  writeGenerated(path.join(courseDir, "instructor-manuscript.md"), buildManuscript(manifest));
  writeGenerated(path.join(courseDir, "learner-guide.md"), buildLearnerGuide(manifest));
  writeGenerated(path.join(courseDir, "workbook.md"), buildWorkbook(manifest));
  writeGenerated(path.join(courseDir, "assessment-bank.json"), `${JSON.stringify(assessment, null, 2)}\n`);
  writeGenerated(path.join(courseDir, "answer-key.json"), `${JSON.stringify({ courseId: manifest.course.id, owner: legalName, logoAsset: manifest.branding.logoAsset, classification: proprietaryNotice, tags: manifest.tags, disclaimer, credentialType: "certificate-of-course-completion-only", answers: Object.fromEntries(assessment.questions.map((question) => [question.id, question.correctOption])) }, null, 2)}\n`);
  writeGenerated(path.join(courseDir, "visual-brief.md"), buildVisualBrief(manifest));
  results.push({ courseId: manifest.course.id, status: "governed-assets-regenerated", officialBrand: true, disclaimerEmbedded: true, tags: manifest.tags });
}

const reportPath = path.join(root, "catalog", "bulk-build-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), owner: legalName, logoAsset: officialBrand.officialLogo.assetPath, classification: proprietaryNotice, disclaimer, courses: results }, null, 2)}\n`);
console.log(`[Academy Studio] Regenerated governed assets for ${results.length} officially branded and tagged course(s).`);
