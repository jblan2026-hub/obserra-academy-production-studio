import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_POLICY_VERSION,
  validateAuthoringEnvelope,
} from "./authoring-checkpoints.mjs";
import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";
import {
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const courseArgIndex = process.argv.indexOf("--course");
const requestedCourse = courseArgIndex >= 0 ? process.argv[courseArgIndex + 1] : null;
const legalName = officialBrand.legalName;
const proprietaryNotice = officialBrand.ownership.defaultClassification;

if (requestedCourse && !/^[a-z0-9][a-z0-9-]{1,120}$/.test(requestedCourse)) {
  throw new Error("Invalid --course identifier.");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function text(value) {
  return String(value ?? "").trim();
}

function bullets(values, empty = "- None recorded.") {
  return Array.isArray(values) && values.length
    ? values.map((value) => `- ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n")
    : empty;
}

function numberedSteps(values) {
  return Array.isArray(values) && values.length
    ? values.map((value, index) => {
      if (typeof value === "string") return `${index + 1}. ${value}`;
      return `${value.sequence ?? index + 1}. **${value.action ?? "Action"}** — Owners: ${(value.ownerRoles ?? []).join(", ") || "Not assigned"}. Inputs: ${(value.inputs ?? []).join(", ") || "None"}. Outputs: ${(value.outputs ?? []).join(", ") || "None"}. Decision gate: ${value.decisionGate ?? "Not recorded"}. Sources: ${(value.sourceIds ?? []).join(", ") || "None"}.`;
    }).join("\n")
    : "1. No implementation steps recorded.";
}

function renderApplicability(value) {
  const applicability = value ?? {};
  return [
    `- **Applies to:** ${(applicability.appliesTo ?? []).join("; ") || "Not specified"}`,
    `- **Applies when:** ${(applicability.appliesWhen ?? []).join("; ") || "Not specified"}`,
    `- **Does not apply when:** ${(applicability.doesNotApplyWhen ?? []).join("; ") || "Not specified"}`,
    `- **Roles:** ${(applicability.roles ?? []).join("; ") || "Not specified"}`,
    `- **Industries:** ${(applicability.industries ?? []).join("; ") || "Not specified"}`,
    `- **Geographies:** ${(applicability.geographies ?? []).join("; ") || "Not specified"}`,
    `- **Systems or processes:** ${(applicability.systemsOrProcesses ?? []).join("; ") || "Not specified"}`,
    `- **Lifecycle phases:** ${(applicability.lifecyclePhases ?? []).join("; ") || "Not specified"}`,
  ].join("\n");
}

function header(manifest, title) {
  return `> **${legalName}**  \\\n> **${proprietaryNotice}**  \\\n> **${title}**  \\\n> ${manifest.disclaimer?.shortText ?? "Educational and informational use only."}\n\n`;
}

function footer(manifest) {
  return `\n---\n\n${manifest.disclaimer?.shortText ?? "Educational and informational use only."}\n\nThis implementation guidance does not establish certification, compliance, legal sufficiency, audit assurance, regulatory approval, or guaranteed results. Applicability must be evaluated against current authoritative requirements and organization-specific facts.\n\n© ${new Date().getUTCFullYear()} ${legalName}. ${proprietaryNotice}\n`;
}

function renderCase(caseItem, index) {
  return `### Case ${index + 1}: ${caseItem.title}\n\n- **Status:** ${caseItem.status}\n- **Organization or sector:** ${caseItem.organizationOrSector ?? "Not recorded"}\n- **Date or period:** ${caseItem.dateOrPeriod ?? "Not recorded"}\n- **Geography:** ${caseItem.geography ?? "Not recorded"}\n- **Modules:** ${(caseItem.moduleIds ?? []).join(", ") || "Not recorded"}\n- **Sources:** ${(caseItem.sourceIds ?? []).join(", ") || "Pending verification"}\n\n**Context**\n\n${caseItem.context}\n\n**Event or decision**\n\n${caseItem.eventOrDecision}\n\n**Outcome**\n\n${caseItem.outcome}\n\n**Successes, failures, and tradeoffs**\n\n${bullets(caseItem.successFailureAndTradeoffs)}\n\n**Lessons**\n\n${bullets(caseItem.lessons)}\n\n**Where this case applies**\n\n${renderApplicability(caseItem.applicability)}\n\n**Limitations:** ${caseItem.limitations}\n\n**Verification instruction:** ${caseItem.verificationInstruction || "Source verification recorded as complete."}\n`;
}

function renderRecommendation(item, index) {
  return `### Recommendation ${index + 1}: ${item.recommendation}\n\n- **Priority:** ${item.priority}\n- **Rationale:** ${item.rationale}\n- **Applies to:** ${(item.appliesTo ?? []).join("; ")}\n- **Effort:** ${item.effort}\n- **Cost considerations:** ${item.costConsiderations}\n- **Time to value:** ${item.timeToValue}\n- **Dependencies:** ${(item.dependencies ?? []).join("; ") || "None recorded"}\n- **Sources:** ${(item.sourceIds ?? []).join(", ") || "None recorded"}\n\n**Implementation steps**\n\n${numberedSteps(item.implementationSteps)}\n\n**Required evidence**\n\n${bullets(item.evidence)}\n\n**Metrics**\n\n${bullets(item.metrics)}\n\n**Risks**\n\n${bullets(item.risks)}\n\n**Limitations:** ${item.limitations}\n`;
}

function renderStandardsGuidance(item, index) {
  return `### Standards Guidance ${index + 1}: ${item.standardOrFramework}\n\n- **Requirement or control:** ${item.requirementOrControl}\n- **Classification:** ${item.classification}\n- **Sources:** ${(item.sourceIds ?? []).join(", ") || "Pending verification"}\n- **Owner roles:** ${(item.ownerRoles ?? []).join(", ") || "Not assigned"}\n- **Validation method:** ${item.validationMethod}\n- **Review cadence:** ${item.reviewCadence}\n\n**Applicability**\n\n${renderApplicability(item.applicability)}\n\n**Implementation actions**\n\n${numberedSteps(item.implementationActions)}\n\n**Evidence**\n\n${bullets(item.evidence)}\n\n**Common pitfalls**\n\n${bullets(item.commonPitfalls)}\n\n**Exceptions and residual risk:** ${item.exceptionsAndResidualRisk}\n`;
}

function renderModule(module, index) {
  const playbook = module.implementationPlaybook ?? {};
  const evidence = module.evidenceAndMetricsPlan ?? {};
  return `## Module ${index + 1}: ${module.title}\n\n### Documented Real-World Cases and Verification Needs\n\n${(module.documentedRealWorldCases ?? []).map(renderCase).join("\n")}\n\n### Implementation Playbook\n\n**Objective:** ${playbook.implementationObjective ?? ""}\n\n**Prerequisites**\n\n${bullets(playbook.prerequisites)}\n\n**Dependencies and sequencing**\n\n${bullets(playbook.dependenciesAndSequencing)}\n\n**Roles and RACI**\n\n${bullets(playbook.rolesAndRaci)}\n\n**Steps**\n\n${numberedSteps(playbook.steps)}\n\n**Artifacts and evidence**\n\n${bullets(playbook.artifactsAndEvidence)}\n\n**Validation and testing**\n\n${bullets(playbook.validationAndTesting)}\n\n**Metrics**\n\n${bullets(playbook.metrics)}\n\n**Maintenance cadence:** ${playbook.maintenanceCadence ?? ""}\n\n**Exceptions and residual risk:** ${playbook.exceptionsAndResidualRisk ?? ""}\n\n### Prioritized Module Recommendations\n\n${(module.recommendations ?? []).map(renderRecommendation).join("\n")}\n\n### Standards Implementation Guidance\n\n${(module.standardImplementationGuidance ?? []).map(renderStandardsGuidance).join("\n")}\n\n### Evidence and Metrics Plan\n\n**Required evidence**\n\n${bullets(evidence.requiredEvidence)}\n\n**Leading indicators**\n\n${bullets(evidence.leadingIndicators)}\n\n**Lagging indicators**\n\n${bullets(evidence.laggingIndicators)}\n\n**Validation activities**\n\n${bullets(evidence.validationActivities)}\n\n**Reporting cadence**\n\n${bullets(evidence.reportingCadence)}\n\n**Ownership**\n\n${bullets(evidence.ownership)}\n`;
}

function buildGuide(manifest, content) {
  const strategy = content.courseImplementationStrategy ?? {};
  return `${header(manifest, "Real-World Application and Implementation Guide")}# ${manifest.course.title}\n\n## Purpose\n\nThis guide connects detailed course instruction to documented public cases, prioritized recommendations, implementation steps, evidence, metrics, standards, and explicit applicability boundaries. Verification-required records remain blocked from commercial release until independently resolved.\n\n## Course Implementation Strategy\n\n### Implementation Vision\n\n${strategy.implementationVision ?? ""}\n\n### Operating Model\n\n${strategy.operatingModel ?? ""}\n\n### Sequencing Strategy\n\n${bullets(strategy.sequencingStrategy)}\n\n### Governance and Decision Rights\n\n${bullets(strategy.governanceAndDecisionRights)}\n\n### Evidence Strategy\n\n${bullets(strategy.evidenceStrategy)}\n\n### Measurement Strategy\n\n${bullets(strategy.measurementStrategy)}\n\n### Change and Adoption Strategy\n\n${bullets(strategy.changeAndAdoptionStrategy)}\n\n### Limitations and Professional-Advice Boundary\n\n${strategy.limitationsAndProfessionalAdviceBoundary ?? ""}\n\n## Course-Level Documented Cases\n\n${(content.documentedRealWorldCaseRegister ?? []).map(renderCase).join("\n")}\n\n## Course-Level Prioritized Recommendations\n\n${(content.prioritizedRecommendations ?? []).map(renderRecommendation).join("\n")}\n\n## Course Standards Implementation Map\n\n${(content.standardsImplementationMap ?? []).map((item, index) => `### Map ${index + 1}: ${item.standardOrFramework}\n\n- **Requirement or control:** ${item.requirementOrControl}\n- **Classification:** ${item.classification}\n- **Modules:** ${(item.moduleIds ?? []).join(", ")}\n- **Implementation objective:** ${item.implementationObjective}\n- **Owners:** ${(item.ownerRoles ?? []).join(", ")}\n- **Validation:** ${item.validationMethod}\n- **Review cadence:** ${item.reviewCadence}\n\n${renderApplicability(item.applicability)}\n\n**Implementation actions**\n\n${numberedSteps(item.implementationActions)}\n\n**Artifacts and evidence**\n\n${bullets(item.artifactsAndEvidence)}\n\n**Common pitfalls**\n\n${bullets(item.commonPitfalls)}\n\n**Exceptions and residual risk:** ${item.exceptionsAndResidualRisk}\n\n**Does not establish**\n\n${bullets(item.doesNotEstablish)}\n`).join("\n")}\n\n## Module-Level Application and Implementation\n\n${(content.modules ?? []).map(renderModule).join("\n")}\n\n${footer(manifest)}`;
}

function assertStructure(content, courseId) {
  if (!content?.courseImplementationStrategy) {
    throw new Error(`${courseId}: missing course implementation strategy.`);
  }
  if (!Array.isArray(content.documentedRealWorldCaseRegister)
      || content.documentedRealWorldCaseRegister.length === 0) {
    throw new Error(`${courseId}: missing documented real-world case register.`);
  }
  if (!Array.isArray(content.standardsImplementationMap)
      || content.standardsImplementationMap.length === 0) {
    throw new Error(`${courseId}: missing standards implementation map.`);
  }
  if (!Array.isArray(content.prioritizedRecommendations)
      || content.prioritizedRecommendations.length < 3) {
    throw new Error(`${courseId}: insufficient prioritized recommendations.`);
  }
  for (const module of content.modules ?? []) {
    if (!Array.isArray(module.documentedRealWorldCases)
        || module.documentedRealWorldCases.length === 0
        || !module.implementationPlaybook
        || !Array.isArray(module.recommendations)
        || module.recommendations.length < 3
        || !Array.isArray(module.standardImplementationGuidance)
        || module.standardImplementationGuidance.length === 0
        || !module.evidenceAndMetricsPlan) {
      throw new Error(`${courseId}/${module.id}: incomplete real-world application or implementation guidance.`);
    }
  }
}

if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
const entries = fs.readdirSync(coursesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => !requestedCourse || entry.name === requestedCourse)
  .sort((left, right) => left.name.localeCompare(right.name));
const results = [];
const failures = [];

for (const entry of entries) {
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(manifestPath)) continue;
  try {
    if (!fs.existsSync(packagePath)) throw new Error("Governed authoring package is missing.");
    const manifest = readJson(manifestPath);
    assertBrandAndTags(manifest, manifestPath);
    const envelope = readJson(packagePath);
    const identity = validateAuthoringEnvelope({
      courseId: manifest.course.id,
      envelope,
      manifest,
    });
    if (envelope.authoringPolicyVersion !== AUTHORING_POLICY_VERSION
        || envelope.implementationGuidanceStatus !== "draft-ai-generated-verification-required") {
      throw new Error("Implementation guidance is missing or stale.");
    }
    assertStructure(envelope.content, manifest.course.id);

    atomicWrite(
      path.join(courseDir, "implementation-and-application-guide.md"),
      buildGuide(manifest, envelope.content),
    );
    for (const [fileName, value] of [
      ["documented-real-world-case-register.json", envelope.content.documentedRealWorldCaseRegister],
      ["course-implementation-strategy.json", envelope.content.courseImplementationStrategy],
      ["standards-implementation-map.json", envelope.content.standardsImplementationMap],
      ["prioritized-recommendations.json", envelope.content.prioritizedRecommendations],
      ["implementation-guidance.json", {
        schemaVersion: "1.0",
        courseId: manifest.course.id,
        authoringPolicyVersion: AUTHORING_POLICY_VERSION,
        authoringPackageHash: identity.packageHash,
        contractId: workerPoolContract.contractId,
        contractHash: contractHash(),
        productionStandardId: commercialProductionStandard.standardId,
        productionStandardHash: commercialProductionStandardHash(),
        qualityTier: commercialProductionStandard.qualityTier,
        status: "draft-ai-generated-verification-required",
        modules: (envelope.content.modules ?? []).map((module) => ({
          moduleId: module.id,
          documentedRealWorldCases: module.documentedRealWorldCases,
          implementationPlaybook: module.implementationPlaybook,
          recommendations: module.recommendations,
          standardImplementationGuidance: module.standardImplementationGuidance,
          evidenceAndMetricsPlan: module.evidenceAndMetricsPlan,
        })),
      }],
    ]) {
      atomicWrite(path.join(courseDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
    }

    results.push({
      courseId: manifest.course.id,
      authoringPackageHash: identity.packageHash,
      caseCount: envelope.content.documentedRealWorldCaseRegister.length,
      standardsMapCount: envelope.content.standardsImplementationMap.length,
      recommendationCount: envelope.content.prioritizedRecommendations.length,
      moduleCount: envelope.content.modules.length,
      status: "implementation-guidance-materialized",
    });
  } catch (error) {
    failures.push({
      courseId: entry.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  requestedCourse,
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  materializedCourses: results.length,
  failureCount: failures.length,
  publicationAllowed: false,
  checkoutAllowed: false,
  results,
  failures,
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
atomicWrite(
  path.join(root, "catalog", "commercial-implementation-materialization.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(2);
