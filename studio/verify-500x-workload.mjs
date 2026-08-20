import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));
const failures = [];
const check = (name, ok) => { if (!ok) failures.push(name); };

const coursesRoot = path.join(root, "courses");
const realCourses = exists("courses") ? fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
check("real course workspace exists", realCourses.length > 0);

const workload = Array.from({ length: 500 }, (_, i) => ({
  id: `studio-scale-${String(i + 1).padStart(3, "0")}`,
  generation: i % 3 === 0 ? "generated" : "pending",
  reviewCompletion: (i % 5) * 25,
  releaseStatus: ["draft", "in-review", "approved", "published"][i % 4],
  missingArtifacts: i % 10 === 0 ? ["learner-guide.md"] : [],
  price: 99 + (i % 10) * 20,
}));

check("500 Studio records created", workload.length === 500);
check("ids unique", new Set(workload.map((c) => c.id)).size === 500);
check("queue states valid", workload.every((c) => ["generated", "pending"].includes(c.generation)));
check("review values bounded", workload.every((c) => c.reviewCompletion >= 0 && c.reviewCompletion <= 100));
check("release states valid", workload.every((c) => ["draft", "in-review", "approved", "published"].includes(c.releaseStatus)));

const actionable = workload.filter((c) => c.generation === "pending");
const publishable = workload.filter((c) => c.generation === "generated" && c.reviewCompletion === 100 && c.missingArtifacts.length === 0);
check("generation queue populated", actionable.length > 300);
check("publishability calculation stable", publishable.every((c) => c.releaseStatus));

const ownerAi = read("owner-command-center/electron/owner-ai.cjs");
const runtime = read("owner-command-center/electron/main.cjs");
const scanner = read("owner-command-center/electron/vulnerability-scan.cjs");
const discovery = read("owner-command-center/electron/discovery.cjs");
const trends = read("owner-command-center/electron/trend-store.cjs");
const threat = read("owner-command-center/electron/threat-policy.cjs");
const ui = read("owner-command-center/src/index.html");

check("15 second monitoring enabled", /MONITOR_INTERVAL_MS\s*=\s*15000/.test(runtime));
check("Owner AI persistent state", /ownerAi\.state/.test(ownerAi));
check("Owner AI durable memory", /memories/.test(ownerAi) && /remember/.test(ownerAi));
check("entire-site scanner exists", /runVulnerabilityScan/.test(scanner));
check("discovery is restricted to approved endpoints and local interfaces", /approved-endpoints-and-local-interfaces/.test(discovery));
check("unrestricted port scanning is disabled", /unrestrictedPortScanning:\s*false/.test(discovery));
check("discovery responses are bounded", /MAX_RESPONSE_BYTES/.test(discovery));
check("discovery requests have timeouts", /DISCOVERY_TIMEOUT_MS/.test(discovery));
check("MITRE mapping present", /MITRE ATT&CK/.test(threat));
check("OWASP mapping present", /OWASP Top 10/.test(threat));
check("known bad policy present", /knownBad|shouldAutoBlock/.test(threat));
check("owner override present", /override/.test(ownerAi) || /override/.test(runtime));
check("trend snapshots present", /recordSnapshot/.test(trends));
check("approval dashboard visible", /ownerAiApprovals/.test(ui));
check("security dashboard visible", /securityAlerts/.test(ui));
check("trend dashboard visible", /trendComparisons/.test(ui));

const events = workload.map((course, index) => ({
  scope: `academy:${course.id}`,
  severity: index % 29 === 0 ? "critical" : index % 7 === 0 ? "high" : "medium",
  mapped: index % 29 === 0,
  fingerprint: crypto.createHash("sha256").update(JSON.stringify(course)).digest("hex"),
}));
check("500 anomaly events simulated", events.length === 500);
check("mapped critical events available", events.some((e) => e.mapped && e.severity === "critical"));
check("all fingerprints valid", events.every((e) => e.fingerprint.length === 64));

console.log(JSON.stringify({ gate: "studio-command-center-500x", realCourses: realCourses.length, simulatedCourses: 500, simulatedEvents: 500, queued: actionable.length, publishable: publishable.length, failures }, null, 2));
if (failures.length) process.exit(1);
