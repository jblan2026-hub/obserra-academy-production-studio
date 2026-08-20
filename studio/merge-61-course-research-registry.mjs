import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const registryPath = path.join(root, "sources", "authoritative-sources.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

const courseIds = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
  .sort();

if (courseIds.length !== 61) throw new Error(`Research registry merge requires exactly 61 course manifests; discovered ${courseIds.length}.`);
if (!fs.existsSync(registryPath)) throw new Error(`Authoritative source registry not found: ${registryPath}`);

const registry = readJson(registryPath);
const existing = new Map((registry.sources || []).map((source) => [source.id, source]));
const mergedSources = [];
const courseSummaries = [];

for (const courseId of courseIds) {
  const generatedPath = path.join(coursesRoot, courseId, "generated", "research", "authoritative-source-research.json");
  const contextPath = path.join(coursesRoot, courseId, "authoritative-sources.generated.json");
  if (!fs.existsSync(generatedPath) || !fs.existsSync(contextPath)) {
    throw new Error(`Authoritative research evidence missing for ${courseId}.`);
  }

  const evidence = readJson(generatedPath);
  const research = evidence.research || readJson(contextPath);
  if (evidence.passed !== true) throw new Error(`Authoritative research has unresolved findings for ${courseId}.`);

  const sources = Array.isArray(research.authoritativeSources) ? research.authoritativeSources : [];
  const cases = Array.isArray(research.documentedCases) ? research.documentedCases : [];
  const sourceIdMap = new Map();
  const caseIdMap = new Map();

  sources.forEach((source, index) => {
    const oldId = String(source.id || `SRC-${index + 1}`);
    const newId = `web-${courseId}-src-${String(index + 1).padStart(2, "0")}`;
    sourceIdMap.set(oldId, newId);
    source.id = newId;
    mergedSources.push({
      id: newId,
      title: source.title,
      issuer: source.issuingAuthority,
      publication: source.publication || source.title,
      authorityType: source.sourceType,
      binding: source.binding === true,
      status: source.status || "current",
      published: source.publicationDate || null,
      canonicalUrl: source.canonicalUrl,
      topics: Array.isArray(source.claimTopics) ? source.claimTopics : [],
      specificReferences: Array.isArray(source.specificReferences) ? source.specificReferences : [],
      applicability: source.applicability || "",
      appliesWhen: Array.isArray(source.appliesWhen) ? source.appliesWhen : [],
      doesNotApplyWhen: Array.isArray(source.doesNotApplyWhen) ? source.doesNotApplyWhen : [],
      limitations: Array.isArray(source.limitations) ? source.limitations : [],
      sourceCourseId: courseId,
      verificationMethod: "openai-responses-web-search-primary-source-research"
    });
  });

  cases.forEach((item, index) => {
    const oldId = String(item.id || `CASE-${index + 1}`);
    const newId = `web-${courseId}-case-${String(index + 1).padStart(2, "0")}`;
    caseIdMap.set(oldId, newId);
    item.id = newId;
    mergedSources.push({
      id: newId,
      title: item.title,
      issuer: item.sourceAuthority,
      publication: `Documented public case: ${item.organizationOrEvent || item.title}`,
      authorityType: "documented-public-case",
      binding: false,
      status: "current-public-record",
      published: item.date || null,
      canonicalUrl: item.primarySourceUrl,
      topics: Array.isArray(item.factsSupported) ? item.factsSupported : [],
      lessonsLearned: Array.isArray(item.lessonsLearned) ? item.lessonsLearned : [],
      implementationRecommendations: Array.isArray(item.implementationRecommendations) ? item.implementationRecommendations : [],
      limitations: Array.isArray(item.limitations) ? item.limitations : [],
      sourceCourseId: courseId,
      verificationMethod: "openai-responses-web-search-primary-source-research"
    });
  });

  for (const item of research.moduleResearch || []) {
    item.sourceIds = (item.sourceIds || []).map((id) => sourceIdMap.get(String(id)) || String(id));
    item.caseIds = (item.caseIds || []).map((id) => caseIdMap.get(String(id)) || String(id));
  }

  for (const source of research.authoritativeSources || []) {
    source.moduleIds = Array.isArray(source.moduleIds) ? source.moduleIds : [];
  }
  for (const item of research.documentedCases || []) {
    item.moduleIds = Array.isArray(item.moduleIds) ? item.moduleIds : [];
  }

  evidence.research = research;
  evidence.normalizedForGovernedRegistry = true;
  evidence.normalizedAt = new Date().toISOString();
  evidence.normalizedSourceIds = [...sourceIdMap.values()];
  evidence.normalizedCaseIds = [...caseIdMap.values()];
  writeJsonAtomic(generatedPath, evidence);
  writeJsonAtomic(contextPath, research);

  courseSummaries.push({
    courseId,
    sourceCount: sources.length,
    documentedCaseCount: cases.length,
    sourceIds: [...sourceIdMap.values()],
    caseIds: [...caseIdMap.values()]
  });
}

for (const source of mergedSources) existing.set(source.id, source);
registry.sources = [...existing.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
registry.updatedAt = new Date().toISOString().slice(0, 10);
registry.runtimeResearchMerge = {
  generatedAt: new Date().toISOString(),
  objective: "complete-all-61-academy-courses-only",
  courseCount: courseSummaries.length,
  mergedSourceCount: mergedSources.length,
  primarySourceResearchRequired: true
};
writeJsonAtomic(registryPath, registry);

const summary = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  courseCount: courseSummaries.length,
  mergedSourceCount: mergedSources.length,
  totalRegistrySources: registry.sources.length,
  courses: courseSummaries
};
writeJsonAtomic(path.join(root, "catalog", "academy-61-research-registry-merge.json"), summary);
console.log(`[Academy Studio] Merged ${mergedSources.length} researched primary-source records across ${courseSummaries.length}/61 courses into the governed runtime registry.`);
