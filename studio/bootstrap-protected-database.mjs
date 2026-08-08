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

validateProtectedDatabaseUrl();

console.log("[Academy Studio] Generating Prisma Client for protected database verification.");
run("npx", ["prisma", "generate"]);

const prismaModule = await import("@prisma/client");
const PrismaClient = prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
if (!PrismaClient) throw new Error("PrismaClient is unavailable after generation.");

const prisma = new PrismaClient();
let schemaExists = false;
try {
  const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.\"Organization\"')::text AS organization_table`);
  schemaExists = Boolean(rows?.[0]?.organization_table);
} finally {
  await prisma.$disconnect();
}

if (schemaExists) {
  console.log("[Academy Studio] Protected Academy schema already exists. Skipping Prisma db push to preserve managed database controls.");
  run("npx", ["prisma", "validate"]);
} else {
  console.log("[Academy Studio] Protected Academy schema is absent. Applying current Prisma schema without development seed data.");
  run("npx", ["prisma", "db", "push", "--skip-generate"]);
  run("npx", ["prisma", "validate"]);
}

console.log("[Academy Studio] Protected Academy database bootstrap verification completed.");
