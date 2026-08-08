import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkpointGatewayConfigured,
  checkpointTransportName,
  fetchCheckpointThroughGateway,
  persistCheckpointThroughGateway,
} from "./checkpoint-gateway.mjs";
import {
  commercialProductionStandard,
  commercialProductionStandardHash,
  contractHash,
  taskContract,
  workerPoolContract,
} from "./worker-pool-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");

export const AUTHORING_POLICY_VERSION = "2026.08.07.3";
const COURSE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,120}$/;
const CHECKPOINT_REQUIRED_VALUES = new Set(["1", "true", "yes", "on"]);
const governedTask = taskContract("protected-authoring");

export function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function authoringSourceHash(manifest, policyVersion = AUTHORING_POLICY_VERSION) {
  return stableHash({ authoringPolicyVersion: policyVersion, manifest });
}

export function authoringPackageHash(envelope) {
  return stableHash(envelope);
}

export function checkpointsRequired() {
  return CHECKPOINT_REQUIRED_VALUES.has(
    String(process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED ?? "false").trim().toLowerCase(),
  );
}

function normalizedOrganizationKey() {
  const value = String(process.env.STUDIO_OWNER_ORGANIZATION_ID ?? "").trim();
  if (!value || value.length > 200) {
    throw new Error("STUDIO_OWNER_ORGANIZATION_ID is required for protected authoring checkpoints.");
  }
  return value;
}

function validatedCourseId(value) {
  const courseId = String(value ?? "").trim();
  if (!COURSE_ID_PATTERN.test(courseId)) throw new Error("Invalid Academy course identifier for checkpoint operation.");
  return courseId;
}

function validatedDatabaseUrl() {
  const raw = String(process.env.DATABASE_URL ?? "").trim();
  if (!raw) {
    if (checkpointsRequired()) throw new Error("DATABASE_URL is required when the protected OIDC checkpoint gateway is not configured.");
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is invalid for protected authoring checkpoints.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Protected authoring checkpoints require PostgreSQL.");
  }
  return raw;
}

async function createPrismaClient() {
  const databaseUrl = validatedDatabaseUrl();
  if (!databaseUrl) return null;
  const module = await import("@prisma/client");
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  if (!PrismaClient) throw new Error("PrismaClient is unavailable for protected authoring checkpoints.");
  return new PrismaClient();
}

function assertStringArrayEqual(actual, expected, message) {
  if (!Array.isArray(actual)
      || actual.length !== expected.length
      || expected.some((value) => !actual.includes(value))) {
    throw new Error(message);
  }
}

export function validateAuthoringEnvelope({ courseId, envelope, manifest }) {
  const normalizedCourseId = validatedCourseId(courseId);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error(`Authoring checkpoint for ${normalizedCourseId} is not a valid object.`);
  }

  const expectedManifestHash = authoringSourceHash(manifest);
  if (envelope.schemaVersion !== "1.3") throw new Error(`Authoring checkpoint for ${normalizedCourseId} uses an unsupported schema.`);
  if (envelope.courseId !== normalizedCourseId) throw new Error(`Authoring checkpoint course identity mismatch for ${normalizedCourseId}.`);
  if (envelope.authoringPolicyVersion !== AUTHORING_POLICY_VERSION) {
    throw new Error(`Authoring checkpoint policy mismatch for ${normalizedCourseId}.`);
  }
  if (envelope.sourceManifestHash !== expectedManifestHash) {
    throw new Error(`Authoring checkpoint manifest integrity mismatch for ${normalizedCourseId}.`);
  }
  if (envelope.reviewStatus !== "draft-ai-generated") {
    throw new Error(`Authoring checkpoint review status is invalid for ${normalizedCourseId}.`);
  }
  if (envelope.commercialQualityStatus !== commercialProductionStandard.claimPolicy.interimLabel) {
    throw new Error(`Authoring checkpoint commercial quality status is invalid for ${normalizedCourseId}.`);
  }
  if (!envelope.content || typeof envelope.content !== "object" || Array.isArray(envelope.content)) {
    throw new Error(`Authoring checkpoint content is missing for ${normalizedCourseId}.`);
  }

  if (envelope.workerContract?.contractId !== workerPoolContract.contractId
      || envelope.workerContract?.contractHash !== contractHash()
      || envelope.workerContract?.taskType !== governedTask.taskType
      || envelope.workerContract?.role !== governedTask.role
      || envelope.workerContract?.workstream !== governedTask.workstream) {
    throw new Error(`Authoring checkpoint worker contract mismatch for ${normalizedCourseId}.`);
  }
  assertStringArrayEqual(
    envelope.workerContract?.appliedRules,
    governedTask.appliedRules,
    `Authoring checkpoint applied rule mismatch for ${normalizedCourseId}.`,
  );

  if (envelope.productionStandard?.standardId !== commercialProductionStandard.standardId
      || envelope.productionStandard?.standardHash !== commercialProductionStandardHash()
      || envelope.productionStandard?.qualityTier !== commercialProductionStandard.qualityTier
      || envelope.productionStandard?.qualityClaimAllowed !== false) {
    throw new Error(`Authoring checkpoint production standard mismatch for ${normalizedCourseId}.`);
  }

  return {
    courseId: normalizedCourseId,
    expectedManifestHash,
    packageHash: authoringPackageHash(envelope),
    contractHash: contractHash(),
    productionStandardHash: commercialProductionStandardHash(),
  };
}

export async function persistAuthoringCheckpoint({ courseId, envelope, manifest }) {
  const identity = validateAuthoringEnvelope({ courseId, envelope, manifest });
  const organizationKey = normalizedOrganizationKey();

  if (checkpointGatewayConfigured()) {
    const gatewayResult = await persistCheckpointThroughGateway({
      organizationKey,
      courseSlug: identity.courseId,
      sourceManifestHash: identity.expectedManifestHash,
      authoringPolicyVersion: AUTHORING_POLICY_VERSION,
      provider: String(envelope.provider ?? "unknown").slice(0, 100),
      model: String(envelope.model ?? "unknown").slice(0, 200),
      packageHash: identity.packageHash,
      envelope,
    });
    return {
      ...gatewayResult,
      contractHash: identity.contractHash,
      productionStandardHash: identity.productionStandardHash,
    };
  }

  const prisma = await createPrismaClient();
  if (!prisma) return { stored: false, reason: "database-not-configured" };

  const id = crypto.randomUUID();
  const payload = JSON.stringify(envelope);

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuthoringCheckpoint" (
        "id", "organizationKey", "courseSlug", "sourceManifestHash",
        "authoringPolicyVersion", "provider", "model", "packageHash",
        "package", "reviewStatus", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CAST($9 AS jsonb), $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationKey", "courseSlug", "sourceManifestHash", "authoringPolicyVersion")
      DO UPDATE SET
        "provider" = EXCLUDED."provider",
        "model" = EXCLUDED."model",
        "packageHash" = EXCLUDED."packageHash",
        "package" = EXCLUDED."package",
        "reviewStatus" = EXCLUDED."reviewStatus",
        "updatedAt" = CURRENT_TIMESTAMP`,
      id,
      organizationKey,
      identity.courseId,
      identity.expectedManifestHash,
      AUTHORING_POLICY_VERSION,
      String(envelope.provider ?? "unknown").slice(0, 100),
      String(envelope.model ?? "unknown").slice(0, 200),
      identity.packageHash,
      payload,
      envelope.reviewStatus,
    );
    return {
      stored: true,
      courseId: identity.courseId,
      packageHash: identity.packageHash,
      contractHash: identity.contractHash,
      productionStandardHash: identity.productionStandardHash,
      transport: "direct-postgresql",
    };
  } finally {
    await prisma.$disconnect();
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWritePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function courseManifestEntries() {
  return fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && COURSE_ID_PATTERN.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      courseId: entry.name,
      manifestPath: path.join(coursesRoot, entry.name, "course-manifest.json"),
    }))
    .filter((entry) => fs.existsSync(entry.manifestPath));
}

async function restoreGatewayCheckpoints(entries, organizationKey) {
  const restoredCourseIds = [];
  const queue = [...entries];
  const concurrency = Math.min(8, queue.length);

  async function worker() {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) return;
      const manifest = readJson(entry.manifestPath);
      const sourceManifestHash = authoringSourceHash(manifest);
      const checkpoint = await fetchCheckpointThroughGateway({
        organizationKey,
        courseSlug: entry.courseId,
        sourceManifestHash,
        authoringPolicyVersion: AUTHORING_POLICY_VERSION,
      });
      if (!checkpoint) continue;

      const envelope = checkpoint.package;
      const identity = validateAuthoringEnvelope({ courseId: entry.courseId, envelope, manifest });
      if (checkpoint.packageHash !== identity.packageHash) {
        throw new Error(`Stored authoring checkpoint hash mismatch for ${entry.courseId}.`);
      }
      atomicWritePrivateJson(
        path.join(coursesRoot, entry.courseId, "generated", "authoring", "course-package.json"),
        envelope,
      );
      restoredCourseIds.push(entry.courseId);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return restoredCourseIds.sort();
}

async function restoreDatabaseCheckpoints(entries, organizationKey) {
  const prisma = await createPrismaClient();
  if (!prisma) return null;
  const restoredCourseIds = [];

  try {
    for (const entry of entries) {
      const manifest = readJson(entry.manifestPath);
      const sourceManifestHash = authoringSourceHash(manifest);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "package", "packageHash"
         FROM "AuthoringCheckpoint"
         WHERE "organizationKey" = $1
           AND "courseSlug" = $2
           AND "sourceManifestHash" = $3
           AND "authoringPolicyVersion" = $4
         ORDER BY "updatedAt" DESC
         LIMIT 1`,
        organizationKey,
        entry.courseId,
        sourceManifestHash,
        AUTHORING_POLICY_VERSION,
      );
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const envelope = rows[0].package;
      const identity = validateAuthoringEnvelope({ courseId: entry.courseId, envelope, manifest });
      if (rows[0].packageHash !== identity.packageHash) {
        throw new Error(`Stored authoring checkpoint hash mismatch for ${entry.courseId}.`);
      }

      atomicWritePrivateJson(
        path.join(coursesRoot, entry.courseId, "generated", "authoring", "course-package.json"),
        envelope,
      );
      restoredCourseIds.push(entry.courseId);
    }
  } finally {
    await prisma.$disconnect();
  }
  return restoredCourseIds;
}

export async function restoreAuthoringCheckpoints() {
  const organizationKey = normalizedOrganizationKey();
  const entries = courseManifestEntries();
  const transport = checkpointTransportName();
  const restoredCourseIds = checkpointGatewayConfigured()
    ? await restoreGatewayCheckpoints(entries, organizationKey)
    : await restoreDatabaseCheckpoints(entries, organizationKey);

  if (restoredCourseIds === null) {
    const summary = {
      schemaVersion: "1.2",
      checkedAt: new Date().toISOString(),
      restored: 0,
      evaluated: 0,
      skipped: true,
      reason: "checkpoint-transport-not-configured",
      transport,
      authoringPolicyVersion: AUTHORING_POLICY_VERSION,
      contractHash: contractHash(),
      productionStandardHash: commercialProductionStandardHash(),
    };
    fs.mkdirSync(catalogRoot, { recursive: true });
    fs.writeFileSync(path.join(catalogRoot, "authoring-checkpoint-restore.json"), `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }

  const summary = {
    schemaVersion: "1.2",
    checkedAt: new Date().toISOString(),
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    contractId: workerPoolContract.contractId,
    contractHash: contractHash(),
    productionStandardId: commercialProductionStandard.standardId,
    productionStandardHash: commercialProductionStandardHash(),
    qualityTier: commercialProductionStandard.qualityTier,
    transport,
    evaluated: entries.length,
    restored: restoredCourseIds.length,
    restoredCourseIds,
    skipped: false,
    claimBoundary: "Restoration proves matching protected checkpoint retrieval, GitHub workflow identity where OIDC is used, worker-contract integrity, production-standard integrity, and package integrity only. It does not establish source verification, media completion, review approval, commercial acceptance, or publication readiness.",
  };
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, "authoring-checkpoint-restore.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
