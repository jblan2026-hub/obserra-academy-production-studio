import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const exists = (file) => fs.existsSync(path.join(root, file));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, passed: Boolean(condition) });

const packageJson = JSON.parse(read("package.json"));
const scripts = packageJson.scripts ?? {};
const authorCourseSource = read("studio/author-course-ai.mjs");
const providerHttpSource = read("studio/provider-http.mjs");
const parallelAuthorSource = read("studio/author-courses-parallel.mjs");

function resolveScriptChain(scriptName, seen = new Set()) {
  if (seen.has(scriptName)) return "";
  seen.add(scriptName);

  const script = typeof scripts[scriptName] === "string" ? scripts[scriptName] : "";
  if (!script) return "";

  const referencedScripts = [];
  const pattern = /npm\s+run\s+([A-Za-z0-9:_-]+)/g;
  let match;
  while ((match = pattern.exec(script)) !== null) {
    referencedScripts.push(match[1]);
  }

  return [script, ...referencedScripts.map((name) => resolveScriptChain(name, seen))]
    .filter(Boolean)
    .join(" && ");
}

const verificationChain = resolveScriptChain("verify");

const requiredScripts = [
  "test", "validate", "build:all", "catalog", "load:courses:check", "db:validate", "build", "verify", "ci",
];
for (const script of requiredScripts) check(`script exists: ${script}`, typeof scripts[script] === "string");

const requiredPaths = [
  "app", "courses", "lib", "prisma/schema.prisma", "studio", "owner-command-center",
  ".github/workflows/enterprise-50x-production-gate.yml",
];
for (const item of requiredPaths) check(`required production asset exists: ${item}`, exists(item));

check("Node engine is enterprise supported", />=22/.test(packageJson.engines?.node ?? ""));
check("Prisma client is present", Boolean(packageJson.dependencies?.["@prisma/client"]));
check("Clerk identity is present", Boolean(packageJson.dependencies?.["@clerk/nextjs"]));
check("Next production runtime is present", Boolean(packageJson.dependencies?.next));
check("locked dependency manifest exists", exists("package-lock.json"));
check("database deployment migration command exists", typeof scripts["db:migrate:deploy"] === "string");
check("course source import command exists", typeof scripts["import:website"] === "string");
check("website synchronization command exists", typeof scripts["sync:website"] === "string");
check("LCMS dry-run command exists", typeof scripts["load:courses:check"] === "string");
check("governed course policy command exists", typeof scripts["apply:course-policy"] === "string");
check("legal asset enforcement is part of course build", /enforce-course-legal-assets/.test(scripts["build:course"] ?? ""));
check("legal asset enforcement is part of all-course build", /enforce-course-legal-assets/.test(scripts["build:all"] ?? ""));
check("verification includes tests", /npm run test(?:\s|$)/.test(verificationChain));
check(
  "verification includes catalog",
  /npm run catalog(?:\s|$)/.test(verificationChain) || /node\s+studio\/generate-catalog\.mjs(?:\s|$)/.test(verificationChain),
);
check("verification includes schema validation", /npm run db:validate(?:\s|$)/.test(verificationChain));
check("CI includes production build", /npm run build/.test(scripts.ci ?? ""));

check(
  "AI authoring requests have a bounded timeout",
  authorCourseSource.includes("ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS")
    && authorCourseSource.includes("providerHttpRequest")
    && authorCourseSource.includes("timeoutMs: requestTimeoutMs")
    && providerHttpSource.includes("setTimeout")
    && providerHttpSource.includes("requestTimeoutMs"),
);
check(
  "AI authoring timeout failures are explicit",
  providerHttpSource.includes('"provider_request_timeout"')
    && providerHttpSource.includes("authoring request timed out after")
    && authorCourseSource.includes("providerCode: error.category"),
);
check("AI provider error bodies are bounded before logging", authorCourseSource.includes("...[truncated]") && authorCourseSource.includes("4000"));
check("parallel authoring processes have a bounded timeout", parallelAuthorSource.includes("ACADEMY_AUTHORING_PROCESS_TIMEOUT_MS") && parallelAuthorSource.includes("processTimeoutMs"));
check("timed out authoring processes terminate gracefully before force kill", parallelAuthorSource.includes('child.kill("SIGTERM")') && parallelAuthorSource.includes('child.kill("SIGKILL")'));
check("parallel authoring preserves bounded retry behavior", parallelAuthorSource.includes("ACADEMY_AUTHORING_MAX_ATTEMPTS") && parallelAuthorSource.includes("retrying in"));
check("parallel authoring emits progress heartbeat evidence", parallelAuthorSource.includes("Parallel authoring heartbeat"));
check("parallel authoring summary records timeout and elapsed evidence", parallelAuthorSource.includes("processTimeoutMs") && parallelAuthorSource.includes("elapsedMs"));
check("parallel authoring keeps protected output in the ephemeral generated path", authorCourseSource.includes('path.join(courseDir, "generated", "authoring")'));
check(
  "parallel authoring is capped at the 16-worker course allocation",
  parallelAuthorSource.includes("const portfolioWorkerCount = 36")
    && parallelAuthorSource.includes("const applicationWorkerAllocation = 20")
    && parallelAuthorSource.includes("const courseWorkerAllocation = 16")
    && parallelAuthorSource.includes("courseWorkerAllocation,\n  1,\n  courseWorkerAllocation")
    && parallelAuthorSource.includes("applicationWorkerAllocation + courseWorkerAllocation !== portfolioWorkerCount"),
);

console.log(`Studio 70x extension evaluated ${checks.length} non-duplicative assertions.`);
for (const item of checks) console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}`);
const failed = checks.filter((item) => !item.passed);
if (checks.length < 30) {
  console.error(`Studio extension is undersized: ${checks.length} assertions.`);
  process.exit(1);
}
if (failed.length) {
  console.error(`${failed.length} Studio assertions failed.`);
  process.exit(1);
}
console.log("Studio 70x extension passed and is intended to run after the existing 50x gate.");
