// Applies a Prisma migration's SQL file directly to a Turso database.
// Exists because the Turso CLI requires WSL on native Windows — this avoids
// that entirely by using the same @libsql/client library the app already
// depends on.
//
// Usage (run from the backend/ folder):
//   node scripts/apply-migration.mjs prisma/migrations/<folder>/migration.sql
//
// Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to be set — either export
// them in your shell first, or paste them directly below temporarily (just
// don't commit real values if you do that).

import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/apply-migration.mjs <path-to-migration.sql>");
  process.exit(1);
}
if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error(
    "Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN. Set them as environment variables first."
  );
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

const sql = readFileSync(filePath, "utf-8");

// Split on semicolons at end of line — good enough for Prisma's generated
// migration files, which don't embed semicolons inside string literals.
const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Applying ${statements.length} statement(s) from ${filePath}...`);

for (const statement of statements) {
  await client.execute(statement);
  console.log("✓ applied:", statement.slice(0, 60).replace(/\n/g, " ") + "...");
}

console.log("Done.");
