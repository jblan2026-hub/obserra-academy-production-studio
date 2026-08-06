export type LearningSignalType =
  | "human_feedback"
  | "quality_score"
  | "citation_validation"
  | "assessment_performance"
  | "publication_outcome"
  | "source_change"
  | "safety_evaluation";

export type LearningSignal = {
  id: string;
  organizationId: string;
  executionId?: string;
  type: LearningSignalType;
  score: number;
  weight: number;
  evidence: Record<string, unknown>;
  createdAt: string;
};

export type LearningCandidate = {
  id: string;
  organizationId: string;
  candidateType: "prompt" | "routing_policy" | "knowledge_snapshot" | "guardrail";
  baselineVersion: string;
  candidateVersion: string;
  evaluationCount: number;
  averageQuality: number;
  citationAccuracy: number;
  safetyPassRate: number;
  regressionRate: number;
  estimatedCostChangePercent: number;
  requiresHumanApproval: true;
};

export type PromotionDecision = {
  eligible: boolean;
  requiresHumanApproval: true;
  reasons: string[];
};

export const DEFAULT_LEARNING_POLICY = Object.freeze({
  minimumEvaluations: 25,
  minimumAverageQuality: 90,
  minimumCitationAccuracy: 0.98,
  minimumSafetyPassRate: 1,
  maximumRegressionRate: 0.02,
  maximumCostIncreasePercent: 15,
});

export function evaluateLearningCandidate(
  candidate: LearningCandidate,
  policy = DEFAULT_LEARNING_POLICY,
): PromotionDecision {
  const reasons: string[] = [];

  if (candidate.evaluationCount < policy.minimumEvaluations) {
    reasons.push(`Requires at least ${policy.minimumEvaluations} evaluations`);
  }
  if (candidate.averageQuality < policy.minimumAverageQuality) {
    reasons.push(`Average quality must be at least ${policy.minimumAverageQuality}`);
  }
  if (candidate.citationAccuracy < policy.minimumCitationAccuracy) {
    reasons.push(`Citation accuracy must be at least ${policy.minimumCitationAccuracy}`);
  }
  if (candidate.safetyPassRate < policy.minimumSafetyPassRate) {
    reasons.push("Every required safety evaluation must pass");
  }
  if (candidate.regressionRate > policy.maximumRegressionRate) {
    reasons.push(`Regression rate must not exceed ${policy.maximumRegressionRate}`);
  }
  if (candidate.estimatedCostChangePercent > policy.maximumCostIncreasePercent) {
    reasons.push(`Estimated cost increase must not exceed ${policy.maximumCostIncreasePercent}%`);
  }

  return {
    eligible: reasons.length === 0,
    requiresHumanApproval: true,
    reasons,
  };
}

export function calculateWeightedLearningScore(signals: readonly LearningSignal[]): number {
  if (signals.length === 0) return 0;

  const weighted = signals.reduce(
    (accumulator, signal) => ({
      score: accumulator.score + signal.score * signal.weight,
      weight: accumulator.weight + signal.weight,
    }),
    { score: 0, weight: 0 },
  );

  if (weighted.weight <= 0) return 0;
  return Math.round((weighted.score / weighted.weight) * 100) / 100;
}

export function assertTenantLearningSignals(
  organizationId: string,
  signals: readonly LearningSignal[],
): void {
  const crossTenantSignal = signals.find((signal) => signal.organizationId !== organizationId);
  if (crossTenantSignal) {
    throw new Error("Cross-organization learning signals are prohibited");
  }
}
