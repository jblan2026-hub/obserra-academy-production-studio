import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertAcademyWorkerAllocation } from "./academy-worker-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const releasesRoot = path.join(root, "releases");
const compliancePath = path.join(catalogRoot, "academy-hollywood-compliance-staging.json");
const gatePath = path.join(catalogRoot, "academy-release-approval-gate.json");
const notificationPath = path.join(catalogRoot, "academy-release-approval-notification.md");
const expectedCourses = Number(process.env.ACADEMY_EXPECTED_REVIEW_COURSES || 60);
const ownerIssueNumber = Number(process.env.ACADEMY_RELEASE_APPROVAL_ISSUE || 27);
const requireAll = process.argv.includes("--require-all");
const allocation = assertAcademyWorkerAllocation();

const expectedOwnerDecisionBlockers = new Set([
  "publication-not-owner-enabled",
  "release-status-not-approved",
]);

const mandatoryReleaseEvidence = Object.freeze([
  "sourceVerificationApproved",
  "realWorldCaseReviewApproved",
  "implementationGuidanceReviewApproved",
  "assessmentIntegrityApproved",
  "mediaMasteringApproved",
  "audioQualityApproved",
  "captionsAndTranscriptsApproved",
  "accessibilityApproved",
  "rightsAndLicensingApproved",
  "certificateVerified",
  "entitlementAndCompletionVerified",
  "securityAndPrivacyVerified",
  "backupRestoreRollbackVerified",
  "independentPreOwnerReviewApproved",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, value, "utf8");
  fs.renameSync(temporary, filePath);
}

function ensureComplianceReport() {
  const result = spawnSync(process.execPath, ["studio/validate-hollywood-course-contract.mjs"], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });
  if (!fs.existsSync(compliancePath)) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-6000);
    throw new Error(`Cinematic compliance report was not generated. ${detail}`);
  }
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(`Cinematic compliance validation failed unexpectedly with exit code ${result.status ?? "unknown"}.`);
  }
}

function courseArtifactStatus(courseId) {
  const courseRoot = path.join(root, "courses", courseId);
  const requiredArtifacts = [
    "instructor-manuscript.md",
    "learner-guide.md",
    "workbook.md",
    "assessment-bank.json",
    "answer-key.json",
  ];
  const results = requiredArtifacts.map((artifact) => ({
    artifact,
    present: fs.existsSync(path.join(courseRoot, artifact)),
  }));
  return {
    required: results,
    complete: results.every((item) => item.present),
    missing: results.filter((item) => !item.present).map((item) => item.artifact),
  };
}

function releaseEvidenceStatus(courseId) {
  const candidates = [
    path.join(releasesRoot, courseId, "FINAL", "release-approval-evidence.json"),
    path.join(releasesRoot, courseId, "FINAL", "commercial-release-evidence.json"),
    path.join(root, "courses", courseId, "generated", "release", "release-approval-evidence.json"),
  ];
  const evidencePath = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  if (!evidencePath) {
    return {
      present: false,
      path: null,
      approved: false,
      missingApprovals: [...mandatoryReleaseEvidence],
      invalid: false,
    };
  }

  try {
    const evidence = readJson(evidencePath);
    const approvals = evidence.approvals && typeof evidence.approvals === "object"
      ? evidence.approvals
      : evidence;
    const missingApprovals = mandatoryReleaseEvidence.filter((name) => approvals?.[name] !== true);
    const explicitlyOwnerAccepted = approvals?.ownerAcceptance === true || evidence?.ownerAcceptance === true;
    return {
      present: true,
      path: path.relative(root, evidencePath).replaceAll(path.sep, "/"),
      approved: missingApprovals.length === 0,
      missingApprovals,
      invalid: false,
      ownerAcceptanceRecorded: explicitlyOwnerAccepted,
      evidenceVersion: evidence.schemaVersion ?? null,
      evidenceGeneratedAt: evidence.generatedAt ?? evidence.updatedAt ?? null,
    };
  } catch (error) {
    return {
      present: true,
      path: path.relative(root, evidencePath).replaceAll(path.sep, "/"),
      approved: false,
      missingApprovals: [...mandatoryReleaseEvidence],
      invalid: true,
      error: String(error?.message ?? error).slice(0, 500),
    };
  }
}

function manifestState(courseId) {
  const manifestPath = path.join(root, "courses", courseId, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { present: false, publicationDisabled: false, statusAllowed: false, status: "missing" };
  }
  const manifest = readJson(manifestPath);
  const status = String(manifest.release?.status ?? "draft").toLowerCase();
  return {
    present: true,
    publicationDisabled: manifest.release?.publishToAcademy !== true,
    statusAllowed: ["draft", "in-review"].includes(status),
    status,
    publishToAcademy: manifest.release?.publishToAcademy === true,
  };
}

function blockerHistogram(courses) {
  const histogram = new Map();
  for (const course of courses) {
    for (const blocker of course.blockers) {
      histogram.set(blocker, (histogram.get(blocker) ?? 0) + 1);
    }
  }
  return [...histogram.entries()]
    .map(([blocker, count]) => ({ blocker, count }))
    .sort((left, right) => right.count - left.count || left.blocker.localeCompare(right.blocker));
}

function writeGithubOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

ensureComplianceReport();
const compliance = readJson(compliancePath);
const courses = [];

for (const course of compliance.courses ?? []) {
  const blockers = [];
  if (course.structuralReady !== true) blockers.push(...(course.findings ?? []).map((finding) => `structural:${finding}`));

  const preOwnerPublicationBlockers = (course.publicationBlockers ?? [])
    .filter((blocker) => !expectedOwnerDecisionBlockers.has(blocker));
  blockers.push(...preOwnerPublicationBlockers.map((blocker) => `release:${blocker}`));

  const artifacts = courseArtifactStatus(course.courseId);
  blockers.push(...artifacts.missing.map((artifact) => `artifact:missing-${artifact}`));

  const releaseEvidence = releaseEvidenceStatus(course.courseId);
  if (!releaseEvidence.present) blockers.push("evidence:missing-release-approval-evidence");
  if (releaseEvidence.invalid) blockers.push("evidence:invalid-release-approval-evidence");
  blockers.push(...releaseEvidence.missingApprovals.map((approval) => `evidence:missing-${approval}`));
  if (releaseEvidence.ownerAcceptanceRecorded === true) {
    blockers.push("governance:owner-acceptance-recorded-before-staging-decision");
  }

  const manifest = manifestState(course.courseId);
  if (!manifest.present) blockers.push("manifest:missing");
  if (!manifest.publicationDisabled) blockers.push("governance:publication-must-remain-disabled");
  if (!manifest.statusAllowed) blockers.push(`governance:release-status-must-remain-draft-or-in-review-current-${manifest.status}`);

  const stagedForOwnerApproval = blockers.length === 0;
  const stagingRecord = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    courseId: course.courseId,
    title: course.title,
    stagedForOwnerApproval,
    structuralReady: course.structuralReady === true,
    instructionalArtifactsComplete: artifacts.complete,
    releaseEvidenceApproved: releaseEvidence.approved,
    publicationDisabled: manifest.publicationDisabled,
    releaseStatus: manifest.status,
    ownerAcceptanceRequired: true,
    ownerAcceptanceRecorded: false,
    publicationAuthorized: false,
    blockers: [...new Set(blockers)].sort(),
    sourceCount: course.sourceCount ?? 0,
    verifiedSourceCount: course.verifiedSourceCount ?? 0,
    assessmentQuestionCount: course.assessmentQuestionCount ?? 0,
    releaseEvidence: course.releaseEvidence ?? {},
    evidenceRecord: releaseEvidence,
    claimBoundary: "Staged for owner approval means all required pre-owner evidence is present and passed while publication remains disabled. It does not constitute owner approval or authorize release.",
  };
  atomicWrite(
    path.join(root, "courses", course.courseId, "generated", "release", "owner-approval-staging-record.json"),
    `${JSON.stringify(stagingRecord, null, 2)}\n`,
  );
  courses.push(stagingRecord);
}

const stagedCourses = courses.filter((course) => course.stagedForOwnerApproval);
const blockedCourses = courses.filter((course) => !course.stagedForOwnerApproval);
const discoveredCourses = courses.length;
const allStagedForOwnerApproval = discoveredCourses === expectedCourses && stagedCourses.length === expectedCourses;
const blockersByFrequency = blockerHistogram(blockedCourses);
const progressPercent = expectedCourses > 0 ? Math.round((stagedCourses.length / expectedCourses) * 100) : 0;

const gate = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  ownerIssueNumber,
  expectedCourses,
  discoveredCourses,
  stagedCourses: stagedCourses.length,
  blockedCourses: blockedCourses.length,
  progressPercent,
  allStagedForOwnerApproval,
  ownerDecisionRequired: allStagedForOwnerApproval,
  ownerAcceptanceRecorded: false,
  publicationAuthorized: false,
  checkoutAuthorized: false,
  allocation,
  stagedCourseIds: stagedCourses.map((course) => course.courseId),
  blockersByFrequency,
  courses,
  nextGovernedAction: allStagedForOwnerApproval
    ? "Owner reviews the exact staged learner packages and records approve, reject, or revise decisions. Publication and checkout remain disabled until an explicit approved decision is processed by a separate governed release action."
    : "Complete the listed course blockers, regenerate the gate, and preserve publication and checkout as disabled.",
  claimBoundary: "This portfolio gate notifies the owner only when all 60 courses satisfy the pre-owner release evidence contract. It never publishes, enables checkout, changes pricing, or records owner acceptance automatically.",
};

fs.mkdirSync(catalogRoot, { recursive: true });
atomicWrite(gatePath, `${JSON.stringify(gate, null, 2)}\n`);

const topBlockers = blockersByFrequency.slice(0, 20);
const blockedPreview = blockedCourses.slice(0, 20);
const heading = allStagedForOwnerApproval
  ? "# READY FOR OWNER APPROVAL: All 60 Academy courses are staged"
  : `# Academy release approval staging: ${stagedCourses.length}/${expectedCourses}`;
const body = [
  heading,
  "",
  "## Governed status",
  "",
  `- Expected courses: **${expectedCourses}**`,
  `- Discovered courses: **${discoveredCourses}**`,
  `- Staged for owner approval: **${stagedCourses.length}**`,
  `- Blocked: **${blockedCourses.length}**`,
  `- Progress: **${progressPercent}%**`,
  `- All staged: **${allStagedForOwnerApproval ? "YES" : "NO"}**`,
  "- Owner acceptance recorded: **NO**",
  "- Publication authorized: **NO**",
  "- Checkout authorized: **NO**",
  `- Gate generated: **${gate.generatedAt}**`,
  "",
  "## What staged means",
  "",
  "Every exact course package has passed the pre-owner instructional, source, applicability, real-world case, implementation, assessment, mastered-media, audio, caption, transcript, accessibility, rights, certificate, entitlement, security, recovery, rollback, and independent pre-owner review evidence gates. Publication remains disabled until the owner makes a separate explicit release decision.",
  "",
  "## Most frequent blockers",
  "",
  ...(topBlockers.length
    ? topBlockers.map((item) => `- ${item.blocker}: **${item.count} course(s)**`)
    : ["- None. All courses satisfy the pre-owner staging contract."]),
  "",
  "## Blocked course preview",
  "",
  ...(blockedPreview.length
    ? blockedPreview.map((course) => `- **${course.title}** (${course.courseId}): ${course.blockers.slice(0, 8).join(", ")}${course.blockers.length > 8 ? `, and ${course.blockers.length - 8} more` : ""}`)
    : ["- None."]),
  "",
  "## Next governed action",
  "",
  gate.nextGovernedAction,
  "",
  `Machine-readable evidence: \`catalog/academy-release-approval-gate.json\``,
  "",
  gate.claimBoundary,
  "",
].join("\n");
atomicWrite(notificationPath, body);

writeGithubOutput("all_staged", String(allStagedForOwnerApproval));
writeGithubOutput("staged_courses", String(stagedCourses.length));
writeGithubOutput("blocked_courses", String(blockedCourses.length));
writeGithubOutput("expected_courses", String(expectedCourses));
writeGithubOutput("progress_percent", String(progressPercent));
writeGithubOutput("owner_issue_number", String(ownerIssueNumber));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
}

console.log(`[Academy Studio] Release approval staging gate: ${stagedCourses.length}/${expectedCourses} staged, ${blockedCourses.length} blocked, allStaged=${allStagedForOwnerApproval}.`);
if (requireAll && !allStagedForOwnerApproval) process.exit(2);
