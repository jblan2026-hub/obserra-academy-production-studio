export const AUTHORING_POLICY_VERSION: string;

export type AuthoringEnvelope = {
  schemaVersion: string;
  courseId: string;
  provider?: string;
  model?: string;
  authoringPolicyVersion: string;
  sourceManifestHash: string;
  reviewStatus: string;
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
};

export function persistAuthoringCheckpoint(input: {
  courseId: string;
  envelope: AuthoringEnvelope;
  manifest: unknown;
}): Promise<
  | { stored: false; reason: "database-not-configured" }
  | { stored: true; courseId: string; packageHash: string }
>;

export function restoreAuthoringCheckpoints(): Promise<{
  schemaVersion: string;
  checkedAt: string;
  restored: number;
  evaluated: number;
  skipped: boolean;
  reason?: string;
  authoringPolicyVersion?: string;
  restoredCourseIds?: string[];
  claimBoundary?: string;
}>;
