import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registryPath = path.join(root, "sources", "authoritative-sources.json");
const cacheRoot = path.join(root, ".academy-cache", "authoritative-sources");
const catalogRoot = path.join(root, "catalog");
const maxBytes = Math.max(256_000, Math.min(20 * 1024 * 1024, Number(process.env.ACADEMY_FREE_SOURCE_MAX_BYTES || 8 * 1024 * 1024)));
const timeoutMs = Math.max(5_000, Math.min(120_000, Number(process.env.ACADEMY_FREE_SOURCE_TIMEOUT_MS || 30_000)));

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const sources = Array.isArray(registry.sources) ? registry.sources : [];
if (sources.length === 0) throw new Error("Authoritative source registry is empty.");

function safeId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,120}$/.test(id)) throw new Error(`Unsafe source id: ${id}`);
  return id;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readableText(contentType, body) {
  if (contentType.includes("json")) {
    try { return JSON.stringify(JSON.parse(body.toString("utf8")), null, 2); } catch { return body.toString("utf8"); }
  }
  if (contentType.includes("html") || contentType.includes("xhtml")) return stripHtml(body.toString("utf8"));
  if (contentType.startsWith("text/")) return body.toString("utf8").replace(/\s+/g, " ").trim();
  return "";
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Obserra-Academy-Free-Source-Cache/1.0",
        Accept: "text/html,application/xhtml+xml,application/json,text/plain,application/pdf;q=0.9,*/*;q=0.5",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
fs.mkdirSync(catalogRoot, { recursive: true });
const results = [];
for (const source of sources) {
  const id = safeId(source.id);
  const sourceDir = path.join(cacheRoot, id);
  fs.mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
  try {
    const response = await fetchWithTimeout(source.canonicalUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    if (body.length === 0) throw new Error("empty response");
    if (body.length > maxBytes) throw new Error(`response ${body.length} bytes exceeds ${maxBytes} byte cache limit`);
    const contentType = String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
    const digest = sha256(body);
    const text = readableText(contentType, body);
    const metadata = {
      schemaVersion: "1.0",
      sourceId: id,
      title: source.title,
      canonicalUrl: source.canonicalUrl,
      resolvedUrl: response.url,
      fetchedAt: new Date().toISOString(),
      httpStatus: response.status,
      contentType,
      bytes: body.length,
      sha256: digest,
      textAvailable: text.length > 0,
      textCharacters: text.length,
      noModelCreditUsed: true,
    };
    fs.writeFileSync(path.join(sourceDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    if (text) fs.writeFileSync(path.join(sourceDir, "source.txt"), `${text.slice(0, 1_000_000)}\n`, { mode: 0o600 });
    results.push({ ...metadata, ok: true });
  } catch (error) {
    results.push({
      schemaVersion: "1.0",
      sourceId: id,
      title: source.title,
      canonicalUrl: source.canonicalUrl,
      fetchedAt: new Date().toISOString(),
      ok: false,
      noModelCreditUsed: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const summary = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  sourceCount: sources.length,
  fetched: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
  cacheRoot: ".academy-cache/authoritative-sources",
  noModelCreditUsed: true,
  results,
};
fs.writeFileSync(path.join(catalogRoot, "academy-free-authoritative-source-cache.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[Academy Studio] Free authoritative source cache fetched ${summary.fetched}/${summary.sourceCount} sources without model credits.`);
if (summary.fetched === 0) process.exit(2);
