export type ProviderFailureClassification = {
  provider: string;
  category: string;
  retryable: boolean;
  exitCode: number;
  status: number | null;
  providerCode: string | null;
  message: string;
};

export type AuthoringExitClassification = {
  category: string;
  retryable: boolean;
  exitCode: number;
};

export const AUTHORING_EXIT_CODES: Readonly<{
  PROVIDER_QUOTA_EXHAUSTED: 42;
  PROVIDER_AUTHENTICATION_FAILED: 43;
  PROVIDER_REQUEST_INVALID: 44;
}>;

export class ProviderAuthoringError extends Error {
  provider: string;
  category: string;
  retryable: boolean;
  exitCode: number;
  status: number | null;
  providerCode: string | null;

  constructor(input: ProviderFailureClassification);
}

export function classifyProviderHttpFailure(input: {
  provider: string;
  status: number;
  body: string;
}): ProviderFailureClassification;

export function providerAuthoringErrorFromHttp(input: {
  provider: string;
  status: number;
  body: string;
}): ProviderAuthoringError;

export function classificationFromAuthoringExit(input: {
  exitCode: number | null;
  timedOut?: boolean;
  signal?: string | null;
}): AuthoringExitClassification;
