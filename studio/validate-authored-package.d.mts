export type AuthoredPackageValidationInput = {
  manifest: unknown;
  authored: unknown;
};

export type AuthoredPackageValidationResult = {
  ready: boolean;
  findingCount: number;
  findings: string[];
};

export function authoredPackageFindings(
  input: AuthoredPackageValidationInput,
): string[];

export function assertAuthoredPackageReady(
  input: AuthoredPackageValidationInput,
): AuthoredPackageValidationResult;
