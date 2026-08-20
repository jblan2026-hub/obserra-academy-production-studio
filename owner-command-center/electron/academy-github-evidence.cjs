const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { stableHash } = require("./academy-release-approval.cjs");

const DEFAULT_REPOSITORY = "jblan2026-hub/obserra-academy-production-studio";
const DEFAULT_BRANCH = "agent/academy-36-worker-hollywood-production";
const DEFAULT_WORKFLOW = "academy-36-worker-hollywood-production.yml";
const DEFAULT_OWNER_LOGIN = "jblan2026-hub";
const DEFAULT_APPROVAL_ISSUE = 27;
const API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_SELECTED_BYTES = 80 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10000;
const CACHE_SCHEMA_VERSION = "1.0";
const DECISION_MARKER = "<!-- OBSERRA_OWNER_RELEASE_DECISION_V1 -->";

const SELECTED_EVIDENCE_PATHS = Object.freeze([
  "catalog/academy-hollywood-provider-preflight.json",
  "catalog/academy-hollywood-course-audit.json",
  "catalog/academy-hollywood-checkpoint-restore.json",
  "catalog/academy-hollywood-parallel-summary.json",
  "catalog/academy-hollywood-compliance-staging.json",
  "catalog/academy-hollywood-media-submission.json",
  "catalog/academy-release-approval-gate.json",
  "catalog/learner-catalog-readiness.json",
]);

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cacheDirectory(app) {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return path.join(localAppData, "Obserra", "OwnerCommandCenter", "academy-evidence-cache");
  return path.join(app.getPath("userData"), "academy-evidence-cache");
}

function normalizedRepository(value) {
  const repository = String(value || DEFAULT_REPOSITORY).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Academy GitHub repository must use owner/name format.");
  }
  return repository;
}

function normalizeZipPath(value) {
  const name = String(value || "").replaceAll("\\", "/");
  if (!name || name.startsWith("/") || /^[A-Za-z]:\//.test(name)) throw new Error("Artifact contains an unsafe absolute path.");
  const segments = name.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("Artifact contains an unsafe traversal path.");
  return segments.join("/");
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Artifact ZIP end-of-central-directory record was not found.");
}

function extractSelectedZipEntries(buffer, selectedPaths = SELECTED_EVIDENCE_PATHS) {
  if (!Buffer.isBuffer(buffer)) throw new Error("Artifact ZIP must be a Buffer.");
  if (buffer.length > MAX_ARTIFACT_BYTES) throw new Error("Artifact ZIP exceeds the governed size limit.");
  const selected = new Set(selectedPaths.map(normalizeZipPath));
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) throw new Error("Multi-disk ZIP artifacts are not supported.");
  if (totalEntries > MAX_ZIP_ENTRIES) throw new Error("Artifact ZIP contains too many entries.");
  if (centralOffset + centralSize > buffer.length) throw new Error("Artifact ZIP central directory is out of bounds.");

  const output = new Map();
  let totalSelectedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Artifact ZIP central directory entry is invalid.");
    }
    const generalPurposeFlags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + fileNameLength + extraLength + commentLength;
    if (entryEnd > buffer.length) throw new Error("Artifact ZIP central directory entry exceeds the archive boundary.");
    const fileName = normalizeZipPath(buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8"));
    offset = entryEnd;

    if (!selected.has(fileName)) continue;
    if ((generalPurposeFlags & 0x1) !== 0) throw new Error(`Encrypted ZIP entry is not supported: ${fileName}`);
    if (![0, 8].includes(compressionMethod)) throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${fileName}.`);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`Artifact evidence entry exceeds the governed size limit: ${fileName}`);
    if (compressedSize > MAX_ARTIFACT_BYTES) throw new Error(`Artifact evidence compressed entry exceeds the governed size limit: ${fileName}`);
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Artifact ZIP local header is invalid: ${fileName}`);
    }
    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > buffer.length) throw new Error(`Artifact ZIP data is out of bounds: ${fileName}`);
    const compressed = buffer.subarray(dataOffset, dataEnd);
    const content = compressionMethod === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    if (content.length !== uncompressedSize) throw new Error(`Artifact ZIP size mismatch: ${fileName}`);
    if (crc32(content) !== expectedCrc) throw new Error(`Artifact ZIP CRC mismatch: ${fileName}`);
    totalSelectedBytes += content.length;
    if (totalSelectedBytes > MAX_SELECTED_BYTES) throw new Error("Selected artifact evidence exceeds the governed aggregate size limit.");
    output.set(fileName, content);
  }
  return output;
}

function safeErrorMessage(error) {
  return String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").slice(0, 1200);
}

function parseGitHubApiError(status, payload) {
  const message = typeof payload === "object" && payload ? payload.message : null;
  return `GitHub API request failed with status ${status}${message ? `: ${String(message).slice(0, 500)}` : ""}`;
}

function createAcademyGithubEvidence({
  store,
  safeStorage,
  app,
  repository = process.env.OBSERRA_ACADEMY_GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  branch = process.env.OBSERRA_ACADEMY_GITHUB_BRANCH || DEFAULT_BRANCH,
  workflow = process.env.OBSERRA_ACADEMY_GITHUB_WORKFLOW || DEFAULT_WORKFLOW,
  ownerLogin = process.env.OBSERRA_OWNER_GITHUB_LOGIN || DEFAULT_OWNER_LOGIN,
  approvalIssue = Number(process.env.ACADEMY_RELEASE_APPROVAL_ISSUE || DEFAULT_APPROVAL_ISSUE),
} = {}) {
  if (!store || !safeStorage || !app) throw new Error("GitHub Academy evidence dependencies are required.");
  const repositoryName = normalizedRepository(repository);
  const branchName = String(branch || DEFAULT_BRANCH).trim();
  const workflowName = String(workflow || DEFAULT_WORKFLOW).trim();
  const expectedOwnerLogin = String(ownerLogin || DEFAULT_OWNER_LOGIN).trim().toLowerCase();
  if (!branchName || !workflowName || !expectedOwnerLogin) throw new Error("GitHub Academy evidence configuration is incomplete.");
  if (!Number.isInteger(approvalIssue) || approvalIssue < 1) throw new Error("Academy approval issue number is invalid.");

  const root = cacheDirectory(app);
  const catalogRoot = path.join(root, "catalog");
  const metadataPath = path.join(root, "sync-metadata.json");
  const submissionPath = path.join(root, "catalog", "academy-owner-release-decision-submission.json");
  let syncInFlight = null;

  function encryptedTokenConfigured() {
    return typeof store.get("secrets.githubToken") === "string";
  }

  function githubToken() {
    const encrypted = store.get("secrets.githubToken");
    if (typeof encrypted !== "string" || !encrypted) throw new Error("GitHub owner token is not configured in the Command Center.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is required for GitHub evidence synchronization.");
    const token = safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim();
    if (!token) throw new Error("The configured GitHub owner token is empty.");
    return token;
  }

  async function githubRequest(endpoint, { method = "GET", body = null, accept = "application/vnd.github+json", timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const token = githubToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`https://api.github.com${endpoint}`, {
        method,
        redirect: "follow",
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "Obserra-Owner-Command-Center",
          "X-GitHub-Api-Version": API_VERSION,
        },
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw new Error(`GitHub API request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function githubJson(endpoint, options = {}) {
    const response = await githubRequest(endpoint, options);
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { message: text.slice(0, 1000) }; }
    }
    if (!response.ok) throw new Error(parseGitHubApiError(response.status, payload));
    return payload;
  }

  async function currentOwner() {
    const user = await githubJson("/user");
    const login = String(user?.login || "").toLowerCase();
    if (login !== expectedOwnerLogin) throw new Error(`Configured GitHub token belongs to ${login || "an unknown user"}; required owner is ${expectedOwnerLogin}.`);
    return { login: user.login, id: user.id };
  }

  async function selectLatestArtifact() {
    const runs = await githubJson(
      `/repos/${repositoryName}/actions/workflows/${encodeURIComponent(workflowName)}/runs?branch=${encodeURIComponent(branchName)}&per_page=20`,
    );
    const candidates = (runs?.workflow_runs || [])
      .filter((run) => run?.status === "completed")
      .sort((left, right) => Date.parse(right.updated_at || right.created_at || 0) - Date.parse(left.updated_at || left.created_at || 0));
    if (candidates.length === 0) throw new Error("No completed Academy production workflow run is available for evidence synchronization.");

    for (const run of candidates) {
      const artifacts = await githubJson(`/repos/${repositoryName}/actions/runs/${run.id}/artifacts?per_page=100`);
      const artifact = (artifacts?.artifacts || [])
        .filter((item) => item?.expired !== true && String(item?.name || "").startsWith("academy-36-worker-production-"))
        .sort((left, right) => Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0))[0];
      if (artifact) return { run, artifact };
    }
    throw new Error("Completed Academy production runs do not contain an unexpired governed evidence artifact.");
  }

  async function downloadArtifact(artifact) {
    const response = await githubRequest(`/repos/${repositoryName}/actions/artifacts/${artifact.id}/zip`, {
      accept: "application/octet-stream",
      timeoutMs: 120000,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(parseGitHubApiError(response.status, { message: text.slice(0, 1000) }));
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_ARTIFACT_BYTES) throw new Error("Academy evidence artifact exceeds the governed download size limit.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ARTIFACT_BYTES) throw new Error("Academy evidence artifact exceeds the governed download size limit.");
    const digest = sha256(buffer);
    const advertisedDigest = String(artifact.digest || "").trim();
    if (advertisedDigest.startsWith("sha256:") && advertisedDigest.slice(7).toLowerCase() !== digest) {
      throw new Error("Academy evidence artifact SHA-256 digest does not match GitHub metadata.");
    }
    return { buffer, digest };
  }

  function validateEvidenceJson(fileName, content) {
    let value;
    try { value = JSON.parse(content.toString("utf8")); }
    catch { throw new Error(`Academy evidence file is not valid JSON: ${fileName}`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Academy evidence file must contain a JSON object: ${fileName}`);
    if (fileName.endsWith("academy-release-approval-gate.json")) {
      if (value.schemaVersion !== "1.1") throw new Error("Academy release-approval gate uses an unsupported schema.");
      if (value.publicationAuthorized !== false || value.checkoutAuthorized !== false) {
        throw new Error("Academy release-approval gate must not grant publication or checkout authority.");
      }
    }
    return value;
  }

  async function synchronize() {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      const startedAt = new Date().toISOString();
      try {
        const owner = await currentOwner();
        const { run, artifact } = await selectLatestArtifact();
        const { buffer, digest } = await downloadArtifact(artifact);
        const entries = extractSelectedZipEntries(buffer);
        const gateEntry = entries.get("catalog/academy-release-approval-gate.json");
        if (!gateEntry) throw new Error("Governed Academy artifact does not contain the release-approval gate.");

        const written = [];
        const evidenceHashes = {};
        for (const [fileName, content] of entries.entries()) {
          validateEvidenceJson(fileName, content);
          const destination = path.join(root, ...fileName.split("/"));
          fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
          const temporaryPath = `${destination}.${process.pid}.${Date.now()}.tmp`;
          fs.writeFileSync(temporaryPath, content, { mode: 0o600 });
          fs.renameSync(temporaryPath, destination);
          written.push(fileName);
          evidenceHashes[fileName] = sha256(content);
        }

        const gate = JSON.parse(gateEntry.toString("utf8"));
        const metadata = {
          schemaVersion: CACHE_SCHEMA_VERSION,
          synchronizedAt: new Date().toISOString(),
          startedAt,
          repository: repositoryName,
          branch: branchName,
          workflow: workflowName,
          owner,
          run: {
            id: run.id,
            runNumber: run.run_number,
            runAttempt: run.run_attempt,
            status: run.status,
            conclusion: run.conclusion,
            event: run.event,
            headBranch: run.head_branch,
            headSha: run.head_sha,
            createdAt: run.created_at,
            updatedAt: run.updated_at,
          },
          artifact: {
            id: artifact.id,
            name: artifact.name,
            sizeInBytes: artifact.size_in_bytes,
            advertisedDigest: artifact.digest || null,
            downloadedSha256: digest,
            createdAt: artifact.created_at,
            expiresAt: artifact.expires_at,
          },
          writtenEvidenceFiles: written.sort(),
          evidenceHashes,
          gateHash: stableHash(gate),
          gateGeneratedAt: gate.generatedAt || null,
          expectedCourses: gate.expectedCourses || null,
          stagedCourses: gate.stagedCourses || 0,
          blockedCourses: gate.blockedCourses || 0,
          allStagedForOwnerApproval: gate.allStagedForOwnerApproval === true,
          publicationAuthorized: false,
          checkoutAuthorized: false,
          claimBoundary: "Synchronization proves retrieval and integrity validation of the latest available governed GitHub Actions evidence artifact. It does not make an incomplete course ready, record owner approval, publish courses, or enable checkout.",
        };
        atomicWriteJson(metadataPath, metadata);
        store.set("academy.githubEvidence", {
          synchronizedAt: metadata.synchronizedAt,
          runId: run.id,
          artifactId: artifact.id,
          gateHash: metadata.gateHash,
          stagedCourses: metadata.stagedCourses,
          expectedCourses: metadata.expectedCourses,
        });
        return { ok: true, cacheRoot: root, ...metadata };
      } catch (error) {
        const failure = {
          schemaVersion: CACHE_SCHEMA_VERSION,
          synchronizedAt: new Date().toISOString(),
          startedAt,
          repository: repositoryName,
          branch: branchName,
          workflow: workflowName,
          ok: false,
          error: safeErrorMessage(error),
        };
        store.set("academy.githubEvidenceFailure", failure);
        throw error;
      } finally {
        syncInFlight = null;
      }
    })();
    return syncInFlight;
  }

  function evidenceRoot() {
    const gatePath = path.join(catalogRoot, "academy-release-approval-gate.json");
    return fs.existsSync(gatePath) ? root : null;
  }

  function snapshot() {
    let metadata = null;
    let metadataError = null;
    if (fs.existsSync(metadataPath)) {
      try { metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")); }
      catch (error) { metadataError = safeErrorMessage(error); }
    }
    const gatePath = path.join(catalogRoot, "academy-release-approval-gate.json");
    let gate = null;
    let gateError = null;
    if (fs.existsSync(gatePath)) {
      try { gate = JSON.parse(fs.readFileSync(gatePath, "utf8")); }
      catch (error) { gateError = safeErrorMessage(error); }
    }
    let submission = null;
    if (fs.existsSync(submissionPath)) {
      try { submission = JSON.parse(fs.readFileSync(submissionPath, "utf8")); }
      catch {}
    }
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      repository: repositoryName,
      branch: branchName,
      workflow: workflowName,
      approvalIssue,
      expectedOwnerLogin,
      tokenConfigured: encryptedTokenConfigured(),
      cacheRoot: root,
      evidenceAvailable: Boolean(gate),
      metadata,
      metadataError,
      gateError,
      gate: gate
        ? {
            gateHash: stableHash(gate),
            generatedAt: gate.generatedAt || null,
            expectedCourses: gate.expectedCourses || null,
            stagedCourses: gate.stagedCourses || 0,
            blockedCourses: gate.blockedCourses || 0,
            progressPercent: gate.progressPercent || 0,
            allStagedForOwnerApproval: gate.allStagedForOwnerApproval === true,
            ownerDecisionRequired: gate.ownerDecisionRequired === true,
            publicationAuthorized: gate.publicationAuthorized === true,
            checkoutAuthorized: gate.checkoutAuthorized === true,
          }
        : null,
      submission,
      lastFailure: store.get("academy.githubEvidenceFailure") || null,
      claimBoundary: "The remote-evidence cache is read-only production evidence. Owner decisions are stored separately and cannot publish courses or enable checkout.",
    };
  }

  async function submitDecision(decision) {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw new Error("A device-bound owner decision is required for GitHub submission.");
    if (!fs.existsSync(path.join(catalogRoot, "academy-release-approval-gate.json"))) throw new Error("Synchronized release-approval gate evidence is unavailable.");
    const gate = JSON.parse(fs.readFileSync(path.join(catalogRoot, "academy-release-approval-gate.json"), "utf8"));
    const gateHash = stableHash(gate);
    if (decision.gateHash !== gateHash) throw new Error("Owner decision does not match the synchronized release-approval gate hash.");
    if (!new Set(["approve", "reject", "revise"]).has(decision.decision)) throw new Error("Owner decision is invalid.");
    if (decision.publicationAuthorized !== false || decision.checkoutAuthorized !== false) throw new Error("Owner decision must not grant publication or checkout authority.");
    if (!decision.signature || decision.signatureAlgorithm !== "hmac-sha256-device-bound") throw new Error("Owner decision is missing its device-bound signature.");
    const owner = await currentOwner();

    const publicRecord = {
      schemaVersion: decision.schemaVersion,
      decisionId: decision.decisionId,
      decidedAt: decision.decidedAt,
      decision: decision.decision,
      note: decision.note,
      gateHash: decision.gateHash,
      gateGeneratedAt: decision.gateGeneratedAt,
      portfolioDefinition: decision.portfolioDefinition,
      expectedCourses: decision.expectedCourses,
      stagedCourses: decision.stagedCourses,
      blockedCourses: decision.blockedCourses,
      stagedCourseIds: decision.stagedCourseIds,
      owner: decision.owner,
      endpoint: decision.endpoint,
      approvalScope: decision.approvalScope,
      publicationAuthorized: false,
      checkoutAuthorized: false,
      pricingChangeAuthorized: false,
      learnerAccessAuthorized: false,
      releaseExecutionRequired: decision.releaseExecutionRequired === true,
      releaseExecutionCompleted: false,
      signatureAlgorithm: decision.signatureAlgorithm,
      signature: decision.signature,
      submittedByGitHubOwner: owner.login,
    };
    const body = [
      DECISION_MARKER,
      `# Obserra Academy owner release decision: ${String(decision.decision).toUpperCase()}`,
      "",
      `- Decision ID: \`${decision.decisionId}\``,
      `- Exact gate hash: \`${decision.gateHash}\``,
      `- Portfolio: **${decision.stagedCourses}/${decision.expectedCourses} staged**, ${decision.blockedCourses} blocked`,
      `- Enrolled endpoint: \`${decision.endpoint?.deviceId || "unknown"}\` on \`${decision.endpoint?.hostname || "unknown"}\``,
      `- Publication authorized by this decision: **NO**`,
      `- Checkout authorized by this decision: **NO**`,
      `- Separate governed release execution required: **${decision.releaseExecutionRequired ? "YES" : "NO"}**`,
      "",
      "```json",
      JSON.stringify(publicRecord, null, 2),
      "```",
      "",
      "This authenticated owner decision applies only to the exact staged gate hash above. It does not itself publish courses, enable checkout, change pricing, or grant learner access.",
    ].join("\n");
    if (body.length > 60000) throw new Error("Owner decision submission exceeds the governed GitHub comment size limit.");

    const response = await githubJson(`/repos/${repositoryName}/issues/${approvalIssue}/comments`, {
      method: "POST",
      body: { body },
    });
    const receipt = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      submittedAt: new Date().toISOString(),
      repository: repositoryName,
      issueNumber: approvalIssue,
      issueCommentId: response.id,
      issueCommentUrl: response.html_url,
      submittedBy: owner.login,
      decisionId: decision.decisionId,
      decision: decision.decision,
      gateHash,
      publicationAuthorized: false,
      checkoutAuthorized: false,
      releaseExecutionCompleted: false,
      claimBoundary: "This receipt proves the signed owner decision was posted through the authenticated GitHub owner account. It does not prove release execution or publication.",
    };
    atomicWriteJson(submissionPath, receipt);
    store.set("academy.githubDecisionSubmission", receipt);
    return receipt;
  }

  return {
    synchronize,
    snapshot,
    submitDecision,
    evidenceRoot,
    cacheRoot: root,
    metadataPath,
    submissionPath,
  };
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  DECISION_MARKER,
  DEFAULT_APPROVAL_ISSUE,
  DEFAULT_BRANCH,
  DEFAULT_OWNER_LOGIN,
  DEFAULT_REPOSITORY,
  DEFAULT_WORKFLOW,
  SELECTED_EVIDENCE_PATHS,
  cacheDirectory,
  createAcademyGithubEvidence,
  crc32,
  extractSelectedZipEntries,
  normalizeZipPath,
};
