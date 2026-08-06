import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourcePath = process.env.OBSERRA_WEBSITE_COURSE_DATA || process.argv[2];
if (!sourcePath) {
  console.error("Usage: node studio/import-website-courses.mjs <path-to-courseData.ts>");
  process.exit(1);
}

const source = fs.readFileSync(path.resolve(sourcePath), "utf8");
const specPattern = /\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\]/g;
const prices = { Foundation: 149, Professional: 249, Advanced: 349, "Executive Intensive": 499, "CISO Masterclass": 699 };
const durations = { Foundation: "2.5 hours", Professional: "4.5 hours", Advanced: "7 hours", "Executive Intensive": "9 hours", "CISO Masterclass": "11 hours" };
const audiences = {
  Cyber: "Security leaders, technology teams, risk owners, and business decision makers",
  Protection: "Corporate security teams, executive support personnel, and protection professionals",
  Intelligence: "Leaders, analysts, investigators, and operational decision makers",
  Technologies: "Technology leaders, product owners, architects, and transformation teams",
};
const minutes = {
  Foundation: [24, 26, 28, 30, 42],
  Professional: [38, 44, 48, 54, 56],
  Advanced: [60, 72, 78, 84, 126],
  "Executive Intensive": [84, 96, 102, 114, 144],
  "CISO Masterclass": [108, 120, 132, 144, 156],
};
const phases = ["Decision context", "Evidence and risk", "Control and authority", "Scenario practice", "Action and improvement"];

const imported = [];
for (const match of source.matchAll(specPattern)) {
  const [, id, title, level, department, track, focus] = match;
  const courseDir = path.join(root, "courses", id);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (fs.existsSync(manifestPath)) {
    imported.push({ id, status: "preserved-existing" });
    continue;
  }

  fs.mkdirSync(courseDir, { recursive: true });
  const modules = phases.map((phase, index) => ({
    id: `${phase.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
    title: `${phase}: ${index === 0 ? title : focus}`,
    duration: `${minutes[level][index]} min`,
    format: index === 3 ? "Scenario" : index === 4 ? "Workshop" : "Interactive lesson",
    description: `Original Obserra Academy instruction on ${focus}. Learners evaluate context, evidence, trade-offs, and an accountable next action.`,
  }));

  const manifest = {
    schemaVersion: "1.0",
    course: {
      id,
      title,
      department,
      level,
      track,
      audience: audiences[department],
      description: `An original Obserra Academy ${level.toLowerCase()} course focused on ${focus}. It uses practical decision scenarios, knowledge checks, and accountable application rather than third-party certification material.`,
      duration: durations[level],
      prerequisites: [],
      outcomes: [
        `Frame ${focus} in business context.`,
        "Evaluate evidence and uncertainty before acting.",
        "Apply policy, authority, and proportionate escalation.",
        "Document a defensible next action.",
      ],
      modules,
    },
    commerce: {
      model: "one-time-payment",
      currency: "USD",
      price: prices[level],
      stripePriceId: null,
      paymentLink: null,
      accessPolicy: "until-completion",
    },
    completion: {
      allLessonsRequired: true,
      assessmentRequired: true,
      passingScore: 80,
      certificateIssued: true,
    },
    release: {
      version: "0.1.0",
      status: "draft",
      publishToAcademy: false,
      effectiveDate: null,
    },
    reviews: {
      subjectMatter: { required: true, status: "not-started", reviewedBy: null, reviewedAt: null, notes: null },
      technical: { required: true, status: "not-started", reviewedBy: null, reviewedAt: null, notes: null },
      legal: { required: false, status: "not-applicable", reviewedBy: null, reviewedAt: null, notes: null },
      brand: { required: true, status: "not-started", reviewedBy: null, reviewedAt: null, notes: null },
      accessibility: { required: true, status: "not-started", reviewedBy: null, reviewedAt: null, notes: null },
    },
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(courseDir, "production-queue.json"), `${JSON.stringify({
    courseId: id,
    source: "obserra-website/app/academy/courseData.ts",
    requiredArtifacts: [
      "instructor-manuscript.md",
      "learner-guide.md",
      "workbook.md",
      "assessment-bank.json",
      "answer-key.json",
      "slide-deck",
      "visual-brief",
      "training-video",
      "captions",
    ],
    status: "queued",
    queuedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  imported.push({ id, status: "created" });
}

const summaryPath = path.join(root, "catalog", "website-import-summary.json");
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify({ importedAt: new Date().toISOString(), sourcePath: path.resolve(sourcePath), courses: imported }, null, 2)}\n`);
console.log(`[Academy Studio] Processed ${imported.length} website course offering(s)`);
