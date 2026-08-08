import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const findings = [];

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    findings.push(`missing-required-file:${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

function filesUnder(relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  const output = [];
  if (!fs.existsSync(absoluteRoot)) return output;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:ts|tsx|mjs|js)$/.test(entry.name)) output.push(full);
    }
  };
  walk(absoluteRoot);
  return output;
}

const packageJson = JSON.parse(read("package.json") || "{}");
const backendConfig = read("lib/backend-config.ts");
const studioAuth = read("lib/studio-auth.ts");
const storageService = read("lib/storage-service.ts");
const aiService = read("lib/free-ai-service.ts");
const worker = read("studio/run-free-ai-worker.ts");
const proxy = read("proxy.ts");

if (!packageJson.dependencies?.jose) findings.push("missing-open-source-jose-jwt-dependency");
if (!String(packageJson.scripts?.["verify:free-backend"] || "").includes("verify-free-backend.mjs")) findings.push("missing-verify-free-backend-script");
if (!String(packageJson.scripts?.["worker:free-ai"] || "").includes("run-free-ai-worker")) findings.push("missing-free-ai-worker-script");

for (const [needle, label] of [
  ['BACKEND_COST_MODE || "free-first"', "backend-cost-mode-not-free-first-by-default"],
  ['STUDIO_AUTH_PROVIDER", ["supabase", "clerk", "machine-only"], "supabase"', "supabase-auth-not-default"],
  ['STUDIO_STORAGE_PROVIDER", ["local", "supabase"], "supabase"', "supabase-storage-not-default"],
  ['STUDIO_QUEUE_PROVIDER", ["postgres", "inline"], "postgres"', "postgres-queue-not-default"],
  ['STUDIO_AI_PROVIDER", ["local", "disabled", "paid-fallback"], "local"', "local-ai-not-default"],
  ['STUDIO_ALLOW_PAID_AI || "false"', "paid-ai-not-disabled-by-default"],
]) {
  if (!backendConfig.includes(needle)) findings.push(label);
}

if (!studioAuth.includes("createRemoteJWKSet") || !studioAuth.includes("jwtVerify")) findings.push("supabase-jwt-verification-not-implemented");
if (!storageService.includes("putPrivateObject") || !storageService.includes("SUPABASE_SERVICE_ROLE_KEY")) findings.push("private-storage-adapter-incomplete");
if (!aiService.includes("/api/chat") || !aiService.includes("estimatedCostUsd: 0")) findings.push("local-zero-cost-ai-adapter-incomplete");
if (!worker.includes("FOR UPDATE SKIP LOCKED") || !worker.includes("estimatedCostUsd: 0")) findings.push("postgres-free-ai-worker-incomplete");
if (!proxy.includes("?!api(?:/|$)")) findings.push("api-still-intercepted-by-clerk-proxy");

for (const fullPath of filesUnder("app/api")) {
  const source = fs.readFileSync(fullPath, "utf8");
  const relative = path.relative(root, fullPath).replace(/\\/g, "/");
  if (source.includes('@clerk/nextjs/server')) findings.push(`direct-clerk-backend-import:${relative}`);
  if (source.includes("OPENAI_API_KEY") || source.includes("ANTHROPIC_API_KEY")) findings.push(`direct-paid-model-backend-secret:${relative}`);
}

const forbiddenRuntimeDependencies = ["redis", "ioredis", "bullmq", "@aws-sdk/client-sqs", "@google-cloud/tasks"];
for (const dependency of forbiddenRuntimeDependencies) {
  if (packageJson.dependencies?.[dependency]) findings.push(`paid-or-extra-queue-runtime-dependency:${dependency}`);
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  objective: "academy-backend-free-first-no-required-paid-services",
  defaults: {
    auth: "supabase",
    database: "postgresql",
    storage: "supabase-private-or-local",
    queue: "postgresql-skip-locked",
    ai: "local-ollama",
    paidAiAllowed: false,
  },
  findings,
  passed: findings.length === 0,
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "free-backend-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Backend] Free-first backend verification ${report.passed ? "PASSED" : "FAILED"} with ${findings.length} finding(s).`);
if (findings.length) {
  for (const finding of findings) console.error(` - ${finding}`);
  process.exit(2);
}
