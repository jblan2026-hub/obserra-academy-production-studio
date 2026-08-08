import {
  ACADEMY_AUTHORING_QUALITY_REQUIREMENTS as requirements,
  countWords,
} from "./academy-authoring-quality-contract.mjs";

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function moduleIdentifier(module, index) {
  return String(module?.id || `module-${index + 1}`);
}

function normalized(value) {
  return String(value ?? "").trim();
}

function validCorrectIndex(item) {
  const options = list(item?.options);
  return (
    Number.isInteger(item?.correctIndex) &&
    item.correctIndex >= 0 &&
    item.correctIndex < options.length
  );
}

function validateStringList(findings, prefix, value, minimum) {
  const items = list(value);
  if (items.length < minimum) {
    findings.push(`${prefix}:insufficient-count-${items.length}-minimum-${minimum}`);
  }
  for (const [index, item] of items.entries()) {
    if (!nonEmpty(item)) findings.push(`${prefix}-${index + 1}:empty-value`);
  }
}

export function authoredPackageFindings({ manifest, authored }) {
  const findings = [];
  const manifestModules = list(manifest?.course?.modules);
  const authoredModules = list(authored?.modules);
  const manifestIds = new Set(
    manifestModules.map((module, index) => moduleIdentifier(module, index)),
  );
  const authoredById = new Map(
    authoredModules.map((module) => [String(module?.id || ""), module]),
  );
  const workbookByModule = new Map(
    list(authored?.learnerWorkbook).map((entry) => [
      String(entry?.moduleId || ""),
      entry,
    ]),
  );

  if (!authored?.courseSummary || typeof authored.courseSummary !== "object") {
    findings.push("missing-course-summary");
  } else {
    if (!nonEmpty(authored.courseSummary.executiveValue)) {
      findings.push("missing-course-summary-executive-value");
    }
    if (!nonEmpty(authored.courseSummary.instructionalStrategy)) {
      findings.push("missing-course-summary-instructional-strategy");
    }
    if (list(authored.courseSummary.sourceAndReviewNotes).length === 0) {
      findings.push("missing-course-summary-source-review-notes");
    }
  }

  const sourceRegister = list(authored?.sourceRegister);
  if (sourceRegister.length === 0) findings.push("missing-source-register");
  const sourceIds = new Set();
  for (const [index, source] of sourceRegister.entries()) {
    const prefix = `source-${index + 1}`;
    const sourceId = normalized(source?.id);
    if (!sourceId) findings.push(`${prefix}:missing-id`);
    else if (sourceIds.has(sourceId)) findings.push(`${prefix}:duplicate-id-${sourceId}`);
    else sourceIds.add(sourceId);
    if (!nonEmpty(source?.sourceType)) findings.push(`${prefix}:missing-source-type`);
    if (!nonEmpty(source?.claimOrTopic)) findings.push(`${prefix}:missing-claim-topic`);
    if (!Array.isArray(source?.moduleIds)) findings.push(`${prefix}:missing-module-ids-array`);
    for (const moduleId of list(source?.moduleIds)) {
      if (!manifestIds.has(String(moduleId))) {
        findings.push(`${prefix}:invalid-module-id-${moduleId}`);
      }
    }
    if (!nonEmpty(source?.verificationInstruction)) {
      findings.push(`${prefix}:missing-verification-instruction`);
    }
    if (!nonEmpty(source?.usageBoundary)) {
      findings.push(`${prefix}:missing-usage-boundary`);
    }
  }

  if (!Array.isArray(authored?.frameworkAlignment)) {
    findings.push("missing-framework-alignment-array");
  } else {
    for (const [index, alignment] of authored.frameworkAlignment.entries()) {
      const prefix = `framework-alignment-${index + 1}`;
      if (!nonEmpty(alignment?.framework)) findings.push(`${prefix}:missing-framework`);
      if (alignment?.applicability !== "informational-mapping-only") {
        findings.push(`${prefix}:invalid-applicability-boundary`);
      }
      if (alignment?.verificationRequired !== true) {
        findings.push(`${prefix}:verification-not-required`);
      }
      if (!nonEmpty(alignment?.alignmentNote)) {
        findings.push(`${prefix}:missing-alignment-note`);
      }
      if (!Array.isArray(alignment?.moduleIds)) {
        findings.push(`${prefix}:missing-module-ids-array`);
      }
      for (const moduleId of list(alignment?.moduleIds)) {
        if (!manifestIds.has(String(moduleId))) {
          findings.push(`${prefix}:invalid-module-id-${moduleId}`);
        }
      }
    }
  }

  if (!authored?.assessmentBlueprint || typeof authored.assessmentBlueprint !== "object") {
    findings.push("missing-assessment-blueprint");
  }
  if (authoredModules.length !== manifestModules.length) {
    findings.push(
      `module-count-mismatch-expected-${manifestModules.length}-found-${authoredModules.length}`,
    );
  }

  for (const [index, manifestModule] of manifestModules.entries()) {
    const moduleId = moduleIdentifier(manifestModule, index);
    const module = authoredById.get(moduleId);
    if (!module) {
      findings.push(`${moduleId}:missing-module`);
      continue;
    }

    if (!nonEmpty(module.title)) findings.push(`${moduleId}:missing-title`);
    else if (normalized(module.title) !== normalized(manifestModule?.title)) {
      findings.push(`${moduleId}:title-does-not-match-manifest`);
    }
    if (!nonEmpty(module.duration)) findings.push(`${moduleId}:missing-duration`);
    else if (normalized(module.duration) !== normalized(manifestModule?.duration)) {
      findings.push(`${moduleId}:duration-does-not-match-manifest`);
    }
    if (!nonEmpty(module.format)) findings.push(`${moduleId}:missing-format`);
    else if (normalized(module.format) !== normalized(manifestModule?.format)) {
      findings.push(`${moduleId}:format-does-not-match-manifest`);
    }
    if (!nonEmpty(module.openingContext)) {
      findings.push(`${moduleId}:missing-opening-context`);
    }

    const narrativeWords = countWords(module.lessonNarrative);
    if (narrativeWords < requirements.lessonNarrativeWords) {
      findings.push(
        `${moduleId}:lesson-narrative-${narrativeWords}-words-minimum-${requirements.lessonNarrativeWords}`,
      );
    }

    validateStringList(
      findings,
      `${moduleId}:learning-objectives`,
      module.learningObjectives,
      requirements.learningObjectives,
    );

    const keyConcepts = list(module.keyConcepts);
    if (keyConcepts.length < requirements.keyConcepts) {
      findings.push(
        `${moduleId}:key-concepts-${keyConcepts.length}-minimum-${requirements.keyConcepts}`,
      );
    }
    for (const [conceptIndex, concept] of keyConcepts.entries()) {
      if (!nonEmpty(concept?.term)) {
        findings.push(`${moduleId}:key-concept-${conceptIndex + 1}:missing-term`);
      }
      if (!nonEmpty(concept?.explanation)) {
        findings.push(`${moduleId}:key-concept-${conceptIndex + 1}:missing-explanation`);
      }
    }

    if (!nonEmpty(module.executiveExample)) {
      findings.push(`${moduleId}:missing-executive-example`);
    }
    if (!nonEmpty(module.operationalExample)) {
      findings.push(`${moduleId}:missing-operational-example`);
    }

    if (!module.scenario || typeof module.scenario !== "object") {
      findings.push(`${moduleId}:missing-scenario`);
    } else {
      for (const field of [
        "situation",
        "decisionPrompt",
        "recommendedApproach",
        "debrief",
      ]) {
        if (!nonEmpty(module.scenario[field])) {
          findings.push(`${moduleId}:scenario-missing-${field}`);
        }
      }
      if (list(module.scenario.evidence).length === 0) {
        findings.push(`${moduleId}:scenario-missing-evidence`);
      }
    }

    if (!module.exercise || typeof module.exercise !== "object") {
      findings.push(`${moduleId}:missing-exercise`);
    } else {
      if (!nonEmpty(module.exercise.instructions)) {
        findings.push(`${moduleId}:exercise-missing-instructions`);
      }
      if (!nonEmpty(module.exercise.deliverable)) {
        findings.push(`${moduleId}:exercise-missing-deliverable`);
      }
      if (list(module.exercise.rubric).length === 0) {
        findings.push(`${moduleId}:exercise-missing-rubric`);
      }
    }

    const knowledgeChecks = list(module.knowledgeChecks);
    if (knowledgeChecks.length < requirements.knowledgeChecks) {
      findings.push(
        `${moduleId}:knowledge-checks-${knowledgeChecks.length}-minimum-${requirements.knowledgeChecks}`,
      );
    }
    for (const [checkIndex, check] of knowledgeChecks.entries()) {
      const prefix = `${moduleId}:knowledge-check-${checkIndex + 1}`;
      if (!nonEmpty(check?.question)) findings.push(`${prefix}:missing-question`);
      if (list(check?.options).length < requirements.finalAssessmentOptions) {
        findings.push(`${prefix}:insufficient-options`);
      }
      if (!validCorrectIndex(check)) findings.push(`${prefix}:invalid-correct-index`);
      if (!nonEmpty(check?.rationale)) findings.push(`${prefix}:missing-rationale`);
    }

    const slideNarratives = list(module.slideNarrative);
    if (slideNarratives.length < requirements.slideNarratives) {
      findings.push(
        `${moduleId}:slide-narratives-${slideNarratives.length}-minimum-${requirements.slideNarratives}`,
      );
    }
    for (const [slideIndex, slide] of slideNarratives.entries()) {
      const prefix = `${moduleId}:slide-${slideIndex + 1}`;
      if (!nonEmpty(slide?.title)) findings.push(`${prefix}:missing-title`);
      if (list(slide?.content).length === 0) findings.push(`${prefix}:missing-content`);
      if (!nonEmpty(slide?.speakerNotes)) findings.push(`${prefix}:missing-speaker-notes`);
      if (!nonEmpty(slide?.visualDirection)) {
        findings.push(`${prefix}:missing-visual-direction`);
      }
    }

    if (!module.videoScript || typeof module.videoScript !== "object") {
      findings.push(`${moduleId}:missing-video-script`);
    } else {
      if (!nonEmpty(module.videoScript.opening)) {
        findings.push(`${moduleId}:video-script-missing-opening`);
      }
      if (!nonEmpty(module.videoScript.closing)) {
        findings.push(`${moduleId}:video-script-missing-closing`);
      }
      const segments = list(module.videoScript.segments);
      if (segments.length < requirements.videoSegments) {
        findings.push(
          `${moduleId}:video-segments-${segments.length}-minimum-${requirements.videoSegments}`,
        );
      }
      for (const [segmentIndex, segment] of segments.entries()) {
        const prefix = `${moduleId}:video-segment-${segmentIndex + 1}`;
        if (!nonEmpty(segment?.visual)) findings.push(`${prefix}:missing-visual`);
        if (!nonEmpty(segment?.narration)) findings.push(`${prefix}:missing-narration`);
      }
    }

    validateStringList(
      findings,
      `${moduleId}:accessibility-notes`,
      module.accessibilityNotes,
      requirements.accessibilityNotes,
    );
    if (!Array.isArray(module.sourcePlaceholders)) {
      findings.push(`${moduleId}:missing-source-placeholders-array`);
    }

    const workbook = workbookByModule.get(moduleId);
    if (!workbook || typeof workbook !== "object") {
      findings.push(`${moduleId}:missing-workbook`);
    } else {
      if (list(workbook.reflectionPrompts).length === 0) {
        findings.push(`${moduleId}:missing-workbook-reflection-prompts`);
      }
      if (list(workbook.decisionWorksheet).length === 0) {
        findings.push(`${moduleId}:missing-workbook-decision-worksheet`);
      }
    }
  }

  for (const module of authoredModules) {
    const moduleId = String(module?.id || "");
    if (!manifestIds.has(moduleId)) {
      findings.push(`${moduleId || "unknown"}:unexpected-module`);
    }
  }

  const assessment = list(authored?.finalAssessment);
  if (assessment.length < requirements.finalAssessmentQuestions) {
    findings.push(
      `final-assessment-${assessment.length}-minimum-${requirements.finalAssessmentQuestions}`,
    );
  }
  for (const [index, question] of assessment.entries()) {
    const prefix = `assessment-${index + 1}`;
    if (!manifestIds.has(String(question?.moduleId || ""))) {
      findings.push(`${prefix}:invalid-module-id`);
    }
    if (!nonEmpty(question?.question)) findings.push(`${prefix}:missing-question`);
    if (list(question?.options).length < requirements.finalAssessmentOptions) {
      findings.push(`${prefix}:insufficient-options`);
    }
    if (!validCorrectIndex(question)) findings.push(`${prefix}:invalid-correct-index`);
    if (!nonEmpty(question?.rationale)) findings.push(`${prefix}:missing-rationale`);
    if (!nonEmpty(question?.cognitiveLevel)) {
      findings.push(`${prefix}:missing-cognitive-level`);
    }
    if (!Array.isArray(question?.sourceIds) || question.sourceIds.length === 0) {
      findings.push(`${prefix}:missing-source-ids`);
    } else {
      for (const sourceId of question.sourceIds) {
        if (!sourceIds.has(String(sourceId))) {
          findings.push(`${prefix}:unknown-source-id-${sourceId}`);
        }
      }
    }
  }

  const coverage = list(authored?.assessmentBlueprint?.coverageByModule);
  const coverageIds = new Set(coverage.map((entry) => String(entry?.moduleId || "")));
  for (const moduleId of manifestIds) {
    if (!coverageIds.has(moduleId)) {
      findings.push(`assessment-blueprint-missing-${moduleId}`);
    }
  }
  for (const [index, entry] of coverage.entries()) {
    const prefix = `assessment-blueprint-coverage-${index + 1}`;
    if (!manifestIds.has(String(entry?.moduleId || ""))) {
      findings.push(`${prefix}:invalid-module-id`);
    }
    if (!Number.isInteger(entry?.minimumQuestions) || entry.minimumQuestions < 1) {
      findings.push(`${prefix}:invalid-minimum-questions`);
    }
  }
  const cognitiveMix = list(authored?.assessmentBlueprint?.cognitiveMix);
  if (cognitiveMix.length === 0) findings.push("missing-assessment-cognitive-mix");
  const cognitiveTotal = cognitiveMix.reduce(
    (total, entry) => total + Number(entry?.targetPercent || 0),
    0,
  );
  if (cognitiveMix.length > 0 && Math.abs(cognitiveTotal - 100) > 0.5) {
    findings.push(`assessment-cognitive-mix-total-${cognitiveTotal}`);
  }
  if (list(authored?.assessmentBlueprint?.integrityNotes).length === 0) {
    findings.push("missing-assessment-integrity-notes");
  }

  if (!authored?.instructorGuide || typeof authored.instructorGuide !== "object") {
    findings.push("missing-instructor-guide");
  } else {
    if (list(authored.instructorGuide.facilitationNotes).length === 0) {
      findings.push("missing-instructor-facilitation-notes");
    }
    if (list(authored.instructorGuide.commonMisconceptions).length === 0) {
      findings.push("missing-instructor-common-misconceptions");
    }
    if (list(authored.instructorGuide.reviewWarnings).length === 0) {
      findings.push("missing-instructor-review-warnings");
    }
  }

  if (!authored?.marketing || typeof authored.marketing !== "object") {
    findings.push("missing-marketing-package");
  } else {
    if (!nonEmpty(authored.marketing.shortDescription)) {
      findings.push("missing-marketing-short-description");
    }
    if (!nonEmpty(authored.marketing.longDescription)) {
      findings.push("missing-marketing-long-description");
    }
    if (list(authored.marketing.buyerOutcomes).length === 0) {
      findings.push("missing-marketing-buyer-outcomes");
    }
    if (list(authored.marketing.seoKeywords).length === 0) {
      findings.push("missing-marketing-seo-keywords");
    }
  }

  if (!authored?.brand || typeof authored.brand !== "object") {
    findings.push("missing-brand-package");
  } else {
    for (const field of ["legalName", "proprietaryNotice", "visualSystem"]) {
      if (!nonEmpty(authored.brand[field])) findings.push(`brand-missing-${field}`);
    }
  }

  return [...new Set(findings)].sort();
}

export function assertAuthoredPackageReady(input) {
  const findings = authoredPackageFindings(input);
  if (findings.length > 0) {
    const detail = findings.slice(0, 120).join(", ");
    throw new Error(
      `AUTHORING_QUALITY_GATE_FAILURE findingCount=${findings.length}: ${detail}`,
    );
  }
  return { ready: true, findingCount: 0, findings: [] };
}
