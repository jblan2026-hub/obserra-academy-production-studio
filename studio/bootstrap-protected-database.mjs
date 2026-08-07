import { spawnSync } from "node:child_process";

const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
const bootstrapAllowed = String(process.env.ACADEMY_DATABASE_BOOTSTRAP_ALLOWED ?? "false").toLowerCase() === "true";
const expectedProjectRef = String(process.env.ACADEMY_SUPABASE_PROJECT_REF ?? "nwxnyqlyzyufgoadtqxs").trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for protected Academy database bootstrap.");
}

if (!bootstrapAllowed) {
  throw new Error("ACADEMY_DATABASE_BOOTSTRAP_ALLOWED=true is required to initialize the protected Academy database.");
}

function validateProtectedDatabaseUrl() {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  if (!parsed.username.endsWith(`.${expectedProjectRef}`)) {
    throw new Error(`DATABASE_URL does not target the expected Supabase project ${expectedProjectRef}.`);
  }

  if (!parsed.hostname.endsWith(".pooler.supabase.com")) {
    throw new Error("Protected Academy GitHub Actions must use the Supabase pooler endpoint.");
  }

  if (parsed.port !== "5432") {
    throw new Error("Protected Academy GitHub Actions must use Supavisor session mode on port 5432.");
  }

  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode && sslMode !== "require") {
    throw new Error("DATABASE_URL sslmode must be require when explicitly configured.");
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

async function createPrismaClient() {
  const prismaModule = await import("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
  if (!PrismaClient) throw new Error("PrismaClient is unavailable after generation.");
  return new PrismaClient();
}

async function organizationSchemaExists() {
  const prisma = await createPrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.\"Organization\"')::text AS organization_table`);
    return Boolean(rows?.[0]?.organization_table);
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureAuthoringCheckpointTable() {
  const prisma = await createPrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AuthoringCheckpoint" (
        "id" TEXT PRIMARY KEY,
        "organizationKey" TEXT NOT NULL,
        "courseSlug" TEXT NOT NULL,
        "sourceManifestHash" TEXT NOT NULL,
        "authoringPolicyVersion" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "model" TEXT NOT NULL,
        "packageHash" TEXT NOT NULL,
        "package" JSONB NOT NULL,
        "reviewStatus" TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_authoring_checkpoint_identity"
      ON "AuthoringCheckpoint" (
        "organizationKey", "courseSlug", "sourceManifestHash", "authoringPolicyVersion"
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ix_authoring_checkpoint_course"
      ON "AuthoringCheckpoint" ("organizationKey", "courseSlug", "updatedAt")
    `);
    const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.\"AuthoringCheckpoint\"')::text AS checkpoint_table`);
    if (!rows?.[0]?.checkpoint_table) {
      throw new Error("Protected authoring checkpoint table verification failed.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

validateProtectedDatabaseUrl();

console.log("[Academy Studio] Generating Prisma Client for protected database verification.");
run("npx", ["prisma", "generate"]);

if (await organizationSchemaExists()) {
  console.log("[Academy Studio] Protected Academy base schema already exists. Preserving managed application tables.");
} else {
  console.log("[Academy Studio] Protected Academy schema is absent. Applying current Prisma schema without development seed data.");
  run("npx", ["prisma", "db", "push", "--skip-generate"]);
}

run("npx", ["prisma", "validate"]);
await ensureAuthoringCheckpointTable();
console.log("[Academy Studio] Protected authoring checkpoint table is present and index-verified.");
console.log("[Academy Studio] Protected Academy database bootstrap verification completed.");
