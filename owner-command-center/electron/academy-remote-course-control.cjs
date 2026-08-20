const crypto = require("node:crypto");
const os = require("node:os");

const { resolvedConnectors } = require("./connectors.cjs");

const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_REPOSITORY = "jblan2026-hub/obserra-academy-production-studio";
const DEFAULT_BRANCH = "main";
const PUBLICATION_WORKFLOW = "publish-to-website.yml";
const STUDIO_WORKFLOW = "studio-console.yml";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const INVENTORY_TTL_MS = 30000;
const RUN_POLL_INTERVAL_MS = 10000;
const RUN_POLL_ATTEMPTS = 90;
const MAX_BLOB_CONCURRENCY = 8;
const LEDGER_LIMIT = 1000;
const ALLOWED_REVIEWS = new Set(["approved", "changes-requested", "rejected", "not-started"]);
const ALLOWED_RELEASE_ACTIONS = new Set(["submit-review", "approve", "publish", "unpublish", "retire", "restore-draft"]);
const REVIEW_APPROVAL_STATES = new Set(["approved", "complete", "completed"]);
const ACTION_TO_OPERATION = Object.freeze({
  author: "author_course",
  revise: "revise_course",
  "author-all": "author_all",
  build: "build_course_release",
  "build-all": "build_all_drafts",
  catalog: "publish_approved_catalog",
  verify: "validate_all",
});

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
  return String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").slice(0, 16000);
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

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} is required.`);
  return value;
}

function requireCourseId(value) {
  const courseId = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{2,159}$/.test(courseId)) throw new Error("A canonical Academy course ID is required.");
  return courseId;
}

function requireNote(value) {
  const note = String(value || "").trim();
  if (note.length < 3 || note.length > 4000) throw new Error("Owner note must contain 3 to 4000 characters.");
  return note;
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

function createAcademyRemoteCourseControl({
  store,
  safeStorage,
  repository = process.env.OBSERRA_ACADEMY_GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  branch = process.env.OBSERRA_ACADEMY_CONTROL_BRANCH || DEFAULT_BRANCH,
} = {}) {
  if (!store || !safeStorage) throw new Error("Remote Academy course control dependencies are required.");
  const repositoryName = String(repository || "").trim();
  const branchName = String(branch || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryName)) throw new Error("Academy repository must use owner/name format.");
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(branchName) || branchName.includes("..")) throw new Error("Academy control branch is invalid.");

  let inventoryCache = null;
  let inventoryInFlight = null;
  let commerceCache = null;
  const inFlightJobs = new Map();

  function assertOwnerEndpoint() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is required for Academy control actions.");
    const enrollment = store.get("endpoint.enrollment");
    if (!enrollment || enrollment.state !== "enrolled") throw new Error("The owner endpoint must be enrolled before Academy control actions are permitted.");
  }

  function readSecret(key) {
    const encrypted = store.get(`secrets.${key}`);
    if (typeof encrypted !== "string" || !encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is required to use live provider credentials.");
    const value = safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim();
    return value || null;
  }

  function connector(id) {
    const value = resolvedConnectors(store).find((item) => item.id === id);
    if (!value) throw new Error(`Connector ${id} is not registered.`);
    return value;
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
      const response = await fetch(url, { method, headers, body, redirect: "manual", signal: controller.signal });
      const rawBody = boundedRawBody(await response.text());
      const result = {
        ok: acceptedStatuses.includes(response.status),
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
    const method = options.method || "GET";
    const url = `https://api.github.com${endpoint}`;
    if (!token) {
      return {
        ok: false,
        provider: "github",
        method,
        url,
        status: null,
        rawBody: "GitHub owner token is not configured in Manage Publishes.",
        body: null,
        requestId: null,
        observedAt: nowIso(),
      };
    }
    return providerRequest({
      provider: "github",
      method,
      url,
      headers: {
        Accept: options.accept || "application/vnd.github+json",
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

  function appendLedger(event) {
    const entries = Array.isArray(store.get("academy.remoteCourseControlLedger"))
      ? store.get("academy.remoteCourseControlLedger")
      : [];
    const previousHash = entries.at(-1)?.hash || "GENESIS";
    const record = {
      schemaVersion: "1.0",
      eventId: crypto.randomUUID(),
      occurredAt: nowIso(),
      actor: `owner-device://${os.hostname().toLowerCase()}/${os.userInfo().username}`,
      hostname: os.hostname().toLowerCase(),
      username: os.userInfo().username,
      ...event,
      previousHash,
    };
    record.hash = sha256(`${previousHash}:${stableJson(record)}`);
    store.set("academy.remoteCourseControlLedger", [...entries, record].slice(-LEDGER_LIMIT));
    return record;
  }

  function ledger(limit = 200) {
    const entries = Array.isArray(store.get("academy.remoteCourseControlLedger"))
      ? store.get("academy.remoteCourseControlLedger")
      : [];
    return entries.slice(-Math.max(1, Math.min(LEDGER_LIMIT, Number(limit) || 200))).reverse();
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

  function studioJobs() {
    const jobs = store.get("academy.studioJobs");
    return jobs && typeof jobs === "object" && !Array.isArray(jobs) ? jobs : {};
  }

  function saveStudioJob(job) {
    const jobs = studioJobs();
    jobs[job.jobId] = job;
    store.set("academy.studioJobs", jobs);
    return job;
  }

  function updateStudioJob(jobId, patch) {
    const jobs = studioJobs();
    const current = jobs[jobId];
    if (!current) throw new Error("Academy Studio job was not found.");
    const next = { ...current, ...patch, updatedAt: nowIso() };
    jobs[jobId] = next;
    store.set("academy.studioJobs", jobs);
    return next;
  }

  async function mapLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
  }

  async function readBlobJson(sha, pathLabel) {
    const response = await githubRequest(`/repos/${repositoryName}/git/blobs/${encodeURIComponent(sha)}`);
    if (!response.ok) throw new Error(response.rawBody || `GitHub blob request failed for ${pathLabel}.`);
    try {
      const text = Buffer.from(String(response.body?.content || "").replace(/\s+/g, ""), "base64").toString("utf8");
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`GitHub blob ${pathLabel} could not be decoded: ${safeMessage(error)}`);
    }
  }

  function reviewEntries(manifest) {
    return Object.entries(manifest.reviews || {}).map(([name, value]) => ({
      name,
      required: value?.required !== false,
      ...(value && typeof value === "object" ? value : { status: String(value || "not-started") }),
    }));
  }

  function allReviewsApproved(manifest) {
    const required = reviewEntries(manifest).filter((review) => review.required);
    return required.length > 0 && required.every((review) => REVIEW_APPROVAL_STATES.has(String(review.status || "").toLowerCase()));
  }

  function summarizeManifest(manifest, paths) {
    const course = manifest.course || {};
    const id = requireCourseId(course.id);
    const reviews = reviewEntries(manifest);
    const requiredReviews = reviews.filter((review) => review.required);
    const completedReviews = requiredReviews.filter((review) => REVIEW_APPROVAL_STATES.has(String(review.status || "").toLowerCase()));
    const generatedPath = `courses/${id}/generated/authoring/course-package.json`;
    const releasePath = `releases/${id}/FINAL/release-record.json`;
    const requiredArtifacts = manifest.productionQueue?.requiredArtifacts || [
      "instructor-manuscript.md",
      "learner-guide.md",
      "assessment-bank.json",
      "answer-key.json",
    ];
    const missingArtifacts = requiredArtifacts.filter((artifact) => !paths.has(`courses/${id}/${artifact}`));
    const commerce = manifest.commerce || {};
    const release = manifest.release || {};
    const publicationBlockers = [];
    if (!paths.has(generatedPath)) publicationBlockers.push("protected-course-package-not-generated");
    if (!paths.has(releasePath)) publicationBlockers.push("final-release-not-built");
    if (missingArtifacts.length) publicationBlockers.push("required-artifacts-missing");
    if (!allReviewsApproved(manifest)) publicationBlockers.push("required-reviews-not-approved");
    if (!(Number(commerce.price || 0) > 0)) publicationBlockers.push("course-price-not-configured");
    if (!String(commerce.stripePriceId || commerce.paymentLink || "").trim()) publicationBlockers.push("stripe-price-or-payment-link-not-configured");
    const recommendations = publicationBlockers.map((blocker) => blocker.replaceAll("-", " "));
    return {
      id,
      title: course.title,
      department: course.department,
      level: course.level,
      track: course.track,
      description: course.description,
      duration: course.duration,
      price: commerce.price ?? null,
      currency: commerce.currency || "USD",
      moduleCount: Array.isArray(course.modules) ? course.modules.length : 0,
      releaseStatus: release.status || "draft",
      publishToAcademy: release.publishToAcademy === true,
      version: release.version || "0.0.0",
      generation: { status: paths.has(generatedPath) ? "generated" : "not-generated" },
      finalRelease: paths.has(releasePath),
      queueStatus: "remote-repository",
      artifacts: requiredArtifacts.map((artifact) => ({ artifact, present: !missingArtifacts.includes(artifact) })),
      missingArtifacts,
      reviews,
      reviewCompletion: requiredReviews.length ? Math.round((completedReviews.length / requiredReviews.length) * 100) : 100,
      recommendations,
      release: {
        status: release.status || "draft",
        publishToAcademy: release.publishToAcademy === true,
        version: release.version || "0.0.0",
      },
      commerce: {
        price: Number(commerce.price || 0),
        currency: commerce.currency || "USD",
        stripePriceId: String(commerce.stripePriceId || ""),
        paymentLink: String(commerce.paymentLink || ""),
        configured: Number(commerce.price || 0) > 0 && Boolean(String(commerce.stripePriceId || commerce.paymentLink || "").trim()),
      },
      publicationBlockers,
      publicationReady: publicationBlockers.length === 0,
      remoteManifest: manifest,
    };
  }

  async function loadInventory(force = false) {
    const timestamp = Date.now();
    if (!force && inventoryCache && timestamp - inventoryCache.cachedAt < INVENTORY_TTL_MS) return inventoryCache.value;
    if (inventoryInFlight) return inventoryInFlight;
    inventoryInFlight = (async () => {
      const reference = await githubRequest(`/repos/${repositoryName}/git/ref/heads/${encodeURIComponent(branchName)}`);
      if (!reference.ok) throw new Error(reference.rawBody || "GitHub branch reference is unavailable.");
      const commitSha = reference.body?.object?.sha;
      if (!commitSha) throw new Error("GitHub branch response did not contain a commit SHA.");
      const tree = await githubRequest(`/repos/${repositoryName}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`, {
        timeoutMs: 60000,
      });
      if (!tree.ok) throw new Error(tree.rawBody || "GitHub repository tree is unavailable.");
      if (tree.body?.truncated === true) throw new Error("GitHub returned a truncated Academy repository tree; complete course control cannot be established.");
      const entries = Array.isArray(tree.body?.tree) ? tree.body.tree : [];
      const pathSet = new Set(entries.map((entry) => entry.path));
      const manifests = entries.filter((entry) => entry.type === "blob" && /^courses\/[^/]+\/course-manifest\.json$/.test(entry.path));
      if (!manifests.length) throw new Error("No governed Academy course manifests were found on the configured branch.");
      const manifestValues = await mapLimit(manifests, MAX_BLOB_CONCURRENCY, async (entry) => readBlobJson(entry.sha, entry.path));
      const courses = manifestValues.map((manifest) => summarizeManifest(manifest, pathSet)).sort((left, right) => left.title.localeCompare(right.title));
      const value = {
        available: true,
        mode: "github-remote-control",
        root: null,
        repository: repositoryName,
        branch: branchName,
        commitSha,
        checkedAt: nowIso(),
        courses,
        summary: {
          total: courses.length,
          generated: courses.filter((course) => course.generation.status === "generated").length,
          published: courses.filter((course) => course.release.publishToAcademy && course.release.status === "published").length,
          reviewReady: courses.filter((course) => course.generation.status === "generated" && course.missingArtifacts.length === 0).length,
          gaps: courses.reduce((sum, course) => sum + course.publicationBlockers.length, 0),
        },
        gaps: [],
      };
      inventoryCache = { cachedAt: Date.now(), value };
      return value;
    })().finally(() => {
      inventoryInFlight = null;
    });
    return inventoryInFlight;
  }

  function invalidateInventory() {
    inventoryCache = null;
  }

  async function readManifest(courseId) {
    const id = requireCourseId(courseId);
    const response = await githubRequest(`/repos/${repositoryName}/contents/courses/${id}/course-manifest.json?ref=${encodeURIComponent(branchName)}`);
    if (!response.ok) return response;
    try {
      const text = Buffer.from(String(response.body?.content || "").replace(/\s+/g, ""), "base64").toString("utf8");
      return { ...response, manifest: JSON.parse(text), fileSha: response.body?.sha, rawBody: text };
    } catch (error) {
      return { ...response, ok: false, rawBody: `Course manifest could not be decoded: ${safeMessage(error)}` };
    }
  }

  async function writeManifest(courseId, manifest, previousSha, message) {
    const id = requireCourseId(courseId);
    const response = await githubRequest(`/repos/${repositoryName}/contents/courses/${id}/course-manifest.json`, {
      method: "PUT",
      body: {
        message,
        content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8").toString("base64"),
        sha: previousSha,
        branch: branchName,
      },
      acceptedStatuses: [200],
    });
    if (response.ok) invalidateInventory();
    return response;
  }

  async function verifyManifest(courseId, predicate, label) {
    const readback = await readManifest(courseId);
    if (!readback.ok) return { verified: false, readback };
    let verified = false;
    try {
      verified = predicate(readback.manifest) === true;
    } catch {
      verified = false;
    }
    return {
      verified,
      readback: verified
        ? readback
        : { ...readback, ok: false, rawBody: `Manifest readback did not confirm ${label}.` },
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
    if (!ALLOWED_REVIEWS.has(decision)) throw new Error("The Academy review decision is invalid.");

    const current = await readManifest(courseId);
    if (!current.ok) return { ok: false, providerError: current };
    const manifest = current.manifest;
    if (!manifest.reviews || typeof manifest.reviews !== "object" || !(reviewName in manifest.reviews)) {
      throw new Error(`Course ${courseId} does not contain review ${reviewName}.`);
    }
    const previous = manifest.reviews[reviewName];
    manifest.reviews[reviewName] = {
      ...(previous && typeof previous === "object" ? previous : {}),
      status: decision,
      note,
      reviewedBy: `owner-device://${os.hostname().toLowerCase()}/${os.userInfo().username}`,
      reviewedAt: nowIso(),
    };
    if (decision !== "approved" && manifest.release?.status === "published") {
      manifest.release = { ...(manifest.release || {}), status: "in-review", publishToAcademy: false };
    } else if (!["approved", "published"].includes(String(manifest.release?.status || ""))) {
      manifest.release = { ...(manifest.release || {}), status: "in-review", publishToAcademy: false };
    }
    const write = await writeManifest(
      courseId,
      manifest,
      current.fileSha,
      `Academy owner review ${reviewName}: ${courseId}`,
    );
    if (!write.ok) return { ok: false, providerError: write };
    const verification = await verifyManifest(
      courseId,
      (value) => value.reviews?.[reviewName]?.status === decision && value.reviews?.[reviewName]?.note === note,
      `review ${reviewName}=${decision}`,
    );
    const result = {
      ok: verification.verified,
      state: verification.verified ? "verified-success" : "verification-failed",
      provider: write,
      readback: verification.readback,
    };
    result.event = appendLedger({
      eventType: "course-review-decision",
      courseId,
      action: "review",
      reviewName,
      previousStatus: previous?.status || previous || null,
      nextStatus: decision,
      outcome: result.state,
      note,
      technicalDetail: result,
    });
    return result;
  }

  function releaseBlockers(course, manifest, action) {
    const blockers = [...course.publicationBlockers];
    if (action === "approve") return blockers.filter((item) => item !== "stripe-price-or-payment-link-not-configured");
    return blockers;
  }

  async function transitionCourse(payload) {
    assertOwnerEndpoint();
    const request = requireObject(payload, "Academy release action");
    const courseId = requireCourseId(request.courseId);
    const action = String(request.action || "").trim().toLowerCase();
    const note = requireNote(request.note);
    if (!ALLOWED_RELEASE_ACTIONS.has(action)) throw new Error("The Academy release action is invalid.");

    const inventory = await loadInventory(true);
    const course = inventory.courses.find((item) => item.id === courseId);
    if (!course) throw new Error(`Course ${courseId} was not found on ${branchName}.`);
    const current = await readManifest(courseId);
    if (!current.ok) return { ok: false, providerError: current };
    const manifest = current.manifest;
    const previousStatus = String(manifest.release?.status || "draft");
    let nextStatus = previousStatus;
    let publishToAcademy = manifest.release?.publishToAcademy === true;
    let requiresPublicationTracking = false;

    if (action === "submit-review") {
      if (course.generation.status !== "generated") throw new Error("A protected generated course package is required before review can begin.");
      nextStatus = "in-review";
      publishToAcademy = false;
    }
    if (action === "approve") {
      const blockers = releaseBlockers(course, manifest, action);
      if (blockers.length) throw new Error(`Course approval is blocked: ${blockers.join(", ")}.`);
      nextStatus = "approved";
      publishToAcademy = false;
    }
    if (action === "publish") {
      if (String(request.confirmation || "") !== `PUBLISH ${courseId}`) throw new Error(`Publication requires confirmation text: PUBLISH ${courseId}`);
      const blockers = releaseBlockers(course, manifest, action);
      if (blockers.length) throw new Error(`Course publication is blocked: ${blockers.join(", ")}.`);
      if (!["approved", "published"].includes(previousStatus)) throw new Error("Course publication requires an approved release state.");
      nextStatus = "published";
      publishToAcademy = true;
      requiresPublicationTracking = true;
    }
    if (action === "unpublish") {
      if (String(request.confirmation || "") !== `UNPUBLISH ${courseId}`) throw new Error(`Unpublication requires confirmation text: UNPUBLISH ${courseId}`);
      nextStatus = "approved";
      publishToAcademy = false;
      requiresPublicationTracking = true;
    }
    if (action === "retire") {
      if (String(request.confirmation || "") !== `RETIRE ${courseId}`) throw new Error(`Retirement requires confirmation text: RETIRE ${courseId}`);
      nextStatus = "retired";
      publishToAcademy = false;
      requiresPublicationTracking = true;
    }
    if (action === "restore-draft") {
      if (String(request.confirmation || "") !== `RESTORE ${courseId}`) throw new Error(`Draft restoration requires confirmation text: RESTORE ${courseId}`);
      nextStatus = "draft";
      publishToAcademy = false;
    }

    manifest.release = {
      ...(manifest.release || {}),
      status: nextStatus,
      publishToAcademy,
      ownerControlledAt: nowIso(),
      ownerControlledBy: `owner-device://${os.hostname().toLowerCase()}/${os.userInfo().username}`,
      ownerControlNote: note,
    };
    const write = await writeManifest(courseId, manifest, current.fileSha, `Academy owner ${action}: ${courseId}`);
    if (!write.ok) return { ok: false, providerError: write };
    const verification = await verifyManifest(
      courseId,
      (value) => value.release?.status === nextStatus && value.release?.publishToAcademy === publishToAcademy,
      `release ${nextStatus} publishToAcademy=${publishToAcademy}`,
    );
    if (!verification.verified) {
      const result = { ok: false, state: "verification-failed", provider: write, readback: verification.readback };
      result.event = appendLedger({
        eventType: "course-release-transition",
        courseId,
        action,
        previousStatus,
        nextStatus,
        outcome: result.state,
        note,
        technicalDetail: result,
      });
      return result;
    }

    const commitSha = write.body?.commit?.sha;
    let publication = null;
    if (requiresPublicationTracking) {
      publication = createPublicationJob({
        courseId,
        action,
        commitSha,
        expectedPublished: publishToAcademy,
      });
    }
    const result = {
      ok: true,
      state: requiresPublicationTracking ? "provider-submitted" : "verified-success",
      provider: write,
      readback: verification.readback,
      publication,
      existingPurchaserAccessPreserved: action === "unpublish" || action === "retire",
    };
    result.event = appendLedger({
      eventType: "course-release-transition",
      courseId,
      action,
      previousStatus,
      nextStatus,
      publishToAcademy,
      outcome: result.state,
      note,
      publicationJobId: publication?.jobId || null,
      technicalDetail: result,
    });
    return result;
  }

  async function readPublishedCatalog() {
    const response = await githubRequest(`/repos/${repositoryName}/contents/catalog/academy-course-catalog.json?ref=${encodeURIComponent(branchName)}`);
    if (!response.ok) return response;
    try {
      const text = Buffer.from(String(response.body?.content || "").replace(/\s+/g, ""), "base64").toString("utf8");
      return { ...response, body: JSON.parse(text), rawBody: text };
    } catch (error) {
      return { ...response, ok: false, rawBody: `Published Academy catalog could not be decoded: ${safeMessage(error)}` };
    }
  }

  async function serviceRequest(connectorId, pathname, acceptedStatuses = [200]) {
    const value = connector(connectorId);
    const token = readSecret(value.credentialKey);
    return providerRequest({
      provider: connectorId,
      method: "GET",
      url: `${value.url}${pathname}`,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      acceptedStatuses,
    });
  }

  async function commerceHealth({ force = false } = {}) {
    const currentTime = Date.now();
    if (!force && commerceCache && currentTime - commerceCache.cachedAt < INVENTORY_TTL_MS) return commerceCache.value;
    const response = await serviceRequest("academy", "/api/academy/commerce-health", [200, 503]);
    const value = {
      ...response,
      operational: response.status === 200 && response.body?.operational === true,
      verified: response.status === 200 && response.body?.operational === true,
    };
    commerceCache = { cachedAt: currentTime, value };
    return value;
  }

  async function verifyPublicationReadback(courseId, expectedPublished) {
    const catalog = await readPublishedCatalog();
    if (!catalog.ok) return { verified: false, catalog, page: null, commerce: null };
    const courses = Array.isArray(catalog.body?.courses) ? catalog.body.courses : [];
    const catalogPublished = courses.some((course) => course.id === courseId);
    const page = expectedPublished
      ? await serviceRequest("website", `/academy/${encodeURIComponent(courseId)}`, [200])
      : await serviceRequest("website", `/academy/${encodeURIComponent(courseId)}`, [404, 410]);
    const commerce = await commerceHealth({ force: true });
    const verified =
      catalogPublished === expectedPublished &&
      page.ok === true &&
      (!expectedPublished || commerce.operational === true);
    return { verified, catalog, page, commerce };
  }

  async function findWorkflowRun(workflow, commitSha, startedAt, event) {
    const response = await githubRequest(
      `/repos/${repositoryName}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branchName)}&event=${encodeURIComponent(event)}&per_page=30`,
    );
    if (!response.ok) return response;
    const threshold = Date.parse(startedAt) - 5000;
    const runs = Array.isArray(response.body?.workflow_runs) ? response.body.workflow_runs : [];
    const run = runs.find((item) =>
      (commitSha && item.head_sha === commitSha) ||
      Date.parse(item.created_at || 0) >= threshold,
    );
    return { ...response, body: run || null };
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
      readback: null,
      error: null,
    });
    trackPublicationJob(job.jobId).catch(() => {});
    return job;
  }

  async function trackPublicationJob(jobId) {
    if (inFlightJobs.has(`publication:${jobId}`)) return inFlightJobs.get(`publication:${jobId}`);
    const promise = (async () => {
      let job = publicationJobs()[jobId];
      for (let attempt = 0; attempt < RUN_POLL_ATTEMPTS; attempt += 1) {
        const result = await findWorkflowRun(PUBLICATION_WORKFLOW, job.commitSha, job.createdAt, "push");
        if (!result.ok) {
          job = updatePublicationJob(jobId, { state: "failed", error: result, completedAt: nowIso() });
          appendLedger({ eventType: "publication-failed", courseId: job.courseId, action: job.action, outcome: job.state, technicalDetail: result });
          return job;
        }
        const run = result.body;
        if (!run) {
          updatePublicationJob(jobId, { state: "queued", pollAttempt: attempt + 1 });
        } else if (run.status !== "completed") {
          updatePublicationJob(jobId, { state: "running", workflowRunId: run.id, workflowUrl: run.html_url, workflowStatus: run.status, pollAttempt: attempt + 1 });
        } else if (run.conclusion !== "success") {
          job = updatePublicationJob(jobId, {
            state: "failed",
            workflowRunId: run.id,
            workflowUrl: run.html_url,
            workflowStatus: run.status,
            workflowConclusion: run.conclusion,
            error: { provider: "github-actions", status: run.conclusion, rawBody: `Publication workflow concluded with ${run.conclusion}.` },
            completedAt: nowIso(),
          });
          appendLedger({ eventType: "publication-failed", courseId: job.courseId, action: job.action, outcome: job.state, technicalDetail: job.error });
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
          appendLedger({ eventType: "publication-verified", courseId: job.courseId, action: job.action, outcome: job.state, technicalDetail: readback });
          invalidateInventory();
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
      }
      job = updatePublicationJob(jobId, {
        state: "verification-timeout",
        error: { provider: "github-actions", status: null, rawBody: "Publication verification timed out after 15 minutes." },
        completedAt: nowIso(),
      });
      appendLedger({ eventType: "publication-timeout", courseId: job.courseId, action: job.action, outcome: job.state, technicalDetail: job.error });
      return job;
    })().finally(() => inFlightJobs.delete(`publication:${jobId}`));
    inFlightJobs.set(`publication:${jobId}`, promise);
    return promise;
  }

  async function runCourseAction(payload) {
    assertOwnerEndpoint();
    const request = requireObject(payload, "Academy Studio action");
    const action = String(request.action || "").trim();
    const operation = ACTION_TO_OPERATION[action];
    if (!operation) throw new Error("Unsupported Academy Studio action.");
    const courseId = ["author", "revise", "build"].includes(action)
      ? requireCourseId(request.courseId)
      : String(request.courseId || "").trim() || null;
    const dispatch = await githubRequest(`/repos/${repositoryName}/actions/workflows/${STUDIO_WORKFLOW}/dispatches`, {
      method: "POST",
      body: {
        ref: branchName,
        inputs: {
          operation,
          course_id: courseId || "",
          video_provider: "synthesia",
          commit_generated_changes: "true",
        },
      },
      acceptedStatuses: [204],
    });
    if (!dispatch.ok) {
      const event = appendLedger({ eventType: "studio-action-failed", courseId, action, outcome: "failed", technicalDetail: dispatch });
      return { ok: false, providerError: dispatch, event };
    }
    const job = saveStudioJob({
      jobId: crypto.randomUUID(),
      action,
      operation,
      courseId,
      state: "queued",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      workflowRunId: null,
      workflowUrl: null,
      error: null,
    });
    trackStudioJob(job.jobId).catch(() => {});
    const event = appendLedger({ eventType: "studio-action-submitted", courseId, action, outcome: "provider-submitted", studioJobId: job.jobId, technicalDetail: dispatch });
    return { ok: true, state: "provider-submitted", job, provider: dispatch, event };
  }

  async function trackStudioJob(jobId) {
    if (inFlightJobs.has(`studio:${jobId}`)) return inFlightJobs.get(`studio:${jobId}`);
    const promise = (async () => {
      let job = studioJobs()[jobId];
      for (let attempt = 0; attempt < RUN_POLL_ATTEMPTS; attempt += 1) {
        const result = await findWorkflowRun(STUDIO_WORKFLOW, null, job.createdAt, "workflow_dispatch");
        if (!result.ok) return updateStudioJob(jobId, { state: "failed", error: result, completedAt: nowIso() });
        const run = result.body;
        if (!run) {
          updateStudioJob(jobId, { state: "queued", pollAttempt: attempt + 1 });
        } else if (run.status !== "completed") {
          updateStudioJob(jobId, { state: "running", workflowRunId: run.id, workflowUrl: run.html_url, workflowStatus: run.status, pollAttempt: attempt + 1 });
        } else {
          const state = run.conclusion === "success" ? "verified-success" : "failed";
          job = updateStudioJob(jobId, {
            state,
            workflowRunId: run.id,
            workflowUrl: run.html_url,
            workflowStatus: run.status,
            workflowConclusion: run.conclusion,
            error: state === "failed" ? { provider: "github-actions", status: run.conclusion, rawBody: `Studio workflow concluded with ${run.conclusion}.` } : null,
            completedAt: nowIso(),
          });
          appendLedger({ eventType: "studio-action-completed", courseId: job.courseId, action: job.action, outcome: job.state, technicalDetail: job });
          invalidateInventory();
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
      }
      job = updateStudioJob(jobId, { state: "verification-timeout", error: { provider: "github-actions", status: null, rawBody: "Studio action verification timed out after 15 minutes." }, completedAt: nowIso() });
      appendLedger({ eventType: "studio-action-timeout", courseId: job.courseId, action: job.action, outcome: job.state, technicalDetail: job.error });
      return job;
    })().finally(() => inFlightJobs.delete(`studio:${jobId}`));
    inFlightJobs.set(`studio:${jobId}`, promise);
    return promise;
  }

  async function stripeRequest(pathname) {
    const stripe = connector("stripe");
    const token = readSecret(stripe.credentialKey);
    if (!token) return { ok: false, provider: "stripe", method: "GET", url: `${stripe.url}${pathname}`, status: null, rawBody: "Stripe live secret key is not configured in Manage Publishes.", body: null, requestId: null, observedAt: nowIso() };
    return providerRequest({ provider: "stripe", method: "GET", url: `${stripe.url}${pathname}`, headers: { Authorization: `Bearer ${token}` }, acceptedStatuses: [200] });
  }

  async function clerkRequest(pathname) {
    const clerk = connector("clerk");
    const token = readSecret(clerk.credentialKey);
    if (!token) return { ok: false, provider: "clerk", method: "GET", url: `${clerk.url}${pathname}`, status: null, rawBody: "Clerk live secret key is not configured in Manage Publishes.", body: null, requestId: null, observedAt: nowIso() };
    return providerRequest({ provider: "clerk", method: "GET", url: `${clerk.url}${pathname}`, headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, acceptedStatuses: [200] });
  }

  async function listPurchases(payload) {
    const request = requireObject(payload, "Academy purchase query");
    const courseId = requireCourseId(request.courseId);
    const purchases = [];
    let startingAfter = null;
    for (let page = 0; page < 5; page += 1) {
      const parameters = new URLSearchParams({ limit: "100" });
      if (startingAfter) parameters.set("starting_after", startingAfter);
      const response = await stripeRequest(`/v1/checkout/sessions?${parameters.toString()}`);
      if (!response.ok) return { ok: false, courseId, providerError: response, purchases: [] };
      const data = Array.isArray(response.body?.data) ? response.body.data : [];
      for (const session of data) {
        if (session?.metadata?.courseId !== courseId) continue;
        purchases.push({
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
      if (response.body?.has_more !== true || !data.length) break;
      startingAfter = data.at(-1)?.id || null;
      if (!startingAfter) break;
    }
    return { ok: true, courseId, purchases, observedAt: nowIso() };
  }

  async function verifyPurchase(payload) {
    const request = requireObject(payload, "Academy purchase verification");
    const courseId = requireCourseId(request.courseId);
    const sessionId = String(request.sessionId || "").trim();
    if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId)) throw new Error("A canonical Stripe Checkout Session ID is required.");
    const stripe = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (!stripe.ok) return recordPurchaseResult(courseId, sessionId, { ok: false, state: "failed", stripe, clerk: null, commerce: null });
    const session = stripe.body || {};
    if (session.payment_status !== "paid") return recordPurchaseResult(courseId, sessionId, { ok: false, state: "payment-not-paid", stripe, clerk: null, commerce: null, reason: `Stripe reports payment_status=${session.payment_status || "unknown"}.` });
    if (session.metadata?.courseId !== courseId) return recordPurchaseResult(courseId, sessionId, { ok: false, state: "course-mismatch", stripe, clerk: null, commerce: null, reason: `Stripe metadata courseId=${session.metadata?.courseId || "missing"}.` });
    const commerce = await commerceHealth({ force: true });
    const clerkUserId = String(session.metadata?.clerkUserId || "").trim();
    if (!clerkUserId) return recordPurchaseResult(courseId, sessionId, { ok: false, state: "paid-pending-account-claim", stripe, clerk: null, commerce, reason: "Stripe confirms payment, but no Clerk user is bound. Access remains pending the purchaser-email claim workflow." });
    const clerk = await clerkRequest(`/v1/users/${encodeURIComponent(clerkUserId)}`);
    if (!clerk.ok) return recordPurchaseResult(courseId, sessionId, { ok: false, state: "failed", stripe, clerk, commerce });
    const entitlement = clerk.body?.private_metadata?.academy?.entitlements?.[courseId];
    const verified =
      stripe.status === 200 &&
      clerk.status === 200 &&
      commerce.operational === true &&
      entitlement?.paymentReference === sessionId;
    return recordPurchaseResult(courseId, sessionId, {
      ok: verified,
      state: verified ? "verified-success" : "entitlement-readback-failed",
      stripe,
      clerk,
      commerce,
      entitlement: entitlement || null,
      reason: verified
        ? "Stripe reports paid, Clerk readback contains the exact course entitlement and payment reference, and Academy commerce health is operational."
        : "The paid Stripe session was not confirmed by an exact Clerk entitlement readback and operational Academy commerce health.",
    });
  }

  function recordPurchaseResult(courseId, sessionId, result) {
    result.event = appendLedger({
      eventType: result.ok ? "purchase-verified" : result.state === "paid-pending-account-claim" ? "purchase-verification-pending" : "purchase-verification-failed",
      courseId,
      action: "verify-purchase",
      outcome: result.state,
      provider: "stripe+clerk+academy",
      sessionId,
      technicalDetail: result,
    });
    return result;
  }

  async function snapshot() {
    const inventory = await loadInventory();
    const commerce = await commerceHealth();
    return {
      ...inventory,
      commerce,
      publicationJobs: publicationJobs(),
      studioJobs: studioJobs(),
      ledger: ledger(100),
      generatedAt: nowIso(),
      claimBoundary:
        "Installed-anywhere course control reads and mutates the configured GitHub branch through authenticated provider APIs. Publication and paid access become verified only after independent provider readback.",
    };
  }

  function resumeTracking() {
    for (const job of Object.values(publicationJobs())) {
      if (["queued", "running"].includes(job.state)) trackPublicationJob(job.jobId).catch(() => {});
    }
    for (const job of Object.values(studioJobs())) {
      if (["queued", "running"].includes(job.state)) trackStudioJob(job.jobId).catch(() => {});
    }
  }

  resumeTracking();

  return {
    snapshot,
    updateReview,
    transitionCourse,
    runCourseAction,
    listPurchases,
    verifyPurchase,
    commerceHealth,
    publicationJobs,
    studioJobs,
    ledger,
    mode: "github-remote-control",
  };
}

module.exports = { createAcademyRemoteCourseControl };
