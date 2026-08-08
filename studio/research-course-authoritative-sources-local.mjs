import "./academy-zero-cost-lock.mjs";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const courseId = arg("--course");
if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  throw new Error("Usage: node studio/research-course-authoritative-sources-local.mjs --course <course-id>");
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const registryPath = path.join(root, "sources", "authoritative-sources.json");
const casesPath = path.join(root, "sources", "documented-cases.json");
const freeContextPath = path.join(courseDir, "generated", "research", "free-source-context.json");
if (!fs.existsSync(manifestPath)) throw new Error(`Course manifest not found for ${courseId}.`);
if (!fs.existsSync(registryPath)) throw new Error("Governed authoritative source registry is missing.");
if (!fs.existsSync(casesPath)) throw new Error("Governed documented-case registry is missing.");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const caseRegistry = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const freeContext = fs.existsSync(freeContextPath)
  ? JSON.parse(fs.readFileSync(freeContextPath, "utf8"))
  : null;
const course = manifest.course || {};
const modules = Array.isArray(course.modules) ? course.modules : [];
const excerptLimit = Math.max(
  1_500,
  Math.min(6_000, Number(process.env.ACADEMY_LOCAL_RESEARCH_EXCERPT_CHARS || 3_000)),
);
const sourceTarget = Math.max(
  4,
  Math.min(8, Number(process.env.ACADEMY_DIRECT_SOURCE_TARGET || 6)),
);
const caseTarget = Math.max(
  2,
  Math.min(5, Number(process.env.ACADEMY_DOCUMENTED_CASE_TARGET || 3)),
);

const allowedPrimaryDomains = [
  ".gov",
  ".mil",
  ".int",
  "nist.gov",
  "csrc.nist.gov",
  "sec.gov",
  "ecfr.gov",
  "federalregister.gov",
  "fda.gov",
  "hhs.gov",
  "cms.gov",
  "ftc.gov",
  "dfs.ny.gov",
  "dol.gov",
  "osha.gov",
  "acquisition.gov",
  "defense.gov",
  "dodcio.defense.gov",
  "state.gov",
  "justice.gov",
  "congress.gov",
  "uscode.house.gov",
  "iso.org",
  "iec.ch",
  "pcisecuritystandards.org",
  "cisecurity.org",
  "pmi.org",
  "owasp.org",
  "cloudsecurityalliance.org",
];

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function primaryDomainAllowed(url) {
  const host = hostname(url);
  return Boolean(
    host &&
      allowedPrimaryDomains.some((domain) =>
        domain.startsWith(".")
          ? host.endsWith(domain)
          : host === domain || host.endsWith(`.${domain}`),
      ),
  );
}

function words(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

function tokens(value) {
  return new Set(words(value));
}

function recordText(record) {
  return [
    record.title,
    record.publication,
    record.issuer,
    record.organizationOrEvent,
    record.sourceAuthority,
    ...(record.topics || []),
    ...(record.factsSupported || []),
    ...(record.lessonsLearned || []),
    ...(record.implementationRecommendations || []),
  ].join(" ");
}

function overlapScore(record, queryTokens) {
  const recordTokens = tokens(recordText(record));
  let score = 0;
  for (const word of queryTokens) if (recordTokens.has(word)) score += 1;
  if (record.binding) score += 0.25;
  if (record.status && record.status !== "draft") score += 0.1;
  return score;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function stripHtml(raw) {
  return String(raw || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function recordUrl(record, kind) {
  return kind === "documented-case" ? record.primarySourceUrl : record.canonicalUrl;
}

function cachedPrimaryRecord(record, kind) {
  const canonicalUrl = recordUrl(record, kind);
  const excerpt = String(record.cachedExcerpt || "").trim().slice(0, excerptLimit);
  if (
    record.cacheAvailable !== true ||
    !record.cacheSha256 ||
    excerpt.length < 200 ||
    !canonicalUrl ||
    !primaryDomainAllowed(canonicalUrl)
  ) {
    return null;
  }
  return {
    record,
    kind,
    verified: true,
    cacheHit: true,
    status: 200,
    finalUrl: canonicalUrl,
    contentType: record.cacheContentType || "text/plain",
    observedAt: record.cacheFetchedAt || null,
    sha256: record.cacheSha256,
    excerpt,
  };
}

async function fetchPrimaryRecord(record, kind) {
  const cached = cachedPrimaryRecord(record, kind);
  if (cached) return cached;

  const canonicalUrl = recordUrl(record, kind);
  if (!canonicalUrl || !primaryDomainAllowed(canonicalUrl)) {
    return {
      record,
      kind,
      verified: false,
      cacheHit: false,
      error: "invalid-or-non-primary-url",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.ACADEMY_DIRECT_SOURCE_TIMEOUT_MS || 25_000),
  );
  try {
    const response = await fetch(canonicalUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Obserra-Academy-Source-Verification/1.3 (+primary-source-validation)",
        Accept:
          "text/html,application/xhtml+xml,application/json,text/plain,application/pdf;q=0.8,*/*;q=0.5",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      return {
        record,
        kind,
        verified: false,
        cacheHit: false,
        status: response.status,
        finalUrl: response.url,
        contentType,
        error: `http-${response.status}`,
      };
    }

    let excerpt = "";
    let sha256 = null;
    if (!contentType.toLowerCase().includes("application/pdf")) {
      const raw = await response.text();
      sha256 = crypto.createHash("sha256").update(raw).digest("hex");
      excerpt = stripHtml(raw).slice(0, excerptLimit);
    }
    return {
      record,
      kind,
      verified: excerpt.length >= 200,
      cacheHit: false,
      status: response.status,
      finalUrl: response.url,
      contentType,
      observedAt: new Date().toISOString(),
      sha256,
      excerpt,
      error: excerpt.length >= 200 ? null : "primary-source-text-unavailable",
    };
  } catch (error) {
    return {
      record,
      kind,
      verified: false,
      cacheHit: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function courseQueryTokens() {
  return tokens(
    [
      course.title,
      course.department,
      course.track,
      course.description,
      ...(course.outcomes || []),
      ...(manifest.tags?.frameworks || []),
      ...modules.flatMap((module) => [module.title, module.description, module.format]),
    ].join(" "),
  );
}

function moduleQueryTokens(module) {
  return tokens(
    [
      course.title,
      course.description,
      ...(course.outcomes || []),
      module.title,
      module.description,
      module.format,
    ].join(" "),
  );
}

function rankedForModule(records, module) {
  const query = moduleQueryTokens(module);
  return [...records].sort((left, right) => {
    const rightScore = overlapScore(right.record, query);
    const leftScore = overlapScore(left.record, query);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return String(left.record.id).localeCompare(String(right.record.id));
  });
}

function sourceApplicability(source) {
  const authorityClass = source.binding ? "binding authority" : "nonbinding guidance or standard";
  return `Use ${source.title} as ${authorityClass} only after confirming that its jurisdiction, sector, data, system, product, contract, and activity scope apply to the learner's organization and decision.`;
}

function sourceAppliesWhen(source) {
  return uniqueStrings([
    ...(source.appliesWhen || []),
    `The organization or use case falls within the documented scope of ${source.issuingAuthority || source.issuer || "the issuing authority"}.`,
    `The current version, effective status, jurisdiction, and organization-specific applicability of ${source.title} have been verified before implementation.`,
  ]);
}

function sourceDoesNotApplyWhen(source) {
  return uniqueStrings([
    ...(source.doesNotApplyWhen || []),
    "The organization, jurisdiction, sector, data, product, contract, or activity is outside the source's documented scope.",
    ...(source.binding
      ? []
      : ["The source is being treated as a mandatory legal requirement without separate binding authority or contractual adoption."]),
  ]);
}

function sourceLimitations(source) {
  return uniqueStrings([
    ...(source.limitations || []),
    "This course uses the source for instruction and does not make a legal, regulatory, certification, audit, or compliance determination.",
    ...(String(source.status || "").toLowerCase() === "draft"
      ? ["The source is a draft and may change before final publication."]
      : []),
  ]);
}

const queryTokens = courseQueryTokens();
const rankedSources =
  Array.isArray(freeContext?.matchedSources) && freeContext.courseId === courseId
    ? freeContext.matchedSources
    : (registry.sources || [])
        .filter((source) => source.canonicalUrl && primaryDomainAllowed(source.canonicalUrl))
        .map((source) => ({ ...source, matchScore: overlapScore(source, queryTokens) }))
        .sort(
          (left, right) =>
            Number(right.matchScore || 0) - Number(left.matchScore || 0) ||
            String(left.id).localeCompare(String(right.id)),
        );
const rankedCases =
  Array.isArray(freeContext?.matchedCases) && freeContext.courseId === courseId
    ? freeContext.matchedCases
    : (caseRegistry.cases || [])
        .filter((item) => item.primarySourceUrl && primaryDomainAllowed(item.primarySourceUrl))
        .map((item) => ({ ...item, matchScore: overlapScore(item, queryTokens) }))
        .sort(
          (left, right) =>
            Number(right.matchScore || 0) - Number(left.matchScore || 0) ||
            String(left.id).localeCompare(String(right.id)),
        );

const sourceCandidates = rankedSources.slice(
  0,
  Math.max(8, Number(process.env.ACADEMY_DIRECT_SOURCE_CANDIDATES || 10)),
);
const caseCandidates = rankedCases.slice(
  0,
  Math.max(4, Number(process.env.ACADEMY_DOCUMENTED_CASE_CANDIDATES || 6)),
);
const sourceVerification = await Promise.all(
  sourceCandidates.map((source) => fetchPrimaryRecord(source, "authority")),
);
const caseVerification = await Promise.all(
  caseCandidates.map((item) => fetchPrimaryRecord(item, "documented-case")),
);
const verifiedSources = sourceVerification.filter((item) => item.verified).slice(0, sourceTarget);
const verifiedCases = caseVerification.filter((item) => item.verified).slice(0, caseTarget);

if (verifiedSources.length < 4 || verifiedCases.length < 2) {
  const unresolvedTopics = [
    ...(verifiedSources.length < 4
      ? [`Only ${verifiedSources.length} usable governed primary authorities were available; minimum 4 required.`]
      : []),
    ...(verifiedCases.length < 2
      ? [`Only ${verifiedCases.length} usable documented primary-source cases were available; minimum 2 required.`]
      : []),
  ];
  const evidence = {
    schemaVersion: "2.2",
    generatedAt: new Date().toISOString(),
    courseId,
    manifestHash: stableHash(manifest),
    provider: "local",
    model: "deterministic-governed-primary-source-synthesis-v1",
    estimatedModelCostUsd: 0,
    primaryCacheUsed: [...sourceVerification, ...caseVerification].some((item) => item.cacheHit),
    directPrimaryFetchUsed: [...sourceVerification, ...caseVerification].some(
      (item) => !item.cacheHit,
    ),
    webSearchUsed: false,
    sourceCount: verifiedSources.length,
    documentedCaseCount: verifiedCases.length,
    unresolvedTopics,
    findings: [
      ...(verifiedSources.length < 4 ? ["insufficient-governed-primary-authorities"] : []),
      ...(verifiedCases.length < 2 ? ["insufficient-governed-documented-cases"] : []),
    ],
    passed: false,
    sourceVerification: sourceVerification.map(({ excerpt, ...item }) => item),
    caseVerification: caseVerification.map(({ excerpt, ...item }) => item),
    research: null,
  };
  writeJsonAtomic(
    path.join(courseDir, "generated", "research", "authoritative-source-research.json"),
    evidence,
  );
  console.error(
    `[Academy Studio] Zero-cost governed research FAILED for ${courseId}: ${verifiedSources.length} authorities and ${verifiedCases.length} documented cases.`,
  );
  process.exit(2);
}

const sourceModuleMap = new Map(verifiedSources.map((item) => [String(item.record.id), new Set()]));
const caseModuleMap = new Map(verifiedCases.map((item) => [String(item.record.id), new Set()]));
const moduleResearch = modules.map((module) => {
  const selectedSources = rankedForModule(verifiedSources, module).slice(
    0,
    Math.min(4, verifiedSources.length),
  );
  const selectedCases = rankedForModule(verifiedCases, module).slice(
    0,
    Math.min(2, verifiedCases.length),
  );
  for (const source of selectedSources) sourceModuleMap.get(String(source.record.id))?.add(module.id);
  for (const item of selectedCases) caseModuleMap.get(String(item.record.id))?.add(module.id);

  const factualClaimsToTeach = uniqueStrings([
    ...selectedSources.map((item) => {
      const source = item.record;
      const topics = uniqueStrings(source.topics || []).slice(0, 4).join(", ");
      return `${source.title}${source.publication ? ` (${source.publication})` : ""} is classified in the governed registry as ${source.binding ? "binding" : "nonbinding"} ${source.authorityType || "authority"}${topics ? ` addressing ${topics}` : ""}; instruction must preserve that status and its applicability limits.`;
    }),
    ...selectedCases.flatMap((item) => (item.record.factsSupported || []).slice(0, 2)),
  ]);
  const lessonsLearned = uniqueStrings([
    ...selectedCases.flatMap((item) => item.record.lessonsLearned || []),
    "Defensible decisions distinguish verified authority, nonbinding guidance, documented case facts, organizational policy, and original instructional judgment.",
  ]);
  const implementationRecommendations = uniqueStrings([
    ...selectedCases.flatMap((item) => item.record.implementationRecommendations || []),
    ...selectedSources.slice(0, 2).map(
      (item) =>
        `Document applicability, accountable owner, evidence, review date, exceptions, and escalation before translating ${item.record.title} into organizational policy, process, or control design.`,
    ),
  ]);

  return {
    moduleId: module.id,
    sourceIds: selectedSources.map((item) => item.record.id),
    caseIds: selectedCases.map((item) => item.record.id),
    factualClaimsToTeach,
    lessonsLearned,
    implementationRecommendations,
  };
});

for (const item of verifiedSources) {
  const key = String(item.record.id);
  if ((sourceModuleMap.get(key)?.size || 0) === 0 && modules[0]) sourceModuleMap.get(key).add(modules[0].id);
}
for (const item of verifiedCases) {
  const key = String(item.record.id);
  if ((caseModuleMap.get(key)?.size || 0) === 0 && modules[0]) caseModuleMap.get(key).add(modules[0].id);
}

const authoritativeSources = verifiedSources.map((item) => {
  const source = item.record;
  return {
    id: source.id,
    title: source.title,
    issuingAuthority: source.issuer,
    sourceType: source.authorityType || "official-guidance",
    publication: source.publication || source.title,
    publicationDate: source.published || null,
    status: source.status || "current-guidance",
    binding: Boolean(source.binding),
    canonicalUrl: source.canonicalUrl,
    specificReferences: uniqueStrings([source.publication, source.title]),
    moduleIds: [...sourceModuleMap.get(String(source.id))],
    claimTopics: uniqueStrings(source.topics || []),
    applicability: sourceApplicability(source),
    appliesWhen: sourceAppliesWhen(source),
    doesNotApplyWhen: sourceDoesNotApplyWhen(source),
    limitations: sourceLimitations(source),
    verificationNotes: `Verified from the governed primary-source cache or direct primary-source retrieval. Observed ${item.observedAt || "during the current production run"}; content SHA-256 ${item.sha256 || "not available for this content type"}.`,
  };
});

const documentedCases = verifiedCases.map((item) => {
  const record = item.record;
  return {
    id: record.id,
    title: record.title,
    organizationOrEvent: record.organizationOrEvent,
    date: record.date || null,
    primarySourceUrl: record.primarySourceUrl,
    sourceAuthority: record.sourceAuthority,
    moduleIds: [...caseModuleMap.get(String(record.id))],
    factsSupported: uniqueStrings(record.factsSupported || []),
    lessonsLearned: uniqueStrings(record.lessonsLearned || []),
    implementationRecommendations: uniqueStrings(record.implementationRecommendations || []),
    limitations: uniqueStrings([
      ...(record.limitations || []),
      "Use this documented event as an instructional case only; do not generalize its facts or legal posture beyond the primary source and applicable context.",
    ]),
  };
});

const research = {
  courseId,
  researchDate: new Date().toISOString().slice(0, 10),
  authoritativeSources,
  documentedCases,
  moduleResearch,
  unresolvedTopics: [],
};

const suppliedById = new Map(authoritativeSources.map((source) => [String(source.id), source]));
const suppliedCasesById = new Map(documentedCases.map((item) => [String(item.id), item]));
const moduleIds = new Set(modules.map((module) => String(module.id)));
const findings = [];
if (authoritativeSources.length < 4) {
  findings.push(`authoritative-source-count-${authoritativeSources.length}-minimum-4`);
}
if (documentedCases.length < 2) {
  findings.push(`documented-case-count-${documentedCases.length}-minimum-2`);
}
for (const [index, source] of authoritativeSources.entries()) {
  const prefix = `source-${index + 1}`;
  if (!source.canonicalUrl || !primaryDomainAllowed(source.canonicalUrl)) {
    findings.push(`${prefix}-canonical-url-invalid`);
  }
  if (!Array.isArray(source.moduleIds) || source.moduleIds.length === 0) {
    findings.push(`${prefix}-missing-module-ids`);
  }
  for (const moduleId of source.moduleIds || []) {
    if (!moduleIds.has(String(moduleId))) findings.push(`${prefix}-unknown-module-${moduleId}`);
  }
  if (!Array.isArray(source.specificReferences) || source.specificReferences.length === 0) {
    findings.push(`${prefix}-missing-specific-references`);
  }
  if (!Array.isArray(source.appliesWhen) || source.appliesWhen.length === 0) {
    findings.push(`${prefix}-missing-applies-when`);
  }
  if (!Array.isArray(source.doesNotApplyWhen) || source.doesNotApplyWhen.length === 0) {
    findings.push(`${prefix}-missing-does-not-apply-when`);
  }
  if (!Array.isArray(source.limitations) || source.limitations.length === 0) {
    findings.push(`${prefix}-missing-limitations`);
  }
}
for (const [index, item] of documentedCases.entries()) {
  const prefix = `case-${index + 1}`;
  if (!item.primarySourceUrl || !primaryDomainAllowed(item.primarySourceUrl)) {
    findings.push(`${prefix}-primary-source-url-invalid`);
  }
  if (!Array.isArray(item.moduleIds) || item.moduleIds.length === 0) {
    findings.push(`${prefix}-missing-module-ids`);
  }
  for (const moduleId of item.moduleIds || []) {
    if (!moduleIds.has(String(moduleId))) findings.push(`${prefix}-unknown-module-${moduleId}`);
  }
  if (!Array.isArray(item.factsSupported) || item.factsSupported.length === 0) {
    findings.push(`${prefix}-missing-supported-facts`);
  }
  if (!Array.isArray(item.lessonsLearned) || item.lessonsLearned.length === 0) {
    findings.push(`${prefix}-missing-lessons-learned`);
  }
  if (
    !Array.isArray(item.implementationRecommendations) ||
    item.implementationRecommendations.length === 0
  ) {
    findings.push(`${prefix}-missing-implementation-recommendations`);
  }
  if (!Array.isArray(item.limitations) || item.limitations.length === 0) {
    findings.push(`${prefix}-missing-limitations`);
  }
}
const researchByModule = new Map(moduleResearch.map((item) => [String(item.moduleId), item]));
for (const module of modules) {
  const item = researchByModule.get(String(module.id));
  if (!item) {
    findings.push(`module-${module.id}-missing-research`);
    continue;
  }
  if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) {
    findings.push(`module-${module.id}-missing-source-ids`);
  }
  for (const sourceId of item.sourceIds || []) {
    if (!suppliedById.has(String(sourceId))) {
      findings.push(`module-${module.id}-unknown-source-${sourceId}`);
    }
  }
  for (const caseId of item.caseIds || []) {
    if (!suppliedCasesById.has(String(caseId))) {
      findings.push(`module-${module.id}-unknown-case-${caseId}`);
    }
  }
  if (!Array.isArray(item.factualClaimsToTeach) || item.factualClaimsToTeach.length === 0) {
    findings.push(`module-${module.id}-missing-factual-claims`);
  }
  if (!Array.isArray(item.lessonsLearned) || item.lessonsLearned.length === 0) {
    findings.push(`module-${module.id}-missing-lessons-learned`);
  }
  if (
    !Array.isArray(item.implementationRecommendations) ||
    item.implementationRecommendations.length === 0
  ) {
    findings.push(`module-${module.id}-missing-implementation-recommendations`);
  }
}

const evidence = {
  schemaVersion: "2.2",
  generatedAt: new Date().toISOString(),
  courseId,
  manifestHash: stableHash(manifest),
  provider: "local",
  model: "deterministic-governed-primary-source-synthesis-v1",
  estimatedModelCostUsd: 0,
  webSearchUsed: false,
  primaryCacheUsed: [...sourceVerification, ...caseVerification].some((item) => item.cacheHit),
  directPrimaryFetchUsed: [...sourceVerification, ...caseVerification].some(
    (item) => !item.cacheHit,
  ),
  responseMode: "deterministic-governed-primary-source-synthesis",
  primarySourcePolicy: allowedPrimaryDomains,
  sourceCount: authoritativeSources.length,
  documentedCaseCount: documentedCases.length,
  unresolvedTopics: [],
  findings,
  passed: findings.length === 0,
  sourceVerification: sourceVerification.map(({ excerpt, ...item }) => item),
  caseVerification: caseVerification.map(({ excerpt, ...item }) => item),
  research,
};
const evidencePath = path.join(
  courseDir,
  "generated",
  "research",
  "authoritative-source-research.json",
);
writeJsonAtomic(evidencePath, evidence);
writeJsonAtomic(path.join(courseDir, "authoritative-sources.generated.json"), research);
console.log(
  `[Academy Studio] Zero-cost deterministic research ${evidence.passed ? "PASSED" : "FAILED"} for ${courseId}: ${authoritativeSources.length} authorities, ${documentedCases.length} documented cases, ${findings.length} finding(s), ${evidence.primaryCacheUsed ? "cache-first" : "direct-primary-source"}.`,
);
if (!evidence.passed) process.exit(2);
