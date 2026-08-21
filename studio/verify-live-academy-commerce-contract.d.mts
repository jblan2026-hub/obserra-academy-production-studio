export type AcademyCommerceHealthPayload = {
  contract?: unknown;
  operational?: unknown;
  paymentProvider?: unknown;
  providerVerification?: {
    environment?: unknown;
    connected?: unknown;
    chargesEnabled?: unknown;
  };
  webhookVerification?: unknown;
  checkoutModes?: unknown;
  claimPolicy?: unknown;
  identity?: unknown;
  durableStorage?: unknown;
  purchaserIdentityHashing?: unknown;
  fulfillment?: {
    authenticated?: unknown;
    guest?: unknown;
    idempotencyKey?: unknown;
    auditLedger?: unknown;
  };
};

export function validateCommerceHealthPayload(payload: AcademyCommerceHealthPayload | null | undefined): void;

export function verifyLiveAcademyCommerce(options?: {
  origin?: string;
  checks?: Set<"health" | "checkout" | "webhook">;
}): Promise<void>;
