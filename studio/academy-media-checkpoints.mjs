import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const TABLE_NAME = "AcademyHollywoodMediaJobCheckpoint";
const SCHEMA_VERSION = "1.0";

function databaseUrl() {
  const value = String(process.env.DATABASE_URL ?? "").trim();
  if (!value) throw new Error("DATABASE_URL is required for protected Academy media checkpoints.");
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Protected Academy media checkpoints require PostgreSQL.");
  return value;
}

function organizationKey() {
  const value = String(process.env.STUDIO_OWNER_ORGANIZATION_ID ?? "").trim();
  if (!value || value.length > 200) throw new Error("STUDIO_OWNER_ORGANIZATION_ID is required for protected Academy media checkpoints.");
  return value;
}

async function prismaClient() {
  databaseUrl();
  const module = await import("@prisma/client");
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  if (!PrismaClient) throw new Error("PrismaClient is unavailable for protected Academy media checkpoints.");
  return new PrismaClient();
}

function validateJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error("Media job checkpoint must be an object.");
  for (const field of ["courseId", "moduleId", "segmentId", "provider", "scriptHash"]) {
    if (!String(job[field] ?? "").trim()) throw new Error(`Media job checkpoint requires ${field}.`);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,160}$/.test(job.courseId)) throw new Error("Media job checkpoint courseId is invalid.");
  if (!/^[a-z0-9][a-z0-9-]{1,200}$/.test(job.segmentId)) throw new Error("Media job checkpoint segmentId is invalid.");
  if (!/^[a-f0-9]{64}$/.test(job.scriptHash)) throw new Error("Media job checkpoint scriptHash is invalid.");
  if (job.publicationAuthorized !== false) throw new Error("Media job checkpoint must not authorize publication.");
  return job;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

export async function bootstrapMediaCheckpointTable() {
  const prisma = await prismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${TABLE_NAME}" (
        "id" text PRIMARY KEY,
        "organizationKey" text NOT NULL,
        "courseSlug" text NOT NULL,
        "moduleId" text NOT NULL,
        "segmentId" text NOT NULL,
        "provider" text NOT NULL,
        "scriptHash" text NOT NULL,
        "externalId" text,
        "status" text NOT NULL,
        "job" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "AcademyHollywoodMediaJob_identity_key"
      ON "${TABLE_NAME}" (
        "organizationKey", "courseSlug", "moduleId", "segmentId", "provider", "scriptHash"
      )
    `);
    const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public."${TABLE_NAME}"')::text AS media_table`);
    if (!rows?.[0]?.media_table) throw new Error("Protected Academy media checkpoint table verification failed.");
    return { ready: true, table: TABLE_NAME };
  } finally {
    await prisma.$disconnect();
  }
}

export async function persistMediaJobCheckpoint(jobInput) {
  const job = validateJob(jobInput);
  const prisma = await prismaClient();
  const owner = organizationKey();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${TABLE_NAME}" (
        "id", "organizationKey", "courseSlug", "moduleId", "segmentId",
        "provider", "scriptHash", "externalId", "status", "job", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CAST($10 AS jsonb), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (
        "organizationKey", "courseSlug", "moduleId", "segmentId", "provider", "scriptHash"
      ) DO UPDATE SET
        "externalId" = EXCLUDED."externalId",
        "status" = EXCLUDED."status",
        "job" = EXCLUDED."job",
        "updatedAt" = CURRENT_TIMESTAMP`,
      crypto.randomUUID(),
      owner,
      job.courseId,
      job.moduleId,
      job.segmentId,
      job.provider,
      job.scriptHash,
      job.externalId ?? null,
      String(job.status ?? "unknown").slice(0, 100),
      JSON.stringify(job),
    );
    return { stored: true, courseId: job.courseId, segmentId: job.segmentId, status: job.status };
  } finally {
    await prisma.$disconnect();
  }
}

export async function restoreMediaJobCheckpoints() {
  const portfolio = academySurgePortfolio();
  const prisma = await prismaClient();
  const owner = organizationKey();
  const restored = [];
  try {
    for (const item of portfolio.selectedCourses) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "job"
         FROM "${TABLE_NAME}"
         WHERE "organizationKey" = $1 AND "courseSlug" = $2
         ORDER BY "updatedAt" ASC`,
        owner,
        item.courseId,
      );
      for (const row of rows ?? []) {
        const job = validateJob(row.job);
        const sidecarPath = path.join(item.courseDir, "generated", "video-jobs", `${job.segmentId}.academy-media-job.json`);
        atomicWriteJson(sidecarPath, job);
        restored.push({ courseId: item.courseId, segmentId: job.segmentId, provider: job.provider, status: job.status });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    restoredAt: new Date().toISOString(),
    evaluatedCourses: portfolio.selectedCourses.length,
    restoredJobs: restored.length,
    jobs: restored,
    claimBoundary: "Restoring provider job state prevents duplicate submissions and preserves progress. It does not prove provider completion, mastered media, accessibility approval, rights clearance, or publication readiness.",
  };
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, "academy-hollywood-media-checkpoint-restore.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
