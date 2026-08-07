import assert from "node:assert/strict";
import test from "node:test";
import {
  answerIndex,
  deliveryReadiness,
  normalizeSelectedAnswers,
  sanitizeAssessment,
  sanitizeLessonContent,
} from "../lib/academy-delivery-contract";

test("learner lesson delivery removes answer keys and instructor-only content recursively", () => {
  const result = sanitizeLessonContent({
    learner: {
      openingContext: "A real learner lesson",
      knowledgeChecks: [
        {
          question: "What is the safest action?",
          options: ["A", "B"],
          correctIndex: 1,
          rationale: "Instructor explanation",
        },
      ],
      scenario: {
        situation: "Incomplete evidence",
        recommendedApproach: "Instructor-only resolution",
      },
    },
    instructor: {
      answerKey: { correctIndex: 1 },
      speakerNotes: "Do not send this to the browser",
    },
  });

  assert.equal(result.openingContext, "A real learner lesson");
  assert.deepEqual(result.knowledgeChecks, [{ question: "What is the safest action?", options: ["A", "B"] }]);
  assert.deepEqual(result.scenario, { situation: "Incomplete evidence" });
  assert.equal("instructor" in result, false);
});

test("assessment delivery exposes questions and options but not scoring data", () => {
  const result = sanitizeAssessment({
    id: "q1",
    kind: "final",
    prompt: "Which action is defensible?",
    options: { options: ["Verify evidence", "Guess"] },
  });

  assert.deepEqual(result, {
    id: "q1",
    kind: "final",
    question: "Which action is defensible?",
    options: ["Verify evidence", "Guess"],
  });
});

test("answerIndex accepts governed answer-key formats only", () => {
  assert.equal(answerIndex({ correctIndex: 2 }), 2);
  assert.equal(answerIndex({ correctOption: 1 }), 1);
  assert.equal(answerIndex(0), 0);
  assert.equal(answerIndex({ correctIndex: "2" }), null);
  assert.equal(answerIndex(null), null);
});

test("published release readiness fails closed when any paid learner asset is missing", () => {
  assert.deepEqual(deliveryReadiness({
    status: "PUBLISHED",
    lessonCount: 5,
    assessmentCount: 25,
    videoCount: 4,
    materialCount: 2,
    certificateTemplateAvailable: true,
  }), {
    ready: false,
    reasons: ["lesson-video-missing"],
  });

  assert.deepEqual(deliveryReadiness({
    status: "PUBLISHED",
    lessonCount: 5,
    assessmentCount: 25,
    videoCount: 5,
    materialCount: 2,
    certificateTemplateAvailable: true,
  }), {
    ready: true,
    reasons: [],
  });
});

test("assessment submissions require named questions and integer choices", () => {
  assert.deepEqual(normalizeSelectedAnswers([
    { questionId: "q1", answerIndex: 0 },
    { questionId: "q2", answerIndex: 3 },
  ]), [
    { questionId: "q1", answerIndex: 0 },
    { questionId: "q2", answerIndex: 3 },
  ]);
  assert.equal(normalizeSelectedAnswers([{ questionId: "q1", answerIndex: -1 }]), null);
  assert.equal(normalizeSelectedAnswers([{ questionId: "", answerIndex: 0 }]), null);
});
