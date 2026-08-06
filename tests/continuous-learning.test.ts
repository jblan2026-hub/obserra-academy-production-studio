import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTenantLearningSignals,
  calculateWeightedLearningScore,
  evaluateLearningCandidate,
  type LearningCandidate,
  type LearningSignal,
} from "@/lib/ai/continuous-learning";

const eligibleCandidate: LearningCandidate = {
  id: "candidate-1",
  organizationId: "org-1",
  candidateType: "prompt",
  baselineVersion: "1",
  candidateVersion: "2",
  evaluationCount: 40,
  averageQuality: 94,
  citationAccuracy: 0.99,
  safetyPassRate: 1,
  regressionRate: 0.01,
  estimatedCostChangePercent: 8,
  requiresHumanApproval: true,
};

test("eligible learning candidates still require human approval", () => {
  const decision = evaluateLearningCandidate(eligibleCandidate);
  assert.equal(decision.eligible, true);
  assert.equal(decision.requiresHumanApproval, true);
  assert.deepEqual(decision.reasons, []);
});

test("unsafe candidates cannot be promoted", () => {
  const decision = evaluateLearningCandidate({ ...eligibleCandidate, safetyPassRate: 0.99 });
  assert.equal(decision.eligible, false);
  assert.match(decision.reasons.join(" "), /safety/i);
});

test("weighted learning score reflects signal confidence", () => {
  const signals: LearningSignal[] = [
    { id: "1", organizationId: "org-1", type: "human_feedback", score: 100, weight: 3, evidence: {}, createdAt: new Date().toISOString() },
    { id: "2", organizationId: "org-1", type: "quality_score", score: 70, weight: 1, evidence: {}, createdAt: new Date().toISOString() },
  ];
  assert.equal(calculateWeightedLearningScore(signals), 92.5);
});

test("cross organization learning signals are rejected", () => {
  const signals: LearningSignal[] = [
    { id: "1", organizationId: "org-2", type: "quality_score", score: 90, weight: 1, evidence: {}, createdAt: new Date().toISOString() },
  ];
  assert.throws(() => assertTenantLearningSignals("org-1", signals), /Cross-organization/);
});
