import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const preferredPatterns = [
  /authoritative[-_ ]?sources/i,
  /source[-_ ]?register/i,
  /traceability/i,
  /crosswalk/i,
  /rights[-_ ]?ledger/i,
  /trademark/i,
  /independence/i,
  /production[-_ ]?status/i,
  /course[-_ ]?qa/i,
  /assessment[-_ ]?delivery[-_ ]?policy/i,
  /ai[-_ ]?tutor[-_ ]?profile/i,
  /video[-_ ]?production[-_ ]?bible/i,
];
const acceptedExtensions = new Set([".json", ".md", ".txt"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function currentSourceFiles(courseDir) {
  return fs.readdirSync(courseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => acceptedExtensions.has(path.extname(name).toLowerCase()))
    .filter((name) => preferredPatterns.some((pattern) => pattern.test(name)))
    .sort()
    .map((file) => ({ file, sha256: sha256(fs.readFileSync(path.join(courseDir, file))) }));
}

const results = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const courseId = entry.name;
  const courseDir = path.join(coursesRoot, courseId);
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(packagePath)) continue;

  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    fs.rmSync(packagePath, { force: true });
    results.push({ courseId, retained: false, reason: "invalid-json" });
    continue;
  }

  const stored = Array.isArray(envelope.sourceContextFiles) ? envelope.sourceContextFiles : [];
  const current = currentSourceFiles(courseDir);
  const storedMap = new Map(stored.map((record) => [String(record.file), String(record.sha256)]));
  const currentMap = new Map(current.map((record) => [record.file, record.sha256]));
  const sameSet = storedMap.size === currentMap.size && [...currentMap.keys()].every((file) => storedMap.has(file));
  const sameHashes = sameSet && [...currentMap.entries()].every(([file, hash]) => storedMap.get(file) === hash);

  if (!sameHashes) {
    fs.rmSync(packagePath, { force: true });
    results.push({ courseId, retained: false, reason: "source-context-changed", storedFiles: storedMap.size, currentFiles: currentMap.size });
    continue;
  }
  results.push({ courseId, retained: true, reason: "source-context-current", files: currentMap.size });
}

const retained = results.filter((item) => item.retained).length;
const pruned = results.length - retained;
console.log(`[Academy Studio] Restored package source validation retained ${retained} and pruned ${pruned} stale package(s).`);
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(
  path.join(root, "catalog", "academy-61-restored-package-validation.json"),
  `${JSON.stringify({ schemaVersion: "1.0", checkedAt: new Date().toISOString(), retained, pruned, results }, null, 2)}\n`,
  "utf8",
);
