import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";

// Governed authoritative registry: sources/authoritative-sources.json
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registryPath = path.join(root, "sources", "authoritative-sources.json");
if (!fs.existsSync(registryPath)) {
  throw new Error(`Authoritative source registry not found: ${registryPath}`);
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const portfolio = academySurgePortfolio();
const generatedAt = new Date().toISOString();

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedText(value) {
  return String(value ?? "").toLowerCase();
}

function relevanceScore(manifest, source) {
  const courseText = normalizedText([
    manifest.course?.title,
    manifest.course?.description,
    manifest.course?.department,
    manifest.course?.track,
    manifest.course?.audience,
    ...(manifest.course?.outcomes ?? []),
    ...(manifest.tags?.frameworks ?? []),
    ...(manifest.tags?.domain ?? []),
    ...(manifest.tags?.industry ?? []),
  ].join(" "));
  let score = 0;
  for (const topic of source.topics ?? []) {
    const normalizedTopic = normalizedText(topic);
    if (normalizedTopic && courseText.includes(normalizedTopic)) score += 4;
    for (const token of normalizedTopic.split(/[^a-z0-9]+/).filter((item) => item.length >= 4)) {
      if (courseText.includes(token)) score += 1;
    }
  }
  const sourceText = normalizedText(`${source.title} ${source.publication} ${source.id}`);
  for (const framework of manifest.tags?.frameworks ?? []) {
    const normalizedFramework = normalizedText(framework).replaceAll("-", " ");
    if (sourceText.includes(normalizedFramework) || normalizedFramework.split(" ").some((token) => token.length >= 4 && sourceText.includes(token))) score += 6;
  }
  if (source.binding === true) score += 1;
  return score;
}

function sourceContextFor(manifest) {
  const scored = (registry.sources ?? [])
    .map((source) => ({ source, score: relevanceScore(manifest, source) }))
    .sort((left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id));
  const relevant = scored.filter((item) => item.score > 0).map((item) => item.source);
  const binding = scored.filter((item) => item.source.binding === true).slice(0, 6).map((item) => item.source);
  const guidance = scored.filter((item) => item.source.binding === false && item.source.status !== "draft").slice(0, 6).map((item) => item.source);
  const selected = new Map();
  for (const source of [...relevant, ...binding, ...guidance]) selected.set(source.id, source);
  return [...selected.values()];
}

const summaries = [];
for (const item of portfolio.selectedCourses) {
  const selectedSources = sourceContextFor(item.manifest);
  const context = {
    schemaVersion: "1.0",
    generatedAt,
    courseId: item.courseId,
    registryUpdatedAt: registry.updatedAt,
    registryPolicy: registry.policy,
    domainRequirements: registry.domainRequirements,
    sources: selectedSources,
    sourceCount: selectedSources.length,
    registryHash: stableHash(registry),
    manifestHash: stableHash(item.manifest),
    rules: {
      exactLocatorRequiredWhenSupplied: true,
      inventedLocatorProhibited: true,
      bindingAuthorityMustBeDistinguishedFromGuidance: true,
      draftSourcesCannotSupportNormativeClaims: true,
      jurisdictionAndApplicabilityRequired: true,
      whereItAppliesAndDoesNotApplyRequired: true,
      independentVerificationRequiredBeforePublication: true,
      sourceCardsRequiredInCinematicMedia: true,
    },
    claimBoundary: "This context provides governed source metadata for course authoring. It does not independently validate every interpretation, jurisdictional application, current amendment, or organization-specific obligation.",
  };
  const outputPath = path.join(item.courseDir, "authoritative-source-context.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(context, null, 2)}\n`);
  summaries.push({ courseId: item.courseId, sourceCount: selectedSources.length, outputPath: path.relative(root, outputPath).replaceAll("\\", "/") });
}

const reportPath = path.join(root, "catalog", "academy-hollywood-source-context.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt,
  expectedCourses: portfolio.expectedCourses,
  preparedCourses: summaries.length,
  excludedCourseIds: portfolio.excludedCourseIds,
  registryHash: stableHash(registry),
  courses: summaries,
}, null, 2)}\n`);

console.log(`[Academy Studio] Prepared authoritative source context for exactly ${summaries.length} Academy surge course(s).`);
