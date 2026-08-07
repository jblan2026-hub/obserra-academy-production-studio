import { spawnSync } from "node:child_process";

const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
const bootstrapAllowed = String(process.env.ACADEMY_DATABASE_BOOTSTRAP_ALLOWED ?? "false").toLowerCase() === "true";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for protected Academy database bootstrap.");
}

if (!bootstrapAllowed) {
  throw new Error("ACADEMY_DATABASE_BOOTSTRAP_ALLOWED=true is required to initialize the protected Academy database.");
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

console.log("[Academy Studio] Generating Prisma Client for protected database bootstrap.");
run("npx", ["prisma", "generate"]);

console.log("[Academy Studio] Applying current Prisma schema to protected PostgreSQL database without development seed data.");
run("npx", ["prisma", "db", "push", "--skip-generate"]);

console.log("[Academy Studio] Protected Academy database schema bootstrap completed.");
