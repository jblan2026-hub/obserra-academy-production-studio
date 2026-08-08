import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProviderAuthoringError,
  providerAuthoringErrorFromHttp,
} from "./authoring-provider-errors.mjs";
import {
  ProviderTransportError,
  providerHttpRequest,
} from "./provider-http.mjs";
import {
  commercialProductionStandard,
  commercialProductionStandardHash,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const courseId = arg("--course");
const provider = (arg("--provider") || process.env.ACADEMY_AUTHORING_PROVIDER || "openai").toLowerCase();
const requestTimeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS,
  15 * 60 * 1000,
  60 * 1000,
  30 * 60 * 1000,
);

if (!courseId || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) {
  console.error("Usage: node studio/enrich-commercial-implementation-guidance.mjs --course <course-id> [--provider openai|anthropic]");
  process.exit(1);
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
if (!fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) {
  throw new Error(`Manifest or governed authoring package is missing for ${courseId}.`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function providerHeaders(providerName, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (providerName === "openai") {
    headers.Authorization = `Bearer ${apiKey}`;
    const organization = String(process.env.OPENAI_ORGANIZATION ?? "").trim();
    const project = String(process.env.OPENAI_PROJECT ?? "").trim();
    if (organization) headers["OpenAI-Organization"] = organization;
    if (project) headers["OpenAI-Project"] = project;
  }
  return headers;
}

async function request(providerName, url, init) {
  try {
    return await providerHttpRequest({
      provider: providerName,
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
      timeoutMs: requestTimeoutMs,
    });
  } catch (error) {
    if (error instanceof ProviderTransportError) {
      throw new ProviderAuthoringError({
        provider: providerName.toLowerCase(),
        category: "provider_transient_failure",
        retryable: true,
        exitCode: 1,
        providerCode: error.category,
        message: error.message,
      });
    }
    throw error;
  }
}

async function boundedErrorText(response) {
  const text = await response.text();
  return text.length > 4000 ? `${text.slice(0, 4000)}...[truncated]` : text;
}

async function providerHttpError(providerName, response) {
  return providerAuthoringErrorFromHttp({
    provider: providerName,
    status: response.status,
    body: await boundedErrorText(response),
  });
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  const response = await request(
    "OpenAI",
    process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: providerHeaders("openai", apiKey),
      body: JSON.stringify({
        model: process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
        input: prompt,
        text: { format: { type: "json_object" } },
        reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "high" },
      }),
    },
  );
  if (!response.ok) throw await providerHttpError("openai", response);
  const payload = await response.json();
  const text = payload.output_text
    || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI response did not contain output text");
  return text;
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  const response = await request(
    "Anthropic",
    process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5",
        max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 64000),
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
    },
  );
  if (!response.ok) throw await providerHttpError("anthropic", response);
  const payload = await response.json();
  const text = payload.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Anthropic response did not contain text");
  return text;
}

function parseJson(text) {
  return JSON.parse(text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim());
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyArray(value, minimum = 1) {
  return Array.isArray(value) && value.length >= minimum;
}

function validateSupplement(supplement, manifest, sourceIds) {
  if (!supplement || typeof supplement !== "object" || Array.isArray(supplement)) {
    throw new Error("Implementation supplement is not a JSON object.");
  }
  if (!supplement.courseImplementationStrategy || typeof supplement.courseImplementationStrategy !== "object") {
    throw new Error("Course implementation strategy is missing.");
  }
  if (!nonEmptyArray(supplement.documentedRealWorldCaseRegister)) {
    throw new Error("Documented real-world case register is missing.");
  }
  if (!nonEmptyArray(supplement.standardsImplementationMap)) {
    throw new Error("Standards implementation map is missing.");
  }
  if (!nonEmptyArray(supplement.prioritizedRecommendations, 3)) {
    throw new Error("Course-level prioritized recommendations are incomplete.");
  }

  const expectedModuleIds = manifest.course.modules.map((module) => module.id);
  const receivedModules = Array.isArray(supplement.modules) ? supplement.modules : [];
  if (receivedModules.length !== expectedModuleIds.length) {
    throw new Error(`Implementation supplement expected ${expectedModuleIds.length} modules and received ${receivedModules.length}.`);
  }
  const receivedIds = new Set(receivedModules.map((module) => module.id));
  for (const moduleId of expectedModuleIds) {
    if (!receivedIds.has(moduleId)) throw new Error(`Implementation supplement is missing module ${moduleId}.`);
  }

  for (const module of receivedModules) {
    const prefix = `${courseId}/${module.id}`;
    if (!nonEmptyArray(module.documentedRealWorldCases)) {
      throw new Error(`${prefix} requires at least one documented public case or explicit verification-required case need.`);
    }
    for (const item of module.documentedRealWorldCases) {
      if (!nonEmptyString(item.title)
          || !nonEmptyString(item.context)
          || !nonEmptyString(item.eventOrDecision)
          || !nonEmptyString(item.outcome)
          || !nonEmptyArray(item.lessons)
          || !item.applicability
          || !nonEmptyString(item.limitations)) {
        throw new Error(`${prefix} contains an incomplete real-world case record.`);
      }
      const ids = Array.isArray(item.sourceIds) ? item.sourceIds : [];
      for (const sourceId of ids) {
        if (!sourceIds.has(sourceId)) throw new Error(`${prefix} references unknown source ${sourceId}.`);
      }
      if (item.status === "documented-public-case" && ids.length === 0) {
        throw new Error(`${prefix} documented public case is missing source IDs.`);
      }
      if (item.status === "verification-required" && !nonEmptyString(item.verificationInstruction)) {
        throw new Error(`${prefix} verification-required case is missing a verification instruction.`);
      }
    }

    const playbook = module.implementationPlaybook;
    if (!playbook
        || !nonEmptyString(playbook.implementationObjective)
        || !nonEmptyArray(playbook.prerequisites)
        || !nonEmptyArray(playbook.dependenciesAndSequencing)
        || !nonEmptyArray(playbook.rolesAndRaci)
        || !nonEmptyArray(playbook.steps, 5)
        || !nonEmptyArray(playbook.artifactsAndEvidence)
        || !nonEmptyArray(playbook.validationAndTesting)
        || !nonEmptyArray(playbook.metrics)
        || !nonEmptyString(playbook.maintenanceCadence)
        || !nonEmptyString(playbook.exceptionsAndResidualRisk)) {
      throw new Error(`${prefix} implementation playbook is incomplete.`);
    }

    if (!nonEmptyArray(module.recommendations, 3)) {
      throw new Error(`${prefix} requires at least three prioritized recommendations.`);
    }
    for (const recommendation of module.recommendations) {
      if (!nonEmptyString(recommendation.priority)
          || !nonEmptyString(recommendation.recommendation)
          || !nonEmptyString(recommendation.rationale)
          || !nonEmptyArray(recommendation.appliesTo)
          || !nonEmptyArray(recommendation.implementationSteps, 3)
          || !nonEmptyArray(recommendation.evidence)
          || !nonEmptyArray(recommendation.metrics)
          || !nonEmptyString(recommendation.effort)
          || !nonEmptyString(recommendation.costConsiderations)
          || !nonEmptyString(recommendation.timeToValue)
          || !nonEmptyArray(recommendation.risks)
          || !nonEmptyString(recommendation.limitations)) {
        throw new Error(`${prefix} contains an incomplete recommendation.`);
      }
    }

    if (!nonEmptyArray(module.standardImplementationGuidance)) {
      throw new Error(`${prefix} requires standards implementation guidance.`);
    }
    for (const guidance of module.standardImplementationGuidance) {
      if (!nonEmptyString(guidance.standardOrFramework)
          || !nonEmptyString(guidance.requirementOrControl)
          || !nonEmptyString(guidance.classification)
          || !guidance.applicability
          || !nonEmptyArray(guidance.implementationActions)
          || !nonEmptyArray(guidance.evidence)
          || !nonEmptyArray(guidance.ownerRoles)
          || !nonEmptyString(guidance.validationMethod)
          || !nonEmptyString(guidance.reviewCadence)
          || !nonEmptyArray(guidance.commonPitfalls)
          || !nonEmptyString(guidance.exceptionsAndResidualRisk)) {
        throw new Error(`${prefix} contains incomplete standards implementation guidance.`);
      }
    }

    const evidence = module.evidenceAndMetricsPlan;
    if (!evidence
        || !nonEmptyArray(evidence.requiredEvidence)
        || !nonEmptyArray(evidence.leadingIndicators)
        || !nonEmptyArray(evidence.laggingIndicators)
        || !nonEmptyArray(evidence.validationActivities)
        || !nonEmptyArray(evidence.reportingCadence)
        || !nonEmptyArray(evidence.ownership)) {
      throw new Error(`${prefix} evidence and metrics plan is incomplete.`);
    }
  }

  return supplement;
}

function buildPrompt(manifest, envelope) {
  const content = envelope.content ?? {};
  const compactContext = {
    course: manifest.course,
    completion: manifest.completion,
    frameworkTags: manifest.tags?.frameworks ?? [],
    sourceRegister: content.sourceRegister ?? [],
    referenceApplicabilityMatrix: content.referenceApplicabilityMatrix ?? [],
    frameworkAlignment: content.frameworkAlignment ?? [],
    modules: (content.modules ?? []).map((module) => ({
      id: module.id,
      title: module.title,
      duration: module.duration,
      format: module.format,
      learningObjectives: module.learningObjectives,
      claimRegister: module.claimRegister,
      keyConcepts: module.keyConcepts,
      executiveExample: module.executiveExample,
      operationalExample: module.operationalExample,
      scenario: module.scenario,
      exercise: module.exercise,
      referenceApplicationNotes: module.referenceApplicationNotes,
      narrativeExcerpt: String(module.lessonNarrative ?? "").slice(0, 3500),
    })),
  };

  return `You are the senior implementation advisor, standards practitioner, real-world case researcher, and executive course editor for OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC.

Create the implementation and real-world application supplement for the governed course below. The supplement must make the course commercially useful: learners must understand what happened in real organizations, what can be learned, where each reference or standard applies, what should be implemented, who is accountable, what evidence proves implementation, how performance is measured, and what limitations or residual risks remain.

Do not invent a company event, statistic, legal requirement, control text, source, URL, outcome, or case fact. A documented public case may be used only when supported by source IDs already present in the supplied source register. When no sufficiently verified case source exists for a module, create a verification-required case need with a precise verification instruction; do not disguise it as a documented fact. Synthetic teaching scenarios remain separate and clearly labeled.

All recommendations and advice are educational and informational. They must not be represented as legal advice, compliance certification, audit opinion, regulatory approval, guaranteed performance, or a substitute for organization-specific professional judgment.

Production standard: ${commercialProductionStandard.standardId}
Production standard hash: ${commercialProductionStandardHash()}
Quality target: ${commercialProductionStandard.qualityTier}

Return one valid JSON object only using this exact top-level structure:
{
  "courseImplementationStrategy": {
    "implementationVision": "",
    "operatingModel": "",
    "sequencingStrategy": [],
    "governanceAndDecisionRights": [],
    "evidenceStrategy": [],
    "measurementStrategy": [],
    "changeAndAdoptionStrategy": [],
    "limitationsAndProfessionalAdviceBoundary": ""
  },
  "documentedRealWorldCaseRegister": [
    {
      "id": "CASE-001",
      "moduleIds": [],
      "status": "documented-public-case|verification-required",
      "title": "",
      "organizationOrSector": "",
      "dateOrPeriod": "",
      "geography": "",
      "context": "",
      "eventOrDecision": "",
      "outcome": "",
      "successFailureAndTradeoffs": [],
      "lessons": [],
      "sourceIds": [],
      "verificationInstruction": "",
      "applicability": {
        "appliesTo": [],
        "appliesWhen": [],
        "doesNotApplyWhen": [],
        "roles": [],
        "industries": [],
        "geographies": [],
        "systemsOrProcesses": [],
        "lifecyclePhases": []
      },
      "limitations": ""
    }
  ],
  "standardsImplementationMap": [
    {
      "standardOrFramework": "",
      "sourceIds": [],
      "requirementOrControl": "",
      "classification": "binding-requirement|voluntary-guidance|organizational-policy|recommended-practice",
      "moduleIds": [],
      "applicability": {
        "appliesTo": [],
        "appliesWhen": [],
        "doesNotApplyWhen": [],
        "roles": [],
        "industries": [],
        "geographies": [],
        "systemsOrProcesses": [],
        "lifecyclePhases": []
      },
      "implementationObjective": "",
      "implementationActions": [],
      "ownerRoles": [],
      "artifactsAndEvidence": [],
      "validationMethod": "",
      "reviewCadence": "",
      "commonPitfalls": [],
      "exceptionsAndResidualRisk": "",
      "doesNotEstablish": []
    }
  ],
  "prioritizedRecommendations": [
    {
      "priority": "critical|high|medium|foundational",
      "recommendation": "",
      "rationale": "",
      "appliesTo": [],
      "implementationSteps": [],
      "evidence": [],
      "metrics": [],
      "effort": "",
      "costConsiderations": "",
      "timeToValue": "",
      "dependencies": [],
      "risks": [],
      "limitations": "",
      "sourceIds": []
    }
  ],
  "modules": [
    {
      "id": "",
      "documentedRealWorldCases": [],
      "implementationPlaybook": {
        "implementationObjective": "",
        "prerequisites": [],
        "dependenciesAndSequencing": [],
        "rolesAndRaci": [],
        "steps": [{"sequence": 1, "action": "", "ownerRoles": [], "inputs": [], "outputs": [], "sourceIds": [], "decisionGate": ""}],
        "artifactsAndEvidence": [],
        "validationAndTesting": [],
        "metrics": [],
        "maintenanceCadence": "",
        "exceptionsAndResidualRisk": ""
      },
      "recommendations": [],
      "standardImplementationGuidance": [],
      "evidenceAndMetricsPlan": {
        "requiredEvidence": [],
        "leadingIndicators": [],
        "laggingIndicators": [],
        "validationActivities": [],
        "reportingCadence": [],
        "ownership": []
      }
    }
  ]
}

REQUIREMENTS
1. Include every manifest module exactly once.
2. Every module requires at least one documented public case or a clearly labeled verification-required case need. A documented case requires source IDs already present in the supplied source register.
3. Explain context, decision, outcome, successes, failures, tradeoffs, lessons, applicability, and limitations for every case.
4. Every module requires a step-by-step implementation playbook with at least five sequenced steps, prerequisites, dependencies, accountable roles, decision gates, outputs, evidence, testing, metrics, maintenance, exceptions, and residual risk.
5. Every module requires at least three prioritized recommendations. Recommendations must state rationale, applicability, implementation steps, evidence, metrics, effort, cost considerations, time to value, dependencies, risks, and limitations.
6. Every module requires at least one standards implementation record. Explain the requirement or control, classification, applicability, implementation actions, evidence, ownership, validation, review cadence, pitfalls, exceptions, residual risk, and what course completion does not establish.
7. Recommendations must be proportionate to the course level and audience. Avoid generic advice such as follow best practices, conduct training, or improve governance without concrete actions and evidence.
8. Preserve the distinction between binding requirements, voluntary guidance, organizational policy, recommended practice, documented public cases, original Obserra instruction, and synthetic scenarios.
9. Do not claim that implementation guidance guarantees compliance, certification, security, audit success, legal sufficiency, or business outcomes.

GOVERNED COURSE CONTEXT
${JSON.stringify(compactContext)}`;
}

async function main() {
  const manifest = readJson(manifestPath);
  const envelope = readJson(packagePath);
  if (envelope.schemaVersion !== "1.3" || envelope.authoringPolicyVersion !== "2026.08.07.3") {
    throw new Error(`Course package for ${courseId} is not on the governed commercial authoring schema.`);
  }
  if (envelope.productionStandard?.standardId !== commercialProductionStandard.standardId
      || envelope.productionStandard?.standardHash !== commercialProductionStandardHash()) {
    throw new Error(`Course package for ${courseId} does not match the active commercial production standard.`);
  }

  const sourceIds = new Set((envelope.content?.sourceRegister ?? []).map((source) => source.id));
  const prompt = buildPrompt(manifest, envelope);
  const raw = provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
  const supplement = validateSupplement(parseJson(raw), manifest, sourceIds);
  const byModule = new Map(supplement.modules.map((module) => [module.id, module]));

  envelope.content = {
    ...envelope.content,
    courseImplementationStrategy: supplement.courseImplementationStrategy,
    documentedRealWorldCaseRegister: supplement.documentedRealWorldCaseRegister,
    standardsImplementationMap: supplement.standardsImplementationMap,
    prioritizedRecommendations: supplement.prioritizedRecommendations,
    modules: (envelope.content.modules ?? []).map((module) => ({
      ...module,
      documentedRealWorldCases: byModule.get(module.id)?.documentedRealWorldCases ?? [],
      implementationPlaybook: byModule.get(module.id)?.implementationPlaybook ?? null,
      recommendations: byModule.get(module.id)?.recommendations ?? [],
      standardImplementationGuidance: byModule.get(module.id)?.standardImplementationGuidance ?? [],
      evidenceAndMetricsPlan: byModule.get(module.id)?.evidenceAndMetricsPlan ?? null,
    })),
  };
  envelope.implementationGuidanceStatus = "draft-ai-generated-verification-required";
  envelope.implementationGuidanceGeneratedAt = new Date().toISOString();
  envelope.implementationGuidanceProvider = provider;
  atomicWriteJson(packagePath, envelope);
  console.log(`[Academy Studio] Added governed real-world cases, recommendations, and implementation-to-standard guidance for ${courseId}.`);
}

try {
  await main();
} catch (error) {
  if (error instanceof ProviderAuthoringError) {
    const safeMessage = String(error.message || error.category).replace(/\s+/g, " ").slice(0, 1600);
    console.error(
      `[Academy Studio] AUTHORING_PROVIDER_FAILURE provider=${error.provider} category=${error.category} retryable=${error.retryable} status=${error.status ?? "unknown"} providerCode=${error.providerCode ?? "unknown"}: ${safeMessage}`,
    );
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
