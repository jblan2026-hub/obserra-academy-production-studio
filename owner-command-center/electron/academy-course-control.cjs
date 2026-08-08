const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  getStudioSnapshot,
  resolveStudioRoot,
  runStudioAction,
} = require("./academy-studio.cjs");
const { resolvedConnectors } = require("./connectors.cjs");

const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_REPOSITORY = "jblan2026-hub/obserra-academy-production-studio";
const DEFAULT_PUBLICATION_BRANCH = "main";
const DEFAULT_PUBLICATION_WORKFLOW = "publish-to-website.yml";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const PUBLICATION_POLL_INTERVAL_MS = 10000;
const PUBLICATION_POLL_ATTEMPTS = 90;
const PURCHASE_PAGE_LIMIT = 5;
const PURCHASES_PER_PAGE = 100;
const LEDGER_SCHEMA_VERSION = "1.0";
const ALLOWED_REVIEW_DECISIONS = new Set([
  "approved",
  "changes-requested",
  "rejected",
  "not-started",
]);
const ALLOWED_RELEASE_ACTIONS = new Set([
  "submit-review",
  "approve",
  "publish",
  "unpublish",
  "retire",
  "restore-draft",
]);
const REVIEW_APPROVAL_STATES = new Set(["approved", "complete", "completed"]);

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function safeMessage(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/\s+/g, " ")
    .slice(0, 16000);
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireCourseId(value) {
  const courseId = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{2,159}$/.test(courseId)) {
    throw new Error("A canonical Academy course ID is required.");
  }
  return courseId;
}

function requireNote(value, minimum = 3) {
  const note = String(value || "").trim();
  if (note.length < minimum || note.length > 4000) {
    throw new Error(`Owner note must contain ${minimum} to 4000 characters.`);
  }
  return note;
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

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object.`);
  }
  return value;
}

function boundedRawBody(text) {
  const value = String(text || "");
  if (Buffer.byteLength(value, "utf8") <= MAX_RESPONSE_BYTES) return value;
  return `${Buffer.from(value, "utf8").subarray(0, MAX_RESPONSE_BYTES).toString("utf8")}\n[response truncated]`;
}

function parseBody(rawBody) {
  if (!rawBody) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

function acceptedStatus(status, acceptedStatuses) {
  return acceptedStatuses.includes(status);
}

function providerFailure(provider, method, url, response) {
  return {
    ok: false,
    provider,
    method,
    url,
    status: response.status,
    rawBody: response.rawBody,
    body: response.body,
    requestId: response.requestId,
    observedAt: nowIso(),
  };
}

function createAcademyCourseControl({
  store,
  safeStorage,
  studioRootProvider = resolveStudioRoot,
  repository = process.env.OBSERRA_ACADEMY_GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  publicationBranch = process.env.OBSERRA_ACADEMY_PUBLICATION_BRANCH || DEFAULT_PUBLICATION_BRANCH,
  publicationWorkflow = process.env.OBSERRA_ACADEMY_PUBLICATION_WORKFLOW || DEFAULT_PUBLICATION_WORKFLOW,
} = {}) {
  if (!store || !safeStorage) throw new Error("Academy course control dependencies are required.");
  const normalizedRepository = String(repository || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedRepository)) {
    throw new Error("Academy publication repository must use owner/name format.");
  }
  const branchName = String(publicationBranch || "").trim();
  const workflowName = String(publicationWorkflow || "").trim();
  if (!branchName || !workflowName) throw new Error("Academy publication configuration is incomplete.");

  const inFlightPublicationJobs = new Map();
  let healthCache = null;

  function root() {
    const value = studioRootProvider();
    if (!value || !fs.existsSync(value)) {
      throw new Error("The Academy Studio workspace is not available on this endpoint.");
    }
    return value;
  }

  function assertOwnerEndpoint() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows credential encryption is required for Academy control actions.");
    }
    const enrollment = store.get("endpoint.enrollment");
    if (!enrollment || enrollment.state !== "enrolled") {
      throw new Error("The owner endpoint must be enrolled before Academy control actions are permitted.");
    }
  }

  function readSecret(key) {
    const encrypted = store.get(`secrets.${key}`);
    if (typeof encrypted !== "string" || !encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows credential encryption is required to use live provider credentials.");
    }
    const value = safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim();
    return value || null;
  }

  function connector(id) {
    const value = resolvedConnectors(store).find((item) => item.id === id);
    if (!value) throw new Error(`Connector ${id} is not registered.`);
    return value;
  }

  function manifestPath(courseId) {
    return path.join(root(), "courses", requireCourseId(courseId), "course-manifest.json");
  }

  function catalogPath() {
    return path.join(root(), "catalog", "academy-course-catalog.json");
  }

  function ledgerPath() {
    return path.join(root(), "catalog", "academy-owner-course-control-ledger.jsonl");
  }

  function readManifest(courseId) {
    return readJson(manifestPath(courseId), `Course manifest ${courseId}`);
  }

  function writeManifest(courseId, manifest) {
    atomicWriteJson(manifestPath(courseId), manifest);
  }

  function actorIdentity() {
    return {
      actor: `owner-device://${os.hostname().toLowerCase()}/${os.userInfo().username}`,
      hostname: os.hostname().toLowerCase(),
      username: os.userInfo().username,
    };
  }

  function appendLedger(event) {
    const filePath = ledgerPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    let previousHash = "GENESIS";
    if (fs.existsSync(filePath)) {
      const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
      if (lines.length) {
        try {
          const previous = JSON.parse(lines.at(-1));
          previousHash = String(previous.hash || "GENESIS");
        } catch {
          throw new Error("The Academy course-control ledger is malformed and must be reviewed before another mutation.");
        }
      }
    }
    const record = {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      eventId: crypto.randomUUID(),
      occurredAt: nowIso(),
      ...actorIdentity(),
      ...event,
      previousHash,
    };
    record.hash = sha256(`${previousHash}:${stableJson(record)}`);
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return record;
  }

  function ledger(limit = 200) {
    const filePath = ledgerPath();
    if (!fs.existsSync(filePath)) return [];
    const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    return fs
      .readFileSync(filePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-boundedLimit)
      .reverse()
      .map((line) => JSON.parse(line));
  }

  function reviewEntries(manifest) {
    return Object.entries(manifest.reviews || {}).map(([name, value]) => ({
      name,
      ...(value && typeof value === "object" ? value : { status: String(value || "not-started") }),
    }));
  }

  function allReviewsApproved(manifest) {
    const entries = reviewEntries(manifest);
    return entries.length > 0 && entries.every((review) => REVIEW_APPROVAL_STATES.has(String(review.status || "").toLowerCase()));
  }

  function publicationBlockers(course, manifest) {
    const blockers = [];
    if (!course || course.generation?.status !== "generated") blockers.push("protected-course-package-not-generated");
    if (!course?.finalRelease) blockers.push("final-release-not-built");
    if (Number(course?.missingArtifacts?.length || 0) > 0) blockers.push("required-artifacts-missing");
    if (!allReviewsApproved(manifest)) blockers.push("required-reviews-not-approved");
    const commerce = manifest.commerce || {};
    if (!(Number(commerce.price || 0) > 0)) blockers.push("course-price-not-configured");
    if (!String(commerce.stripePriceId || commerce.paymentLink || "").trim()) {
      blockers.push("stripe-price-or-payment-link-not-configured");
    }
    return blockers;
  }

  function enrichCourse(course) {
    const manifest = readManifest(course.id);
    const commerce = manifest.commerce || {};
    const release = manifest.release || {};
    const reviews = reviewEntries(manifest);
    const blockers = publicationBlockers(course, manifest);
    return {
      ...course,
      reviews,
      release: {
        status: String(release.status || course.releaseStatus || "draft"),
        publishToAcademy: release.publishToAcademy === true,
        version: String(release.version || course.version || "0.0.0"),
      },
      commerce: {
        price: Number(commerce.price || course.price || 0),
        currency: String(commerce.currency || course.currency || "USD"),
        stripePriceId: String(commerce.stripePriceId || ""),
        paymentLink: String(commerce.paymentLink || ""),
        configured: Number(commerce.price || course.price || 0) > 0 && Boolean(String(commerce.stripePriceId || commerce.paymentLink || "").trim()),
      },
      publicationBlockers: blockers,
      publicationReady: blockers.length === 0,
    };
  }

  async function providerRequest({
    provider,
    method = "GET",
    url,
    headers = {},
    body,
    acceptedStatuses = [200],
    timeoutMs = REQUEST_TIMEOUT_MS,
  }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      const rawBody = boundedRawBody(await response.text());
      const result = {
        ok: acceptedStatus(response.status, acceptedStatuses),
        status: response.status,
        rawBody,
        body: parseBody(rawBody),
        requestId:
          response.headers.get("request-id") ||
          response.headers.get("stripe-request-id") ||
          response.headers.get("x-github-request-id") ||
          response.headers.get("x-request-id") ||
          null,
      };
      if (!result.ok) return providerFailure(provider, method, url, result);
      return {
        ok: true,
        provider,
        method,
        url,
        status: result.status,
        rawBody: result.rawBody,
        body: result.body,
        requestId: result.requestId,
        observedAt: nowIso(),
      };
    } catch (error) {
      return {
        ok: false,
        provider,
        method,
        url,
        status: null,
        rawBody: controller.signal.aborted
          ? `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`
          : safeMessage(error),
        body: null,
        requestId: null,
        observedAt: nowIso(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function githubRequest(endpoint, options = {}) {
    const token = readSecret("githubToken");
    if (!token) {
      return {
        ok: false,
        provider: "github",
        method: options.method || "GET",
        url: `https://api.github.com${endpoint}`,
        status: null,
        rawBody: "GitHub owner token is not configured in Manage Publishes.",
        body: null,
        requestId: null,
        observedAt: nowIso(),
      };
    }
    const method = options.method || "GET";
    return providerRequest({
      provider: "github",
      method,
      url: `https://api.github.com${endpoint}`,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Obserra-Owner-Command-Center",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      acceptedStatuses: options.acceptedStatuses || [200],
      timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS,
    });
  }

  async function academyRequest(pathname, acceptedStatuses = [200]) {
    const academy = connector("academy");
    const token = readSecret(academy.credentialKey);
    return providerRequest({
      provider: "academy",
      method: "GET",
      url: `${academy.url}${pathname}`,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      acceptedStatuses,
    });
  }

  async function websiteRequest(pathname, acceptedStatuses = [200]) {
    const website = connector("website");
    const token = readSecret(website.credentialKey);
    return providerRequest({
      provider: "website",
      method: "GET",
      url: `${website.url}${pathname}`,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      acceptedStatuses,
    });
  }

  async function commerceHealth({ force = false } = {}) {
    const currentTime = Date.now();
    if (!force && healthCache && currentTime - healthCache.cachedAt < 30000) {
      return healthCache.value;
    }
    const response = await academyRequest("/api/academy/commerce-health", [200, 503]);
    const operational = response.ok && response.status === 200 && response.body?.operational === true;
    const value = {
      ...response,
      operational,
      verified: operational,
    };
    healthCache = { cachedAt: currentTime, value };
    return value;
  }

  function publicationJobs() {
    const jobs = store.get("academy.publicationJobs");
    return jobs && typeof jobs === "object" && !Array.isArray(jobs) ? jobs : {};
  }

  function savePublicationJob(job) {
    const jobs = publicationJobs();
    jobs[job.jobId] = job;
    store.set("academy.publicationJobs", jobs);
    return job;
  }

  function updatePublicationJob(jobId, patch) {
    const jobs = publicationJobs();
    const current = jobs[jobId];
    if (!current) throw new Error("Academy publication job was not found.");
    const next = { ...current, ...patch, updatedAt: nowIso() };
    jobs[jobId] = next;
    store.set("academy.publicationJobs", jobs);
    return next;
  }

  async function commitPublicationFiles(courseId, action) {
    const reference = await githubRequest(
      `/repos/${normalizedRepository}/git/ref/heads/${encodeURIComponent(branchName)}`,
    );
    if (!reference.ok) return reference;
    const baseCommitSha = reference.body?.object?.sha;
    if (!baseCommitSha) return { ...reference, ok: false, rawBody: "GitHub branch response did not contain the base commit SHA." };

    const baseCommit = await githubRequest(
      `/repos/${normalizedRepository}/git/commits/${encodeURIComponent(baseCommitSha)}`,
    );
    if (!baseCommit.ok) return baseCommit;
    const baseTreeSha = baseCommit.body?.tree?.sha;
    if (!baseTreeSha) return { ...baseCommit, ok: false, rawBody: "GitHub commit response did not contain the base tree SHA." };

    const localFiles = [
      {
        repositoryPath: `courses/${courseId}/course-manifest.json`,
        localPath: manifestPath(courseId),
      },
      {
        repositoryPath: "catalog/academy-course-catalog.json",
        localPath: catalogPath(),
      },
    ];
    const treeEntries = [];
    for (const file of localFiles) {
      if (!fs.existsSync(file.localPath)) {
        return {
          ok: false,
          provider: "github",
          method: "POST",
          url: file.repositoryPath,
          status: null,
          rawBody: `Required Academy publication file is missing: ${file.localPath}`,
          body: null,
          requestId: null,
          observedAt: nowIso(),
        };
      }
      const blob = await githubRequest(`/repos/${normalizedRepository}/git/blobs`, {
        method: "POST",
        body: {
          content: fs.readFileSync(file.localPath, "utf8"),
          encoding: "utf-8",
        },
        acceptedStatuses: [201],
      });
      if (!blob.ok) return blob;
      treeEntries.push({
        path: file.repositoryPath,
        mode: "100644",
        type: "blob",
        sha: blob.body?.sha,
      });
    }

    const tree = await githubRequest(`/repos/${normalizedRepository}/git/trees`, {
      method: "POST",
      body: { base_tree: baseTreeSha, tree: treeEntries },
      acceptedStatuses: [201],
    });
    if (!tree.ok) return tree;

    const commit = await githubRequest(`/repos/${normalizedRepository}/git/commits`, {
      method: "POST",
      body: {
        message: `Academy owner ${action}: ${courseId}`,
        tree: tree.body?.sha,
        parents: [baseCommitSha],
      },
      acceptedStatuses: [201],
    });
    if (!commit.ok) return commit;

    const refUpdate = await githubRequest(
      `/repos/${normalizedRepository}/git/refs/heads/${encodeURIComponent(branchName)}`,
      {
        method: "PATCH",
        body: { sha: commit.body?.sha, force: false },
        acceptedStatuses: [200],
      },
    );
    if (!refUpdate.ok) return refUpdate;
    return {
      ok: true,
      provider: "github",
      method: "PATCH",
      url: refUpdate.url,
      status: refUpdate.status,
      rawBody: refUpdate.rawBody,
      body: {
        commitSha: commit.body?.sha,
        baseCommitSha,
        branch: branchName,
        files: treeEntries.map((entry) => entry.path),
      },
      requestId: refUpdate.requestId,
      observedAt: nowIso(),
    };
  }

  async function readPublishedCatalog() {
    const response = await githubRequest(
      `/repos/${normalizedRepository}/contents/catalog/academy-course-catalog.json?ref=${encodeURIComponent(branchName)}`,
    );
    if (!response.ok) return response;
    try {
      const content = Buffer.from(String(response.body?.content || ""), "base64").toString("utf8");
      return { ...response, body: JSON.parse(content), rawBody: content };
    } catch (error) {
      return { ...response, ok: false, rawBody: `Published Academy catalog could not be decoded: ${safeMessage(error)}` };
    }
  }

  async function verifyPublicationReadback(courseId, expectedPublished) {
    const catalog = await readPublishedCatalog();
    if (!catalog.ok) return { verified: false, catalog, commerce: null, page: null };
    const courses = Array.isArray(catalog.body?.courses) ? catalog.body.courses : [];
    const catalogPublished = courses.some((course) => course.id === courseId);
    if (catalogPublished !== expectedPublished) {
      return {
        verified: false,
        catalog: {
          ...catalog,
          ok: false,
          rawBody: `Catalog readback expected published=${expectedPublished}, observed published=${catalogPublished}.`,
        },
        commerce: null,
        page: null,
      };
    }
    const commerce = await commerceHealth({ force: true });
    const page = expectedPublished
      ? await websiteRequest(`/academy/${encodeURIComponent(courseId)}`, [200])
      : null;
    const pageVerified = !expectedPublished || page?.ok === true;
    return {
      verified: catalogPublished === expectedPublished && commerce.operational === true && pageVerified,
      catalog,
      commerce,
      page,
    };
  }

  async function findPublicationRun(commitSha, startedAt) {
    const response = await githubRequest(
      `/repos/${normalizedRepository}/actions/workflows/${encodeURIComponent(workflowName)}/runs?branch=${encodeURIComponent(branchName)}&per_page=20`,
    );
    if (!response.ok) return response;
    const started = Date.parse(startedAt);
    const runs = Array.isArray(response.body?.workflow_runs) ? response.body.workflow_runs : [];
    const run = runs.find((item) =>
      item?.head_sha === commitSha ||
      (Date.parse(item?.created_at || 0) >= started - 5000 && ["push", "workflow_dispatch"].includes(item?.event)),
    );
    return { ...response, body: run || null };
  }

  async function trackPublicationJob(jobId) {
    if (inFlightPublicationJobs.has(jobId)) return inFlightPublicationJobs.get(jobId);
    const tracker = (async () => {
      let job = publicationJobs()[jobId];
      if (!job) return null;
      for (let attempt = 0; attempt < PUBLICATION_POLL_ATTEMPTS; attempt += 1) {
        const runResult = await findPublicationRun(job.commitSha, job.createdAt);
        if (!runResult.ok) {
          job = updatePublicationJob(jobId, {
            state: "failed",
            error: runResult,
            completedAt: nowIso(),
          });
          appendLedger({
            eventType: "publication-failed",
            courseId: job.courseId,
            action: job.action,
            outcome: "failed",
            provider: "github",
            technicalDetail: runResult,
          });
          return job;
        }
        const run = runResult.body;
        if (!run) {
          updatePublicationJob(jobId, { state: "queued", pollAttempt: attempt + 1 });
        } else if (run.status !== "completed") {
          updatePublicationJob(jobId, {
            state: "running",
            workflowRunId: run.id,
            workflowUrl: run.html_url,
            workflowStatus: run.status,
            workflowConclusion: run.conclusion,
            pollAttempt: attempt + 1,
          });
        } else if (run.conclusion !== "success") {
          job = updatePublicationJob(jobId, {
            state: "failed",
            workflowRunId: run.id,
            workflowUrl: run.html_url,
            workflowStatus: run.status,
            workflowConclusion: run.conclusion,
            error: {
              provider: "github-actions",
              status: run.conclusion,
              rawBody: `Publication workflow concluded with ${run.conclusion}.`,
            },
            completedAt: nowIso(),
          });
          appendLedger({
            eventType: "publication-failed",
            courseId: job.courseId,
            action: job.action,
            outcome: "failed",
            provider: "github-actions",
            technicalDetail: job.error,
          });
          return job;
        } else {
          const readback = await verifyPublicationReadback(job.courseId, job.expectedPublished);
          job = updatePublicationJob(jobId, {
            state: readback.verified ? "verified-success" : "verification-failed",
            workflowRunId: run.id,
            workflowUrl: run.html_url,
            workflowStatus: run.status,
            workflowConclusion: run.conclusion,
            readback,
            completedAt: nowIso(),
          });
          appendLedger({
            eventType: "publication-verified",
            courseId: job.courseId,
            action: job.action,
            outcome: job.state,
            provider: "github-actions+website",
            technicalDetail: readback,
          });
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, PUBLICATION_POLL_INTERVAL_MS));
      }
      job = updatePublicationJob(jobId, {
        state: "verification-timeout",
        error: {
          provider: "github-actions",
          status: null,
          rawBody: `Publication verification timed out after ${Math.round((PUBLICATION_POLL_ATTEMPTS * PUBLICATION_POLL_INTERVAL_MS) / 60000)} minutes.`,
        },
        completedAt: nowIso(),
      });
      appendLedger({
        eventType: "publication-timeout",
        courseId: job.courseId,
        action: job.action,
        outcome: "verification-timeout",
        provider: "github-actions",
        technicalDetail: job.error,
      });
      return job;
    })().finally(() => inFlightPublicationJobs.delete(jobId));
    inFlightPublicationJobs.set(jobId, tracker);
    return tracker;
  }

  function createPublicationJob({ courseId, action, commitSha, expectedPublished }) {
    const job = savePublicationJob({
      jobId: crypto.randomUUID(),
      courseId,
      action,
      commitSha,
      expectedPublished,
      state: "queued",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      workflowRunId: null,
      workflowUrl: null,
      workflowStatus: null,
      workflowConclusion: null,
      readback: null,
      error: null,
    });
    trackPublicationJob(job.jobId).catch(() => {});
    return job;
  }

  async function snapshot() {
    const studio = getStudioSnapshot();
    const courses = studio.courses.map(enrichCourse);
    const commerce = await commerceHealth();
    return {
      ...studio,
      courses,
      commerce,
      publicationJobs: publicationJobs(),
      ledger: ledger(100),
      generatedAt: nowIso(),
      claimBoundary:
        "Course state is local until GitHub accepts the exact manifest and catalog commit. Publication is verified only after the workflow succeeds and GitHub catalog plus website and commerce readback pass.",
    };
  }

  async function updateReview(payload) {
    assertOwnerEndpoint();
    const request = requireObject(payload, "Academy review decision");
    const courseId = requireCourseId(request.courseId);
    const reviewName = String(request.reviewName || "").trim();
    const decision = String(request.decision || "").trim().toLowerCase();
    const note = requireNote(request.note);
    if (!reviewName || reviewName.length > 160) throw new Error("A valid review name is required.");
    if (!ALLOWED_REVIEW_DECISIONS.has(decision)) throw new Error("The Academy review decision is invalid.");

    const manifest = readManifest(courseId);
    if (!manifest.reviews || typeof manifest.reviews !== "object" || !(reviewName in manifest.reviews)) {
      throw new Error(`Course ${courseId} does not contain review ${reviewName}.`);
    }
    const previous = manifest.reviews[reviewName];
    manifest.reviews[reviewName] = {
      ...(previous && typeof previous === "object" ? previous : {}),
      status: decision,
      note,
      reviewedBy: actorIdentity().actor,
      reviewedAt: nowIso(),
    };
    if (!["approved", "published"].includes(String(manifest.release?.status || ""))) {
      manifest.release = { ...(manifest.release || {}), status: "in-review", publishToAcademy: false };
    } else if (decision !== "approved") {
      manifest.release = { ...(manifest.release || {}), status: "in-review", publishToAcademy: false };
    }
    writeManifest(courseId, manifest);
    const event = appendLedger({
      eventType: "course-review-decision",
      courseId,
      action: "review",
      reviewName,
      previousStatus: previous?.status || previous || null,
      nextStatus: decision,
      outcome: "recorded",
      note,
    });
    return { ok: true, course: enrichCourse(getStudioSnapshot().courses.find((item) => item.id === courseId)), event };
  }

  async function transitionCourse(payload) {
    assertOwnerEndpoint();
    const request = requireObject(payload, "Academy release action");
    const courseId = requireCourseId(request.courseId);
    const action = String(request.action || "").trim().toLowerCase();
    const note = requireNote(request.note);
    if (!ALLOWED_RELEASE_ACTIONS.has(action)) throw new Error("The Academy release action is invalid.");

    const studio = getStudioSnapshot();
    const course = studio.courses.find((item) => item.id === courseId);
    if (!course) throw new Error(`Course ${courseId} was not found.`);
    const manifest = readManifest(courseId);
    const previousStatus = String(manifest.release?.status || course.releaseStatus || "draft");
    let nextStatus = previousStatus;
    let publishToAcademy = manifest.release?.publishToAcademy === true;
    let requiresPublicationSync = false;

    if (action === "submit-review") {
      if (course.generation?.status !== "generated") {
        throw new Error("A protected generated course package is required before review can begin.");
      }
      nextStatus = "in-review";
      publishToAcademy = false;
    }
    if (action === "approve") {
      const blockers = publicationBlockers(course, manifest).filter(
        (item) => !["stripe-price-or-payment-link-not-configured"].includes(item),
      );
      if (blockers.length) throw new Error(`Course approval is blocked: ${blockers.join(", ")}.`);
      nextStatus = "approved";
      publishToAcademy = false;
    }
    if (action === "publish") {
      if (String(request.confirmation || "") !== `PUBLISH ${courseId}`) {
        throw new Error(`Publication requires confirmation text: PUBLISH ${courseId}`);
      }
      const blockers = publicationBlockers(course, manifest);
      if (blockers.length) throw new Error(`Course publication is blocked: ${blockers.join(", ")}.`);
      if (!REVIEW_APPROVAL_STATES.has(previousStatus) && !["approved", "published"].includes(previousStatus)) {
        throw new Error("Course publication requires an approved release state.");
      }
      nextStatus = "published";
      publishToAcademy = true;
      requiresPublicationSync = true;
    }
    if (action === "unpublish") {
      if (String(request.confirmation || "") !== `UNPUBLISH ${courseId}`) {
        throw new Error(`Unpublication requires confirmation text: UNPUBLISH ${courseId}`);
      }
      nextStatus = "approved";
      publishToAcademy = false;
      requiresPublicationSync = true;
    }
    if (action === "retire") {
      if (String(request.confirmation || "") !== `RETIRE ${courseId}`) {
        throw new Error(`Retirement requires confirmation text: RETIRE ${courseId}`);
      }
      nextStatus = "retired";
      publishToAcademy = false;
      requiresPublicationSync = true;
    }
    if (action === "restore-draft") {
      if (String(request.confirmation || "") !== `RESTORE ${courseId}`) {
        throw new Error(`Draft restoration requires confirmation text: RESTORE ${courseId}`);
      }
      nextStatus = "draft";
      publishToAcademy = false;
    }

    manifest.release = {
      ...(manifest.release || {}),
      status: nextStatus,
      publishToAcademy,
      ownerControlledAt: nowIso(),
      ownerControlledBy: actorIdentity().actor,
      ownerControlNote: note,
    };
    writeManifest(courseId, manifest);
    let publication = null;
    if (requiresPublicationSync) {
      const catalogResult = await runStudioAction("catalog");
      if (catalogResult?.code !== 0) {
        manifest.release = {
          ...(manifest.release || {}),
          status: previousStatus,
          publishToAcademy: previousStatus === "published",
        };
        writeManifest(courseId, manifest);
        throw new Error(`Academy catalog generation failed: ${String(catalogResult?.stderr || catalogResult?.stdout || "unknown failure").slice(0, 4000)}`);
      }
      const commit = await commitPublicationFiles(courseId, action);
      if (!commit.ok) {
        appendLedger({
          eventType: "course-release-sync-failed",
          courseId,
          action,
          previousStatus,
          nextStatus,
          outcome: "failed",
          note,
          technicalDetail: commit,
        });
        return {
          ok: false,
          course: enrichCourse(getStudioSnapshot().courses.find((item) => item.id === courseId)),
          providerError: commit,
          publication: null,
        };
      }
      publication = createPublicationJob({
        courseId,
        action,
        commitSha: commit.body.commitSha,
        expectedPublished: publishToAcademy,
      });
    }
    const event = appendLedger({
      eventType: "course-release-transition",
      courseId,
      action,
      previousStatus,
      nextStatus,
      publishToAcademy,
      outcome: requiresPublicationSync ? "provider-submitted" : "recorded",
      note,
      publicationJobId: publication?.jobId || null,
    });
    return {
      ok: true,
      course: enrichCourse(getStudioSnapshot().courses.find((item) => item.id === courseId)),
      publication,
      event,
      existingPurchaserAccessPreserved: action === "unpublish" || action === "retire",
    };
  }

  async function stripeRequest(pathname) {
    const stripe = connector("stripe");
    const token = readSecret(stripe.credentialKey);
    if (!token) {
      return {
        ok: false,
        provider: "stripe",
        method: "GET",
        url: `${stripe.url}${pathname}`,
        status: null,
        rawBody: "Stripe live secret key is not configured in Manage Publishes.",
        body: null,
        requestId: null,
        observedAt: nowIso(),
      };
    }
    return providerRequest({
      provider: "stripe",
      method: "GET",
      url: `${stripe.url}${pathname}`,
      headers: { Authorization: `Bearer ${token}` },
      acceptedStatuses: [200],
    });
  }

  async function clerkRequest(pathname) {
    const clerk = connector("clerk");
    const token = readSecret(clerk.credentialKey);
    if (!token) {
      return {
        ok: false,
        provider: "clerk",
        method: "GET",
        url: `${clerk.url}${pathname}`,
        status: null,
        rawBody: "Clerk live secret key is not configured in Manage Publishes.",
        body: null,
        requestId: null,
        observedAt: nowIso(),
      };
    }
    return providerRequest({
      provider: "clerk",
      method: "GET",
      url: `${clerk.url}${pathname}`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      acceptedStatuses: [200],
    });
  }

  async function listPurchases(payload) {
    const request = requireObject(payload, "Academy purchase query");
    const courseId = requireCourseId(request.courseId);
    const matches = [];
    let startingAfter = null;
    for (let page = 0; page < PURCHASE_PAGE_LIMIT; page += 1) {
      const parameters = new URLSearchParams({ limit: String(PURCHASES_PER_PAGE) });
      if (startingAfter) parameters.set("starting_after", startingAfter);
      const response = await stripeRequest(`/v1/checkout/sessions?${parameters.toString()}`);
      if (!response.ok) return { ok: false, courseId, providerError: response, purchases: [] };
      const data = Array.isArray(response.body?.data) ? response.body.data : [];
      for (const session of data) {
        if (session?.metadata?.courseId !== courseId) continue;
        matches.push({
          sessionId: session.id,
          paymentStatus: session.payment_status,
          status: session.status,
          amountTotal: session.amount_total,
          currency: session.currency,
          purchaserReference: session.metadata?.purchaserReference || session.client_reference_id || null,
          clerkUserId: session.metadata?.clerkUserId || null,
          identityMode: session.metadata?.identityMode || null,
          customerEmail: session.customer_details?.email || session.customer_email || null,
          created: session.created,
        });
      }
      if (response.body?.has_more !== true || data.length === 0) break;
      startingAfter = data.at(-1)?.id || null;
      if (!startingAfter) break;
    }
    return { ok: true, courseId, purchases: matches, observedAt: nowIso() };
  }

  async function verifyPurchase(payload) {
    const request = requireObject(payload, "Academy purchase verification");
    const courseId = requireCourseId(request.courseId);
    const sessionId = String(request.sessionId || "").trim();
    if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      throw new Error("A canonical Stripe Checkout Session ID is required.");
    }
    const stripe = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (!stripe.ok) {
      const event = appendLedger({
        eventType: "purchase-verification-failed",
        courseId,
        action: "verify-purchase",
        outcome: "failed",
        provider: "stripe",
        sessionId,
        technicalDetail: stripe,
      });
      return { ok: false, state: "failed", stripe, clerk: null, commerce: null, event };
    }
    const session = stripe.body || {};
    if (session.payment_status !== "paid") {
      const result = {
        ok: false,
        state: "payment-not-paid",
        stripe,
        clerk: null,
        commerce: null,
        reason: `Stripe reports payment_status=${session.payment_status || "unknown"}.`,
      };
      result.event = appendLedger({
        eventType: "purchase-verification-failed",
        courseId,
        action: "verify-purchase",
        outcome: result.state,
        provider: "stripe",
        sessionId,
        technicalDetail: result,
      });
      return result;
    }
    if (session.metadata?.courseId !== courseId) {
      const result = {
        ok: false,
        state: "course-mismatch",
        stripe,
        clerk: null,
        commerce: null,
        reason: `Stripe metadata courseId=${session.metadata?.courseId || "missing"}.`,
      };
      result.event = appendLedger({
        eventType: "purchase-verification-failed",
        courseId,
        action: "verify-purchase",
        outcome: result.state,
        provider: "stripe",
        sessionId,
        technicalDetail: result,
      });
      return result;
    }

    const commerce = await commerceHealth({ force: true });
    const clerkUserId = String(session.metadata?.clerkUserId || "").trim();
    if (!clerkUserId) {
      const result = {
        ok: false,
        state: "paid-pending-account-claim",
        stripe,
        clerk: null,
        commerce,
        reason: "Stripe confirms payment, but no Clerk user is bound. Access remains pending the purchaser-email claim workflow.",
      };
      result.event = appendLedger({
        eventType: "purchase-verification-pending",
        courseId,
        action: "verify-purchase",
        outcome: result.state,
        provider: "stripe+academy",
        sessionId,
        technicalDetail: result,
      });
      return result;
    }

    const clerk = await clerkRequest(`/v1/users/${encodeURIComponent(clerkUserId)}`);
    if (!clerk.ok) {
      const event = appendLedger({
        eventType: "purchase-verification-failed",
        courseId,
        action: "verify-purchase",
        outcome: "failed",
        provider: "clerk",
        sessionId,
        technicalDetail: clerk,
      });
      return { ok: false, state: "failed", stripe, clerk, commerce, event };
    }
    const entitlement = clerk.body?.private_metadata?.academy?.entitlements?.[courseId];
    const entitlementVerified = entitlement?.paymentReference === sessionId;
    const verified =
      stripe.status === 200 &&
      clerk.status === 200 &&
      commerce.operational === true &&
      entitlementVerified;
    const result = {
      ok: verified,
      state: verified ? "verified-success" : "entitlement-readback-failed",
      stripe,
      clerk,
      commerce,
      entitlement: entitlement || null,
      reason: verified
        ? "Stripe reports paid, Clerk readback contains the exact course entitlement and payment reference, and Academy commerce health is operational."
        : "The paid Stripe session was not confirmed by an exact Clerk entitlement readback and operational Academy commerce health.",
    };
    result.event = appendLedger({
      eventType: verified ? "purchase-verified" : "purchase-verification-failed",
      courseId,
      action: "verify-purchase",
      outcome: result.state,
      provider: "stripe+clerk+academy",
      sessionId,
      technicalDetail: {
        stripeStatus: stripe.status,
        clerkStatus: clerk.status,
        commerceStatus: commerce.status,
        entitlementVerified,
        reason: result.reason,
      },
    });
    return result;
  }

  function resumePublicationTracking() {
    for (const job of Object.values(publicationJobs())) {
      if (["queued", "running"].includes(job.state)) trackPublicationJob(job.jobId).catch(() => {});
    }
  }

  resumePublicationTracking();

  return {
    snapshot,
    updateReview,
    transitionCourse,
    listPurchases,
    verifyPurchase,
    commerceHealth,
    publicationJobs,
    ledger,
  };
}

module.exports = {
  createAcademyCourseControl,
  ALLOWED_REVIEW_DECISIONS,
  ALLOWED_RELEASE_ACTIONS,
};
