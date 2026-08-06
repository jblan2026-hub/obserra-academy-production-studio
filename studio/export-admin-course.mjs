import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const courseId = arg("--course") || "all";
const packageType = arg("--type") || "source";
const outputRoot = path.join(root, "admin-exports");
const notice = "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";

if (!["source", "final", "both"].includes(packageType)) {
  console.error("--type must be source, final, or both");
  process.exit(1);
}

function readManifest(id) {
  const manifestPath = path.join(root, "courses", id, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found for ${id}`);
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function listCourseIds() {
  const coursesDir = path.join(root, "courses");
  if (!fs.existsSync(coursesDir)) return [];
  return fs.readdirSync(coursesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(coursesDir, entry.name, "course-manifest.json")))
    .map((entry) => entry.name)
    .sort();
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.cpSync(source, destination, { recursive: true });
  return true;
}

function createZip(stageDir, zipPath) {
  fs.rmSync(zipPath, { force: true });
  execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: stageDir, stdio: "inherit" });
}

function exportOne(id, type) {
  const manifest = readManifest(id);
  const version = manifest.release.version;
  const stageDir = path.join(outputRoot, ".stage", `${id}-${type}`);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const sourcePath = type === "source"
    ? path.join(root, "courses", id)
    : path.join(root, "releases", id, "FINAL");

  if (!copyDirectory(sourcePath, path.join(stageDir, type))) {
    throw new Error(`${type} package is not available for ${id}`);
  }

  const exportRecord = {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    courseId: id,
    title: manifest.course.title,
    version,
    packageType: type,
    owner: "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC",
    classification: notice,
    licenseModel: manifest.commerce.model,
    accessPolicy: manifest.commerce.accessPolicy,
    passingScore: manifest.completion.passingScore,
    certificateIssued: manifest.completion.certificateIssued,
    releaseStatus: manifest.release.status,
  };
  fs.writeFileSync(path.join(stageDir, "ADMIN_EXPORT_RECORD.json"), `${JSON.stringify(exportRecord, null, 2)}\n`);
  fs.writeFileSync(path.join(stageDir, "PROPRIETARY_NOTICE.txt"), `${notice}\nAuthorized administrator use only.\n`);

  fs.mkdirSync(outputRoot, { recursive: true });
  const zipName = `obserra-academy-${id}-${type}-v${version}.zip`;
  const zipPath = path.join(outputRoot, zipName);
  createZip(stageDir, zipPath);
  return zipName;
}

const ids = courseId === "all" ? listCourseIds() : [courseId];
if (ids.length === 0) {
  console.error("No course manifests were found");
  process.exit(1);
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
const exports = [];
for (const id of ids) {
  if (packageType === "source" || packageType === "both") exports.push(exportOne(id, "source"));
  if (packageType === "final" || packageType === "both") exports.push(exportOne(id, "final"));
}

fs.rmSync(path.join(outputRoot, ".stage"), { recursive: true, force: true });
fs.writeFileSync(path.join(outputRoot, "export-summary.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  requestedCourse: courseId,
  packageType,
  files: exports,
  classification: notice,
}, null, 2)}\n`);
console.log(`[Academy Studio] Created ${exports.length} admin export package(s)`);
