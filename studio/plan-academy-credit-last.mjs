import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");
const expectedCourses = Number(process.env.ACADEMY_EXPECTED_SURGE_COURSES || 61);

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function fileState(courseDir, manifest) {
  const researchPath = path.join(courseDir, "generated", "research", "authoritative-source-research.json");
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  const reviewPath = path.join(courseDir, "generated", "quality", "independent-course-quality-review.json");
  const research = readJson(researchPath);
  const authored = readJson(packagePath);
  const review = readJson(reviewPath);
  const manifestHash = hash(manifest);

  const researchReusable = Boolean(
    research?.passed === true &&
    research?.manifestHash === manifestHash &&
    Array.isArray(research?.unresolvedTopics) && research.unresolvedTopics.length === 0
  );

  const packageReusable = Boolean(
    authored?.schemaVersion === "2.0" &&
    authored?.courseId === manifest.course?.id &&
    authored?.publicationAuthorized === false &&
    authored?.content && typeof authored.content === "object"
  );

  const reviewReusable = Boolean(
    review?.passed === true &&
    review?.courseId === manifest.course?.id &&
    review?.review &&
    review.review.passed === true &&
    Object.values(review.review.scores || {}).length >= 8 &&
    Object.values(review.review.scores || {}).every((score) => Number.isInteger(score) && score >= 90)
  );

  return {
    researchReusable,
    packageReusable,
    reviewReusable,
    needsResearch: !researchReusable,
    needsAuthoring: !packageReusable,
    needsReview: !reviewReusable,
  };
}

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .filter((courseId) => {
    const manifest = readJson(path.join(coursesRoot, courseId, "course-manifest.json"));
    return manifest && !["retired", "archived"].includes(String(manifest.release?.status || "draft").toLowerCase());
  })
  .sort();

if (courseIds.length !== expectedCourses) {
  throw new Error(`Credit-last planner expected ${expectedCourses} active courses; discovered ${courseIds.length}.`);
}

const courses = courseIds.map((courseId) => {
  const courseDir = path.join(coursesRoot, courseId);
  const manifest = readJson(path.join(courseDir, "course-manifest.json"));
  return { courseId, ...fileState(courseDir, manifest) };
});

const plan = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  objective: "exhaust-no-model-credit-channels-before-paid-model-work",
  expectedCourses,
  logicalWorkers: 36,
  paidConcurrency: {
    research: Number(process.env.ACADEMY_PAID_RESEARCH_CONCURRENCY || 4),
    authoring: Number(process.env.ACADEMY_PAID_AUTHORING_CONCURRENCY || 4),
    review: Number(process.env.ACADEMY_PAID_REVIEW_CONCURRENCY || 2),
  },
  reuseCounts: {
    research: courses.filter((item) => item.researchReusable).length,
    authoring: courses.filter((item) => item.packageReusable).length,
    review: courses.filter((item) => item.reviewReusable).length,
  },
  paidNeedCounts: {
    research: courses.filter((item) => item.needsResearch).length,
    authoring: courses.filter((item) => item.needsAuthoring).length,
    review: courses.filter((item) => item.needsReview).length,
  },
  paidModelRequired: courses.some((item) => item.needsResearch || item.needsAuthoring || item.needsReview),
  courses,
};

fs.mkdirSync(catalogRoot, { recursive: true });
fs.writeFileSync(path.join(catalogRoot, "academy-credit-last-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `ACADEMY_PAID_MODEL_REQUIRED=${plan.paidModelRequired ? "true" : "false"}\n`);
  fs.appendFileSync(process.env.GITHUB_ENV, `ACADEMY_RESEARCH_CONCURRENCY=${plan.paidConcurrency.research}\n`);
  fs.appendFileSync(process.env.GITHUB_ENV, `ACADEMY_AUTHORING_CONCURRENCY=${plan.paidConcurrency.authoring}\n`);
  fs.appendFileSync(process.env.GITHUB_ENV, `ACADEMY_REVIEW_CONCURRENCY=${plan.paidConcurrency.review}\n`);
}

console.log(`[Academy Studio] Credit-last plan: reusable research ${plan.reuseCounts.research}/${expectedCourses}, authored ${plan.reuseCounts.authoring}/${expectedCourses}, reviews ${plan.reuseCounts.review}/${expectedCourses}.`);
console.log(`[Academy Studio] Paid work remaining: research ${plan.paidNeedCounts.research}, authoring ${plan.paidNeedCounts.authoring}, review ${plan.paidNeedCounts.review}.`);
console.log(`[Academy Studio] Paid concurrency caps: research ${plan.paidConcurrency.research}, authoring ${plan.paidConcurrency.authoring}, review ${plan.paidConcurrency.review}.`);
