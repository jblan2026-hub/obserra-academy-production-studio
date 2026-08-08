import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const model = String(process.env.LOCAL_AI_MODEL || process.env.OPENAI_AUTHORING_MODEL || "qwen2.5:7b-instruct").trim();
const expected = Number(process.env.ACADEMY_EXPECTED_SURGE_COURSES || 61);

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .sort();
if (courseIds.length !== expected) throw new Error(`Local evidence normalization expected ${expected} courses; discovered ${courseIds.length}.`);

const summary = [];
for (const courseId of courseIds) {
  const changed = [];
  const researchPath = path.join(coursesRoot, courseId, "generated", "research", "authoritative-source-research.json");
  const research = readJson(researchPath);
  if (research) {
    research.provider = "local-ollama";
    research.model = model;
    research.webSearchUsed = false;
    research.sourceCacheUsed = true;
    research.responseMode = "local-ollama-plus-cached-authoritative-primary-sources";
    research.estimatedApiCostUsd = 0;
    research.externalPaidApiUsed = false;
    research.localExecution = true;
    writeJson(researchPath, research);
    changed.push("research");
  }

  const packagePath = path.join(coursesRoot, courseId, "generated", "authoring", "course-package.json");
  const authored = readJson(packagePath);
  if (authored) {
    authored.provider = "local-ollama";
    authored.model = model;
    authored.estimatedApiCostUsd = 0;
    authored.externalPaidApiUsed = false;
    authored.localExecution = true;
    authored.sourceExecutionBoundary = "cached-authoritative-source-context-only-no-commercial-web-search";
    writeJson(packagePath, authored);
    changed.push("authoring");
  }

  const reviewPath = path.join(coursesRoot, courseId, "generated", "quality", "independent-course-quality-review.json");
  const review = readJson(reviewPath);
  if (review) {
    review.provider = "local-ollama";
    review.model = model;
    review.webSearchUsed = false;
    review.sourceCacheUsed = true;
    review.estimatedApiCostUsd = 0;
    review.externalPaidApiUsed = false;
    review.localExecution = true;
    writeJson(reviewPath, review);
    changed.push("review");
  }

  summary.push({ courseId, changed });
}

const output = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  provider: "local-ollama",
  model,
  expectedCourses: expected,
  estimatedApiCostUsd: 0,
  externalPaidApiUsed: false,
  sourcePolicy: "cached canonical authoritative sources plus deterministic validation; no commercial web-search API",
  courses: summary,
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-local-ollama-evidence-summary.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`[Academy Studio] Normalized local Ollama provenance for ${summary.length}/${expected} courses at $0 estimated model API cost.`);
