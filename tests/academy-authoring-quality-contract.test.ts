import assert from "node:assert/strict";
import test from "node:test";

// @ts-ignore Studio production utilities are intentionally authored as native ESM.
import {
  ACADEMY_AUTHORING_POLICY_VERSION,
  ACADEMY_AUTHORING_QUALITY_REQUIREMENTS,
  academyAuthoringQualityContract,
  countWords,
} from "../studio/academy-authoring-quality-contract.mjs";
// @ts-ignore Studio production utilities are intentionally authored as native ESM.
import {
  assertAuthoredPackageReady,
  authoredPackageFindings,
} from "../studio/validate-authored-package.mjs";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ");
}

function choices() {
  return ["Option A", "Option B", "Option C", "Option D"];
}

function knowledgeCheck(index: number) {
  return {
    question: `Knowledge check ${index}`,
    options: choices(),
    correctIndex: index % 4,
    rationale: "The selected answer follows the evidence and decision criteria.",
  };
}

function assessmentQuestion(index: number) {
  return {
    question: `Assessment question ${index}`,
    options: choices(),
    correctIndex: index % 4,
    rationale: "The selected answer is the most proportionate and defensible response.",
    moduleId: "module-1",
    cognitiveLevel: index % 2 === 0 ? "application" : "analysis",
    sourceIds: ["SRC-001"],
  };
}

function validFixture() {
  const manifest = {
    course: {
      modules: [
        {
          id: "module-1",
          title: "Governed Executive Decision-Making",
          duration: "60 minutes",
          format: "interactive",
        },
      ],
    },
  };
  const authored = {
    courseSummary: {
      executiveValue: "Builds defensible executive judgment.",
      instructionalStrategy: "Evidence-led instruction with applied decisions.",
      sourceAndReviewNotes: ["All external claims require governed verification."],
    },
    sourceRegister: [
      {
        id: "SRC-001",
        sourceType: "authoritative-source-needed",
        claimOrTopic: "Executive decision governance",
        moduleIds: ["module-1"],
        verificationInstruction: "Verify against an approved authoritative source.",
        usageBoundary: "Informational instruction only; not legal or compliance advice.",
      },
    ],
    frameworkAlignment: [
      {
        framework: "NIST CSF 2.0",
        applicability: "informational-mapping-only",
        moduleIds: ["module-1"],
        alignmentNote: "Use only where the organizational context makes the mapping relevant.",
        verificationRequired: true,
      },
    ],
    assessmentBlueprint: {
      coverageByModule: [{ moduleId: "module-1", minimumQuestions: 30 }],
      cognitiveMix: [
        { level: "application", targetPercent: 60 },
        { level: "analysis", targetPercent: 40 },
      ],
      integrityNotes: ["Do not disclose answers during protected assessments."],
    },
    modules: [
      {
        id: "module-1",
        title: "Governed Executive Decision-Making",
        duration: "60 minutes",
        format: "interactive",
        learningObjectives: Array.from(
          { length: ACADEMY_AUTHORING_QUALITY_REQUIREMENTS.learningObjectives },
          (_, index) => `Learning objective ${index + 1}`,
        ),
        openingContext: "Executives must distinguish urgency from unsupported certainty.",
        lessonNarrative: words(
          ACADEMY_AUTHORING_QUALITY_REQUIREMENTS.lessonNarrativeWords,
        ),
        keyConcepts: Array.from(
          { length: ACADEMY_AUTHORING_QUALITY_REQUIREMENTS.keyConcepts },
          (_, index) => ({
            term: `Concept ${index + 1}`,
            explanation: "A developed explanation grounded in evidence and governance.",
          }),
        ),
        executiveExample: "An executive compares alternatives before authorizing action.",
        operationalExample: "An operator records evidence and escalates a material exception.",
        scenario: {
          situation: "A high-impact decision must be made with incomplete evidence.",
          evidence: ["Verified observation", "Known limitation"],
          decisionPrompt: "Select and justify the proportionate response.",
          recommendedApproach: "Preserve evidence, bound the action, and retain human oversight.",
          debrief: "The recommendation balances urgency, authority, and reversibility.",
        },
        exercise: {
          instructions: "Prepare a decision record using the supplied facts.",
          deliverable: "A reviewable executive decision memorandum.",
          rubric: ["Evidence", "Authority", "Proportionality", "Escalation"],
        },
        knowledgeChecks: Array.from(
          { length: ACADEMY_AUTHORING_QUALITY_REQUIREMENTS.knowledgeChecks },
          (_, index) => knowledgeCheck(index),
        ),
        slideNarrative: Array.from(
          { length: ACADEMY_AUTHORING_QUALITY_REQUIREMENTS.slideNarratives },
          (_, index) => ({
            title: `Slide ${index + 1}`,
            content: ["Substantive instructional point", "Evidence boundary"],
            speakerNotes: "Explain the decision logic and practical implications.",
            visualDirection: "Use a readable decision-flow graphic with text labels.",
          }),
        ),
        videoScript: {
          opening: "Open with a consequential executive decision under uncertainty.",
          segments: Array.from(
            { length: ACADEMY_AUTHORING_QUALITY_REQUIREMENTS.videoSegments },
            (_, index) => ({
              visual: `Scene ${index + 1} with readable source and context cards.`,
              narration: "Professional narration explains the evidence and decision logic.",
            }),
          ),
          closing: "Close with a defensible action and documentation standard.",
        },
        accessibilityNotes: Array.from(
          { length: ACADEMY_AUTHORING_QUALITY_REQUIREMENTS.accessibilityNotes },
          (_, index) => `Accessibility requirement ${index + 1}`,
        ),
        sourcePlaceholders: ["SRC-001"],
      },
    ],
    finalAssessment: Array.from(
      { length: ACADEMY_AUTHORING_QUALITY_REQUIREMENTS.finalAssessmentQuestions },
      (_, index) => assessmentQuestion(index),
    ),
    learnerWorkbook: [
      {
        moduleId: "module-1",
        reflectionPrompts: ["What evidence most changed your decision?"],
        decisionWorksheet: ["Evidence", "Authority", "Action", "Escalation"],
      },
    ],
    instructorGuide: {
      facilitationNotes: ["Require learners to explain their evidence boundary."],
      commonMisconceptions: ["Speed does not eliminate decision authority."],
      reviewWarnings: ["Do not represent informational mappings as compliance."],
    },
    marketing: {
      shortDescription: "Executive decision instruction grounded in evidence.",
      longDescription: "A professional course on proportionate, governed executive decisions.",
      buyerOutcomes: ["Produce a defensible decision record."],
      seoKeywords: ["executive leadership", "decision governance"],
    },
    brand: {
      legalName: "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC",
      proprietaryNotice: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.",
      visualSystem: "Official Obserra black, dark navy, gold, white, and restrained holographic blue",
    },
  };
  return { manifest, authored };
}

test("Academy authoring uses one explicit production-depth contract", () => {
  assert.equal(ACADEMY_AUTHORING_POLICY_VERSION, "2026.08.08.1");
  assert.deepEqual(academyAuthoringQualityContract(), {
    policyVersion: "2026.08.08.1",
    lessonNarrativeWords: 1200,
    learningObjectives: 6,
    keyConcepts: 6,
    knowledgeChecks: 4,
    slideNarratives: 10,
    videoSegments: 8,
    accessibilityNotes: 4,
    finalAssessmentQuestions: 30,
    finalAssessmentOptions: 4,
  });
  assert.equal(countWords(words(1200)), 1200);
});

test("a package satisfying the complete production-depth contract passes", () => {
  const fixture = validFixture();
  assert.deepEqual(authoredPackageFindings(fixture), []);
  assert.deepEqual(assertAuthoredPackageReady(fixture), {
    ready: true,
    findingCount: 0,
    findings: [],
  });
});

test("the quality gate rejects the prior 700-word and 25-question standard", () => {
  const fixture = validFixture();
  fixture.authored.modules[0].lessonNarrative = words(700);
  fixture.authored.modules[0].learningObjectives = fixture.authored.modules[0].learningObjectives.slice(0, 4);
  fixture.authored.modules[0].keyConcepts = fixture.authored.modules[0].keyConcepts.slice(0, 4);
  fixture.authored.modules[0].slideNarrative = fixture.authored.modules[0].slideNarrative.slice(0, 8);
  fixture.authored.modules[0].videoScript.segments = fixture.authored.modules[0].videoScript.segments.slice(0, 4);
  fixture.authored.finalAssessment = fixture.authored.finalAssessment.slice(0, 25);

  const findings = authoredPackageFindings(fixture);
  assert.ok(findings.includes("module-1:lesson-narrative-700-words-minimum-1200"));
  assert.ok(findings.includes("module-1:learning-objectives:insufficient-count-4-minimum-6"));
  assert.ok(findings.includes("module-1:key-concepts-4-minimum-6"));
  assert.ok(findings.includes("module-1:slide-narratives-8-minimum-10"));
  assert.ok(findings.includes("module-1:video-segments-4-minimum-8"));
  assert.ok(findings.includes("final-assessment-25-minimum-30"));
  assert.throws(
    () => assertAuthoredPackageReady(fixture),
    /AUTHORING_QUALITY_GATE_FAILURE/,
  );
});

test("assessment source identifiers must resolve to the governed source register", () => {
  const fixture = validFixture();
  fixture.authored.finalAssessment[0].sourceIds = ["UNKNOWN-SOURCE"];
  const findings = authoredPackageFindings(fixture);
  assert.ok(findings.includes("assessment-1:unknown-source-id-UNKNOWN-SOURCE"));
});
