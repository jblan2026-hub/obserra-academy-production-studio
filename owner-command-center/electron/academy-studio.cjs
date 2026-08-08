const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const { getAcademyGovernanceSnapshot, readJsonIfPresent } = require("./academy-governance.cjs");

const ALLOWED_ACTIONS = new Set([
  "author",
  "revise",
  "author-all",
  "build",
  "build-all",
  "stage-all",
  "source-queue",
  "release-check",
  "catalog",
  "verify"
]);
const ALLOWED_RELEASE_STATUSES = new Set(["draft", "in-review", "approved", "published", "retired"]);
const ACTION_TERMINATION_GRACE_MS = 10000;
const ACTION_SETTLE_GRACE_MS = 5000;
const ACTION_TIMEOUT_DEFAULTS_MS = Object.freeze({
  author: 60 * 60 * 1000,
  revise: 60 * 60 * 1000,
  "author-all": 4 * 60 * 60 * 1000,
  build: 45 * 60 * 1000,
  "build-all": 2 * 60 * 60 * 1000,
  "stage-all": 3 * 60 * 60 * 1000,
  "source-queue": 30 * 60 * 1000,
  "release-check": 60 * 60 * 1000,
  catalog: 15 * 60 * 1000,
  verify: 3 * 60 * 60 * 1000
});
const ACTION_TIMEOUT_MIN_MS = 2 * 60 * 1000;
const ACTION_TIMEOUT_MAX_MS = 4 * 60 * 60 * 1000;
const MAX_CAPTURED_OUTPUT_CHARS = 100000;
const REQUIRED_DETAILED_ARTIFACTS = Object.freeze([
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "implementation-and-application-guide.md",
  "assessment-bank.json",
  "answer-key.json",
  "visual-brief.md",
  "source-register.json",
  "reference-applicability-matrix.json",
  "documented-real-world-case-register.json",
  "course-implementation-strategy.json",
  "standards-implementation-map.json",
  "prioritized-recommendations.json",
  "implementation-guidance.json",
  "course-production-bible.json",
  "commercial-production-plan.json",
  "certificate-package.json",
  "commercial-course-stage.json"
]);

function workspaceCandidates() {
  const home = os.homedir();
  return [
    process.env.OBSERRA_ACADEMY_STUDIO_ROOT,
    path.resolve(__dirname, "../.."),
    path.join(home, "source", "repos", "obserra-academy-production-studio"),
    path.join(home, "Documents", "GitHub", "obserra-academy-production-studio"),
    path.join(home, "GitHub", "obserra-academy-production-studio")
  ].filter(Boolean);
}

function isStudioRoot(candidate) {
  return Boolean(
    candidate
      && fs.existsSync(path.join(candidate, "package.json"))
      && fs.existsSync(path.join(candidate, "courses"))
      && fs.existsSync(path.join(candidate, "studio"))
      && fs.existsSync(path.join(candidate, "policy", "elastic-worker-pool-contract.json"))
  );
}

function resolveStudioRoot() {
  const configured = workspaceCandidates().find(isStudioRoot);
  return configured ? fs.realpathSync(configured) : null;
}

function assertCourseId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(value)) {
    throw new Error("Invalid course identifier");
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(tempPath, filePath);
}

function fileExists(root, ...segments) {
  return fs.existsSync(path.join(root, ...segments));
}

function externalSource(source) {
  return !["original-obserra-instruction", "synthetic-scenario"].includes(
    String(source?.requirementClassification || "")
  );
}

function sourceRegister(courseRoot, authored) {
  const materialized = readJsonIfPresent(path.join(courseRoot, "source-register.json"));
  if (Array.isArray(materialized)) return materialized;
  return Array.isArray(authored?.content?.sourceRegister) ? authored.content.sourceRegister : [];
}

function countUnresolvedReferences(sources) {
  return sources.filter((source) =>
    externalSource(source)
      && (
        source.citationStatus !== "verified"
        || !String(source.urlOrLocator || "").trim()
        || String(source.urlOrLocator || "").trim().toLowerCase() === "to-be-resolved"
        || !String(source.retrievalOrVerificationDate || "").trim()
      )
  ).length;
}

function instructionalModules(manifest) {
  return (manifest.course?.modules || []).filter(
    (module) => String(module.format || "").toLowerCase() !== "assessment"
  );
}

function countMediaManifests(courseRoot, manifest) {
  return instructionalModules(manifest).filter((module) =>
    fs.existsSync(path.join(courseRoot, "media", module.id, "media-manifest.json"))
  ).length;
}

function requiredArtifacts(queue) {
  const queueArtifacts = Array.isArray(queue?.requiredArtifacts) ? queue.requiredArtifacts : [];
  return [...new Set([...REQUIRED_DETAILED_ARTIFACTS, ...queueArtifacts])];
}

function releaseRecord(root, courseId, stage) {
  return readJsonIfPresent(path.join(root, "releases", courseId, stage, "release-record.json"));
}

function commercialEvidence(courseRoot) {
  return readJsonIfPresent(path.join(courseRoot, "commercial-release-evidence.json"));
}

function evidenceAccepted(evidence) {
  return Boolean(
    evidence
      && !evidence.invalid
      && evidence.accepted === true
      && evidence.ownerAcceptance?.decision === "approved"
      && evidence.referenceResolution?.unresolvedExternalReferences === 0
      && evidence.mediaInventory?.missingRequiredAssets === 0
  );
}

function assertPublicationEligible(root, courseId, manifest) {
  const normalizedCourseId = assertCourseId(courseId);
  if (!["approved", "published"].includes(manifest.release?.status)) {
    throw new Error("Publication requires an approved or published release status.");
  }
  const courseRoot = path.join(root, "courses", normalizedCourseId);
  const finalRecord = releaseRecord(root, normalizedCourseId, "FINAL");
  const evidence = commercialEvidence(courseRoot);
  if (!finalRecord || finalRecord.invalid || finalRecord.packageStage !== "FINAL") {
    throw new Error("Publication requires a valid FINAL governed package.");
  }
  if (finalRecord.qualityClaimAllowed !== true) {
    throw new Error("Publication requires a FINAL package authorized for the commercial quality claim.");
  }
  if (!evidenceAccepted(evidence)) {
    throw new Error("Publication requires accepted commercial release evidence, zero unresolved references, complete media, and owner approval.");
  }
  return {
    eligible: true,
    finalRecord,
    evidence
  };
}

function summarizeCourse(root, courseId) {
  const courseRoot = path.join(root, "courses", assertCourseId(courseId));
  const manifestPath = path.join(courseRoot, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;

  const manifest = readJson(manifestPath);
  const queue = readJsonIfPresent(path.join(courseRoot, "production-queue.json"));
  const generatedPackagePath = path.join(courseRoot, "generated", "authoring", "course-package.json");
  const authored = readJsonIfPresent(generatedPackagePath);
  const stagedRelease = releaseRecord(root, courseId, "STAGED");
  const finalRelease = releaseRecord(root, courseId, "FINAL");
  const evidence = commercialEvidence(courseRoot);
  const sources = sourceRegister(courseRoot, authored);
  const unresolvedReferences = countUnresolvedReferences(sources);
  const artifacts = requiredArtifacts(queue).map((artifact) => ({
    artifact,
    present: fileExists(courseRoot, artifact)
  }));
  const missingArtifacts = artifacts.filter((item) => !item.present).map((item) => item.artifact);
  const reviewEntries = Object.entries(manifest.reviews || {}).map(([name, review]) => ({
    name,
    required: review.required !== false,
    status: review.status || "not-started",
    reviewedBy: review.reviewedBy || null,
    reviewedAt: review.reviewedAt || null
  }));
  const requiredReviews = reviewEntries.filter((review) => review.required);
  const completedReviews = requiredReviews.filter((review) =>
    ["approved", "complete", "completed"].includes(review.status)
  );
  const instructionalModuleCount = instructionalModules(manifest).length;
  const mediaManifestCount = countMediaManifests(courseRoot, manifest);
  const implementationReady = Boolean(
    authored?.implementationGuidanceStatus === "draft-ai-generated-verification-required"
      && authored?.content?.courseImplementationStrategy
      && Array.isArray(authored?.content?.documentedRealWorldCaseRegister)
      && authored.content.documentedRealWorldCaseRegister.length > 0
      && Array.isArray(authored?.content?.standardsImplementationMap)
      && authored.content.standardsImplementationMap.length > 0
      && Array.isArray(authored?.content?.prioritizedRecommendations)
      && authored.content.prioritizedRecommendations.length >= 3
  );
  const commercialReady = Boolean(
    finalRelease
      && !finalRelease.invalid
      && finalRelease.packageStage === "FINAL"
      && finalRelease.qualityClaimAllowed === true
      && evidenceAccepted(evidence)
  );
  const recommendations = [];

  if (!authored || authored.invalid) {
    recommendations.push("Generate the governed detailed AI course package under the current worker and production contracts.");
  }
  if (!implementationReady) {
    recommendations.push("Complete sourced real-world cases, prioritized recommendations, implementation playbooks, standards guidance, evidence, and metrics.");
  }
  if (missingArtifacts.length) {
    recommendations.push(`Materialize missing protected course artifacts: ${missingArtifacts.join(", ")}.`);
  }
  if (unresolvedReferences > 0) {
    recommendations.push(`Resolve and independently verify ${unresolvedReferences} external reference item(s), including applicability and limitations.`);
  }
  if (mediaManifestCount < instructionalModuleCount) {
    recommendations.push(`Complete mastered media evidence for ${instructionalModuleCount - mediaManifestCount} instructional module(s).`);
  }
  if (completedReviews.length < requiredReviews.length) {
    recommendations.push(`Complete ${requiredReviews.length - completedReviews.length} required manifest review(s).`);
  }
  if (!stagedRelease || stagedRelease.invalid) {
    recommendations.push("Build a governed COMPLIANCE-STAGED package.");
  }
  if (!commercialReady) {
    recommendations.push("Keep publication, checkout, and Hollywood-grade completion claims disabled until the commercial release gate and owner acceptance pass.");
  }
  if (!manifest.commerce?.stripePriceId && !manifest.commerce?.paymentLink) {
    recommendations.push("Configure commerce only after the commercial release gate passes and owner approval is recorded.");
  }

  return {
    id: manifest.course.id,
    title: manifest.course.title,
    department: manifest.course.department,
    level: manifest.course.level,
    track: manifest.course.track,
    description: manifest.course.description,
    duration: manifest.course.duration,
    price: manifest.commerce?.price ?? null,
    currency: manifest.commerce?.currency ?? "USD",
    moduleCount: Array.isArray(manifest.course.modules) ? manifest.course.modules.length : 0,
    instructionalModuleCount,
    mediaManifestCount,
    releaseStatus: manifest.release?.status || "draft",
    publishToAcademy: manifest.release?.publishToAcademy === true,
    version: manifest.release?.version || "0.0.0",
    generation: authored && !authored.invalid ? "generated" : "not-generated",
    authoringPolicyVersion: authored?.authoringPolicyVersion || null,
    commercialQualityStatus: authored?.commercialQualityStatus || "not-started",
    implementationReady,
    sourceCount: sources.length,
    unresolvedReferences,
    stagedRelease: Boolean(stagedRelease && !stagedRelease.invalid),
    finalRelease: Boolean(finalRelease && !finalRelease.invalid),
    commercialReady,
    ownerAccepted: evidence?.ownerAcceptance?.decision === "approved",
    queueStatus: queue?.status || "not-queued",
    artifacts,
    missingArtifacts,
    reviews: reviewEntries,
    reviewCompletion: requiredReviews.length
      ? Math.round((completedReviews.length / requiredReviews.length) * 100)
      : 100,
    recommendations
  };
}

function getStudioSnapshot() {
  const root = resolveStudioRoot();
  if (!root) {
    return {
      available: false,
      mode: "detached",
      root: null,
      courses: [],
      governance: null,
      summary: {
        total: 0,
        generated: 0,
        staged: 0,
        commercialReady: 0,
        published: 0,
        reviewReady: 0,
        unresolvedReferences: 0,
        mediaComplete: 0,
        gaps: 1
      },
      gaps: [
        "Academy Studio workspace was not found. Set OBSERRA_ACADEMY_STUDIO_ROOT to the local repository path."
      ]
    };
  }

  const governance = getAcademyGovernanceSnapshot(root);
  const courses = fs.readdirSync(path.join(root, "courses"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => summarizeCourse(root, entry.name))
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));

  const notGenerated = courses.filter((course) => course.generation !== "generated").length;
  const notStaged = courses.filter((course) => !course.stagedRelease).length;
  const notCommercialReady = courses.filter((course) => !course.commercialReady).length;
  const unresolvedReferences = courses.reduce(
    (count, course) => count + course.unresolvedReferences,
    0
  );
  const incompleteMedia = courses.filter(
    (course) => course.mediaManifestCount < course.instructionalModuleCount
  ).length;
  const gaps = [];

  if (!courses.length) gaps.push("No course manifests are available.");
  if (notGenerated) gaps.push(`${notGenerated} course(s) have no current governed detailed authoring package.`);
  if (unresolvedReferences) gaps.push(`${unresolvedReferences} external reference item(s) remain unresolved or unverified.`);
  if (incompleteMedia) gaps.push(`${incompleteMedia} course(s) do not have complete module-level commercial media evidence.`);
  if (notStaged) gaps.push(`${notStaged} course(s) have not reached the COMPLIANCE-STAGED package gate.`);
  if (notCommercialReady) gaps.push(`${notCommercialReady} course(s) have not passed final commercial release and owner-acceptance gates.`);

  return {
    available: true,
    mode: "local-workspace",
    root,
    checkedAt: new Date().toISOString(),
    governance,
    courses,
    summary: {
      total: courses.length,
      generated: courses.filter((course) => course.generation === "generated").length,
      staged: courses.filter((course) => course.stagedRelease).length,
      commercialReady: courses.filter((course) => course.commercialReady).length,
      published: courses.filter(
        (course) => course.publishToAcademy && ["approved", "published"].includes(course.releaseStatus)
      ).length,
      reviewReady: courses.filter(
        (course) =>
          course.generation === "generated"
          && course.implementationReady
          && course.missingArtifacts.length === 0
      ).length,
      unresolvedReferences,
      mediaComplete: courses.filter(
        (course) => course.instructionalModuleCount > 0
          && course.mediaManifestCount === course.instructionalModuleCount
      ).length,
      gaps: courses.reduce((count, course) => count + course.recommendations.length, 0)
    },
    gaps
  };
}

function updateCourseMetadata(payload) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable");

  const courseId = assertCourseId(payload?.courseId);
  const manifestPath = path.join(root, "courses", courseId, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Course manifest not found");

  const manifest = readJson(manifestPath);
  const updates = payload?.updates || {};
  if (typeof updates.title === "string" && updates.title.trim()) {
    manifest.course.title = updates.title.trim();
  }
  if (typeof updates.description === "string" && updates.description.trim()) {
    manifest.course.description = updates.description.trim();
  }
  if (typeof updates.duration === "string" && updates.duration.trim()) {
    manifest.course.duration = updates.duration.trim();
  }
  if (Number.isFinite(updates.price) && updates.price >= 0) {
    manifest.commerce.price = Number(updates.price);
  }
  if (typeof updates.releaseStatus === "string") {
    if (!ALLOWED_RELEASE_STATUSES.has(updates.releaseStatus)) {
      throw new Error("Unsupported release status");
    }
    if (updates.releaseStatus === "published") {
      assertPublicationEligible(root, courseId, manifest);
    }
    manifest.release.status = updates.releaseStatus;
    if (updates.releaseStatus === "retired") manifest.release.publishToAcademy = false;
  }
  if (typeof updates.publishToAcademy === "boolean") {
    if (updates.publishToAcademy) {
      assertPublicationEligible(root, courseId, manifest);
    }
    manifest.release.publishToAcademy = updates.publishToAcademy;
  }

  atomicWriteJson(manifestPath, manifest);
  return summarizeCourse(root, courseId);
}

function clampNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function actionTimeoutMs(action) {
  const fallback = ACTION_TIMEOUT_DEFAULTS_MS[action];
  if (!fallback) throw new Error("Unsupported Studio action");
  return clampNumber(
    process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS,
    fallback,
    ACTION_TIMEOUT_MIN_MS,
    ACTION_TIMEOUT_MAX_MS
  );
}

function studioActionArgs(action, courseId) {
  switch (action) {
    case "author":
      return ["run", "author:course", "--", "--course", assertCourseId(courseId)];
    case "revise":
      return ["run", "author:course", "--", "--course", assertCourseId(courseId), "--force"];
    case "author-all":
      return ["run", "author:parallel"];
    case "build":
      return ["run", "build:course", "--", "--course", assertCourseId(courseId)];
    case "build-all":
      return ["run", "build:all"];
    case "stage-all":
      return ["run", "stage:courses"];
    case "source-queue":
      return ["run", "collect:sources"];
    case "release-check":
      return ["run", "validate:commercial-release"];
    case "catalog":
      return ["run", "catalog"];
    case "verify":
      return ["run", "verify:protected"];
    default:
      throw new Error("Unsupported Studio action");
  }
}

function terminateChildTree(child, force) {
  if (!child?.pid || child.exitCode !== null) return;

  if (process.platform === "win32") {
    const args = ["/pid", String(child.pid), "/t"];
    if (force) args.push("/f");
    const killer = spawn("taskkill", args, {
      windowsHide: true,
      shell: false,
      stdio: "ignore"
    });
    killer.on("error", () => {});
    return;
  }

  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function appendBoundedOutput(current, chunk) {
  return `${current}${chunk}`.slice(-MAX_CAPTURED_OUTPUT_CHARS);
}

function governedRuntimeEnvironment(root) {
  const governance = getAcademyGovernanceSnapshot(root);
  const allocation = governance.workerAllocation || {};
  return {
    OBSERRA_PORTFOLIO_WORKER_COUNT: String(allocation.totalWorkers || 36),
    OBSERRA_APPLICATION_WORKER_COUNT: String(allocation.applicationWorkers || 0),
    COMMAND_CENTER_WORKER_ALLOCATION: String(allocation.commandCenterWorkers || 0),
    IDLE_WORKER_ALLOCATION: String(allocation.idleWorkers || 0),
    ACADEMY_AUTHORING_CONCURRENCY: String(allocation.academyWorkers || 36),
    ACADEMY_STAGING_CONCURRENCY: String(allocation.academyWorkers || 36)
  };
}

function runStudioAction(action, courseId) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable");
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("Unsupported Studio action");

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = studioActionArgs(action, courseId);
  const timeoutMs = actionTimeoutMs(action);

  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutTimer = null;
    let forceKillTimer = null;
    let settleTimer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (settleTimer) clearTimeout(settleTimer);
      resolve({
        action,
        courseId: courseId || null,
        startedAt,
        completedAt: new Date().toISOString(),
        timeoutMs,
        timedOut,
        stdout,
        stderr,
        ...result
      });
    };

    let child;
    try {
      child = spawn(npmCommand, args, {
        cwd: root,
        env: {
          ...process.env,
          ...governedRuntimeEnvironment(root)
        },
        windowsHide: true,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        stderr: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout = appendBoundedOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBoundedOutput(stderr, chunk);
    });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      const timeoutMessage = `[Owner Command Center] Academy ${action} action exceeded ${Math.round(timeoutMs / 1000)} seconds and was terminated.`;
      stderr = appendBoundedOutput(stderr, `\n${timeoutMessage}\n`);
      terminateChildTree(child, false);

      forceKillTimer = setTimeout(() => {
        terminateChildTree(child, true);
      }, ACTION_TERMINATION_GRACE_MS);

      settleTimer = setTimeout(() => {
        finish({
          ok: false,
          exitCode: child.exitCode,
          signal: child.signalCode || null
        });
      }, ACTION_TERMINATION_GRACE_MS + ACTION_SETTLE_GRACE_MS);
    }, timeoutMs);

    child.on("error", (error) => {
      stderr = appendBoundedOutput(
        stderr,
        error instanceof Error ? error.message : String(error)
      );
      finish({ ok: false, exitCode: null, signal: null });
    });

    child.on("close", (exitCode, signal) => {
      finish({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal: signal || null
      });
    });
  });
}

module.exports = {
  getStudioSnapshot,
  updateCourseMetadata,
  runStudioAction,
  resolveStudioRoot,
  studioActionArgs,
  actionTimeoutMs,
  assertPublicationEligible,
  governedRuntimeEnvironment
};
