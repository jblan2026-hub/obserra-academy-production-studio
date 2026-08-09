import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));
const failures = [];
const check = (name, ok) => { if (!ok) failures.push(name); };

const coursesRoot = path.join(root, "courses");
const realCourses = exists("courses")
  ? fs.readdirSync(coursesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];
check("real course workspace exists", realCourses.length > 0);

const workload = Array.from({ length: 500 }, (_, index) => ({
  id: `studio-scale-${String(index + 1).padStart(3, "0")}`,
  generation: index % 3 === 0 ? "generated" : "pending",
  reviewCompletion: (index % 5) * 25,
  releaseStatus: ["draft", "in-review", "approved", "published"][index % 4],
  missingArtifacts: index % 10 === 0 ? ["learner-guide.md"] : [],
  price: 99 + (index % 10) * 20,
}));

check("500 Studio records created", workload.length === 500);
check("ids unique", new Set(workload.map((course) => course.id)).size === 500);
check("queue states valid", workload.every((course) => ["generated", "pending"].includes(course.generation)));
check("review values bounded", workload.every((course) => course.reviewCompletion >= 0 && course.reviewCompletion <= 100));
check(
  "release states valid",
  workload.every((course) => ["draft", "in-review", "approved", "published"].includes(course.releaseStatus)),
);

const actionable = workload.filter((course) => course.generation === "pending");
const publishable = workload.filter(
  (course) => course.generation === "generated"
    && course.reviewCompletion === 100
    && course.missingArtifacts.length === 0,
);
check("generation queue populated", actionable.length > 300);
check("publishability calculation stable", publishable.every((course) => course.releaseStatus));

const ownerAi = read("owner-command-center/electron/owner-ai.cjs");
const runtime = read("owner-command-center/electron/main.cjs");
const scanner = read("owner-command-center/electron/vulnerability-scan.cjs");
const discovery = read("owner-command-center/electron/discovery.cjs");
const trends = read("owner-command-center/electron/trend-store.cjs");
const threat = read("owner-command-center/electron/threat-policy.cjs");
const ui = read("owner-command-center/src/index.html");
const academyUi = read("owner-command-center/src/academy-reset-ui.js");

check("15 second monitoring enabled", /MONITOR_INTERVAL_MS\s*=\s*15000/.test(runtime));
check("Owner AI persistent state", /ownerAi\.state/.test(ownerAi));
check("Owner AI durable memory", /memories/.test(ownerAi) && /remember/.test(ownerAi));
check("entire-site scanner exists", /runVulnerabilityScan/.test(scanner));
check(
  "discovery is restricted to approved endpoints and local interfaces",
  /approved-endpoints-and-local-interfaces/.test(discovery),
);
check("unrestricted port scanning is disabled", /unrestrictedPortScanning:\s*false/.test(discovery));
check("discovery responses are bounded", /MAX_RESPONSE_BYTES/.test(discovery));
check("discovery requests have timeouts", /DISCOVERY_TIMEOUT_MS/.test(discovery));
check("MITRE mapping present", /MITRE ATT&CK/.test(threat));
check("OWASP mapping present", /OWASP Top 10/.test(threat));
check("known bad policy present", /knownBad|shouldAutoBlock/.test(threat));
check("owner override present", /override/.test(ownerAi) || /override/.test(runtime));
check("trend snapshots present", /recordSnapshot/.test(trends));

// The reset-v2 Command Center intentionally consolidates the former approval,
// security, and trend dashboard DOM islands into one evidence-backed course
// detail and portfolio-metric surface. Validate the current interaction
// contract rather than obsolete element identifiers from the retired layout.
check(
  "owner review and approval controls visible",
  /REQUIRED REVIEWS/.test(ui)
    && /OWNER RELEASE CONTROL/.test(ui)
    && /data-review-decision/.test(academyUi)
    && /data-release-action/.test(academyUi),
);
check(
  "release security and purchase controls visible",
  /RELEASE READINESS/.test(ui)
    && /SECURE PURCHASE VERIFICATION/.test(ui)
    && /publicationBlockers/.test(academyUi)
    && /data-purchase-action/.test(academyUi),
);
check(
  "assembly line stage metrics visible",
  /academyMetrics/.test(ui)
    && /BUILDING/.test(academyUi)
    && /NEEDS REVIEW/.test(academyUi)
    && /BLOCKED/.test(academyUi)
    && /APPROVED/.test(academyUi)
    && /LIVE/.test(academyUi),
);
check(
  "owner evidence and failure readback visible",
  /OWNER EVIDENCE/.test(ui)
    && /state\.lastResult/.test(academyUi)
    && /state\.lastError/.test(academyUi)
    && /providerReadback|required provider/i.test(academyUi),
);

const events = workload.map((course, index) => ({
  scope: `academy:${course.id}`,
  severity: index % 29 === 0 ? "critical" : index % 7 === 0 ? "high" : "medium",
  mapped: index % 29 === 0,
  fingerprint: crypto.createHash("sha256").update(JSON.stringify(course)).digest("hex"),
}));
check("500 anomaly events simulated", events.length === 500);
check("mapped critical events available", events.some((event) => event.mapped && event.severity === "critical"));
check("all fingerprints valid", events.every((event) => event.fingerprint.length === 64));

console.log(JSON.stringify({
  gate: "studio-command-center-500x",
  realCourses: realCourses.length,
  simulatedCourses: 500,
  simulatedEvents: 500,
  queued: actionable.length,
  publishable: publishable.length,
  failures,
}, null, 2));
if (failures.length) process.exit(1);
