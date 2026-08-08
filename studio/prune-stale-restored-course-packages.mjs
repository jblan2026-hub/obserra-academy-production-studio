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

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

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

function allCourseIds() {
  return fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
    .sort();
}

function governedScope(courseIds) {
  const shardValue = String(process.env.ACADEMY_SHARD_INDEX ?? "").trim();
  if (!shardValue) return { courseIds, scope: "portfolio", shardIndex: null, shardCount: null };

  const shardIndex = Number(shardValue);
  const shardCount = boundedInteger(process.env.ACADEMY_SHARD_COUNT, 61, 1, 64);
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error(`ACADEMY_SHARD_INDEX must be an integer from 0 through ${shardCount - 1}.`);
  }
  const selected = courseIds.filter((_courseId, index) => index % shardCount === shardIndex);
  if (selected.length === 0) throw new Error(`Restored package validation shard ${shardIndex}/${shardCount} received no courses.`);
  return { courseIds: selected, scope: "shard", shardIndex, shardCount };
}

const portfolio = allCourseIds();
const scope = governedScope(portfolio);
const results = [];
for (const courseId of scope.courseIds) {
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
    results.push({
      courseId,
      retained: false,
      reason: "source-context-changed",
      storedFiles: storedMap.size,
      currentFiles: currentMap.size,
    });
    continue;
  }
  results.push({ courseId, retained: true, reason: "source-context-current", files: currentMap.size });
}

const retained = results.filter((item) => item.retained).length;
const pruned = results.length - retained;
console.log(
  `[Academy Studio] Restored package source validation checked ${scope.courseIds.length} course(s) in ${scope.scope} scope, retained ${retained}, and pruned ${pruned} stale package(s).`,
);
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(
  path.join(root, "catalog", "academy-61-restored-package-validation.json"),
  `${JSON.stringify({
    schemaVersion: "1.1",
    checkedAt: new Date().toISOString(),
    scope: scope.scope,
    shardIndex: scope.shardIndex,
    shardCount: scope.shardCount,
    selectedCourseCount: scope.courseIds.length,
    retained,
    pruned,
    results,
  }, null, 2)}\n`,
  "utf8",
);
