import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const host = String(process.env.ACADEMY_LOCAL_PROXY_HOST || "127.0.0.1").trim();
const port = Math.max(1024, Math.min(65535, Number(process.env.ACADEMY_LOCAL_PROXY_PORT || 11435)));
const ollamaBaseUrl = String(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const defaultModel = String(process.env.LOCAL_AI_MODEL || "qwen2.5:7b-instruct").trim();
const timeoutMs = Math.max(60_000, Math.min(45 * 60_000, Number(process.env.LOCAL_AI_TIMEOUT_MS || 20 * 60_000)));
const maximumContextChars = Math.max(20_000, Math.min(180_000, Number(process.env.ACADEMY_LOCAL_CONTEXT_MAX_CHARS || 100_000)));

function jsonResponse(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function extractCourseId(prompt) {
  const patterns = [
    /Course ID:\s*([a-z0-9][a-z0-9-]{1,120})/i,
    /Course title:[^\n]*\n[\s\S]*?courseId["']?\s*[:=]\s*["']?([a-z0-9][a-z0-9-]{1,120})/i,
    /for\s+([a-z0-9][a-z0-9-]{2,120})\b/i,
  ];
  for (const pattern of patterns) {
    const match = String(prompt || "").match(pattern);
    if (match?.[1] && fs.existsSync(path.join(root, "courses", match[1], "course-manifest.json"))) return match[1];
  }
  return null;
}

function readFileBounded(filePath, maximum = maximumContextChars) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  return text.slice(0, maximum);
}

function governedContext(courseId) {
  if (!courseId) return "";
  const courseDir = path.join(root, "courses", courseId);
  const candidates = [
    ["free authoritative-source context", path.join(courseDir, "generated", "research", "free-source-context.json")],
    ["authoritative source research", path.join(courseDir, "generated", "research", "authoritative-source-research.json")],
    ["generated authoritative sources", path.join(courseDir, "authoritative-sources.generated.json")],
    ["course manifest", path.join(courseDir, "course-manifest.json")],
  ];
  let remaining = maximumContextChars;
  const blocks = [];
  for (const [label, filePath] of candidates) {
    if (remaining <= 0) break;
    const content = readFileBounded(filePath, remaining);
    if (!content) continue;
    remaining -= content.length;
    blocks.push(`\n--- ${label} ---\n${content}`);
  }
  if (!blocks.length) return "";
  return `\n\nLOCAL GOVERNED EVIDENCE BOUNDARY:\nYou have no commercial web-search tool in this execution. Use ONLY the supplied cached first-party/authoritative evidence below for externally verifiable claims. Never invent URLs, cases, dates, statistics, quotations, clauses, authorities, or facts. If the supplied evidence is insufficient, preserve the required JSON structure and explicitly identify the gap rather than fabricating support.${blocks.join("")}`;
}

function inputText(body) {
  if (typeof body.input === "string") return body.input;
  if (Array.isArray(body.input)) {
    return body.input.map((item) => {
      if (typeof item === "string") return item;
      if (typeof item?.content === "string") return item.content;
      if (Array.isArray(item?.content)) return item.content.map((part) => typeof part === "string" ? part : part?.text || "").join("\n");
      return "";
    }).filter(Boolean).join("\n");
  }
  return String(body.input || "");
}

async function ollamaJson(prompt, requestedModel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: requestedModel || defaultModel,
        stream: false,
        format: "json",
        messages: [
          {
            role: "system",
            content: "You are a governed Obserra Academy production model. Return one valid JSON object only. Follow the supplied source boundary. Never fabricate external evidence.",
          },
          { role: "user", content: prompt },
        ],
        options: {
          temperature: Number(process.env.ACADEMY_LOCAL_MODEL_TEMPERATURE || 0.15),
          num_ctx: Math.max(8192, Number(process.env.ACADEMY_LOCAL_MODEL_CONTEXT || 32768)),
        },
        keep_alive: process.env.ACADEMY_LOCAL_MODEL_KEEP_ALIVE || "30m",
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${text.slice(0, 2000)}`);
    const payload = JSON.parse(text);
    const content = payload?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("Ollama returned no message content.");
    return { content: content.trim(), usage: payload };
  } finally {
    clearTimeout(timer);
  }
}

async function handleResponses(request, response) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 2_000_000) {
      jsonResponse(response, 413, { error: { message: "Request too large" } });
      return;
    }
  }
  let body;
  try { body = JSON.parse(raw || "{}"); }
  catch {
    jsonResponse(response, 400, { error: { message: "Invalid JSON body" } });
    return;
  }

  const basePrompt = inputText(body);
  const courseId = extractCourseId(basePrompt);
  const prompt = `${basePrompt}${governedContext(courseId)}\n\nExecution metadata: provider=local-ollama; external-paid-api=false; estimated-api-cost-usd=0; external-web-search=false.`;

  try {
    const result = await ollamaJson(prompt, body.model || defaultModel);
    jsonResponse(response, 200, {
      id: `resp_local_${Date.now()}`,
      object: "response",
      status: "completed",
      model: body.model || defaultModel,
      output_text: result.content,
      output: [{
        id: `msg_local_${Date.now()}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: result.content }],
      }],
      usage: {
        input_tokens: Number(result.usage?.prompt_eval_count || 0),
        output_tokens: Number(result.usage?.eval_count || 0),
        total_tokens: Number(result.usage?.prompt_eval_count || 0) + Number(result.usage?.eval_count || 0),
      },
      local_execution: {
        provider: "ollama",
        paid_api: false,
        estimated_api_cost_usd: 0,
        course_id: courseId,
        source_cache_injected: Boolean(courseId),
      },
    });
  } catch (error) {
    jsonResponse(response, 502, {
      error: {
        type: "local_model_error",
        code: "ollama_local_failure",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    try {
      const upstream = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      jsonResponse(response, upstream.ok ? 200 : 503, {
        healthy: upstream.ok,
        provider: "local-ollama",
        model: defaultModel,
        estimatedApiCostUsd: 0,
      });
    } catch (error) {
      jsonResponse(response, 503, { healthy: false, provider: "local-ollama", detail: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (request.method === "POST" && ["/v1/responses", "/responses"].includes(request.url || "")) {
    await handleResponses(request, response);
    return;
  }
  jsonResponse(response, 404, { error: { message: "Not found" } });
});

server.listen(port, host, () => {
  console.log(`[Academy Studio] Local Ollama Responses proxy listening on http://${host}:${port}/v1/responses with model ${defaultModel}; paid API cost is $0.`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
