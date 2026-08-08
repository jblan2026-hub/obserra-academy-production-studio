import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const registryPath = path.join(root, "sources", "authoritative-sources.json");
const casesPath = path.join(root, "sources", "documented-cases.json");
const cacheRoot = path.join(root, ".academy-cache", "authoritative-sources");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const caseRegistry = fs.existsSync(casesPath) ? JSON.parse(fs.readFileSync(casesPath, "utf8")) : { cases: [] };
const sources = Array.isArray(registry.sources) ? registry.sources : [];
const documentedCases = Array.isArray(caseRegistry.cases) ? caseRegistry.cases : [];
const expectedCourses = Number(process.env.ACADEMY_EXPECTED_SURGE_COURSES || 61);
const maxExcerptCharacters = Math.max(2_000, Math.min(25_000, Number(process.env.ACADEMY_FREE_SOURCE_EXCERPT_CHARACTERS || 12_000)));

const stopWords = new Set(["and","the","for","with","from","into","that","this","your","course","business","executive","professional","management","leadership","application","advanced","fundamentals"]);
function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}
function tokens(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 3 && !stopWords.has(token)));
}
function overlap(left, right) {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}
function courseTokens(manifest) {
  const course = manifest.course || {};
  return tokens([
    course.title, course.department, course.track, course.description,
    ...(course.outcomes || []),
    ...((course.modules || []).flatMap((module) => [module.title, module.description, module.format])),
    ...(manifest.tags?.frameworks || []),
  ].join(" "));
}
function sourceScore(source, manifest) {
  const courseSet = courseTokens(manifest);
  const sourceSet = tokens([source.title, source.publication, source.issuer, ...(source.topics || [])].join(" "));
  let score = overlap(courseSet, sourceSet);
  const frameworks = (manifest.tags?.frameworks || []).map((value) => String(value).toLowerCase());
  const sourceText = [source.id, source.title, source.publication, ...(source.topics || [])].join(" ").toLowerCase();
  for (const framework of frameworks) if (framework && sourceText.includes(framework)) score += 6;
  if (source.binding) score += 1;
  if (["final", "current-regulation", "current-statute", "current-clause", "final-rule", "current-guidance", "current-web-guidance", "current-dynamic-advisory"].includes(source.status)) score += 1;
  return score;
}
function caseScore(item, manifest) {
  const courseSet = courseTokens(manifest);
  const caseSet = tokens([
    item.title, item.organizationOrEvent, item.sourceAuthority,
    ...(item.topics || []), ...(item.factsSupported || []),
    ...(item.lessonsLearned || []), ...(item.implementationRecommendations || []),
  ].join(" "));
  let score = overlap(courseSet, caseSet) * 2;
  const department = String(manifest.course?.department || "").toLowerCase();
  const topics = (item.topics || []).join(" ").toLowerCase();
  if (department.includes("cyber") && /cyber|data security|ransomware|breach|vulnerability/.test(topics)) score += 4;
  if (department.includes("protection") && /workplace violence|physical security|executive protection|safety/.test(topics)) score += 5;
  if (department.includes("health") && /healthcare|hipaa|medical device|patient safety/.test(topics)) score += 5;
  if (/ai|artificial intelligence/.test(String(manifest.course?.title || "").toLowerCase()) && /artificial intelligence|facial recognition|algorithmic/.test(topics)) score += 6;
  return score;
}
function cachedEvidence(id) {
  const sourceDir = path.join(cacheRoot, id);
  const metadata = readJson(path.join(sourceDir, "metadata.json"));
  const textPath = path.join(sourceDir, "source.txt");
  const text = fs.existsSync(textPath) ? fs.readFileSync(textPath, "utf8").slice(0, maxExcerptCharacters) : "";
  return {
    cacheAvailable: Boolean(metadata?.sha256 && text),
    cacheFetchedAt: metadata?.fetchedAt || null,
    cacheSha256: metadata?.sha256 || null,
    cacheContentType: metadata?.contentType || null,
    cachedExcerpt: text,
  };
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
  const rankedSources = sources
    .map((source) => ({ source, score: sourceScore(source, manifest) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.source.id).localeCompare(String(b.source.id)))
    .slice(0, 12);
  const rankedCases = documentedCases
    .map((item) => ({ item, score: caseScore(item, manifest) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))
    .slice(0, 6);
  const matchedSources = rankedSources.map(({ source, score }) => ({ ...source, matchScore: score, ...cachedEvidence(source.id) }));
  const matchedCases = rankedCases.map(({ item, score }) => ({ ...item, matchScore: score, ...cachedEvidence(item.id) }));
  const context = {
    schemaVersion: "1.2",
    generatedAt: new Date().toISOString(),
    courseId,
    sourceRegistryUpdatedAt: registry.updatedAt || null,
    documentedCaseRegistryUpdatedAt: caseRegistry.updatedAt || null,
    policy: registry.policy || {},
    casePolicy: caseRegistry.policy || {},
    matchedSources,
    matchedCases,
    sourceCount: matchedSources.length,
    caseCount: matchedCases.length,
    cachedSourceCount: matchedSources.filter((item) => item.cacheAvailable).length,
    cachedCaseCount: matchedCases.filter((item) => item.cacheAvailable).length,
    noModelCreditUsed: true,
    claimBoundary: "Deterministic matching and direct primary-source caching are zero-model-cost evidence steps. Local synthesis may use only these governed records and cached excerpts. Unsupported applicability, case facts, or authority must remain unresolved rather than be invented."
  };
  const outputDir = path.join(courseDir, "generated", "research");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "free-source-context.json"), `${JSON.stringify(context, null, 2)}\n`);
  summary.push({ courseId, sourceCount: matchedSources.length, caseCount: matchedCases.length, cachedSourceCount: context.cachedSourceCount, cachedCaseCount: context.cachedCaseCount });
}

fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-free-source-context-summary.json"), `${JSON.stringify({
  schemaVersion: "1.2",
  generatedAt: new Date().toISOString(),
  expectedCourses,
  coursesWithMatches: summary.filter((item) => item.sourceCount > 0).length,
  coursesWithCases: summary.filter((item) => item.caseCount >= 2).length,
  coursesWithCachedSources: summary.filter((item) => item.cachedSourceCount > 0).length,
  coursesWithCachedCases: summary.filter((item) => item.cachedCaseCount >= 2).length,
  totalCachedMatches: summary.reduce((total, item) => total + item.cachedSourceCount + item.cachedCaseCount, 0),
  courses: summary,
}, null, 2)}\n`);
console.log(`[Academy Studio] Built zero-cost governed context for ${summary.length}/${expectedCourses} courses with ${summary.reduce((total, item) => total + item.cachedSourceCount, 0)} cached authorities and ${summary.reduce((total, item) => total + item.cachedCaseCount, 0)} cached primary-source cases.`);
