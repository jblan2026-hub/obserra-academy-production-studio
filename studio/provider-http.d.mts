export type ProviderTransportCategory =
  | "provider_response_too_large"
  | "provider_connection_aborted"
  | "provider_response_failure"
  | "provider_request_timeout"
  | "provider_connection_failure"
  | string;

export class ProviderTransportError extends Error {
  constructor(
    provider: string,
    category: ProviderTransportCategory,
    message: string,
    cause?: unknown,
  );

  readonly provider: string;
  readonly category: ProviderTransportCategory;
  readonly retryable: boolean;
}

export type ProviderHttpResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
};

export function providerHttpRequest(input: {
  provider: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Record<string, unknown> | unknown[];
  timeoutMs?: number;
  maximumResponseBytes?: number;
}): Promise<ProviderHttpResponse>;
