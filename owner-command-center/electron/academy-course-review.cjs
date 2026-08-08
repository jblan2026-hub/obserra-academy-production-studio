const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  getStudioSnapshot,
  resolveStudioRoot,
  updateCourseMetadata,
} = require("./academy-studio.cjs");

const DECISION_SCHEMA_VERSION = "1.0";
const MAX_MEDIA_FILES = 1000;
const MAX_MEDIA_DEPTH = 8;
const MAX_PLAYABLE_MEDIA_BYTES = 4 * 1024 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".ogv"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);
const MEDIA_MIME_TYPES = Object.freeze({
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
});
const ALLOWED_DECISIONS = new Set(["approve", "revise", "reject"]);

function assertCourseId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(value)) {
    throw new Error("Invalid course identifier.");
  }
  return value;
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function realPathWithin(root, candidate) {
  if (!fs.existsSync(candidate)) return null;
  const realRoot = fs.realpathSync(root);
  const realCandidate = fs.realpathSync(candidate);
  const relative = path.relative(realRoot, realCandidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return realCandidate;
  }
  throw new Error("Course media path escaped the approved Academy workspace.");
}

function coursePaths(root, courseId) {
  const id = assertCourseId(courseId);
  const courseRoot = realPathWithin(root, path.join(root, "courses", id));
  if (!courseRoot) throw new Error("Course workspace was not found.");
  return {
    id,
    courseRoot,
    manifestPath: path.join(courseRoot, "course-manifest.json"),
    packagePath: path.join(courseRoot, "generated", "authoring", "course-package.json"),
    decisionRoot: path.join(root, "catalog", "course-owner-decisions", id),
    currentDecisionPath: path.join(root, "catalog", "course-owner-decisions", id, "current.json"),
  };
}

function mediaRoots(root, paths) {
  return [
    path.join(paths.courseRoot, "media"),
    path.join(paths.courseRoot, "generated", "media"),
    path.join(paths.courseRoot, "generated", "video"),
    path.join(paths.courseRoot, "generated", "audio"),
    path.join(root, "releases", paths.id, "FINAL", "media"),
  ]
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => realPathWithin(root, candidate));
}

function walkMedia(root, current, depth, output) {
  if (!current || depth > MAX_MEDIA_DEPTH || output.length >= MAX_MEDIA_FILES) return;
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= MAX_MEDIA_FILES) break;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkMedia(root, fullPath, depth + 1, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(extension) && !AUDIO_EXTENSIONS.has(extension)) continue;
    const realPath = realPathWithin(root, fullPath);
    const stats = fs.statSync(realPath);
    if (stats.size <= 0 || stats.size > MAX_PLAYABLE_MEDIA_BYTES) continue;
    const relativePath = path.relative(root, realPath).replaceAll(path.sep, "/");
    output.push({
      assetId: sha256(relativePath),
      fileName: path.basename(realPath),
      relativePath,
      mediaType: VIDEO_EXTENSIONS.has(extension) ? "video" : "audio",
      mimeType: MEDIA_MIME_TYPES[extension] || "application/octet-stream",
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      absolutePath: realPath,
    });
  }
}

function listMediaAssets(root, paths) {
  const assets = [];
  for (const candidate of mediaRoots(root, paths)) {
    walkMedia(root, candidate, 0, assets);
  }
  return assets
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map(({ absolutePath, ...asset }) => asset);
}

function authoredVideoScripts(authored) {
  const modules = Array.isArray(authored?.content?.modules) ? authored.content.modules : [];
  return modules.map((module) => {
    const script = module?.videoScript || null;
    const segments = Array.isArray(script?.segments) ? script.segments : [];
    const complete = Boolean(
      String(script?.opening || "").trim()
      && String(script?.closing || "").trim()
      && segments.length > 0
      && segments.every(
        (segment) => String(segment?.visual || "").trim()
          && String(segment?.narration || "").trim(),
      ),
    );
    return {
      moduleId: String(module?.id || "unknown-module"),
      title: String(module?.title || module?.id || "Untitled module"),
      complete,
      opening: script?.opening || null,
      segments,
      closing: script?.closing || null,
    };
  });
}

function courseSummary(root, courseId) {
  const snapshot = getStudioSnapshot();
  return (snapshot.courses || []).find((course) => course.id === courseId) || null;
}

function currentDecision(paths) {
  try {
    return readJsonIfPresent(paths.currentDecisionPath);
  } catch (error) {
    return {
      schemaVersion: DECISION_SCHEMA_VERSION,
      decision: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function reviewBundle(courseId) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable.");
  const paths = coursePaths(root, courseId);
  const manifest = readJsonIfPresent(paths.manifestPath);
  if (!manifest) throw new Error("Course manifest was not found.");
  const authored = readJsonIfPresent(paths.packagePath);
  const summary = courseSummary(root, paths.id);
  if (!summary) throw new Error("Course summary was not found.");
  const mediaAssets = listMediaAssets(root, paths);
  const videoScripts = authoredVideoScripts(authored);
  const videoAssets = mediaAssets.filter((asset) => asset.mediaType === "video");
  const audioAssets = mediaAssets.filter((asset) => asset.mediaType === "audio");
  const assessment = Array.isArray(authored?.content?.finalAssessment)
    ? authored.content.finalAssessment
    : readJsonIfPresent(path.join(paths.courseRoot, "assessment-bank.json")) || [];
  const modules = Array.isArray(authored?.content?.modules)
    ? authored.content.modules
    : manifest.course?.modules || [];
  const requiredReviews = (summary.reviews || []).filter((review) => review.required);
  const completedReviews = requiredReviews.filter((review) =>
    ["approved", "complete", "completed"].includes(review.status),
  );
  const blockers = [];
  if (summary.generation !== "generated") blockers.push("Governed AI course package is not generated.");
  if ((summary.missingArtifacts || []).length > 0) {
    blockers.push(`Missing course artifacts: ${summary.missingArtifacts.join(", ")}.`);
  }
  if (completedReviews.length < requiredReviews.length) {
    blockers.push(`${requiredReviews.length - completedReviews.length} required review(s) remain incomplete.`);
  }
  if (!summary.finalRelease) blockers.push("FINAL release record is not available.");
  if (!manifest.commerce?.stripePriceId && !manifest.commerce?.paymentLink) {
    blockers.push("Stripe price or governed payment link is not configured.");
  }
  if (videoScripts.length === 0 || videoScripts.some((script) => !script.complete)) {
    blockers.push("One or more module video scripts are incomplete.");
  }
  if (videoAssets.length < Number(summary.moduleCount || modules.length || 0)) {
    blockers.push(`Rendered course videos are incomplete: ${videoAssets.length} available for ${summary.moduleCount || modules.length || 0} module(s).`);
  }
  if (summary.releaseStatus === "retired") blockers.push("Retired courses cannot be released.");

  return {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    course: summary,
    manifest: {
      schemaVersion: manifest.schemaVersion || null,
      title: manifest.course?.title || summary.title,
      description: manifest.course?.description || summary.description,
      audience: manifest.course?.audience || null,
      outcomes: manifest.course?.outcomes || [],
      completion: manifest.completion || null,
      commerce: {
        price: manifest.commerce?.price ?? null,
        currency: manifest.commerce?.currency || "USD",
        stripeConfigured: Boolean(manifest.commerce?.stripePriceId || manifest.commerce?.paymentLink),
        accessPolicy: manifest.commerce?.accessPolicy || null,
      },
      release: manifest.release || null,
    },
    authoredPackage: {
      available: Boolean(authored),
      schemaVersion: authored?.schemaVersion || null,
      provider: authored?.provider || null,
      model: authored?.model || null,
      generatedAt: authored?.generatedAt || null,
      reviewStatus: authored?.reviewStatus || "not-generated",
    },
    modules,
    videoScripts,
    media: {
      assets: mediaAssets,
      videos: videoAssets,
      audio: audioAssets,
      renderedVideoCount: videoAssets.length,
      requiredVideoCount: Number(summary.moduleCount || modules.length || 0),
      allRequiredVideosAvailable:
        videoAssets.length >= Number(summary.moduleCount || modules.length || 0)
        && Number(summary.moduleCount || modules.length || 0) > 0,
    },
    materials: {
      artifacts: summary.artifacts || [],
      missingArtifacts: summary.missingArtifacts || [],
      learnerGuideAvailable: fs.existsSync(path.join(paths.courseRoot, "learner-guide.md")),
      workbookAvailable: fs.existsSync(path.join(paths.courseRoot, "workbook.md")),
      instructorManuscriptAvailable: fs.existsSync(path.join(paths.courseRoot, "instructor-manuscript.md")),
    },
    assessment: {
      questionCount: Array.isArray(assessment) ? assessment.length : 0,
      passingScore: manifest.completion?.passingScore ?? null,
      required: manifest.completion?.assessmentRequired === true,
    },
    reviews: {
      required: requiredReviews.length,
      completed: completedReviews.length,
      records: summary.reviews || [],
    },
    readiness: {
      ownerReviewReady:
        summary.generation === "generated"
        && (summary.missingArtifacts || []).length === 0,
      autoReleaseReady: blockers.length === 0,
      blockers,
    },
    ownerDecision: currentDecision(paths),
    claimBoundary:
      "Course approval records the owner's review decision. Auto-release is queued only when every course, media, review, commerce, release, LCMS, website, and deployment gate is directly verified. A rendered video count of zero means no playable course video is available in the approved workspace.",
  };
}

function mediaAssetUrl(courseId, assetId) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable.");
  const paths = coursePaths(root, courseId);
  const assets = [];
  for (const candidate of mediaRoots(root, paths)) walkMedia(root, candidate, 0, assets);
  const asset = assets.find((item) => item.assetId === assetId);
  if (!asset) throw new Error("Course media asset was not found.");
  return {
    assetId: asset.assetId,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    url: pathToFileURL(asset.absolutePath).toString(),
  };
}

function createAcademyCourseReview({ store, safeStorage, endpointRuntime }) {
  if (!store || !safeStorage || !endpointRuntime) {
    throw new Error("Academy course review dependencies are required.");
  }

  function deviceSecret() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Device credential encryption is required for owner course approval.");
    }
    const encrypted = store.get("endpoint.identity.encryptedSecret");
    if (typeof encrypted !== "string" || !encrypted) {
      throw new Error("The enrolled owner endpoint identity is unavailable.");
    }
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  function sign(record) {
    return crypto
      .createHmac("sha256", deviceSecret())
      .update(JSON.stringify(stableJson(record)))
      .digest("hex");
  }

  function recordDecision({ courseId, decision, note = "", autoRelease = false, confirmation } = {}) {
    const id = assertCourseId(courseId);
    const normalizedDecision = String(decision || "").trim().toLowerCase();
    if (!ALLOWED_DECISIONS.has(normalizedDecision)) {
      throw new Error("Course decision must be approve, revise, or reject.");
    }
    const requiredConfirmation = `${normalizedDecision.toUpperCase()} ${id.toUpperCase()}`;
    if (String(confirmation || "").trim() !== requiredConfirmation) {
      throw new Error(`Owner confirmation must exactly match: ${requiredConfirmation}`);
    }
    const normalizedNote = String(note || "").trim();
    if (["revise", "reject"].includes(normalizedDecision) && normalizedNote.length < 10) {
      throw new Error("Revise and reject decisions require a substantive note of at least 10 characters.");
    }
    const endpoint = endpointRuntime.getSnapshot();
    if (
      endpoint?.endpointReady !== true
      || endpoint?.enrollment?.state !== "enrolled"
      || !endpoint?.deviceFingerprint
    ) {
      throw new Error("The owner endpoint must be enrolled and heartbeat-ready before approving a course.");
    }

    const root = resolveStudioRoot();
    if (!root) throw new Error("Academy Studio workspace is unavailable.");
    const paths = coursePaths(root, id);
    const bundle = reviewBundle(id);
    const decidedAt = new Date().toISOString();
    const unsignedRecord = {
      schemaVersion: DECISION_SCHEMA_VERSION,
      decisionId: crypto.randomUUID(),
      courseId: id,
      courseTitle: bundle.course.title,
      decision: normalizedDecision,
      note: normalizedNote || null,
      decidedAt,
      owner: {
        username: (() => {
          try {
            return os.userInfo().username || "unknown-owner";
          } catch {
            return "unknown-owner";
          }
        })(),
        hostname: os.hostname(),
      },
      endpoint: {
        deviceId: endpoint.deviceId,
        deviceFingerprint: endpoint.deviceFingerprint,
        lastHeartbeatAt: endpoint.lastHeartbeatAt,
      },
      evidence: {
        generatedPackage: bundle.authoredPackage.available,
        generatedAt: bundle.authoredPackage.generatedAt,
        requiredReviews: bundle.reviews.required,
        completedReviews: bundle.reviews.completed,
        missingArtifacts: bundle.materials.missingArtifacts,
        renderedVideoCount: bundle.media.renderedVideoCount,
        requiredVideoCount: bundle.media.requiredVideoCount,
        finalRelease: bundle.course.finalRelease,
        stripeConfigured: bundle.manifest.commerce.stripeConfigured,
        readinessBlockers: bundle.readiness.blockers,
      },
      autoReleaseRequested: normalizedDecision === "approve" && autoRelease === true,
      autoReleaseState:
        normalizedDecision !== "approve" || autoRelease !== true
          ? "not-requested"
          : bundle.readiness.autoReleaseReady
            ? "ready-for-governed-execution"
            : "queued-awaiting-production-gates",
      publicationAuthorized: false,
      checkoutAuthorized: false,
      releaseExecutionCompleted: false,
      claimBoundary:
        "This owner decision does not by itself publish the course, enable checkout, change pricing, or grant learner access. Auto-release executes only after every recorded blocker is cleared and the governed release workflow confirms LCMS, website, commerce, security, rollback, and deployment evidence.",
    };
    const record = {
      ...unsignedRecord,
      signatureAlgorithm: "hmac-sha256-device-bound",
      signature: sign(unsignedRecord),
    };
    const historyPath = path.join(
      paths.decisionRoot,
      `${decidedAt.replaceAll(":", "-")}-${record.decisionId}.json`,
    );
    atomicWriteJson(historyPath, record);
    atomicWriteJson(paths.currentDecisionPath, record);

    if (normalizedDecision === "approve") {
      updateCourseMetadata({
        courseId: id,
        updates: {
          releaseStatus: bundle.readiness.autoReleaseReady && autoRelease ? "approved" : "in-review",
          publishToAcademy: false,
        },
      });
    } else if (normalizedDecision === "revise") {
      updateCourseMetadata({
        courseId: id,
        updates: { releaseStatus: "in-review", publishToAcademy: false },
      });
    } else {
      updateCourseMetadata({
        courseId: id,
        updates: { releaseStatus: "draft", publishToAcademy: false },
      });
    }

    return {
      decision: record,
      review: reviewBundle(id),
    };
  }

  return {
    getCourseReview: reviewBundle,
    getMediaAssetUrl: mediaAssetUrl,
    recordDecision,
  };
}

module.exports = {
  ALLOWED_DECISIONS,
  DECISION_SCHEMA_VERSION,
  createAcademyCourseReview,
  mediaAssetUrl,
  reviewBundle,
};
