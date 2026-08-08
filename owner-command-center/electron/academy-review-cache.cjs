const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { pathToFileURL } = require("node:url");

const { resolveStudioRoot } = require("./academy-studio.cjs");

const DEFAULT_REPOSITORY = "jblan2026-hub/obserra-academy-production-studio";
const DEFAULT_BRANCH = "agent/academy-build-acceleration";
const DEFAULT_WORKFLOW = "accelerated-protected-course-build.yml";
const DEFAULT_OWNER_LOGIN = "jblan2026-hub";
const DEFAULT_APPROVAL_ISSUE = 27;
const API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 180 * 1024 * 1024;
const MAX_SELECTED_BYTES = 300 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 50000;
const COURSE_DECISION_MARKER = "<!-- OBSERRA_COURSE_REVIEW_DECISION_V1 -->";
const REVIEW_FILES = Object.freeze([
  "catalog/academy-learner-course-catalog.json",
  "catalog/learner-catalog-readiness.json",
  "catalog/parallel-authoring-summary.json",
  "catalog/authoring-quality-repair.json",
]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".m4v", ".mov"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".ogg"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/https:\/\/[^\s:@]+:[^\s@]+@/gi, "https://[redacted]@")
    .replace(/\s+/g, " ")
    .slice(0, 1600);
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function atomicWriteJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeZipPath(value) {
  const name = String(value || "").replaceAll("\\", "/");
  if (!name || name.startsWith("/") || /^[A-Za-z]:\//.test(name)) {
    throw new Error("Artifact contains an unsafe absolute path.");
  }
  const segments = name.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Artifact contains an unsafe traversal path.");
  }
  return segments.join("/");
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function endOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Artifact ZIP end-of-central-directory record was not found.");
}

function extractSelectedEntries(buffer, selectedPaths = REVIEW_FILES) {
  if (!Buffer.isBuffer(buffer)) throw new Error("Artifact ZIP must be a Buffer.");
  if (buffer.length > MAX_ARTIFACT_BYTES) throw new Error("Course artifact exceeds the governed size limit.");
  const selected = new Set(selectedPaths.map(normalizeZipPath));
  const eocd = endOfCentralDirectory(buffer);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entriesOnDisk !== totalEntries) throw new Error("Multi-disk course artifacts are not supported.");
  if (totalEntries > MAX_ZIP_ENTRIES) throw new Error("Course artifact contains too many entries.");
  if (centralOffset + centralSize > buffer.length) throw new Error("Course artifact central directory is invalid.");

  const output = new Map();
  let selectedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Course artifact central directory entry is invalid.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + fileNameLength + extraLength + commentLength;
    if (entryEnd > buffer.length) throw new Error("Course artifact entry exceeds archive boundary.");
    const fileName = normalizeZipPath(
      buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8"),
    );
    offset = entryEnd;
    if (!selected.has(fileName)) continue;
    if ((flags & 0x1) !== 0) throw new Error(`Encrypted ZIP entry is unsupported: ${fileName}`);
    if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP method ${method}: ${fileName}`);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`Course review entry is too large: ${fileName}`);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Course artifact local header is invalid: ${fileName}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > buffer.length) throw new Error(`Course artifact data is out of bounds: ${fileName}`);
    const compressed = buffer.subarray(dataOffset, dataEnd);
    const content = method === 0
      ? Buffer.from(compressed)
      : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    if (content.length !== uncompressedSize) throw new Error(`Course artifact size mismatch: ${fileName}`);
    if (crc32(content) !== expectedCrc) throw new Error(`Course artifact CRC mismatch: ${fileName}`);
    selectedBytes += content.length;
    if (selectedBytes > MAX_SELECTED_BYTES) throw new Error("Selected course review data exceeds the governed size limit.");
    output.set(fileName, content);
  }
  return output;
}

function reviewCacheRoot(app) {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return path.join(localAppData, "Obserra", "OwnerCommandCenter", "academy-review-cache");
  return path.join(app.getPath("userData"), "academy-review-cache");
}

function findReviewRoot(app) {
  const localRoot = resolveStudioRoot();
  if (localRoot && fs.existsSync(path.join(localRoot, REVIEW_FILES[0]))) {
    return { root: localRoot, source: "local-workspace" };
  }
  const cache = reviewCacheRoot(app);
  if (fs.existsSync(path.join(cache, REVIEW_FILES[0]))) {
    return { root: cache, source: "github-protected-artifact" };
  }
  return { root: localRoot || cache, source: localRoot ? "local-workspace-incomplete" : "not-synchronized" };
}

function courseDecisionMap(store) {
  const value = store.get("academy.courseReviewDecisions");
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedCourseId(value) {
  const courseId = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(courseId)) throw new Error("Invalid course identifier.");
  return courseId;
}

function courseBlockers(course) {
  const blockers = [];
  if (!course?.authoring?.available) blockers.push("authored-package-missing");
  const modules = course?.learnerExperience?.modules || [];
  if (!Array.isArray(modules) || modules.length === 0) blockers.push("course-modules-missing");
  for (const module of modules) {
    const prefix = module?.id || "module";
    if (!String(module?.lessonNarrative || "").trim()) blockers.push(`${prefix}:lesson-narrative-missing`);
    if (!module?.videoScript) blockers.push(`${prefix}:video-script-missing`);
    if (!module?.workbook) blockers.push(`${prefix}:workbook-missing`);
    if (!Array.isArray(module?.knowledgeChecks) || module.knowledgeChecks.length < 4) blockers.push(`${prefix}:knowledge-checks-incomplete`);
  }
  const assessment = course?.learnerExperience?.finalAssessment || [];
  if (!Array.isArray(assessment) || assessment.length < 25) blockers.push("final-assessment-incomplete");
  return [...new Set(blockers)];
}

function mediaAssets(root, courseId) {
  const localRoot = resolveStudioRoot();
  if (!localRoot || path.resolve(root) !== path.resolve(localRoot)) return [];
  const courseRoot = path.join(localRoot, "courses", courseId);
  const releaseRoot = path.join(localRoot, "releases", courseId);
  const roots = [courseRoot, releaseRoot].filter((candidate) => fs.existsSync(candidate));
  const assets = [];

  function walk(directory, depth = 0) {
    if (depth > 8 || assets.length >= 250) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(extension) && !AUDIO_EXTENSIONS.has(extension)) continue;
      const stat = fs.statSync(fullPath);
      assets.push({
        id: sha256(fullPath).slice(0, 24),
        name: entry.name,
        type: VIDEO_EXTENSIONS.has(extension) ? "video" : "audio",
        extension,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        url: pathToFileURL(fullPath).href,
        relativePath: path.relative(localRoot, fullPath).replaceAll(path.sep, "/"),
      });
    }
  }

  for (const directory of roots) walk(directory);
  return assets.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function createAcademyReviewCache({
  store,
  safeStorage,
  app,
  repository = process.env.OBSERRA_ACADEMY_GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  branch = process.env.OBSERRA_ACADEMY_REVIEW_BRANCH || DEFAULT_BRANCH,
  workflow = process.env.OBSERRA_ACADEMY_REVIEW_WORKFLOW || DEFAULT_WORKFLOW,
  ownerLogin = process.env.OBSERRA_OWNER_GITHUB_LOGIN || DEFAULT_OWNER_LOGIN,
  approvalIssue = Number(process.env.ACADEMY_RELEASE_APPROVAL_ISSUE || DEFAULT_APPROVAL_ISSUE),
} = {}) {
  if (!store || !safeStorage || !app) throw new Error("Academy review cache dependencies are required.");
  const repositoryName = String(repository).trim();
  const branchName = String(branch).trim();
  const workflowName = String(workflow).trim();
  const expectedOwner = String(ownerLogin).trim().toLowerCase();
  const root = reviewCacheRoot(app);
  const metadataPath = path.join(root, "sync-metadata.json");
  let syncInFlight = null;

  function tokenConfigured() {
    return typeof store.get("secrets.githubToken") === "string";
  }

  function githubToken() {
    const encrypted = store.get("secrets.githubToken");
    if (typeof encrypted !== "string" || !encrypted) throw new Error("GitHub owner token is not configured.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Device encryption is required for GitHub synchronization.");
    const token = safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim();
    if (!token) throw new Error("The configured GitHub owner token is empty.");
    return token;
  }

  async function request(endpoint, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`https://api.github.com${endpoint}`, {
        method: options.method || "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: options.accept || "application/vnd.github+json",
          Authorization: `Bearer ${githubToken()}`,
          "Content-Type": "application/json",
          "User-Agent": "Obserra-Owner-Command-Center",
          "X-GitHub-Api-Version": API_VERSION,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return response;
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw new Error("GitHub Academy review request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(endpoint, options = {}) {
    const response = await request(endpoint, options);
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 1000) }; }
    }
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}: ${payload?.message || "request failed"}`);
    return payload;
  }

  async function verifyOwner() {
    const user = await json("/user");
    const login = String(user?.login || "").toLowerCase();
    if (login !== expectedOwner) {
      throw new Error(`Configured GitHub token belongs to ${login || "an unknown user"}; required owner is ${expectedOwner}.`);
    }
    return { login: user.login, id: user.id };
  }

  async function latestArtifact() {
    const runs = await json(
      `/repos/${repositoryName}/actions/workflows/${encodeURIComponent(workflowName)}/runs?branch=${encodeURIComponent(branchName)}&per_page=25`,
    );
    const candidates = (runs?.workflow_runs || [])
      .filter((run) => run?.status === "completed")
      .sort((left, right) => Date.parse(right.updated_at || right.created_at || 0) - Date.parse(left.updated_at || left.created_at || 0));
    for (const run of candidates) {
      const artifacts = await json(`/repos/${repositoryName}/actions/runs/${run.id}/artifacts?per_page=100`);
      const artifact = (artifacts?.artifacts || [])
        .filter((item) => item?.expired !== true && String(item?.name || "").startsWith("protected-academy-course-packages-"))
        .sort((left, right) => Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0))[0];
      if (artifact) return { run, artifact };
    }
    throw new Error("No unexpired protected Academy course artifact is available yet.");
  }

  async function downloadArtifact(artifact) {
    const response = await request(
      `/repos/${repositoryName}/actions/artifacts/${artifact.id}/zip`,
      { accept: "application/octet-stream", timeoutMs: 180000 },
    );
    if (!response.ok) throw new Error(`Protected Academy artifact download failed with ${response.status}.`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_ARTIFACT_BYTES) throw new Error("Protected Academy artifact exceeds the governed size limit.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ARTIFACT_BYTES) throw new Error("Protected Academy artifact exceeds the governed size limit.");
    const digest = sha256(buffer);
    const advertised = String(artifact.digest || "");
    if (advertised.startsWith("sha256:") && advertised.slice(7).toLowerCase() !== digest) {
      throw new Error("Protected Academy artifact digest does not match GitHub metadata.");
    }
    return { buffer, digest };
  }

  function snapshot() {
    const located = findReviewRoot(app);
    const catalogPath = path.join(located.root, REVIEW_FILES[0]);
    const readinessPath = path.join(located.root, REVIEW_FILES[1]);
    const metadata = fs.existsSync(metadataPath) ? readJson(metadataPath) : null;
    if (!fs.existsSync(catalogPath)) {
      return {
        available: false,
        source: located.source,
        tokenConfigured: tokenConfigured(),
        synchronizedAt: metadata?.synchronizedAt || null,
        courses: [],
        decisions: courseDecisionMap(store),
        summary: { total: 0, contentReady: 0, pendingReview: 0, approved: 0, blocked: 0 },
        blockers: [
          tokenConfigured()
            ? "Protected Academy course artifact has not been synchronized."
            : "GitHub owner token is required to synchronize protected course review packages.",
        ],
      };
    }

    const catalog = readJson(catalogPath);
    const readiness = fs.existsSync(readinessPath) ? readJson(readinessPath) : null;
    const decisions = courseDecisionMap(store);
    const courses = (Array.isArray(catalog.courses) ? catalog.courses : []).map((course) => {
      const blockers = courseBlockers(course);
      const decision = decisions[course.id] || null;
      return {
        id: course.id,
        title: course.title,
        department: course.department,
        track: course.track,
        level: course.level,
        duration: course.duration,
        moduleCount: course.moduleCount,
        releaseStatus: course.releaseStatus,
        publicationApproved: course.publication?.approved === true,
        authoringAvailable: course.authoring?.available === true,
        authoringModel: course.authoring?.model || null,
        generatedAt: course.authoring?.generatedAt || null,
        readiness: blockers.length === 0 ? "content-ready" : "blocked",
        blockerCount: blockers.length,
        blockers,
        decision,
      };
    });
    const approved = courses.filter((course) => course.decision?.decision === "approved").length;
    const blocked = courses.filter((course) => course.blockerCount > 0).length;
    return {
      available: true,
      source: located.source,
      tokenConfigured: tokenConfigured(),
      synchronizedAt: metadata?.synchronizedAt || catalog.generatedAt || null,
      catalogSchemaVersion: catalog.schemaVersion || null,
      readiness,
      courses,
      decisions,
      summary: {
        total: courses.length,
        contentReady: courses.filter((course) => course.readiness === "content-ready").length,
        pendingReview: courses.filter((course) => !course.decision).length,
        approved,
        blocked,
        publicationApproved: courses.filter((course) => course.publicationApproved).length,
      },
      blockers: readiness?.ready === false ? readiness.findings || [] : [],
    };
  }

  function courseDetail(courseIdValue) {
    const courseId = normalizedCourseId(courseIdValue);
    const located = findReviewRoot(app);
    const catalogPath = path.join(located.root, REVIEW_FILES[0]);
    if (!fs.existsSync(catalogPath)) throw new Error("Protected Academy course catalog is unavailable.");
    const catalog = readJson(catalogPath);
    const course = (catalog.courses || []).find((item) => item.id === courseId);
    if (!course) throw new Error("Course review package was not found.");
    const blockers = courseBlockers(course);
    const assets = mediaAssets(located.root, courseId);
    const modules = (course.learnerExperience?.modules || []).map((module, index) => ({
      ...module,
      sequence: module.sequence || index + 1,
      renderedMedia: assets.filter((asset) => asset.relativePath.includes(`/${module.id}/`) || asset.name.toLowerCase().includes(String(module.id || "").toLowerCase())),
      videoReviewState: assets.some((asset) => asset.type === "video") ? "rendered-media-available" : module.videoScript ? "script-only" : "missing",
    }));
    return {
      available: true,
      source: located.source,
      course: {
        ...course,
        learnerExperience: {
          ...course.learnerExperience,
          modules,
        },
      },
      blockers,
      readyForOwnerContentApproval: blockers.length === 0,
      renderedMedia: assets,
      decision: courseDecisionMap(store)[courseId] || null,
      claimBoundary: "Content-ready means the protected learner package passed structural owner-review checks. It does not prove final mastered video, accessibility acceptance, rights clearance, LCMS publication, checkout enablement, or production deployment.",
    };
  }

  async function synchronize() {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      const owner = await verifyOwner();
      const { run, artifact } = await latestArtifact();
      const { buffer, digest } = await downloadArtifact(artifact);
      const entries = extractSelectedEntries(buffer);
      if (!entries.has(REVIEW_FILES[0])) throw new Error("Protected Academy artifact does not contain the learner review catalog.");
      for (const [fileName, content] of entries.entries()) {
        const destination = path.join(root, fileName);
        atomicWrite(destination, content.toString("utf8"));
      }
      const catalog = readJson(path.join(root, REVIEW_FILES[0]));
      const metadata = {
        schemaVersion: "1.0",
        synchronizedAt: new Date().toISOString(),
        repository: repositoryName,
        branch: branchName,
        workflow: workflowName,
        runId: run.id,
        runConclusion: run.conclusion || null,
        artifactId: artifact.id,
        artifactName: artifact.name,
        artifactDigest: digest,
        owner,
        selectedFiles: [...entries.keys()].sort(),
        courseCount: Array.isArray(catalog.courses) ? catalog.courses.length : 0,
      };
      atomicWriteJson(metadataPath, metadata);
      store.set("academy.reviewLastSync", metadata);
      return { ...snapshot(), synchronization: metadata };
    })();
    try {
      return await syncInFlight;
    } catch (error) {
      const failure = { failedAt: new Date().toISOString(), error: safeError(error) };
      store.set("academy.reviewLastSyncFailure", failure);
      throw error;
    } finally {
      syncInFlight = null;
    }
  }

  async function recordDecision(payload) {
    const courseId = normalizedCourseId(payload?.courseId);
    const decision = String(payload?.decision || "").trim();
    if (!["approved", "revision-requested", "rejected"].includes(decision)) {
      throw new Error("Course decision must be approved, revision-requested, or rejected.");
    }
    const note = String(payload?.note || "").trim();
    if (note.length < 3) throw new Error("An owner review note is required.");
    const detail = courseDetail(courseId);
    if (decision === "approved" && detail.blockers.length > 0) {
      throw new Error(`Course cannot be approved while ${detail.blockers.length} review blocker(s) remain.`);
    }
    const endpoint = store.get("endpoint.identity") || {};
    const record = {
      schemaVersion: "1.0",
      decisionId: crypto.randomUUID(),
      courseId,
      courseTitle: detail.course.title,
      decision,
      note: note.slice(0, 8000),
      autoReleaseWhenEligible: decision === "approved" && payload?.autoReleaseWhenEligible === true,
      queueProductionRelease: decision === "approved" && payload?.queueProductionRelease === true,
      decidedBy: "company-owner",
      deviceId: endpoint.deviceId || null,
      decidedAt: new Date().toISOString(),
      contentFingerprint: sha256(JSON.stringify(detail.course)),
      blockersAtDecision: detail.blockers,
      publicationAuthorized: false,
      releaseExecuted: false,
      claimBoundary: "This owner decision approves or rejects the reviewed protected content package. Production publication remains a separate governed action and is never inferred from the decision alone.",
    };

    const decisions = courseDecisionMap(store);
    decisions[courseId] = record;
    store.set("academy.courseReviewDecisions", decisions);

    const localRoot = resolveStudioRoot();
    if (localRoot) {
      const destination = path.join(localRoot, "courses", courseId, "generated", "release", "owner-course-review-decision.json");
      atomicWriteJson(destination, record);
    }

    let githubSubmission = null;
    let githubSubmissionError = null;
    if (tokenConfigured()) {
      try {
        const owner = await verifyOwner();
        const comment = [
          COURSE_DECISION_MARKER,
          `## Owner course review decision: ${detail.course.title}`,
          "",
          `- Course ID: \`${courseId}\``,
          `- Decision: **${decision}**`,
          `- Auto release when eligible: **${record.autoReleaseWhenEligible ? "YES" : "NO"}**`,
          `- Queue production release: **${record.queueProductionRelease ? "YES" : "NO"}**`,
          `- Decision ID: \`${record.decisionId}\``,
          `- Content fingerprint: \`${record.contentFingerprint}\``,
          `- Device ID: \`${record.deviceId || "not-enrolled"}\``,
          `- Decided at: \`${record.decidedAt}\``,
          "",
          "### Owner note",
          "",
          record.note,
          "",
          "```json",
          JSON.stringify(record),
          "```",
          "",
          record.claimBoundary,
        ].join("\n");
        const response = await json(
          `/repos/${repositoryName}/issues/${approvalIssue}/comments`,
          { method: "POST", body: { body: comment } },
        );
        githubSubmission = {
          submitted: true,
          owner,
          issueNumber: approvalIssue,
          commentId: response.id,
          commentUrl: response.html_url,
          submittedAt: new Date().toISOString(),
        };
      } catch (error) {
        githubSubmissionError = safeError(error);
      }
    }

    const completed = { ...record, githubSubmission, githubSubmissionError };
    decisions[courseId] = completed;
    store.set("academy.courseReviewDecisions", decisions);
    return completed;
  }

  return {
    synchronize,
    snapshot,
    courseDetail,
    recordDecision,
    cacheRoot: root,
    tokenConfigured,
  };
}

module.exports = {
  COURSE_DECISION_MARKER,
  REVIEW_FILES,
  createAcademyReviewCache,
  extractSelectedEntries,
};
