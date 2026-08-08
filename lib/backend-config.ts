export type BackendAuthProvider = "supabase" | "oidc" | "clerk" | "machine-only";
export type BackendStorageProvider = "local" | "supabase";
export type BackendQueueProvider = "postgres" | "inline";
export type BackendAiProvider = "local" | "disabled" | "paid-fallback";

function enumValue<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = String(process.env[name] || "").trim().toLowerCase() as T;
  return allowed.includes(value) ? value : fallback;
}

function positiveInt(name: string, fallback: number, maximum: number): number {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

export const backendConfig = Object.freeze({
  mode: String(process.env.BACKEND_COST_MODE || "free-first").trim().toLowerCase(),
  authProvider: enumValue<BackendAuthProvider>("STUDIO_AUTH_PROVIDER", ["supabase", "oidc", "clerk", "machine-only"], "supabase"),
  storageProvider: enumValue<BackendStorageProvider>("STUDIO_STORAGE_PROVIDER", ["local", "supabase"], "supabase"),
  queueProvider: enumValue<BackendQueueProvider>("STUDIO_QUEUE_PROVIDER", ["postgres", "inline"], "postgres"),
  aiProvider: enumValue<BackendAiProvider>("STUDIO_AI_PROVIDER", ["local", "disabled", "paid-fallback"], "local"),
  paidAiAllowed: ["1", "true", "yes", "on"].includes(String(process.env.STUDIO_ALLOW_PAID_AI || "false").trim().toLowerCase()),
  paidAiDailyCallBudget: positiveInt("STUDIO_PAID_AI_DAILY_CALL_BUDGET", 5, 1000),
  paidAiPerRunCallBudget: positiveInt("STUDIO_PAID_AI_PER_RUN_CALL_BUDGET", 2, 100),
  localAiBaseUrl: String(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
  localAiModel: String(process.env.LOCAL_AI_MODEL || "qwen2.5:14b-instruct").trim(),
  supabaseUrl: String(process.env.SUPABASE_URL || (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : "")).replace(/\/$/, ""),
  supabaseStorageBucket: String(process.env.SUPABASE_STORAGE_BUCKET || "academy-private").trim(),
  localStorageRoot: String(process.env.STUDIO_LOCAL_STORAGE_ROOT || ".academy-private-storage").trim(),
  oidcIssuer: String(process.env.STUDIO_OIDC_ISSUER || "").replace(/\/$/, ""),
  oidcAudience: String(process.env.STUDIO_OIDC_AUDIENCE || "").trim(),
  oidcJwksUrl: String(process.env.STUDIO_OIDC_JWKS_URL || "").trim(),
});

export function assertFreeFirstBackendPolicy(): void {
  if (backendConfig.mode !== "free-first") {
    throw new Error(`BACKEND_COST_MODE must be free-first; received ${backendConfig.mode || "empty"}.`);
  }
  if (backendConfig.aiProvider === "paid-fallback" && !backendConfig.paidAiAllowed) {
    throw new Error("STUDIO_AI_PROVIDER=paid-fallback requires explicit STUDIO_ALLOW_PAID_AI=true.");
  }
  if (backendConfig.authProvider === "supabase" && !backendConfig.supabaseUrl) {
    throw new Error("Supabase auth requires SUPABASE_URL or SUPABASE_PROJECT_REF.");
  }
  if (backendConfig.authProvider === "oidc" && !backendConfig.oidcIssuer) {
    throw new Error("OIDC auth requires STUDIO_OIDC_ISSUER.");
  }
}
