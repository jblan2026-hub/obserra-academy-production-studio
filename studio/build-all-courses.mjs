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
const legalName = officialBrand.legalName;
const proprietaryNotice = officialBrand.ownership.defaultClassification;
const disclaimer = officialBrand.disclaimer;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeGenerated(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
}

function text(value) {
  return String(value ?? "").trim();
}

function bulletList(values, empty = "- None recorded.") {
  return Array.isArray(values) && values.length
    ? values.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`).join("\n")
    : empty;
}

function legalNoticeMarkdown() {
  return `## Important informational-use notice\n\n**${disclaimer.shortText}**\n\n${disclaimer.fullText}\n\n## Assumption of risk, release, and limitation of liability\n\n${disclaimer.releaseAndLimitationOfLiability}\n\n**Required acknowledgement:** ${disclaimer.acknowledgementText}\n`;
}

function brandHeader(manifest, documentType) {
  return `> **${legalName}**  \\\n> **${proprietaryNotice}**  \\\n> **${documentType}**  \\\n> Official logo: \`${manifest.branding.logoAsset}\`  \\\n> ${disclaimer.shortText}\n\n`;
}

function brandFooter() {
  return `\n---\n\n${disclaimer.shortText}\n\n© ${new Date().getUTCFullYear()} ${legalName}. All rights reserved. ${proprietaryNotice}\n`;
}

function renderApplicability(applicability) {
  const value = applicability ?? {};
  return [
    `- **Applies to:** ${(value.appliesTo ?? []).join("; ") || "Not specified"}`,
    `- **Applies when:** ${(value.appliesWhen ?? []).join("; ") || "Not specified"}`,
    `- **Does not apply when:** ${(value.doesNotApplyWhen ?? []).join("; ") || "Not specified"}`,
    `- **Affected roles:** ${(value.roles ?? []).join("; ") || "Not specified"}`,
    `- **Industries:** ${(value.industries ?? []).join("; ") || "Not specified"}`,
    `- **Geographies or jurisdictions:** ${(value.geographies ?? []).join("; ") || "Not specified"}`,
    `- **Systems or processes:** ${(value.systemsOrProcesses ?? []).join("; ") || "Not specified"}`,
    `- **Lifecycle phases:** ${(value.lifecyclePhases ?? []).join("; ") || "Not specified"}`,
  ].join("\n");
}

function renderSourceRegister(sources) {
  return (sources ?? []).map((source) => `### ${source.id}: ${source.sourceTitle}\n\n- **Citation status:** ${source.citationStatus}\n- **Source type:** ${source.sourceType}\n- **Issuing authority:** ${source.issuingAuthority}\n- **Version or publication date:** ${source.versionOrPublicationDate}\n- **Authoritative locator:** ${source.urlOrLocator}\n- **Retrieval or verification date:** ${source.retrievalOrVerificationDate ?? "Pending verification"}\n- **Jurisdiction or scope:** ${source.jurisdictionOrScope}\n- **Classification:** ${source.requirementClassification}\n- **Claim or topic:** ${source.claimOrTopic}\n- **Modules:** ${(source.moduleIds ?? []).join(", ")}\n- **Claims:** ${(source.claimIds ?? []).join(", ")}\n\n#### Applicability\n\n${renderApplicability(source.applicability)}\n\n- **Limitations:** ${source.limitations}\n- **Verification instruction:** ${source.verificationInstruction}\n- **Usage boundary:** ${source.usageBoundary}\n`).join("\n");
}

function renderObjectives(objectives) {
  return (objectives ?? []).map((objective) => `- **${objective.id}:** ${objective.statement}  \\\n  Evidence of learning: ${objective.evidenceOfLearning}`).join("\n");
}

function renderClaims(claims) {
  return (claims ?? []).map((claim) => `#### ${claim.id}\n\n${claim.statement}\n\n- **Classification:** ${claim.classification}\n- **Verification:** ${claim.verificationStatus}\n- **Sources:** ${(claim.sourceIds ?? []).join(", ")}\n- **Limitations:** ${claim.limitations}\n\n${renderApplicability(claim.applicability)}\n`).join("\n");
}

function renderKnowledgeChecks(questions, includeAnswers) {
  return (questions ?? []).map((question, index) => {
    const options = (question.options ?? []).map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join("\n");
    const answer = includeAnswers
      ? `\n\n**Correct answer:** ${String.fromCharCode(65 + Number(question.correctIndex ?? 0))}\n\n**Rationale:** ${question.rationale}`
      : "";
    return `### Knowledge Check ${index + 1}: ${question.id}\n\n${question.question}\n\n${options}${answer}\n\n**Objectives:** ${(question.objectiveIds ?? []).join(", ")}  \\\n**Sources:** ${(question.sourceIds ?? []).join(", ")}\n`;
  }).join("\n");
}

function renderProductionPlan(module) {
  const plan = module.productionPlan ?? {};
  const storyboard = (plan.storyboard ?? []).map((scene) => `- **${scene.sceneId}** (${scene.durationSeconds}s): ${scene.purpose}. Picture: ${scene.picture}. On-screen text: ${scene.onScreenText}. Sources: ${(scene.sourceIds ?? []).join(", ")}. Accessibility: ${scene.accessibilityDescription}`).join("\n");
  const shots = (plan.shotList ?? []).map((shot) => `- **${shot.shotId} / ${shot.sceneId}:** ${shot.shotType}; subject ${shot.subject}; movement ${shot.movement}; environment ${shot.locationOrEnvironment}; assets ${(shot.assetNeeds ?? []).join(", ")}; rights ${shot.rightsNotes}`).join("\n");
  const graphics = (plan.motionGraphicsPlan ?? []).map((graphic) => `- **${graphic.sceneId}:** ${graphic.graphic}; claims ${(graphic.dataOrClaimIds ?? []).join(", ")}; sources ${(graphic.sourceIds ?? []).join(", ")}; reduced-motion alternative ${graphic.reducedMotionAlternative}`).join("\n");
  const assets = (plan.assetRequirements ?? []).map((asset) => `- **${asset.assetId}:** ${asset.description}; origin ${asset.origin}; rights evidence required ${asset.rightsEvidenceRequired}`).join("\n");
  return `### Storyboard\n\n${storyboard || "No storyboard recorded."}\n\n### Shot List\n\n${shots || "No shot list recorded."}\n\n### Motion Graphics\n\n${graphics || "No motion graphics recorded."}\n\n### Audio Plan\n\n- **Narration style:** ${plan.audioPlan?.narrationStyle ?? ""}\n- **Music direction:** ${plan.audioPlan?.musicDirection ?? ""}\n- **Sound design:** ${plan.audioPlan?.soundDesign ?? ""}\n- **Silence and emphasis:** ${plan.audioPlan?.silenceAndEmphasis ?? ""}\n- **Rights notes:** ${plan.audioPlan?.rightsNotes ?? ""}\n\n### Asset Requirements\n\n${assets || "No assets recorded."}\n`;
}

function renderVideoScript(video) {
  const scenes = (video?.scenes ?? []).map((scene) => `### ${scene.sceneId} (${scene.durationSeconds}s)\n\n- **Visual:** ${scene.visual}\n- **On-screen text:** ${scene.onScreenText}\n- **Narration:** ${scene.narration}\n- **Audio cue:** ${scene.audioCue}\n- **Claims:** ${(scene.claimIds ?? []).join(", ")}\n- **Sources:** ${(scene.sourceIds ?? []).join(", ")}\n- **Accessibility description:** ${scene.accessibilityDescription}\n`).join("\n");
  return `**Opening:** ${video?.opening ?? ""}\n\n${scenes}\n\n**Closing:** ${video?.closing ?? ""}\n\n**Estimated narration words:** ${video?.estimatedNarrationWords ?? 0}  \\\n**Estimated runtime:** ${video?.estimatedRuntimeMinutes ?? 0} minutes\n`;
}

function moduleInstructorManuscript(module, index) {
  const treatment = module.creativeTreatment ?? {};
  return `## Module ${index + 1}: ${module.title}\n\n**Duration:** ${module.duration}  \\\n**Format:** ${module.format}\n\n### Learning Objectives\n\n${renderObjectives(module.learningObjectives)}\n\n### Opening Context\n\n${module.openingContext}\n\n### Detailed Instructor Narrative\n\n${module.lessonNarrative}\n\n### Claim Register and Applicability\n\n${renderClaims(module.claimRegister)}\n\n### Key Concepts\n\n${(module.keyConcepts ?? []).map((concept) => `- **${concept.term}:** ${concept.explanation} Claims: ${(concept.claimIds ?? []).join(", ")}. Sources: ${(concept.sourceIds ?? []).join(", ")}.`).join("\n")}\n\n### Executive Example\n\n${module.executiveExample?.narrative ?? ""}\n\n**Applicability:** ${module.executiveExample?.applicabilityNote ?? ""}  \\\n**Sources:** ${(module.executiveExample?.sourceIds ?? []).join(", ")}\n\n### Operational Example\n\n${module.operationalExample?.narrative ?? ""}\n\n**Applicability:** ${module.operationalExample?.applicabilityNote ?? ""}  \\\n**Sources:** ${(module.operationalExample?.sourceIds ?? []).join(", ")}\n\n### Applied Scenario\n\n**Classification:** ${module.scenario?.classification ?? ""}\n\n${module.scenario?.situation ?? ""}\n\n**Evidence:**\n\n${bulletList(module.scenario?.evidence)}\n\n**Decision prompt:** ${module.scenario?.decisionPrompt ?? ""}\n\n**Recommended approach:** ${module.scenario?.recommendedApproach ?? ""}\n\n**Debrief:** ${module.scenario?.debrief ?? ""}\n\n**Applicability:** ${module.scenario?.applicabilityNote ?? ""}\n\n### Applied Exercise\n\n${module.exercise?.instructions ?? ""}\n\n**Deliverable:** ${module.exercise?.deliverable ?? ""}\n\n**Rubric:**\n\n${bulletList(module.exercise?.rubric)}\n\n### Knowledge Checks and Instructor Rationales\n\n${renderKnowledgeChecks(module.knowledgeChecks, true)}\n\n### Creative Treatment\n\n- **Learning arc:** ${treatment.learningArc ?? ""}\n- **Cinematic opening:** ${treatment.cinematicOpening ?? ""}\n- **Visual motifs:** ${(treatment.visualMotifs ?? []).join("; ")}\n- **Pacing:** ${treatment.pacingPlan ?? ""}\n- **Scenario treatment:** ${treatment.scenarioTreatment ?? ""}\n- **Source cards:** ${treatment.sourceCardPlan ?? ""}\n- **Closing resolution:** ${treatment.closingResolution ?? ""}\n\n### Commercial Production Plan\n\n${renderProductionPlan(module)}\n\n### Slide Narrative\n\n${(module.slideNarrative ?? []).map((slide) => `#### ${slide.id}: ${slide.title}\n\n${bulletList(slide.content)}\n\n**Speaker notes:** ${slide.speakerNotes}\n\n**Visual direction:** ${slide.visualDirection}\n\n**Claims:** ${(slide.claimIds ?? []).join(", ")}  \\\n**Sources:** ${(slide.sourceIds ?? []).join(", ")}\n`).join("\n")}\n\n### Scene-Level Video Script\n\n${renderVideoScript(module.videoScript)}\n\n### Accessibility Requirements\n\n${bulletList(module.accessibilityNotes)}\n\n### Reference Application Notes\n\n${bulletList(module.referenceApplicationNotes)}\n`;
}

function moduleLearnerGuide(module, index) {
  return `## Module ${index + 1}: ${module.title}\n\n**Duration:** ${module.duration}  \\\n**Format:** ${module.format}\n\n### Learning Objectives\n\n${renderObjectives(module.learningObjectives)}\n\n### Opening Context\n\n${module.openingContext}\n\n### Detailed Lesson\n\n${module.lessonNarrative}\n\n### Key Concepts\n\n${(module.keyConcepts ?? []).map((concept) => `- **${concept.term}:** ${concept.explanation}`).join("\n")}\n\n### Executive Example\n\n${module.executiveExample?.narrative ?? ""}\n\n**Where it applies:** ${module.executiveExample?.applicabilityNote ?? ""}\n\n### Operational Example\n\n${module.operationalExample?.narrative ?? ""}\n\n**Where it applies:** ${module.operationalExample?.applicabilityNote ?? ""}\n\n### Scenario\n\n${module.scenario?.situation ?? ""}\n\n**Evidence to consider:**\n\n${bulletList(module.scenario?.evidence)}\n\n**Decision prompt:** ${module.scenario?.decisionPrompt ?? ""}\n\n### Exercise\n\n${module.exercise?.instructions ?? ""}\n\n**Deliverable:** ${module.exercise?.deliverable ?? ""}\n\n### Knowledge Checks\n\n${renderKnowledgeChecks(module.knowledgeChecks, false)}\n\n### Reference and Applicability Notes\n\n${bulletList(module.referenceApplicationNotes)}\n\n### Accessibility and Alternative Formats\n\n${bulletList(module.accessibilityNotes)}\n`;
}

function buildManuscript(manifest, content) {
  const course = manifest.course;
  const bible = content.courseProductionBible ?? {};
  return `${brandHeader(manifest, "Detailed Instructor Manuscript and Commercial Production Book")}# ${course.title}\n\n${legalNoticeMarkdown()}\n\n**Department:** ${course.department}  \\\n**Track:** ${course.track}  \\\n**Level:** ${course.level}  \\\n**Audience:** ${course.audience}  \\\n**Course length:** ${course.duration}  \\\n**Authoring policy:** ${AUTHORING_POLICY_VERSION}  \\\n**Production standard:** ${commercialProductionStandard.standardId}\n\n## Course Summary\n\n### Executive Value\n\n${content.courseSummary?.executiveValue ?? ""}\n\n### Instructional Strategy\n\n${content.courseSummary?.instructionalStrategy ?? ""}\n\n### Commercial Learner Experience\n\n${content.courseSummary?.commercialExperience ?? ""}\n\n## Course Production Bible\n\n- **Creative intent:** ${bible.creativeIntent ?? ""}\n- **Audience experience:** ${bible.audienceExperience ?? ""}\n- **Narrative arc:** ${(bible.narrativeArc ?? []).join("; ")}\n- **Visual language:** ${bible.visualLanguage ?? ""}\n- **Cinematography:** ${bible.cinematography ?? ""}\n- **Motion graphics:** ${bible.motionGraphicsLanguage ?? ""}\n- **Sound and music:** ${bible.soundAndMusicDirection ?? ""}\n- **Source cards:** ${bible.sourceCardTreatment ?? ""}\n- **Accessibility:** ${bible.accessibilityTreatment ?? ""}\n- **Rights and synthetic media:** ${bible.rightsAndSyntheticMediaTreatment ?? ""}\n\n## Learning Outcomes\n\n${course.outcomes.map((item) => `- ${item}`).join("\n")}\n\n## Detailed Modules\n\n${(content.modules ?? []).map(moduleInstructorManuscript).join("\n")}\n\n## Course Source Register and Applicability\n\n${renderSourceRegister(content.sourceRegister)}\n\n## Reference Applicability Matrix\n\n${JSON.stringify(content.referenceApplicabilityMatrix ?? [], null, 2)}\n\n## Instructor Guide\n\n### Facilitation Notes\n\n${bulletList(content.instructorGuide?.facilitationNotes)}\n\n### Common Misconceptions\n\n${bulletList(content.instructorGuide?.commonMisconceptions)}\n\n### Applicability Warnings\n\n${bulletList(content.instructorGuide?.applicabilityWarnings)}\n\n### Source Verification Warnings\n\n${bulletList(content.instructorGuide?.sourceVerificationWarnings)}\n\n### Review Warnings\n\n${bulletList(content.instructorGuide?.reviewWarnings)}\n\n${legalNoticeMarkdown()}${brandFooter()}`;
}

function buildLearnerGuide(manifest, content) {
  const course = manifest.course;
  return `${brandHeader(manifest, "Detailed Learner Guide")}# ${course.title}\n\n${legalNoticeMarkdown()}\n\n**Length:** ${course.duration}  \\\n**Audience:** ${course.audience}\n\n## Course Value\n\n${content.courseSummary?.executiveValue ?? ""}\n\n## Learning Strategy\n\n${content.courseSummary?.instructionalStrategy ?? ""}\n\n## Outcomes\n\n${course.outcomes.map((item) => `- ${item}`).join("\n")}\n\n## Detailed Lessons\n\n${(content.modules ?? []).map(moduleLearnerGuide).join("\n")}\n\n## Reference Guide: What Applies Where\n\n${renderSourceRegister(content.sourceRegister)}\n\n## Completion Requirements\n\n- Complete every required lesson, activity, and learner work product.\n- Achieve ${manifest.completion.passingScore} percent or higher on the protected final assessment.\n- Accept the informational-use disclaimer and limitation-of-liability terms.\n- Apply references only within their documented scope, conditions, jurisdiction, systems, roles, and limitations.\n\n## Completion Record\n\nAny issued document is a certificate of course completion only and does not represent certification, licensure, accreditation, compliance, regulatory approval, or professional qualification.\n\n${legalNoticeMarkdown()}${brandFooter()}`;
}

function buildWorkbook(manifest, content) {
  const entries = new Map((content.learnerWorkbook ?? []).map((entry) => [entry.moduleId, entry]));
  return `${brandHeader(manifest, "Applied Learner Workbook")}# ${manifest.course.title}\n\n${legalNoticeMarkdown()}\n\n${(content.modules ?? []).map((module, index) => {
    const workbook = entries.get(module.id) ?? {};
    return `## Module ${index + 1}: ${module.title}\n\n### Reflection Prompts\n\n${bulletList(workbook.reflectionPrompts)}\n\n### Decision Worksheet\n\n${bulletList(workbook.decisionWorksheet)}\n\n### Reference Application Prompts\n\n${bulletList(workbook.referenceApplicationPrompts)}\n\n### Applicable Sources\n\n${(workbook.sourceIds ?? []).join(", ")}\n\n### Required Exercise Deliverable\n\n${module.exercise?.deliverable ?? ""}\n\n### Exercise Rubric\n\n${bulletList(module.exercise?.rubric)}\n`;
  }).join("\n")}\n\n## Final Action and Evidence Plan\n\nDocument the decision, verified facts, unresolved assumptions, sources, applicability, exclusions, affected stakeholders, selected action, authority, evidence, monitoring, escalation, and expected outcome. Independently validate all legal, compliance, regulatory, technical, or professional decisions before implementation.\n\n${legalNoticeMarkdown()}${brandFooter()}`;
}

function buildAssessment(manifest, content) {
  return {
    schemaVersion: "2.0",
    courseId: manifest.course.id,
    owner: legalName,
    logoAsset: manifest.branding.logoAsset,
    classification: proprietaryNotice,
    tags: manifest.tags,
    disclaimer,
    credentialType: "certificate-of-course-completion-only",
    passingScore: manifest.completion.passingScore,
    blueprint: content.assessmentBlueprint,
    questions: content.finalAssessment,
  };
}

function buildAnswerKey(manifest, content) {
  return {
    schemaVersion: "2.0",
    courseId: manifest.course.id,
    owner: legalName,
    classification: proprietaryNotice,
    protected: true,
    answers: Object.fromEntries((content.finalAssessment ?? []).map((question) => [question.id, {
      correctIndex: question.correctIndex,
      rationale: question.rationale,
      distractorRationales: question.distractorRationales,
      sourceIds: question.sourceIds,
      applicabilityNote: question.applicabilityNote,
    }])),
  };
}

function buildVisualBrief(manifest, content) {
  const bible = content.courseProductionBible ?? {};
  return `${brandHeader(manifest, "Commercial Cinematic Visual and Audio Production Brief")}# ${manifest.course.title}\n\n${legalNoticeMarkdown()}\n\n## Production Status\n\n**${commercialProductionStandard.claimPolicy.interimLabel}**. Scripts, plans, storyboards, provider previews, and test renders are not final mastered media.\n\n## Course Creative Direction\n\n- **Creative intent:** ${bible.creativeIntent ?? ""}\n- **Audience experience:** ${bible.audienceExperience ?? ""}\n- **Narrative arc:** ${(bible.narrativeArc ?? []).join("; ")}\n- **Visual language:** ${bible.visualLanguage ?? ""}\n- **Cinematography:** ${bible.cinematography ?? ""}\n- **Motion graphics:** ${bible.motionGraphicsLanguage ?? ""}\n- **Sound and music:** ${bible.soundAndMusicDirection ?? ""}\n- **Source-card treatment:** ${bible.sourceCardTreatment ?? ""}\n- **Accessibility:** ${bible.accessibilityTreatment ?? ""}\n- **Rights and synthetic media:** ${bible.rightsAndSyntheticMediaTreatment ?? ""}\n\n## Mastering Target\n\n- Picture: ${commercialProductionStandard.pictureMaster.minimumRaster} master or explicitly approved equivalent; mezzanine master and web derivative required.\n- Audio: ${commercialProductionStandard.audioMaster.sampleRateHz} Hz, minimum ${commercialProductionStandard.audioMaster.minimumBitDepth}-bit, ${commercialProductionStandard.audioMaster.integratedLoudnessTargetLufs} LUFS ±${commercialProductionStandard.audioMaster.integratedLoudnessToleranceLufs}, true peak no greater than ${commercialProductionStandard.audioMaster.truePeakMaximumDbtp} dBTP.\n- Human editorial, visual, audio, accessibility, rights, source-applicability, security, and owner acceptance are mandatory.\n\n## Module Production Plans\n\n${(content.modules ?? []).map((module, index) => `## Module ${index + 1}: ${module.title}\n\n${renderProductionPlan(module)}\n\n### Creative Treatment\n\n${JSON.stringify(module.creativeTreatment ?? {}, null, 2)}\n\n### Video Script\n\n${renderVideoScript(module.videoScript)}\n`).join("\n")}\n\n## Prohibited Final Substitutes\n\n${bulletList(commercialProductionStandard.prohibitedFinalSubstitutes)}\n\n${legalNoticeMarkdown()}${brandFooter()}`;
}

function sourceResolutionSummary(content) {
  const sources = content.sourceRegister ?? [];
  const unresolved = sources.filter((source) => !["verified", "not-external-source"].includes(source.citationStatus));
  return {
    totalSources: sources.length,
    verifiedOrInternalSources: sources.length - unresolved.length,
    unresolvedSources: unresolved.length,
    unresolvedSourceIds: unresolved.map((source) => source.id),
    commercialReleaseBlocked: unresolved.length > 0,
  };
}

if (!fs.existsSync(coursesRoot)) {
  console.error(`[Academy Studio] Courses directory not found: ${coursesRoot}`);
  process.exit(1);
}

const results = [];
const failures = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;

  try {
    const manifest = readJson(manifestPath);
    assertBrandAndTags(manifest, manifestPath);
    const packagePath = path.join(courseDir, "generated", "authoring", "course-package.json");
    if (!fs.existsSync(packagePath)) {
      throw new Error("Detailed governed authoring package is missing.");
    }
    const envelope = readJson(packagePath);
    const identity = validateAuthoringEnvelope({
      courseId: manifest.course.id,
      envelope,
      manifest,
    });
    const content = envelope.content;
    if (!content?.courseProductionBible
        || !Array.isArray(content?.sourceRegister)
        || !Array.isArray(content?.referenceApplicabilityMatrix)
        || !Array.isArray(content?.modules)
        || !Array.isArray(content?.finalAssessment)) {
      throw new Error("Detailed course, production, reference, or assessment structure is incomplete.");
    }

    const assessment = buildAssessment(manifest, content);
    const answerKey = buildAnswerKey(manifest, content);
    const sourceSummary = sourceResolutionSummary(content);
    writeGenerated(path.join(courseDir, "instructor-manuscript.md"), buildManuscript(manifest, content));
    writeGenerated(path.join(courseDir, "learner-guide.md"), buildLearnerGuide(manifest, content));
    writeGenerated(path.join(courseDir, "workbook.md"), buildWorkbook(manifest, content));
    writeGenerated(path.join(courseDir, "assessment-bank.json"), `${JSON.stringify(assessment, null, 2)}\n`);
    writeGenerated(path.join(courseDir, "answer-key.json"), `${JSON.stringify(answerKey, null, 2)}\n`);
    writeGenerated(path.join(courseDir, "visual-brief.md"), buildVisualBrief(manifest, content));
    writeGenerated(path.join(courseDir, "source-register.json"), `${JSON.stringify(content.sourceRegister, null, 2)}\n`);
    writeGenerated(path.join(courseDir, "reference-applicability-matrix.json"), `${JSON.stringify(content.referenceApplicabilityMatrix, null, 2)}\n`);
    writeGenerated(path.join(courseDir, "course-production-bible.json"), `${JSON.stringify(content.courseProductionBible, null, 2)}\n`);
    writeGenerated(path.join(courseDir, "commercial-production-plan.json"), `${JSON.stringify({
      schemaVersion: "1.0",
      courseId: manifest.course.id,
      contractId: workerPoolContract.contractId,
      contractHash: contractHash(),
      productionStandardId: commercialProductionStandard.standardId,
      productionStandardHash: commercialProductionStandardHash(),
      qualityTier: commercialProductionStandard.qualityTier,
      status: commercialProductionStandard.claimPolicy.interimLabel,
      modules: content.modules.map((module) => ({
        moduleId: module.id,
        creativeTreatment: module.creativeTreatment,
        productionPlan: module.productionPlan,
        videoScript: module.videoScript,
      })),
    }, null, 2)}\n`);
    writeGenerated(path.join(courseDir, "certificate-package.json"), `${JSON.stringify({
      schemaVersion: "1.0",
      courseId: manifest.course.id,
      title: "Certificate of Course Completion",
      issuer: legalName,
      templateId: "obserra-academy-course-completion-v1",
      verificationRequired: true,
      professionalCertification: false,
      complianceEvidence: false,
      passingScore: manifest.completion.passingScore,
      allLessonsRequired: manifest.completion.allLessonsRequired,
      assessmentRequired: manifest.completion.assessmentRequired,
      ownerAcceptanceRequired: true,
    }, null, 2)}\n`);
    writeGenerated(path.join(courseDir, "commercial-course-stage.json"), `${JSON.stringify({
      schemaVersion: "1.0",
      courseId: manifest.course.id,
      generatedAt: new Date().toISOString(),
      authoringPolicyVersion: AUTHORING_POLICY_VERSION,
      authoringPackageHash: identity.packageHash,
      contractId: workerPoolContract.contractId,
      contractHash: contractHash(),
      productionStandardId: commercialProductionStandard.standardId,
      productionStandardHash: commercialProductionStandardHash(),
      qualityTier: commercialProductionStandard.qualityTier,
      status: "compliance-staged",
      qualityClaimAllowed: false,
      publicationAllowed: false,
      checkoutAllowed: false,
      sourceResolution: sourceSummary,
      remainingGates: commercialProductionStandard.requiredReleaseEvidence,
      claimBoundary: commercialProductionStandard.claimBoundary,
    }, null, 2)}\n`);

    results.push({
      courseId: manifest.course.id,
      status: "detailed-authored-assets-materialized",
      authoringPackageHash: identity.packageHash,
      sourceResolution: sourceSummary,
      officialBrand: true,
      disclaimerEmbedded: true,
      tags: manifest.tags,
    });
  } catch (error) {
    failures.push({
      courseId: entry.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const reportPath = path.join(root, "catalog", "bulk-build-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const report = {
  schemaVersion: "2.0",
  generatedAt: new Date().toISOString(),
  owner: legalName,
  logoAsset: officialBrand.officialLogo.assetPath,
  classification: proprietaryNotice,
  authoringPolicyVersion: AUTHORING_POLICY_VERSION,
  contractId: workerPoolContract.contractId,
  contractHash: contractHash(),
  productionStandardId: commercialProductionStandard.standardId,
  productionStandardHash: commercialProductionStandardHash(),
  qualityTier: commercialProductionStandard.qualityTier,
  status: failures.length ? "failed" : "compliance-staged",
  publicationAllowed: false,
  checkoutAllowed: false,
  disclaimer,
  courseCount: results.length,
  failureCount: failures.length,
  courses: results,
  failures,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  console.error(`[Academy Studio] Detailed asset materialization failed for ${failures.length} course(s).`);
  for (const failure of failures.slice(0, 100)) {
    console.error(`[Academy Studio] ${failure.courseId}: ${failure.error}`);
  }
  process.exit(2);
}

console.log(`[Academy Studio] Materialized detailed authored learner, instructor, assessment, reference, certificate, and cinematic production assets for ${results.length} course(s); every course remains compliance-staged and unpublished.`);
