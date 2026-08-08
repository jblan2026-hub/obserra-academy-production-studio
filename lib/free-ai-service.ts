import { backendConfig } from "@/lib/backend-config";

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type FreeAiRequest = {
  messages: AiMessage[];
  responseFormat?: "text" | "json";
  temperature?: number;
  timeoutMs?: number;
};

export type FreeAiResult = {
  provider: "local-ollama" | "disabled";
  model: string;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd: 0;
};

function boundedTimeout(value?: number): number {
  const parsed = Number(value || process.env.LOCAL_AI_TIMEOUT_MS || 300_000);
  if (!Number.isFinite(parsed)) return 300_000;
  return Math.max(5_000, Math.min(900_000, Math.floor(parsed)));
}

async function localOllama(request: FreeAiRequest): Promise<FreeAiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(request.timeoutMs));
  try {
    const response = await fetch(`${backendConfig.localAiBaseUrl}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: backendConfig.localAiModel,
        messages: request.messages,
        stream: false,
        ...(request.responseFormat === "json" ? { format: "json" } : {}),
        options: {
          temperature: Math.max(0, Math.min(1, Number(request.temperature ?? 0.2))),
        },
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Local Ollama request failed with ${response.status}: ${raw.slice(0, 600)}`);
    const payload = JSON.parse(raw) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const content = String(payload.message?.content || "").trim();
    if (!content) throw new Error("Local Ollama returned no content");
    return {
      provider: "local-ollama",
      model: backendConfig.localAiModel,
      content,
      inputTokens: payload.prompt_eval_count,
      outputTokens: payload.eval_count,
      estimatedCostUsd: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeFreeAi(request: FreeAiRequest): Promise<FreeAiResult> {
  if (backendConfig.aiProvider === "disabled") {
    throw new Error("AI execution is disabled by STUDIO_AI_PROVIDER=disabled");
  }

  if (backendConfig.aiProvider === "paid-fallback" && !backendConfig.paidAiAllowed) {
    throw new Error("Paid AI fallback is blocked by the free-first backend policy");
  }

  return localOllama(request);
}

export async function freeAiHealth(): Promise<{
  provider: string;
  configured: boolean;
  reachable: boolean;
  model: string;
  detail?: string;
}> {
  if (backendConfig.aiProvider === "disabled") {
    return { provider: "disabled", configured: true, reachable: true, model: "none" };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(`${backendConfig.localAiBaseUrl}/api/tags`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) return { provider: "local-ollama", configured: true, reachable: false, model: backendConfig.localAiModel, detail: `HTTP ${response.status}` };
      return { provider: "local-ollama", configured: true, reachable: true, model: backendConfig.localAiModel };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      provider: "local-ollama",
      configured: true,
      reachable: false,
      model: backendConfig.localAiModel,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
