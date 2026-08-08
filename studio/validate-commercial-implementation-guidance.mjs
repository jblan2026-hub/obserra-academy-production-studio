import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  commercialProductionStandard,
  commercialProductionStandardHash,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(
  root,
  "catalog",
  "academy-learner-course-catalog.json",
);
const reportPath = path.join(
  root,
  "catalog",
  "commercial-implementation-guidance-readiness.json",
);
const expectedReviewCourses = Number(
  process.env.ACADEMY_EXPECTED_REVIEW_COURSES || 60,
);

if (!fs.existsSync(catalogPath)) {
  throw new Error(`Learner catalog not found: ${catalogPath}`);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const courses = Array.isArray(catalog.courses) ? catalog.courses : [];
const findings = [];
const releaseBlockers = [];
const summaries = [];

function text(value) {
  return String(value ?? "").trim();
}

function array(value, minimum = 1) {
  return Array.isArray(value) && value.length >= minimum;
}

function validateApplicability(value, prefix, collection) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    collection.push(`${prefix}:missing-applicability`);
    return;
  }
  for (const field of [
    "appliesTo",
    "appliesWhen",
    "doesNotApplyWhen",
    "roles",
    "industries",
    "geographies",
    "systemsOrProcesses",
    "lifecyclePhases",
  ]) {
    if (!Array.isArray(value[field])) {
      collection.push(`${prefix}:applicability-missing-${field}`);
    }
  }
}

function validateRecommendation(value, prefix, collection) {
  for (const field of [
    "priority",
    "recommendation",
    "rationale",
    "effort",
    "costConsiderations",
    "timeToValue",
    "limitations",
  ]) {
    if (!text(value?.[field])) collection.push(`${prefix}:missing-${field}`);
  }
  for (const [field, minimum] of [
    ["appliesTo", 1],
    ["implementationSteps", 3],
    ["evidence", 1],
    ["metrics", 1],
    ["risks", 1],
  ]) {
    if (!array(value?.[field], minimum)) {
      collection.push(`${prefix}:insufficient-${field}`);
    }
  }
  if (!Array.isArray(value?.sourceIds)) {
    collection.push(`${prefix}:missing-source-ids-array`);
  }
}

if (catalog.schemaVersion !== "1.3") {
  findings.push(`unsupported-learner-catalog-schema-${catalog.schemaVersion ?? "missing"}`);
}
if (catalog.productionStandard?.standardId
    !== commercialProductionStandard.standardId) {
  findings.push("catalog-production-standard-id-mismatch");
}
if (catalog.productionStandard?.standardHash
    !== commercialProductionStandardHash()) {
  findings.push("catalog-production-standard-hash-mismatch");
}
if (catalog.productionStandard?.qualityTier !== "commercial-hollywood-grade") {
  findings.push("catalog-quality-tier-mismatch");
}
if (courses.length !== expectedReviewCourses) {
  findings.push(
    `expected-${expectedReviewCourses}-owner-review-courses-found-${courses.length}`,
  );
}

for (const course of courses) {
  const prefix = course.id || course.title || "unknown-course";
  const experience = course.learnerExperience ?? {};
  const courseFindings = [];
  const courseReleaseBlockers = [];
  const modules = Array.isArray(experience.modules) ? experience.modules : [];

  if (course.authoring?.implementationGuidanceStatus
      !== "draft-ai-generated-verification-required") {
    courseFindings.push(`${prefix}:missing-implementation-guidance-status`);
  }
  if (!course.authoring?.implementationGuidanceGeneratedAt) {
    courseFindings.push(`${prefix}:missing-implementation-guidance-timestamp`);
  }
  if (!experience.courseImplementationStrategy) {
    courseFindings.push(`${prefix}:missing-course-implementation-strategy`);
  } else {
    const strategy = experience.courseImplementationStrategy;
    for (const field of [
      "implementationVision",
      "operatingModel",
      "limitationsAndProfessionalAdviceBoundary",
    ]) {
      if (!text(strategy[field])) {
        courseFindings.push(`${prefix}:implementation-strategy-missing-${field}`);
      }
    }
    for (const field of [
      "sequencingStrategy",
      "governanceAndDecisionRights",
      "evidenceStrategy",
      "measurementStrategy",
      "changeAndAdoptionStrategy",
    ]) {
      if (!array(strategy[field])) {
        courseFindings.push(`${prefix}:implementation-strategy-insufficient-${field}`);
      }
    }
  }

  const caseRegister = experience.documentedRealWorldCaseRegister;
  if (!array(caseRegister)) {
    courseFindings.push(`${prefix}:missing-documented-real-world-case-register`);
  }
  for (const [index, item] of (caseRegister ?? []).entries()) {
    const casePrefix = `${prefix}/case-${index + 1}`;
    for (const field of [
      "id",
      "status",
      "title",
      "organizationOrSector",
      "dateOrPeriod",
      "geography",
      "context",
      "eventOrDecision",
      "outcome",
      "limitations",
    ]) {
      if (!text(item?.[field])) {
        courseFindings.push(`${casePrefix}:missing-${field}`);
      }
    }
    for (const field of [
      "moduleIds",
      "successFailureAndTradeoffs",
      "lessons",
      "sourceIds",
    ]) {
      if (!Array.isArray(item?.[field])) {
        courseFindings.push(`${casePrefix}:missing-${field}`);
      }
    }
    validateApplicability(item?.applicability, casePrefix, courseFindings);
    if (item?.status === "documented-public-case"
        && !array(item?.sourceIds)) {
      courseFindings.push(`${casePrefix}:documented-case-missing-source-ids`);
    }
    if (item?.status === "verification-required") {
      if (!text(item?.verificationInstruction)) {
        courseFindings.push(`${casePrefix}:missing-verification-instruction`);
      }
      courseReleaseBlockers.push(`${casePrefix}:source-verification-required`);
    }
  }

  const standardsMap = experience.standardsImplementationMap;
  if (!array(standardsMap)) {
    courseFindings.push(`${prefix}:missing-standards-implementation-map`);
  }
  for (const [index, item] of (standardsMap ?? []).entries()) {
    const mapPrefix = `${prefix}/standards-map-${index + 1}`;
    for (const field of [
      "standardOrFramework",
      "requirementOrControl",
      "classification",
      "implementationObjective",
      "validationMethod",
      "reviewCadence",
      "exceptionsAndResidualRisk",
    ]) {
      if (!text(item?.[field])) {
        courseFindings.push(`${mapPrefix}:missing-${field}`);
      }
    }
    for (const field of [
      "sourceIds",
      "moduleIds",
      "implementationActions",
      "ownerRoles",
      "artifactsAndEvidence",
      "commonPitfalls",
      "doesNotEstablish",
    ]) {
      if (!array(item?.[field])) {
        courseFindings.push(`${mapPrefix}:insufficient-${field}`);
      }
    }
    validateApplicability(item?.applicability, mapPrefix, courseFindings);
  }

  if (!array(experience.prioritizedRecommendations, 3)) {
    courseFindings.push(`${prefix}:insufficient-prioritized-recommendations`);
  } else {
    experience.prioritizedRecommendations.forEach((item, index) => {
      validateRecommendation(
        item,
        `${prefix}/course-recommendation-${index + 1}`,
        courseFindings,
      );
    });
  }

  for (const module of modules) {
    const modulePrefix = `${prefix}/${module.id ?? "unknown-module"}`;
    if (!array(module.documentedRealWorldCases)) {
      courseFindings.push(`${modulePrefix}:missing-documented-real-world-cases`);
    }
    for (const [index, item] of (module.documentedRealWorldCases ?? []).entries()) {
      const casePrefix = `${modulePrefix}/case-${index + 1}`;
      for (const field of [
        "title",
        "context",
        "eventOrDecision",
        "outcome",
        "limitations",
      ]) {
        if (!text(item?.[field])) {
          courseFindings.push(`${casePrefix}:missing-${field}`);
        }
      }
      if (!array(item?.lessons)) {
        courseFindings.push(`${casePrefix}:insufficient-lessons`);
      }
      if (!Array.isArray(item?.sourceIds)) {
        courseFindings.push(`${casePrefix}:missing-source-ids-array`);
      }
      validateApplicability(item?.applicability, casePrefix, courseFindings);
      if (item?.status === "documented-public-case"
          && !array(item?.sourceIds)) {
        courseFindings.push(`${casePrefix}:documented-case-missing-source-ids`);
      }
      if (item?.status === "verification-required") {
        if (!text(item?.verificationInstruction)) {
          courseFindings.push(`${casePrefix}:missing-verification-instruction`);
        }
        courseReleaseBlockers.push(`${casePrefix}:verification-required`);
      }
    }

    const playbook = module.implementationPlaybook;
    if (!playbook) {
      courseFindings.push(`${modulePrefix}:missing-implementation-playbook`);
    } else {
      if (!text(playbook.implementationObjective)) {
        courseFindings.push(`${modulePrefix}:playbook-missing-objective`);
      }
      for (const [field, minimum] of [
        ["prerequisites", 1],
        ["dependenciesAndSequencing", 1],
        ["rolesAndRaci", 1],
        ["steps", 5],
        ["artifactsAndEvidence", 1],
        ["validationAndTesting", 1],
        ["metrics", 1],
      ]) {
        if (!array(playbook[field], minimum)) {
          courseFindings.push(`${modulePrefix}:playbook-insufficient-${field}`);
        }
      }
      if (!text(playbook.maintenanceCadence)) {
        courseFindings.push(`${modulePrefix}:playbook-missing-maintenance-cadence`);
      }
      if (!text(playbook.exceptionsAndResidualRisk)) {
        courseFindings.push(
          `${modulePrefix}:playbook-missing-exceptions-and-residual-risk`,
        );
      }
    }

    if (!array(module.recommendations, 3)) {
      courseFindings.push(`${modulePrefix}:insufficient-module-recommendations`);
    } else {
      module.recommendations.forEach((item, index) => {
        validateRecommendation(
          item,
          `${modulePrefix}/recommendation-${index + 1}`,
          courseFindings,
        );
      });
    }

    if (!array(module.standardImplementationGuidance)) {
      courseFindings.push(`${modulePrefix}:missing-standard-implementation-guidance`);
    }
    for (const [index, item] of (module.standardImplementationGuidance ?? []).entries()) {
      const guidancePrefix = `${modulePrefix}/standard-guidance-${index + 1}`;
      for (const field of [
        "standardOrFramework",
        "requirementOrControl",
        "classification",
        "validationMethod",
        "reviewCadence",
        "exceptionsAndResidualRisk",
      ]) {
        if (!text(item?.[field])) {
          courseFindings.push(`${guidancePrefix}:missing-${field}`);
        }
      }
      for (const field of [
        "implementationActions",
        "evidence",
        "ownerRoles",
        "commonPitfalls",
      ]) {
        if (!array(item?.[field])) {
          courseFindings.push(`${guidancePrefix}:insufficient-${field}`);
        }
      }
      if (!Array.isArray(item?.sourceIds)) {
        courseFindings.push(`${guidancePrefix}:missing-source-ids-array`);
      }
      validateApplicability(item?.applicability, guidancePrefix, courseFindings);
    }

    const evidence = module.evidenceAndMetricsPlan;
    if (!evidence) {
      courseFindings.push(`${modulePrefix}:missing-evidence-and-metrics-plan`);
    } else {
      for (const field of [
        "requiredEvidence",
        "leadingIndicators",
        "laggingIndicators",
        "validationActivities",
        "reportingCadence",
        "ownership",
      ]) {
        if (!array(evidence[field])) {
          courseFindings.push(`${modulePrefix}:evidence-plan-insufficient-${field}`);
        }
      }
    }
  }

  findings.push(...courseFindings);
  releaseBlockers.push(...courseReleaseBlockers);
  summaries.push({
    courseId: prefix,
    moduleCount: modules.length,
    caseCount: Array.isArray(caseRegister) ? caseRegister.length : 0,
    standardsMapCount: Array.isArray(standardsMap) ? standardsMap.length : 0,
    recommendationCount: Array.isArray(experience.prioritizedRecommendations)
      ? experience.prioritizedRecommendations.length
      : 0,
    structuralFindingCount: courseFindings.length,
    releaseBlockerCount: courseReleaseBlockers.length,
  });
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  expectedReviewCourses,
  discoveredCourses: courses.length,
  structurallyReadyForComplianceStaging: findings.length === 0,
  commercialReleaseReady:
    findings.length === 0 && releaseBlockers.length === 0,
  findingCount: findings.length,
  releaseBlockerCount: releaseBlockers.length,
  findings,
  releaseBlockers,
  summaries,
  claimBoundary:
    "This gate verifies real-world case structure, prioritized recommendations, implementation playbooks, standards mappings, evidence, metrics, and educational-advice boundaries. Verification-required case records may enter compliance staging but block commercial release until independently sourced and approved. Publication and checkout remain separately controlled.",
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (findings.length) {
  console.error(
    `[Academy Studio] Commercial implementation-guidance validation failed with ${findings.length} structural finding(s).`,
  );
  for (const finding of findings.slice(0, 300)) console.error(`- ${finding}`);
  process.exit(2);
}

console.log(
  `[Academy Studio] Commercial implementation-guidance structure passed for ${courses.length} course(s); ${releaseBlockers.length} verification blocker(s) remain for compliance resolution before release.`,
);
