import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course");
if (!courseId) {
  console.error("Usage: node studio/source-grounding-gate.mjs --course <course-id>");
  process.exit(1);
}

const registryPath = path.join(root, "sources", "authoritative-sources.json");
const packagePath = path.join(root, "courses", courseId, "generated", "authoring", "course-package.json");
if (!fs.existsSync(registryPath) || !fs.existsSync(packagePath)) {
  console.error(`[Academy Studio] Missing source registry or AI authored package for ${courseId}`);
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const sources = new Map(registry.sources.map((source) => [source.id, source]));
const modules = envelope.content?.modules || [];
const failures = [];
const warnings = [];
const usedSources = new Set();

const frameworkPattern = /\b(NIST|CSF|SP 800|SSDF|zero trust|FDA|524B|CMMC|DFARS|CUI|FCI|PCI DSS|HIPAA|ISO 27001|AI RMF|RMF|CIS Controls|OWASP ASVS)\b/i;

for (const module of modules) {
  const claims = Array.isArray(module.sourceClaims) ? module.sourceClaims : [];
  const narrative = [
    module.lessonNarrative,
    module.executiveExample,
    module.operationalExample,
    module.scenario?.situation,
    module.scenario?.recommendedApproach,
    ...(module.keyConcepts || []).map((item) => `${item.term} ${item.explanation}`),
    ...(module.slideNarrative || []).map((item) => `${item.title} ${(item.content || []).join(" ")} ${item.speakerNotes || ""}`),
  ].join("\n");

  if (frameworkPattern.test(narrative) && claims.length === 0) {
    failures.push(`${module.id}: framework or regulatory content appears without sourceClaims.`);
  }

  for (const claim of claims) {
    if (!claim.claim || !claim.sourceId || !claim.reference) {
      failures.push(`${module.id}: source claim is missing claim, sourceId, or reference.`);
      continue;
    }
    const source = sources.get(claim.sourceId);
    if (!source) {
      failures.push(`${module.id}: unknown sourceId ${claim.sourceId}.`);
      continue;
    }
    usedSources.add(source.id);
    if (["draft", "initial-public-draft"].includes(source.status) && claim.normative !== false) {
      failures.push(`${module.id}: draft source ${source.id} cannot support a normative claim.`);
    }
    if (!claim.reference.trim()) failures.push(`${module.id}: source ${source.id} requires a section, control, practice, clause, or page reference.`);
    if (claim.quote && claim.quote.trim().split(/\s+/).length > registry.policy.quoteLimitPerSourceWords) {
      failures.push(`${module.id}: quotation from ${source.id} exceeds the configured word limit.`);
    }
    if (!claim.interpretation) warnings.push(`${module.id}: source claim ${source.id} lacks an interpretation note.`);
  }
}

if (usedSources.size === 0 && modules.some((module) => frameworkPattern.test(JSON.stringify(module)))) {
  failures.push("The course contains standards or regulatory topics but no authoritative sources were used.");
}

const report = {
  schemaVersion: "1.0",
  courseId,
  generatedAt: new Date().toISOString(),
  passed: failures.length === 0,
  usedSources: [...usedSources],
  failures,
  warnings,
  policy: registry.policy,
  proprietaryNotice: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION."
};
const outputDir = path.join(root, "courses", courseId, "generated", "quality");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "source-grounding-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Source grounding gate ${report.passed ? "PASSED" : "FAILED"} for ${courseId}`);
if (!report.passed) process.exit(1);
