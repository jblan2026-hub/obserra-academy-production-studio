export const AUTHORING_POLICY_VERSION: string;

export type AuthoringEnvelope = {
  schemaVersion: "1.3";
  courseId: string;
  provider?: string;
  model?: string;
  authoringPolicyVersion: string;
  sourceManifestHash: string;
  reviewStatus: "draft-ai-generated";
  commercialQualityStatus: string;
  workerContract: {
    contractId: string;
    contractHash: string;
    taskType: string;
    role: string;
    workstream: string;
    appliedRules: string[];
    runtimeContext?: Record<string, string>;
  };
  productionStandard: {
    standardId: string;
    standardHash: string;
    qualityTier: string;
    qualityClaimAllowed: false;
    claimBoundary: string;
  };
  content: Record<string, unknown>;
  [key: string]: unknown;
};

export function stableHash(value: unknown): string;
export function authoringSourceHash(manifest: unknown, policyVersion?: string): string;
export function authoringPackageHash(envelope: unknown): string;
export function checkpointsRequired(): boolean;

export function validateAuthoringEnvelope(input: {
  courseId: string;
  envelope: AuthoringEnvelope;
  manifest: unknown;
}): {
  courseId: string;
  expectedManifestHash: string;
  packageHash: string;
  contractHash: string;
  productionStandardHash: string;
};

export function persistAuthoringCheckpoint(input: {
  courseId: string;
  envelope: AuthoringEnvelope;
  manifest: unknown;
}): Promise<
  | { stored: false; reason: "database-not-configured" }
  | {
      stored: true;
      courseId: string;
      packageHash: string;
      contractHash: string;
      productionStandardHash: string;
      transport: "github-oidc-supabase" | "direct-postgresql";
    }
>;

export function restoreAuthoringCheckpoints(): Promise<{
  schemaVersion: string;
  checkedAt: string;
  restored: number;
  evaluated: number;
  skipped: boolean;
  reason?: string;
  transport?: "github-oidc-supabase" | "direct-postgresql";
  authoringPolicyVersion?: string;
  contractId?: string;
  contractHash?: string;
  productionStandardId?: string;
  productionStandardHash?: string;
  qualityTier?: string;
  restoredCourseIds?: string[];
  claimBoundary?: string;
}>;
