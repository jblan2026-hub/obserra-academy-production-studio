import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registryPath = path.join(root, "sources", "authoritative-sources.json");
const casesPath = path.join(root, "sources", "documented-cases.json");
const cacheRoot = path.join(root, ".academy-cache", "authoritative-sources");
const catalogRoot = path.join(root, "catalog");
const maxBytes = Math.max(256_000, Math.min(20 * 1024 * 1024, Number(process.env.ACADEMY_FREE_SOURCE_MAX_BYTES || 8 * 1024 * 1024)));
const timeoutMs = Math.max(5_000, Math.min(120_000, Number(process.env.ACADEMY_FREE_SOURCE_TIMEOUT_MS || 30_000)));
const cacheTtlHours = Math.max(1, Math.min(720, Number(process.env.ACADEMY_FREE_SOURCE_CACHE_TTL_HOURS || 24)));
const cacheTtlMs = cacheTtlHours * 60 * 60 * 1000;

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const caseRegistry = fs.existsSync(casesPath) ? JSON.parse(fs.readFileSync(casesPath, "utf8")) : { cases: [] };
const authorities = Array.isArray(registry.sources) ? registry.sources.map((source) => ({
  id: source.id,
  title: source.title,
  canonicalUrl: source.canonicalUrl,
  evidenceKind: "authority",
})) : [];
const cases = Array.isArray(caseRegistry.cases) ? caseRegistry.cases.map((item) => ({
  id: item.id,
  title: item.title,
  canonicalUrl: item.primarySourceUrl,
  evidenceKind: "documented-case",
})) : [];
const sources = [...authorities, ...cases];
if (authorities.length === 0) throw new Error("Authoritative source registry is empty.");

function safeId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,120}$/.test(id)) throw new Error(`Unsafe source id: ${id}`);
  return id;
}
function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
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
function cachedRecord(sourceDir, source) {
  const metadataPath = path.join(sourceDir, "metadata.json");
  const metadata = readJsonIfPresent(metadataPath);
  if (!metadata || metadata.sourceId !== source.id || metadata.canonicalUrl !== source.canonicalUrl || metadata.evidenceKind !== source.evidenceKind || !metadata.sha256) return null;
  const fetchedAtMs = Date.parse(metadata.fetchedAt || "");
  if (!Number.isFinite(fetchedAtMs)) return null;
  const ageMs = Math.max(0, Date.now() - fetchedAtMs);
  return {
    metadata,
    metadataPath,
    ageMs,
    ageHours: Number((ageMs / 3_600_000).toFixed(2)),
    fresh: ageMs <= cacheTtlMs,
  };
}
async function fetchWithTimeout(url, cached) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "User-Agent": "Obserra-Academy-Free-Source-Cache/1.2",
    Accept: "text/html,application/xhtml+xml,application/json,text/plain,application/pdf;q=0.9,*/*;q=0.5",
  };
  if (cached?.metadata?.etag) headers["If-None-Match"] = cached.metadata.etag;
  if (cached?.metadata?.lastModified) headers["If-Modified-Since"] = cached.metadata.lastModified;
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers,
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
  const cached = cachedRecord(sourceDir, source);

  if (cached?.fresh) {
    results.push({
      ...cached.metadata,
      ok: true,
      cacheHit: true,
      networkFetched: false,
      revalidated: false,
      cacheAgeHours: cached.ageHours,
    });
    continue;
  }

  try {
    const response = await fetchWithTimeout(source.canonicalUrl, cached);
    const now = new Date().toISOString();
    if (response.status === 304 && cached) {
      const metadata = {
        ...cached.metadata,
        fetchedAt: now,
        revalidatedAt: now,
        httpStatus: 304,
        noModelCreditUsed: true,
      };
      fs.writeFileSync(cached.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
      results.push({
        ...metadata,
        ok: true,
        cacheHit: true,
        networkFetched: false,
        revalidated: true,
        cacheAgeHours: 0,
      });
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) throw new Error("empty response");
    if (body.length > maxBytes) throw new Error(`response ${body.length} bytes exceeds ${maxBytes} byte cache limit`);
    const contentType = String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
    const digest = sha256(body);
    const text = readableText(contentType, body);
    const metadata = {
      schemaVersion: "1.2",
      sourceId: id,
      evidenceKind: source.evidenceKind,
      title: source.title,
      canonicalUrl: source.canonicalUrl,
      resolvedUrl: response.url,
      fetchedAt: now,
      contentFetchedAt: now,
      httpStatus: response.status,
      contentType,
      bytes: body.length,
      sha256: digest,
      etag: response.headers.get("etag") || null,
      lastModified: response.headers.get("last-modified") || null,
      textAvailable: text.length > 0,
      textCharacters: text.length,
      noModelCreditUsed: true,
    };
    fs.writeFileSync(path.join(sourceDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    if (text) fs.writeFileSync(path.join(sourceDir, "source.txt"), `${text.slice(0, 1_000_000)}\n`, { mode: 0o600 });
    else fs.rmSync(path.join(sourceDir, "source.txt"), { force: true });
    results.push({
      ...metadata,
      ok: true,
      cacheHit: false,
      networkFetched: true,
      revalidated: false,
      cacheAgeHours: 0,
    });
  } catch (error) {
    results.push({
      schemaVersion: "1.2",
      sourceId: id,
      evidenceKind: source.evidenceKind,
      title: source.title,
      canonicalUrl: source.canonicalUrl,
      fetchedAt: new Date().toISOString(),
      ok: false,
      cacheHit: Boolean(cached),
      networkFetched: false,
      revalidated: false,
      cacheAgeHours: cached?.ageHours ?? null,
      noModelCreditUsed: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const authorityResults = results.filter((item) => item.evidenceKind === "authority");
const caseResults = results.filter((item) => item.evidenceKind === "documented-case");
const summary = {
  schemaVersion: "1.2",
  generatedAt: new Date().toISOString(),
  cacheTtlHours,
  authorityCount: authorities.length,
  documentedCaseCount: cases.length,
  sourceCount: sources.length,
  fetched: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
  cacheHits: results.filter((item) => item.ok && item.cacheHit).length,
  networkFetches: results.filter((item) => item.ok && item.networkFetched).length,
  revalidated: results.filter((item) => item.ok && item.revalidated).length,
  fetchedAuthorities: authorityResults.filter((item) => item.ok).length,
  fetchedDocumentedCases: caseResults.filter((item) => item.ok).length,
  cacheRoot: ".academy-cache/authoritative-sources",
  noModelCreditUsed: true,
  results,
};
fs.writeFileSync(path.join(catalogRoot, "academy-free-authoritative-source-cache.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[Academy Studio] Free primary-source cache ready for ${summary.fetched}/${summary.sourceCount} records: ${summary.cacheHits} cache hit(s), ${summary.networkFetches} network fetch(es), ${summary.revalidated} conditional revalidation(s).`);
if (summary.fetchedAuthorities < 4 || summary.fetchedDocumentedCases < 2) process.exit(2);
