import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const registryPath = path.join(root, "sources", "authoritative-sources.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const sources = Array.isArray(registry.sources) ? registry.sources : [];
const expectedCourses = Number(process.env.ACADEMY_EXPECTED_SURGE_COURSES || 61);

const stopWords = new Set(["and","the","for","with","from","into","that","this","your","course","business","executive","professional","management","leadership","application","advanced","fundamentals"]);

function tokens(value) {
  return new Set(String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token)));
}

function overlap(left, right) {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function sourceScore(source, manifest) {
  const course = manifest.course || {};
  const courseText = [course.title, course.department, course.track, course.description, ...(course.outcomes || []), ...((course.modules || []).flatMap((module) => [module.title, module.format]))].join(" ");
  const courseTokens = tokens(courseText);
  const sourceTokens = tokens([source.title, source.publication, source.issuer, ...(source.topics || [])].join(" "));
  let score = overlap(courseTokens, sourceTokens);
  const frameworks = (manifest.tags?.frameworks || []).map((value) => String(value).toLowerCase());
  const sourceText = [source.id, source.title, source.publication, ...(source.topics || [])].join(" ").toLowerCase();
  for (const framework of frameworks) if (framework && sourceText.includes(framework)) score += 6;
  if (source.binding) score += 1;
  if (["final", "current-regulation", "current-statute", "current-clause", "final-rule", "current-guidance", "current-web-guidance", "current-dynamic-advisory"].includes(source.status)) score += 1;
  return score;
}

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .filter((courseId) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(coursesRoot, courseId, "course-manifest.json"), "utf8"));
    return !["retired", "archived"].includes(String(manifest.release?.status || "draft").toLowerCase());
  })
  .sort();

if (courseIds.length !== expectedCourses) throw new Error(`Free source-context builder expected ${expectedCourses} courses; discovered ${courseIds.length}.`);

const summary = [];
for (const courseId of courseIds) {
  const courseDir = path.join(coursesRoot, courseId);
  const manifest = JSON.parse(fs.readFileSync(path.join(courseDir, "course-manifest.json"), "utf8"));
  const ranked = sources
    .map((source) => ({ source, score: sourceScore(source, manifest) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.source.id).localeCompare(String(b.source.id)))
    .slice(0, 12);
  const context = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    courseId,
    sourceRegistryUpdatedAt: registry.updatedAt || null,
    policy: registry.policy || {},
    matchedSources: ranked.map(({ source, score }) => ({ ...source, matchScore: score })),
    sourceCount: ranked.length,
    noModelCreditUsed: true,
    claimBoundary: "Deterministic source matching is a cost-avoidance context step only. It does not establish applicability or factual sufficiency; paid research is used only for unresolved mapping, freshness, documented cases, or gaps."
  };
  const outputDir = path.join(courseDir, "generated", "research");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "free-source-context.json"), `${JSON.stringify(context, null, 2)}\n`);
  summary.push({ courseId, sourceCount: ranked.length });
}

fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-free-source-context-summary.json"), `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  expectedCourses,
  coursesWithMatches: summary.filter((item) => item.sourceCount > 0).length,
  courses: summary,
}, null, 2)}\n`);
console.log(`[Academy Studio] Built no-model source context for ${summary.length}/${expectedCourses} courses.`);
