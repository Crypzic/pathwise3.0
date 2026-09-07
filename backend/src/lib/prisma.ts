import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

// Local dev: DATABASE_URL is a plain file (e.g. "file:./pathwise.db") and we
// use the default Prisma client — no adapter needed, nothing to configure.
//
// Production (Render, or anywhere with an ephemeral filesystem): set
// TURSO_DATABASE_URL + TURSO_AUTH_TOKEN instead. Turso is hosted SQLite with
// a free tier — same SQL, same Prisma schema, just not living on a disk that
// gets wiped on every restart/redeploy.
//
// The adapter is imported dynamically rather than at the top of the file.
// @prisma/adapter-libsql pulls in a platform-specific native binding, and a
// static import loads it on every boot — so a missing or mismatched binary
// takes down local development too, even though nothing there uses Turso.
// Importing it only when Turso is actually configured keeps that failure
// scoped to the deployment that opted in.
async function createPrismaClient(): Promise<PrismaClient> {
  if (!env.TURSO_DATABASE_URL) {
    return new PrismaClient();
  }

  try {
    const { PrismaLibSQL } = await import("@prisma/adapter-libsql");
    const adapter = new PrismaLibSQL({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
    return new PrismaClient({ adapter });
  } catch (err) {
    // Falling back to the local file here would silently write a production
    // deployment's data to an ephemeral disk. Fail loudly instead.
    console.error(
      "❌ TURSO_DATABASE_URL is set but the libsql adapter failed to load.\n" +
        "   Reinstall dependencies on the target platform, or unset the Turso\n" +
        "   variables to use the local DATABASE_URL file."
    );
    throw err;
  }
}

// Single shared Prisma client for the whole app.
export const prisma: PrismaClient = await createPrismaClient();
