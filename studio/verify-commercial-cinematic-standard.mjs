import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACADEMY_WORKSTREAM,
  commercialCinematicStandard,
  productionStandardHash,
  roleForTask,
  assertTaskAssignment,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const evidencePath = path.join(root, "catalog", "commercial-cinematic-standard-verification.json");
const checks = [];
const check = (name, condition, detail = null) => {
  checks.push({ name, passed: Boolean(condition), detail });
};
const includesEvery = (values, required) => {
  const available = new Set(Array.isArray(values) ? values : []);
  return required.every((item) => available.has(item));
};

const standard = commercialCinematicStandard;
const academy = workerPoolContract.academyContract;
const universalRules = workerPoolContract.universalRules ?? [];

check("standard identity", standard.standardId === "obserra-commercial-cinematic-course-production-v1");
check("standard applies to 60 courses", standard.appliesTo?.targetOwnerReviewCourses === 60);
check("commercial paid-learning release class", standard.appliesTo?.releaseClass === "commercial-paid-learning");
check("Hollywood-grade remains an aspirational description", standard.claimBoundary?.aspirationalDescription === "Hollywood-grade");
check("public quality claims require final acceptance", standard.claimBoundary?.publicClaimAllowedBeforeFinalAcceptance === false);

check("4K UHD picture master", standard.pictureMaster?.minimumWidthPixels >= 3840 && standard.pictureMaster?.minimumHeightPixels >= 2160);
check("progressive picture master", standard.pictureMaster?.scan === "progressive");
check("10-bit minimum picture master", standard.pictureMaster?.minimumBitDepth >= 10);
check("approved cinematic frame rates", includesEvery(standard.pictureMaster?.allowedFrameRates, [23.976, 24, 25, 29.97, 30]));
check("Rec.709 delivery color space", standard.pictureMaster?.colorSpace === "Rec.709");
check("picture requirements prohibit placeholders", includesEvery(standard.pictureMaster?.requirements, [
  "no-placeholder-or-test-footage",
  "title-safe-legible-graphics",
  "consistent-color-and-exposure",
]));

check("48 kHz audio master", standard.audioMaster?.sampleRateHz === 48000);
check("24-bit minimum audio master", standard.audioMaster?.minimumBitDepth >= 24);
check("commercial loudness target", standard.audioMaster?.integratedLoudnessTargetLufs === -16 && standard.audioMaster?.integratedLoudnessToleranceLu <= 1);
check("true peak ceiling", standard.audioMaster?.maximumTruePeakDbtp <= -1);
check("audio requirements reject clipping and dropouts", includesEvery(standard.audioMaster?.requirements, [
  "no-clipping",
  "no-audible-dropouts",
  "dialogue-intelligibility-verified",
  "professional-mix-and-master",
]));

check("creative quality rejects generic slide reading", includesEvery(standard.creativeQuality?.requirements, [
  "lesson-specific-storyboard",
  "lesson-specific-shot-list",
  "professional-motion-graphics",
  "human-directed-narration-performance",
  "no-generic-slide-reading-as-final-production",
  "no-provider-watermark-or-test-mode-output",
]));

check("WCAG 2.2 AA alignment target", String(standard.accessibility?.target ?? "").includes("WCAG 2.2 AA"));
check("caption accuracy threshold", standard.accessibility?.captionAccuracyMinimumPercent >= 99);
check("accessibility equivalents required", includesEvery(standard.accessibility?.requiredArtifacts, [
  "human-reviewed-webvtt-captions",
  "human-reviewed-srt-captions",
  "verbatim-time-aligned-transcript",
  "audio-description-or-approved-equivalent",
  "reduced-motion-alternative",
  "text-equivalent-for-essential-visuals",
]));

check("per-asset rights and provenance required", includesEvery(standard.rightsAndProvenance?.requiredArtifacts, [
  "per-asset-rights-ledger",
  "license-or-ownership-evidence",
  "source-register",
  "ai-generated-asset-provenance",
]));
check("unauthorized media prohibited", includesEvery(standard.rightsAndProvenance?.prohibited, [
  "unlicensed-copyrighted-media",
  "unauthorized-voice-or-likeness",
  "confidential-or-recalled-exam-content",
  "fabricated-source-attribution",
]));

check("complete learning package required", includesEvery(standard.learningPackage?.requiredArtifacts, [
  "instructor-manuscript",
  "learner-guide",
  "learner-workbook",
  "practice-exercises",
  "knowledge-checks",
  "original-final-assessment",
  "protected-answer-key-and-rationales",
  "certificate-of-course-completion-template",
]));
check("assessment integrity required", includesEvery(standard.learningPackage?.assessmentRequirements, [
  "original-items-only",
  "module-and-objective-traceability",
  "answer-key-protected-from-learner-delivery",
  "tutor-lockout-during-graded-assessment",
  "psychometric-and-sme-review",
]));

check("final release requires master and QC evidence", includesEvery(standard.finalReleasePackage?.requiredArtifacts, [
  "approved-mezzanine-video-master",
  "approved-streaming-delivery-file",
  "audio-loudness-and-true-peak-report",
  "picture-technical-qc-report",
  "caption-and-transcript-qc-report",
  "accessibility-equivalence-report",
  "source-and-rights-ledger",
  "sha256-integrity-manifest",
  "versioned-release-record",
  "rollback-and-recovery-record",
]));
check("submitted or test outputs cannot be final", includesEvery(standard.finalReleasePackage?.prohibitedFinalStates, [
  "configuration-required",
  "submitted-only",
  "rendering",
  "test-mode",
  "silent-media",
  "placeholder-media",
  "unreviewed-ai-output",
  "failed-qc",
]));

check("owner final acceptance is mandatory", standard.approvalGates?.includes("owner-final-acceptance"));
check("release controls fail closed", standard.releaseControls?.failClosed === true);
check("publication and checkout default off", standard.releaseControls?.publicationDefault === false && standard.releaseControls?.checkoutDefault === false);
check("provider submission is not completion", standard.releaseControls?.providerSubmissionIsNotCompletion === true);
check("script or storyboard is not final media", standard.releaseControls?.scriptOrStoryboardIsNotFinalMedia === true);
check("automatic publication prohibited", standard.releaseControls?.automaticPublicationAllowed === false);
check("automatic purchase enablement prohibited", standard.releaseControls?.automaticPurchaseEnablementAllowed === false);

check("worker contract references cinematic standard", workerPoolContract.qualityStandard?.standardId === standard.standardId);
check("worker contract cinematic enforcement is fail closed", workerPoolContract.qualityStandard?.enforcementMode === "fail-closed");
check("all production roles are contract authorized", includesEvery(academy.allowedRoles, standard.requiredRoles));
check("all production stages are contract required", includesEvery(academy.requiredStages, standard.requiredStages));
check("worker contract rejects weak final substitutes", includesEvery(academy.prohibitedCompletionSubstitutes, [
  "script-only",
  "storyboard-only",
  "provider-job-submitted-only",
  "silent-media",
  "placeholder-media",
  "unreviewed-ai-output",
  "failed-media-qc",
]));
check("universal media rules are mandatory", includesEvery(universalRules, [
  "no-placeholder-media-as-final",
  "no-silent-media-as-final",
  "no-provider-submission-as-completion",
  "no-unlicensed-media",
  "ai-media-provenance-required",
  "accessibility-before-release",
  "rights-before-release",
]));

const taskRolePairs = {
  "learning-architecture": "instructional-director",
  "screenplay-and-narration-script": "script-editor",
  "storyboard-and-shot-list": "storyboard-producer",
  "visual-asset-production": "visual-director",
  "motion-graphics-and-compositing": "motion-graphics-producer",
  "picture-edit": "video-editor",
  "color-finishing": "colorist",
  "narration-recording": "narration-director",
  "audio-edit-mix-and-master": "audio-engineer",
  "assessment-and-answer-key": "assessment-author",
  "psychometric-review": "psychometric-reviewer",
  "captions-transcript-and-accessibility": "caption-transcript-qc",
  "accessibility-equivalence": "accessibility-producer",
  "rights-and-source-records": "rights-clearance-producer",
  "automated-media-qc": "media-qc-validator",
  "compliance-staging": "compliance-validator",
};
for (const [taskType, expectedRole] of Object.entries(taskRolePairs)) {
  const actualRole = roleForTask(taskType);
  check(`task role mapping ${taskType}`, actualRole === expectedRole, `${actualRole} / ${expectedRole}`);
  let accepted = false;
  try {
    accepted = assertTaskAssignment({
      workstream: ACADEMY_WORKSTREAM,
      taskType,
      role: expectedRole,
    });
  } catch (error) {
    check(`task assignment ${taskType}`, false, error instanceof Error ? error.message : String(error));
    continue;
  }
  check(`task assignment ${taskType}`, accepted === true);
}

const failed = checks.filter((item) => !item.passed);
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  standardId: standard.standardId,
  productionStandardHash: productionStandardHash(),
  contractId: workerPoolContract.contractId,
  checks: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  ready: failed.length === 0,
  claimBoundary: "This verifies the enforceable production standard and worker-role contract. It does not prove that any course video, assessment, certificate, or release package has completed production or passed final human review.",
  results: checks,
};

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);

for (const item of checks) {
  console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}${item.detail ? `: ${item.detail}` : ""}`);
}
console.log(`[Academy Studio] Commercial cinematic standard verification: ${report.passed}/${report.checks} passed.`);
if (failed.length > 0) process.exit(1);
