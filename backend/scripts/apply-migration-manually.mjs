// Applies pending migration folders through the Prisma *query* engine and
// records them in _prisma_migrations, exactly as `prisma migrate deploy`
// would.
//
// Exists because `migrate deploy` shells out to schema-engine-windows.exe,
// which some antivirus setups quarantine (this machine's did). The query
// engine is a .dll.node loaded in-process and survives. CI and production
// (Linux) use the normal `prisma migrate deploy` path — this script is a
// fallback for local dev and for applying SQL to Turso-style targets.
//
// Usage:
//   node scripts/apply-migration-manually.mjs           # apply all pending
//   node scripts/apply-migration-manually.mjs <folder>  # apply one by name
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "prisma", "migrations");

const prisma = new PrismaClient();

// Same table `migrate deploy` maintains — created here so a brand-new empty
// database file works too.
await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
)`);

const appliedRows = await prisma.$queryRawUnsafe(
  `SELECT migration_name FROM _prisma_migrations`
);
const applied = new Set(appliedRows.map((r) => r.migration_name));

const requested = process.argv[2];
const all = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort(); // folder names start with a timestamp, so sort order = apply order

const pending = requested
  ? all.filter((name) => name === requested)
  : all.filter((name) => !applied.has(name));

if (requested && pending.length === 0) {
  console.error(`No migration folder named ${requested}`);
  process.exit(1);
}

for (const name of pending) {
  if (applied.has(name)) {
    console.log(`${name}: already applied — skipping.`);
    continue;
  }

  const sql = await readFile(join(migrationsDir, name, "migration.sql"), "utf8");
  // Prisma records the checksum of the file bytes; matching it keeps a later
  // real `migrate deploy` from re-applying or flagging drift.
  const checksum = createHash("sha256").update(sql).digest("hex");

  // Split on statement boundaries; SQLite's driver runs one statement at a
  // time. Comment lines are stripped from within each chunk — a chunk that
  // *starts* with "-- AlterTable" still contains a real statement below it.
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);

  if (statements.length === 0) {
    console.error(`${name}: parsed zero statements — refusing to record it.`);
    process.exit(1);
  }

  // One transaction per migration, like the real `migrate deploy` — a crash
  // mid-migration must not leave half the DDL applied but unrecorded
  // (SQLite DDL is transactional, so this genuinely rolls back).
  const now = new Date().toISOString();
  await prisma.$transaction([
    ...statements.map((statement) => prisma.$executeRawUnsafe(statement)),
    prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
      randomUUID(),
      checksum,
      now,
      name,
      now,
      statements.length
    ),
  ]);

  console.log(`Applied ${name}: ${statements.length} statements.`);
}

if (pending.length === 0) {
  console.log("Database is up to date — nothing pending.");
}
await prisma.$disconnect();
