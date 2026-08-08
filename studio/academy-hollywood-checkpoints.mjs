import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");

export const AUTHORING_POLICY_VERSION = "2026.08.08.1";
export const PRODUCTION_CONTRACT_VERSION = "academy-hollywood-production-contract-1.0";
const COURSE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,120}$/;
const REQUIRED_VALUES = new Set(["1", "true", "yes", "on"]);
const CHECKPOINT_AUDIENCE = "obserra-academy-checkpoint";

export function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function authoringSourceHash(manifest) {
  return stableHash({
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    productionContractVersion: PRODUCTION_CONTRACT_VERSION,
    manifest,
  });
}

export function authoringPackageHash(envelope) {
  return stableHash(envelope);
}

export function checkpointsRequired() {
  return REQUIRED_VALUES.has(
    String(process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED ?? "true").trim().toLowerCase(),
  );
}

function organizationKey() {
  const value = String(process.env.STUDIO_OWNER_ORGANIZATION_ID ?? "").trim();
  if (!value || value.length > 200) {
    throw new Error("STUDIO_OWNER_ORGANIZATION_ID is required for protected Academy checkpoints.");
  }
  return value;
}

function courseSlug(value) {
  const normalized = String(value ?? "").trim();
  if (!COURSE_ID_PATTERN.test(normalized)) throw new Error("Invalid Academy course identifier for checkpoint operation.");
  return normalized;
}

function checkpointGatewayUrl() {
  const raw = String(process.env.ACADEMY_CHECKPOINT_GATEWAY_URL ?? "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ACADEMY_CHECKPOINT_GATEWAY_URL is invalid.");
  }
  if (parsed.protocol !== "https:") throw new Error("Protected Academy checkpoint gateway must use HTTPS.");
  return parsed.toString();
}

async function githubOidcToken() {
  const requestUrl = String(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "").trim();
  const requestToken = String(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "").trim();
  if (!requestUrl || !requestToken) {
    throw new Error("GitHub Actions OIDC credentials are unavailable for protected Academy checkpoints.");
  }
  const url = new URL(requestUrl);
  url.searchParams.set("audience", CHECKPOINT_AUDIENCE);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${requestToken}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub OIDC token request failed with ${response.status}: ${text.slice(0, 600)}`);
  const payload = JSON.parse(text);
  if (!payload?.value || typeof payload.value !== "string") throw new Error("GitHub OIDC token response did not contain a token.");
  return payload.value;
}

async function gatewayRequest(body) {
  const gateway = checkpointGatewayUrl();
  if (!gateway) throw new Error("Protected Academy checkpoint gateway is not configured.");
  const token = await githubOidcToken();
  const response = await fetch(gateway, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { error: text.slice(0, 1000) }; }
  if (!response.ok) {
    throw new Error(`Protected checkpoint gateway failed with ${response.status}: ${payload?.error ?? text.slice(0, 1000)}`);
  }
  return payload;
}

function databaseUrl() {
  const raw = String(process.env.DATABASE_URL ?? "").trim();
  if (!raw) {
    if (checkpointsRequired() && !checkpointGatewayUrl()) throw new Error("DATABASE_URL or ACADEMY_CHECKPOINT_GATEWAY_URL is required for protected Academy checkpoints.");
    return null;
  }
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("DATABASE_URL is invalid for protected Academy checkpoints."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Protected Academy checkpoints require PostgreSQL.");
  return raw;
}

async function createPrismaClient() {
  const url = databaseUrl();
  if (!url) return null;
  const module = await import("@prisma/client");
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  if (!PrismaClient) throw new Error("PrismaClient is unavailable for protected Academy checkpoints.");
  return new PrismaClient();
}

export async function bootstrapHollywoodCheckpointTable() {
  if (checkpointGatewayUrl()) {
    const result = await gatewayRequest({ action: "health" });
    if (result?.ready !== true) throw new Error("Protected Academy checkpoint gateway health check did not report ready.");
    return { bootstrapped: true, transport: "github-oidc-supabase" };
  }
  const prisma = await createPrismaClient();
  if (!prisma) return { bootstrapped: false, reason: "database-not-configured" };
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AcademyHollywoodAuthoringCheckpoint" (
        "id" text PRIMARY KEY,
        "organizationKey" text NOT NULL,
        "courseSlug" text NOT NULL,
        "sourceManifestHash" text NOT NULL,
        "authoringPolicyVersion" text NOT NULL,
        "productionContractVersion" text NOT NULL,
        "provider" text NOT NULL,
        "model" text NOT NULL,
        "packageHash" text NOT NULL,
        "package" jsonb NOT NULL,
        "reviewStatus" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "AcademyHollywoodCheckpoint_identity_key"
      ON "AcademyHollywoodAuthoringCheckpoint" (
        "organizationKey", "courseSlug", "sourceManifestHash",
        "authoringPolicyVersion", "productionContractVersion"
      )
    `);
    const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public."AcademyHollywoodAuthoringCheckpoint"')::text AS checkpoint_table`);
    if (!rows?.[0]?.checkpoint_table) throw new Error("Protected Academy checkpoint table verification failed.");
    return { bootstrapped: true, transport: "postgresql" };
  } finally {
    await prisma.$disconnect();
  }
}

export function validateHollywoodEnvelope({ courseId, envelope, manifest }) {
  const normalizedCourseId = courseSlug(courseId);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error(`Checkpoint for ${normalizedCourseId} is not a valid object.`);
  const expectedManifestHash = authoringSourceHash(manifest);
  if (envelope.schemaVersion !== "2.0") throw new Error(`Checkpoint for ${normalizedCourseId} uses an unsupported schema.`);
  if (envelope.courseId !== normalizedCourseId) throw new Error(`Checkpoint course identity mismatch for ${normalizedCourseId}.`);
  if (envelope.authoringPolicyVersion !== AUTHORING_POLICY_VERSION) throw new Error(`Checkpoint policy mismatch for ${normalizedCourseId}.`);
  if (envelope.productionContractVersion !== PRODUCTION_CONTRACT_VERSION) throw new Error(`Checkpoint production contract mismatch for ${normalizedCourseId}.`);
  if (envelope.sourceManifestHash !== expectedManifestHash) throw new Error(`Checkpoint manifest integrity mismatch for ${normalizedCourseId}.`);
  if (envelope.reviewStatus !== "draft-ai-generated-compliance-staging") throw new Error(`Checkpoint review status is invalid for ${normalizedCourseId}.`);
  if (envelope.publicationAuthorized !== false) throw new Error(`Checkpoint must not grant publication authority for ${normalizedCourseId}.`);
  if (!envelope.content || typeof envelope.content !== "object" || Array.isArray(envelope.content)) throw new Error(`Checkpoint content is missing for ${normalizedCourseId}.`);
  return { courseId: normalizedCourseId, expectedManifestHash, packageHash: authoringPackageHash(envelope) };
}

export async function persistHollywoodCheckpoint({ courseId, envelope, manifest }) {
  const identity = validateHollywoodEnvelope({ courseId, envelope, manifest });
  const ownerOrganization = organizationKey();
  if (checkpointGatewayUrl()) {
    const result = await gatewayRequest({
      action: "upsert",
      organizationKey: ownerOrganization,
      courseSlug: identity.courseId,
      sourceManifestHash: identity.expectedManifestHash,
      authoringPolicyVersion: AUTHORING_POLICY_VERSION,
      productionContractVersion: PRODUCTION_CONTRACT_VERSION,
      provider: String(envelope.provider ?? "unknown").slice(0, 100),
      model: String(envelope.model ?? "unknown").slice(0, 200),
      packageHash: identity.packageHash,
      package: envelope,
    });
    if (result?.stored !== true || result?.packageHash !== identity.packageHash) throw new Error(`Protected checkpoint gateway did not confirm storage for ${identity.courseId}.`);
    return { stored: true, courseId: identity.courseId, packageHash: identity.packageHash, transport: "github-oidc-supabase" };
  }

  const prisma = await createPrismaClient();
  if (!prisma) return { stored: false, reason: "database-not-configured" };
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AcademyHollywoodAuthoringCheckpoint" (
        "id", "organizationKey", "courseSlug", "sourceManifestHash",
        "authoringPolicyVersion", "productionContractVersion", "provider",
        "model", "packageHash", "package", "reviewStatus", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CAST($10 AS jsonb), $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationKey", "courseSlug", "sourceManifestHash", "authoringPolicyVersion", "productionContractVersion") DO UPDATE SET
        "provider" = EXCLUDED."provider", "model" = EXCLUDED."model", "packageHash" = EXCLUDED."packageHash",
        "package" = EXCLUDED."package", "reviewStatus" = EXCLUDED."reviewStatus", "updatedAt" = CURRENT_TIMESTAMP`,
      crypto.randomUUID(), ownerOrganization, identity.courseId, identity.expectedManifestHash,
      AUTHORING_POLICY_VERSION, PRODUCTION_CONTRACT_VERSION,
      String(envelope.provider ?? "unknown").slice(0, 100), String(envelope.model ?? "unknown").slice(0, 200),
      identity.packageHash, JSON.stringify(envelope), envelope.reviewStatus,
    );
    return { stored: true, courseId: identity.courseId, packageHash: identity.packageHash, transport: "postgresql" };
  } finally {
    await prisma.$disconnect();
  }
}

function atomicWritePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

async function fetchGatewayCheckpoint(courseId, manifest) {
  const identity = validateHollywoodEnvelope;
  const sourceManifestHash = authoringSourceHash(manifest);
  const result = await gatewayRequest({
    action: "fetch",
    organizationKey: organizationKey(),
    courseSlug: courseId,
    sourceManifestHash,
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    productionContractVersion: PRODUCTION_CONTRACT_VERSION,
  });
  if (!result?.checkpoint) return null;
  const envelope = result.checkpoint.package;
  const validated = identity({ courseId, envelope, manifest });
  if (result.checkpoint.packageHash !== validated.packageHash) throw new Error(`Stored checkpoint hash mismatch for ${courseId}.`);
  return envelope;
}

export async function restoreHollywoodCheckpoints() {
  const restoredCourseIds = [];
  let evaluated = 0;

  if (checkpointGatewayUrl()) {
    const entries = fs.readdirSync(coursesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && COURSE_ID_PATTERN.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      evaluated += 1;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const envelope = await fetchGatewayCheckpoint(entry.name, manifest);
      if (!envelope) continue;
      atomicWritePrivateJson(path.join(coursesRoot, entry.name, "generated", "authoring", "course-package.json"), envelope);
      restoredCourseIds.push(entry.name);
    }
  } else {
    const prisma = await createPrismaClient();
    if (!prisma) {
      const summary = { schemaVersion: "1.0", checkedAt: new Date().toISOString(), restored: 0, evaluated: 0, skipped: true, reason: "database-not-configured" };
      fs.mkdirSync(catalogRoot, { recursive: true });
      fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-checkpoint-restore.json"), `${JSON.stringify(summary, null, 2)}\n`);
      return summary;
    }
    const ownerOrganization = organizationKey();
    try {
      const entries = fs.readdirSync(coursesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && COURSE_ID_PATTERN.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
        if (!fs.existsSync(manifestPath)) continue;
        evaluated += 1;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const sourceManifestHash = authoringSourceHash(manifest);
        const rows = await prisma.$queryRawUnsafe(
          `SELECT "package", "packageHash" FROM "AcademyHollywoodAuthoringCheckpoint"
           WHERE "organizationKey" = $1 AND "courseSlug" = $2 AND "sourceManifestHash" = $3
             AND "authoringPolicyVersion" = $4 AND "productionContractVersion" = $5
           ORDER BY "updatedAt" DESC LIMIT 1`,
          ownerOrganization, entry.name, sourceManifestHash, AUTHORING_POLICY_VERSION, PRODUCTION_CONTRACT_VERSION,
        );
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const envelope = rows[0].package;
        const validated = validateHollywoodEnvelope({ courseId: entry.name, envelope, manifest });
        if (rows[0].packageHash !== validated.packageHash) throw new Error(`Stored checkpoint hash mismatch for ${entry.name}.`);
        atomicWritePrivateJson(path.join(coursesRoot, entry.name, "generated", "authoring", "course-package.json"), envelope);
        restoredCourseIds.push(entry.name);
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  const summary = {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    productionContractVersion: PRODUCTION_CONTRACT_VERSION,
    evaluated,
    restored: restoredCourseIds.length,
    restoredCourseIds,
    skipped: false,
    transport: checkpointGatewayUrl() ? "github-oidc-supabase" : "postgresql",
    claimBoundary: "Restoration proves matching protected checkpoint retrieval and package integrity only. It does not establish review approval, mastered media, or publication readiness.",
  };
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-checkpoint-restore.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
