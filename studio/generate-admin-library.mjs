import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const releasesRoot = path.join(root, "releases");
const outputDir = path.join(root, "catalog");
const outputPath = path.join(outputDir, "admin-course-library.json");

const proprietaryNotice = "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";
const legalName = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function walk(directory, base = directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, base));
    else files.push({
      path: path.relative(base, absolute).replaceAll(path.sep, "/"),
      bytes: fs.statSync(absolute).size,
      sha256: sha256(absolute),
    });
  }
  return files;
}

fs.mkdirSync(outputDir, { recursive: true });

const courses = [];
if (fs.existsSync(coursesRoot)) {
  for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourceDir = path.join(coursesRoot, entry.name);
    const manifestPath = path.join(sourceDir, "course-manifest.json");
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = readJson(manifestPath);
    const finalDir = path.join(releasesRoot, manifest.course.id, "FINAL");
    const sourceFiles = walk(sourceDir);
    const releaseFiles = walk(finalDir);

    courses.push({
      id: manifest.course.id,
      title: manifest.course.title,
      department: manifest.course.department,
      track: manifest.course.track,
      level: manifest.course.level,
      duration: manifest.course.duration,
      description: manifest.course.description,
      moduleCount: manifest.course.modules.length,
      moduleMinutes: manifest.course.modules.map((module) => ({
        id: module.id,
        title: module.title,
        duration: module.duration,
        format: module.format,
      })),
      price: manifest.commerce.price,
      currency: manifest.commerce.currency,
      licenseModel: manifest.commerce.model,
      accessPolicy: manifest.commerce.accessPolicy,
      passingScore: manifest.completion.passingScore,
      certificateIssued: manifest.completion.certificateIssued,
      releaseVersion: manifest.release.version,
      releaseStatus: manifest.release.status,
      publishToAcademy: manifest.release.publishToAcademy,
      reviews: manifest.reviews,
      sourcePackage: {
        relativePath: `courses/${manifest.course.id}`,
        fileCount: sourceFiles.length,
        totalBytes: sourceFiles.reduce((sum, file) => sum + file.bytes, 0),
        files: sourceFiles,
      },
      finalRelease: {
        available: releaseFiles.length > 0,
        relativePath: `releases/${manifest.course.id}/FINAL`,
        fileCount: releaseFiles.length,
        totalBytes: releaseFiles.reduce((sum, file) => sum + file.bytes, 0),
        files: releaseFiles,
      },
      exportNames: {
        source: `obserra-academy-${manifest.course.id}-source-v${manifest.release.version}.zip`,
        final: `obserra-academy-${manifest.course.id}-final-v${manifest.release.version}.zip`,
      },
    });
  }
}

courses.sort((a, b) => a.title.localeCompare(b.title));
const library = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  owner: legalName,
  classification: proprietaryNotice,
  courseCount: courses.length,
  courses,
};

fs.writeFileSync(outputPath, `${JSON.stringify(library, null, 2)}\n`);
console.log(`[Academy Studio] Generated admin library with ${courses.length} course(s)`);
