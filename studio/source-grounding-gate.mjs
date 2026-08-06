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

const courseDir = path.join(root, "courses", courseId);
const registryPath = path.join(root, "sources", "authoritative-sources.json");
const manifestPath = path.join(courseDir, "course-manifest.json");
const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
if (!fs.existsSync(registryPath) || !fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) {
  console.error(`[Academy Studio] Missing source registry, manifest, or AI authored package for ${courseId}`);
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const sources = new Map(registry.sources.map((source) => [source.id, source]));
const modules = envelope.content?.modules || [];
const failures = [];
const warnings = [];
const usedSources = new Set();
const usedBindingSources = new Set();

const frameworkPattern = /\b(NIST|CSF|SP 800|SSDF|zero trust|FDA|524B|CMMC|DFARS|CUI|FCI|PCI DSS|HIPAA|ISO 27001|AI RMF|RMF|CIS Controls|OWASP ASVS|SEC|Regulation S-K|FTC Safeguards|NYDFS|23 NYCRR|OSHA|General Duty Clause|workplace violence|Labor Code 6401\.9)\b/i;
const courseText = [manifest.course.title, manifest.course.track, manifest.course.department, manifest.course.description].join(" ").toLowerCase();

function courseDomain() {
  if (/executive protection|protective intelligence|travel risk|workplace violence|family security|threat assessment/.test(courseText)) return "executive-protection";
  if (/ciso|board|cybersecurity governance|executive metrics|regulatory readiness|security program/.test(courseText)) return "board-ciso-leadership";
  if (/business leader|executive decision|trusted teams|leadership|enterprise risk/.test(courseText)) return "business-leadership";
  return null;
}

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
    failures.push(`${module.id}: framework, legal, or regulatory content appears without sourceClaims.`);
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
    if (source.binding) usedBindingSources.add(source.id);

    if (["draft", "initial-public-draft"].includes(source.status) && claim.normative !== false) {
      failures.push(`${module.id}: draft source ${source.id} cannot support a normative claim.`);
    }
    if (claim.normative === true && !source.binding) {
      failures.push(`${module.id}: nonbinding source ${source.id} cannot be presented as a legal obligation.`);
    }
    if (source.binding === false && !claim.authorityLabel) {
      warnings.push(`${module.id}: nonbinding source ${source.id} should be labeled as guidance, advisory, or standard.`);
    }
    if (!claim.reference.trim()) failures.push(`${module.id}: source ${source.id} requires a section, control, practice, clause, or page reference.`);
    if (claim.quote && claim.quote.trim().split(/\s+/).length > registry.policy.quoteLimitPerSourceWords) {
      failures.push(`${module.id}: quotation from ${source.id} exceeds the configured word limit.`);
    }
    if (!claim.interpretation) warnings.push(`${module.id}: source claim ${source.id} lacks an interpretation note.`);
    if (!claim.application) warnings.push(`${module.id}: source claim ${source.id} lacks an application note for the learner.`);
  }
}

if (usedSources.size === 0 && modules.some((module) => frameworkPattern.test(JSON.stringify(module)))) {
  failures.push("The course contains standards, legal, or regulatory topics but no authoritative sources were used.");
}

const domain = courseDomain();
if (domain) {
  const policy = registry.domainRequirements?.[domain];
  const preferred = new Set(policy?.preferredSources || []);
  const preferredUsed = [...usedSources].filter((sourceId) => preferred.has(sourceId));
  const preferredBindingUsed = preferredUsed.filter((sourceId) => sources.get(sourceId)?.binding === true);

  if (preferredUsed.length === 0) {
    failures.push(`${domain}: none of the required domain authorities were cited.`);
  }
  if (preferredBindingUsed.length === 0) {
    failures.push(`${domain}: at least one binding statute, regulation, final rule, or contract clause is required.`);
  }
  if (domain === "executive-protection" && !usedSources.has("osh-act-29-usc-654") && !usedSources.has("california-labor-code-6401-9")) {
    failures.push("executive-protection: workplace safety obligations require an applicable occupational safety or workplace violence authority.");
  }
  if (domain === "board-ciso-leadership" && ![...usedSources].some((id) => ["sec-cyber-rule-33-11216", "sec-reg-sk-item-106", "nydfs-23-nycrr-500", "ftc-safeguards-16-cfr-314"].includes(id))) {
    failures.push("board-ciso-leadership: a board, CISO, financial services, or public company authority is required where applicable.");
  }
}

const report = {
  schemaVersion: "1.1",
  courseId,
  domain,
  generatedAt: new Date().toISOString(),
  passed: failures.length === 0,
  usedSources: [...usedSources],
  usedBindingSources: [...usedBindingSources],
  failures,
  warnings,
  policy: registry.policy,
  domainPolicy: domain ? registry.domainRequirements?.[domain] : null,
  proprietaryNotice: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION."
};
const outputDir = path.join(courseDir, "generated", "quality");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "source-grounding-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Source grounding gate ${report.passed ? "PASSED" : "FAILED"} for ${courseId}`);
if (!report.passed) process.exit(1);
