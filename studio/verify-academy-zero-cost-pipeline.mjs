import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflows = [
  ".github/workflows/academy-61-content-checkpoint.yml",
  ".github/workflows/academy-61-course-completion-only.yml",
];
const findings = [];

for (const relative of workflows) {
  const filePath = path.join(root, relative);
  if (!fs.existsSync(filePath)) {
    findings.push(`missing-workflow:${relative}`);
    continue;
  }
  const source = fs.readFileSync(filePath, "utf8");
  const forbidden = [
    ["secrets.OPENAI_API_KEY", "commercial-openai-secret"],
    ["secrets.ANTHROPIC_API_KEY", "commercial-anthropic-secret"],
    ["secrets.SYNTHESIA_API_KEY", "commercial-synthesia-secret"],
    ["secrets.HEYGEN_API_KEY", "commercial-heygen-secret"],
    ["submit-all-61-media-jobs.mjs", "commercial-media-submission-path"],
    ["reconcile-hollywood-media-results.mjs", "commercial-media-reconciliation-path"],
    ["actions/upload-artifact", "public-repository-artifact-upload"],
    ["STUDIO_ALLOW_PAID_AI: \"true\"", "paid-ai-enabled"],
  ];
  for (const [needle, label] of forbidden) {
    if (source.includes(needle)) findings.push(`${relative}:${label}`);
  }

  for (const required of [
    "OLLAMA_NO_CLOUD: \"1\"",
    "STUDIO_ALLOW_PAID_AI: \"false\"",
    "OPENAI_API_URL: http://127.0.0.1:11435/v1/responses",
    "local-ollama-responses-proxy.mjs",
    "normalize-local-ollama-evidence.mjs",
  ]) {
    if (!source.includes(required)) findings.push(`${relative}:missing:${required}`);
  }
}

const completion = fs.readFileSync(path.join(root, workflows[1]), "utf8");
for (const required of [
  "piper-tts==1.5.0",
  "render-all-61-local-media.mjs",
  "academy-61-local-media-render-summary.json",
  "ACADEMY_PRIVATE_BACKUP_REPOSITORY",
  "backup-61-courses-to-private-github.sh",
]) {
  if (!completion.includes(required)) findings.push(`completion-workflow:missing:${required}`);
}

const rendererPath = path.join(root, "studio", "render-all-61-local-media.mjs");
if (!fs.existsSync(rendererPath)) findings.push("missing-local-media-renderer");
else {
  const renderer = fs.readFileSync(rendererPath, "utf8");
  for (const required of [
    "1920x1080",
    "verify-media-audio.mjs",
    "piper-tts",
    "estimatedApiCostUsd: 0",
    "externalPaidMediaProviderUsed: false",
  ]) {
    if (!renderer.includes(required)) findings.push(`local-media-renderer:missing:${required}`);
  }
}

const proxyPath = path.join(root, "studio", "local-ollama-responses-proxy.mjs");
if (!fs.existsSync(proxyPath)) findings.push("missing-local-ollama-proxy");
else {
  const proxy = fs.readFileSync(proxyPath, "utf8");
  if (!proxy.includes('estimated_api_cost_usd: 0')) findings.push("local-ollama-proxy:missing-zero-cost-evidence");
  if (!proxy.includes("LOCAL GOVERNED EVIDENCE BOUNDARY")) findings.push("local-ollama-proxy:missing-governed-source-boundary");
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  objective: "academy-61-zero-commercial-model-media-api-cost",
  workflows,
  commercialModelApiAllowed: false,
  commercialMediaApiAllowed: false,
  protectedPublicArtifactsAllowed: false,
  findings,
  passed: findings.length === 0,
};
fs.mkdirSync(path.join(root, "catalog"), { recursive: true });
fs.writeFileSync(path.join(root, "catalog", "academy-zero-cost-pipeline-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Academy Studio] Zero-cost pipeline verification ${report.passed ? "PASSED" : "FAILED"} with ${findings.length} finding(s).`);
for (const finding of findings) console.error(` - ${finding}`);
if (!report.passed) process.exit(2);
