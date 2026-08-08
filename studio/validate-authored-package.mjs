function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function moduleIdentifier(module, index) {
  return String(module?.id || `module-${index + 1}`);
}

export function authoredPackageFindings({ manifest, authored }) {
  const findings = [];
  const manifestModules = list(manifest?.course?.modules);
  const authoredModules = list(authored?.modules);
  const authoredById = new Map(authoredModules.map((module) => [String(module?.id || ""), module]));
  const workbookByModule = new Map(
    list(authored?.learnerWorkbook).map((entry) => [String(entry?.moduleId || ""), entry]),
  );

  if (!authored?.courseSummary || typeof authored.courseSummary !== "object") {
    findings.push("missing-course-summary");
  }
  if (list(authored?.sourceRegister).length === 0) findings.push("missing-source-register");
  if (!Array.isArray(authored?.frameworkAlignment)) findings.push("missing-framework-alignment-array");
  if (!authored?.assessmentBlueprint || typeof authored.assessmentBlueprint !== "object") {
    findings.push("missing-assessment-blueprint");
  }
  if (authoredModules.length !== manifestModules.length) {
    findings.push(`module-count-mismatch-expected-${manifestModules.length}-found-${authoredModules.length}`);
  }

  for (const [index, manifestModule] of manifestModules.entries()) {
    const moduleId = moduleIdentifier(manifestModule, index);
    const module = authoredById.get(moduleId);
    if (!module) {
      findings.push(`${moduleId}:missing-module`);
      continue;
    }
    if (!nonEmpty(module.title)) findings.push(`${moduleId}:missing-title`);
    if (!nonEmpty(module.duration)) findings.push(`${moduleId}:missing-duration`);
    if (!nonEmpty(module.format)) findings.push(`${moduleId}:missing-format`);
    if (!nonEmpty(module.lessonNarrative)) findings.push(`${moduleId}:missing-lesson-narrative`);
    if (list(module.learningObjectives).length === 0) findings.push(`${moduleId}:missing-learning-objectives`);
    if (list(module.keyConcepts).length < 4) findings.push(`${moduleId}:insufficient-key-concepts`);
    if (!module.scenario || typeof module.scenario !== "object") findings.push(`${moduleId}:missing-scenario`);
    if (!module.exercise || typeof module.exercise !== "object") findings.push(`${moduleId}:missing-exercise`);
    if (list(module.knowledgeChecks).length < 4) findings.push(`${moduleId}:insufficient-knowledge-checks`);
    if (list(module.slideNarrative).length < 8) findings.push(`${moduleId}:insufficient-slide-narrative`);
    if (!module.videoScript || typeof module.videoScript !== "object") findings.push(`${moduleId}:missing-video-script`);
    if (module.videoScript && list(module.videoScript.segments).length === 0) findings.push(`${moduleId}:missing-video-segments`);
    if (list(module.accessibilityNotes).length < 4) findings.push(`${moduleId}:insufficient-accessibility-notes`);
    if (!Array.isArray(module.sourcePlaceholders)) findings.push(`${moduleId}:missing-source-placeholders-array`);

    const workbook = workbookByModule.get(moduleId);
    if (!workbook || typeof workbook !== "object") {
      findings.push(`${moduleId}:missing-workbook`);
    } else {
      if (list(workbook.reflectionPrompts).length === 0) findings.push(`${moduleId}:missing-workbook-reflection-prompts`);
      if (list(workbook.decisionWorksheet).length === 0) findings.push(`${moduleId}:missing-workbook-decision-worksheet`);
    }
  }

  const manifestIds = new Set(manifestModules.map(moduleIdentifier));
  for (const module of authoredModules) {
    const moduleId = String(module?.id || "");
    if (!manifestIds.has(moduleId)) findings.push(`${moduleId || "unknown"}:unexpected-module`);
  }

  const assessment = list(authored?.finalAssessment);
  if (assessment.length < 25) findings.push(`insufficient-final-assessment-${assessment.length}`);
  for (const [index, question] of assessment.entries()) {
    const prefix = `assessment-${index + 1}`;
    if (!manifestIds.has(String(question?.moduleId || ""))) findings.push(`${prefix}:invalid-module-id`);
    if (!nonEmpty(question?.question)) findings.push(`${prefix}:missing-question`);
    if (list(question?.options).length < 2) findings.push(`${prefix}:insufficient-options`);
    if (!Number.isInteger(question?.correctIndex) || question.correctIndex < 0 || question.correctIndex >= list(question?.options).length) {
      findings.push(`${prefix}:invalid-correct-index`);
    }
    if (!nonEmpty(question?.rationale)) findings.push(`${prefix}:missing-rationale`);
    if (!nonEmpty(question?.cognitiveLevel)) findings.push(`${prefix}:missing-cognitive-level`);
    if (!Array.isArray(question?.sourceIds)) findings.push(`${prefix}:missing-source-ids-array`);
  }

  const coverage = list(authored?.assessmentBlueprint?.coverageByModule);
  const coverageIds = new Set(coverage.map((entry) => String(entry?.moduleId || "")));
  for (const moduleId of manifestIds) {
    if (!coverageIds.has(moduleId)) findings.push(`assessment-blueprint-missing-${moduleId}`);
  }
  if (list(authored?.assessmentBlueprint?.cognitiveMix).length === 0) findings.push("missing-assessment-cognitive-mix");
  if (list(authored?.assessmentBlueprint?.integrityNotes).length === 0) findings.push("missing-assessment-integrity-notes");

  return [...new Set(findings)].sort();
}

export function assertAuthoredPackageReady(input) {
  const findings = authoredPackageFindings(input);
  if (findings.length > 0) {
    const detail = findings.slice(0, 80).join(", ");
    throw new Error(
      `AUTHORING_QUALITY_GATE_FAILURE findingCount=${findings.length}: ${detail}`,
    );
  }
  return { ready: true, findingCount: 0, findings: [] };
}
