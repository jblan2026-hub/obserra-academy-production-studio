import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const defaultExcludedCourseIds = Object.freeze(["pmp-exam-prep-business-application"]);

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function academySurgePortfolio() {
  if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
  const expectedCourses = Number(process.env.ACADEMY_EXPECTED_SURGE_COURSES || 60);
  if (!Number.isInteger(expectedCourses) || expectedCourses < 1) {
    throw new Error("ACADEMY_EXPECTED_SURGE_COURSES must be a positive integer.");
  }

  const configuredExclusions = parseCsv(process.env.ACADEMY_SURGE_EXCLUDED_COURSE_IDS);
  const excludedCourseIds = new Set(configuredExclusions.length ? configuredExclusions : defaultExcludedCourseIds);
  const manifests = [];
  for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    const courseId = String(manifest.course?.id ?? entry.name).trim();
    const releaseStatus = String(manifest.release?.status ?? "draft").trim().toLowerCase();
    manifests.push({
      courseId,
      directoryName: entry.name,
      manifestPath,
      courseDir: path.dirname(manifestPath),
      manifest,
      releaseStatus,
      ownerReviewEligible: !["retired", "archived"].includes(releaseStatus),
      excludedFromSurge: excludedCourseIds.has(courseId),
    });
  }

  const selected = manifests
    .filter((item) => item.ownerReviewEligible && !item.excludedFromSurge)
    .sort((left, right) => left.courseId.localeCompare(right.courseId));
  const excluded = manifests
    .filter((item) => item.excludedFromSurge)
    .sort((left, right) => left.courseId.localeCompare(right.courseId));

  if (selected.length !== expectedCourses) {
    throw new Error(
      `The Academy surge must contain exactly ${expectedCourses} governed courses; discovered ${selected.length}. `
      + `Excluded course IDs: ${[...excludedCourseIds].join(", ") || "none"}.`,
    );
  }

  return Object.freeze({
    expectedCourses,
    discoveredManifests: manifests.length,
    selectedCourses: selected,
    selectedCourseIds: selected.map((item) => item.courseId),
    excludedCourses: excluded,
    excludedCourseIds: [...excludedCourseIds].sort(),
    policy: "exactly-60-standard-academy-courses-pmp-retains-separate-course-specific-production-contract",
  });
}

export { defaultExcludedCourseIds };
