// Error recording (beta readiness). Pure grouping in errorModel.ts; this
// is the write path. Recording must NEVER be able to fail a request — every
// entry point swallows its own failures.
import { prisma } from "./prisma.js";
import { dayKeyOf, fingerprintError } from "./errorModel.js";

export async function recordError(input: {
  source: "client" | "server";
  message: string;
  stack?: string | null;
  url?: string | null;
  requestId?: string | null;
  userId?: string | null;
}): Promise<void> {
  try {
    const fingerprint = fingerprintError(input.message, input.stack);
    const dayKey = dayKeyOf();
    await prisma.errorReport.upsert({
      where: { fingerprint_dayKey: { fingerprint, dayKey } },
      create: {
        source: input.source,
        message: input.message,
        stack: input.stack ?? null,
        url: input.url ?? null,
        requestId: input.requestId ?? null,
        userId: input.userId ?? null,
        fingerprint,
        dayKey,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        // Keep the freshest context — the latest occurrence is the one
        // someone will want to reproduce.
        requestId: input.requestId ?? undefined,
        url: input.url ?? undefined,
      },
    });
  } catch (err) {
    // Last resort: at least the process log sees it.
    console.error("⚠️  error tracking failed to record:", err);
  }
}

/** Drop reports older than 30 days. Called opportunistically from ops. */
export async function pruneOldErrors(now = new Date()): Promise<void> {
  try {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await prisma.errorReport.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
  } catch {
    // Non-fatal.
  }
}
