import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, content);
  return true;
}

function moduleManuscript(course, module, index) {
  return `## Module ${index + 1}: ${module.title}\n\n**Duration:** ${module.duration}\n\n**Format:** ${module.format}\n\n### Purpose\n\n${module.description}\n\n### Learning objective\n\nBy the end of this module, the learner will be able to apply ${module.title.toLowerCase()} to a realistic organizational decision.\n\n### Instructor narrative\n\nOpen with the business context and explain why the subject matters to the learner's role. Define the relevant terms, identify the evidence required for a defensible decision, and distinguish verified facts from assumptions. Explain the control expectations, decision authority, escalation path, and documentation standard. Use an industry-neutral example before moving into the applied scenario.\n\n### Applied scenario\n\nPresent a realistic situation involving incomplete information, competing priorities, and a time-sensitive decision. Require the learner to identify the decision owner, evidence gaps, affected stakeholders, relevant policy or control requirements, and the safest proportionate next action.\n\n### Knowledge check\n\n1. What evidence is required before action?\n2. Who owns the decision and who must be consulted?\n3. What control or policy requirement applies?\n4. What should be documented for accountability?\n\n### Module completion evidence\n\nThe learner records a concise decision statement, supporting evidence, selected action, escalation path, and expected outcome.\n`;
}

function buildManuscript(manifest) {
  const course = manifest.course;
  return `# ${course.title}\n\n## Instructor Manuscript\n\n**Department:** ${course.department}\n\n**Track:** ${course.track}\n\n**Level:** ${course.level}\n\n**Audience:** ${course.audience}\n\n**Course length:** ${course.duration}\n\n## Course description\n\n${course.description}\n\n## Learning outcomes\n\n${course.outcomes.map((item) => `- ${item}`).join("\n")}\n\n## Instructional approach\n\nThis course uses evidence-based explanation, decision scenarios, practical exercises, knowledge checks, and a final assessment. Content must be reviewed for technical accuracy, accessibility, brand consistency, and defensible claims before commercial release.\n\n${course.modules.map((module, index) => moduleManuscript(course, module, index)).join("\n")}\n\n## Final assessment preparation\n\nReview the course outcomes, decision frameworks, control expectations, escalation requirements, and documentation practices. The final assessment requires a score of ${manifest.completion.passingScore} percent or higher.\n`;
}

function buildLearnerGuide(manifest) {
  const course = manifest.course;
  return `# ${course.title}\n\n## Learner Guide\n\n**Length:** ${course.duration}\n\n**Audience:** ${course.audience}\n\n## Description\n\n${course.description}\n\n## Outcomes\n\n${course.outcomes.map((item) => `- ${item}`).join("\n")}\n\n## Course map\n\n${course.modules.map((module, index) => `${index + 1}. **${module.title}**. ${module.duration}. ${module.description}`).join("\n")}\n\n## Completion requirements\n\n- Complete every module.\n- Complete all required activities.\n- Achieve ${manifest.completion.passingScore} percent or higher on the final assessment.\n- Maintain an authenticated learner record.\n\n## Access and certificate\n\nEnrollment is a one-time purchase. Access remains active until completion. After successful completion, the platform retains the learner transcript and certificate record.\n`;
}

function buildWorkbook(manifest) {
  const course = manifest.course;
  return `# ${course.title}\n\n## Learner Workbook\n\n${course.modules.map((module, index) => `## Module ${index + 1}: ${module.title}\n\n1. What is the decision or problem?\n2. What facts are verified?\n3. What information is missing?\n4. Which stakeholders are affected?\n5. Which policies, controls, laws, or standards apply?\n6. Who has decision authority?\n7. What is the proportionate next action?\n8. What evidence will demonstrate completion?\n9. What outcome should be measured?\n\n`).join("\n")}## Final action plan\n\nSummarize the three practices you will apply within 30 days, the accountable owner for each action, the evidence that will confirm completion, and the expected organizational benefit.\n`;
}

function buildAssessment(manifest) {
  const course = manifest.course;
  const questions = [];
  let number = 1;
  for (const [moduleIndex, module] of course.modules.entries()) {
    const stems = [
      `Which action best demonstrates accountable application of ${module.title}?`,
      `What should be established first when evaluating a decision related to ${module.title}?`,
      `Which record provides the strongest evidence that ${module.title} was handled appropriately?`,
      `When information is incomplete during ${module.title}, what is the most defensible response?`,
      `Who should own the final decision involving ${module.title}?`,
    ];
    for (const stem of stems) {
      questions.push({
        id: `q${String(number).padStart(2, "0")}`,
        moduleId: module.id,
        moduleIndex,
        type: "single-choice",
        question: stem,
        options: [
          "Use verified evidence, defined authority, proportionate action, and documented rationale.",
          "Act immediately without documenting assumptions.",
          "Delegate accountability without confirming ownership.",
          "Select the most convenient action regardless of policy or impact.",
        ],
        correctOption: 0,
        rationale: "The correct response combines evidence, authority, proportionality, and traceable documentation.",
      });
      number += 1;
    }
  }
  return { courseId: course.id, passingScore: manifest.completion.passingScore, questions };
}

function buildVisualBrief(manifest) {
  const course = manifest.course;
  return `# Visual Production Brief: ${course.title}\n\n## Brand direction\n\nUse the official Obserra black, dark navy, gold, and restrained holographic blue visual system. Use the official Obserra logo. Avoid generic stock imagery that implies unsupported operational claims.\n\n## Course length\n\n${course.duration}\n\n## Required visuals\n\n${course.modules.map((module, index) => `- Module ${index + 1}: one opening title visual, one explanatory diagram, one scenario visual, and one decision-summary visual for **${module.title}**.`).join("\n")}\n\n## Video requirements\n\n- 16:9 1080p master.\n- Professional narration.\n- Closed captions and transcript.\n- On-screen source attribution when external standards or public data are referenced.\n- No asset moves to FINAL until accessibility, brand, technical, and subject-matter reviews are approved.\n`;
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
  const assessment = buildAssessment(manifest);
  const created = [];
  if (writeIfMissing(path.join(courseDir, "instructor-manuscript.md"), buildManuscript(manifest))) created.push("instructor-manuscript.md");
  if (writeIfMissing(path.join(courseDir, "learner-guide.md"), buildLearnerGuide(manifest))) created.push("learner-guide.md");
  if (writeIfMissing(path.join(courseDir, "workbook.md"), buildWorkbook(manifest))) created.push("workbook.md");
  if (writeIfMissing(path.join(courseDir, "assessment-bank.json"), `${JSON.stringify(assessment, null, 2)}\n`)) created.push("assessment-bank.json");
  if (writeIfMissing(path.join(courseDir, "answer-key.json"), `${JSON.stringify({ courseId: manifest.course.id, answers: Object.fromEntries(assessment.questions.map((q) => [q.id, q.correctOption])) }, null, 2)}\n`)) created.push("answer-key.json");
  if (writeIfMissing(path.join(courseDir, "visual-brief.md"), buildVisualBrief(manifest))) created.push("visual-brief.md");
  results.push({ courseId: manifest.course.id, created, status: created.length ? "draft-assets-created" : "preserved-existing" });
}

const reportPath = path.join(root, "catalog", "bulk-build-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), courses: results }, null, 2)}\n`);
console.log(`[Academy Studio] Built or preserved draft assets for ${results.length} course(s)`);
