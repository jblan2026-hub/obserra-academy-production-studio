const fs = require("node:fs");
const path = require("node:path");

require("./academy-course-review-runtime.cjs");

const { resolveStudioRoot } = require("./academy-studio.cjs");

function assertCourseId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(value)) throw new Error("Invalid course identifier");
  return value;
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function readJson(filePath) {
  const text = readText(filePath);
  return text ? JSON.parse(text) : null;
}

function previewCourse(courseId) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable");
  const id = assertCourseId(courseId);
  const courseRoot = path.join(root, "courses", id);
  const manifest = readJson(path.join(courseRoot, "course-manifest.json"));
  if (!manifest) throw new Error("Course manifest not found");
  const authored = readJson(path.join(courseRoot, "generated", "authoring", "course-package.json"));
  const content = authored?.content || null;
  return {
    type: "course",
    courseId: id,
    title: manifest.course.title,
    description: manifest.course.description,
    duration: manifest.course.duration,
    level: manifest.course.level,
    audience: manifest.course.audience,
    outcomes: manifest.course.outcomes || [],
    modules: content?.modules || manifest.course.modules || [],
    finalAssessmentCount: Array.isArray(content?.finalAssessment) ? content.finalAssessment.length : 0,
    source: authored ? "governed-ai-package" : "manifest-fallback",
    reviewStatus: authored?.reviewStatus || "not-generated",
    generatedAt: authored?.generatedAt || null
  };
}

function previewMaterials(courseId) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable");
  const id = assertCourseId(courseId);
  const courseRoot = path.join(root, "courses", id);
  const authored = readJson(path.join(courseRoot, "generated", "authoring", "course-package.json"));
  const content = authored?.content || {};
  return {
    type: "materials",
    courseId: id,
    learnerGuide: readText(path.join(courseRoot, "learner-guide.md")),
    workbook: readText(path.join(courseRoot, "workbook.md")),
    instructorManuscript: readText(path.join(courseRoot, "instructor-manuscript.md")),
    assessmentBank: readJson(path.join(courseRoot, "assessment-bank.json")) || content.finalAssessment || [],
    learnerWorkbook: content.learnerWorkbook || [],
    instructorGuide: content.instructorGuide || null,
    marketing: content.marketing || null,
    source: authored ? "governed-ai-package" : "release-assets"
  };
}

function previewCertificate(courseId) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable");
  const id = assertCourseId(courseId);
  const manifest = readJson(path.join(root, "courses", id, "course-manifest.json"));
  if (!manifest) throw new Error("Course manifest not found");
  const pattern = `OBS-${id.toUpperCase().replace(/[^A-Z0-9]+/g, "")}-PREVIEW`;
  return {
    type: "certificate",
    courseId: id,
    issuer: "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC",
    title: "Certificate of Course Completion",
    learnerName: "PREVIEW LEARNER",
    courseTitle: manifest.course.title,
    trainingHours: manifest.course.duration,
    completionDate: new Date().toISOString().slice(0, 10),
    certificateId: pattern,
    passingScore: manifest.completion?.passingScore || 80,
    disclaimer: "This is a preview of a proprietary course-completion record. It is not a license, accreditation, regulatory approval, or professional certification.",
    verificationRequired: true,
    branding: manifest.branding || null
  };
}

module.exports = { previewCourse, previewMaterials, previewCertificate };