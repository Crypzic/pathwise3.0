// Error intake + ops readout (beta readiness).
//
// The frontend's global handlers POST here; server 5xx errors are recorded
// by the setErrorHandler in server.ts. Client reports are anonymous-capable
// (crashes happen before sign-in too), tightly rate-limited, and bounded —
// a hostile client can at worst fill one fingerprint bucket per day.
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { opsAuthorized } from "../lib/opsAuth.js";
import { boundReport } from "../lib/errorModel.js";
import { recordError, pruneOldErrors } from "../lib/errors.js";

export default async function errorRoutes(app: FastifyInstance) {
  app.post(
    "/api/client-errors",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const bounded = boundReport((req.body ?? {}) as Record<string, unknown>);
      if (!bounded) {
        return reply.code(400).send({ error: "message required" });
      }
      await recordError({
        source: "client",
        ...bounded,
        requestId: req.id,
      });
      return reply.code(202).send({ recorded: true });
    }
  );

  // What broke lately, grouped and counted. Same guard as the other ops
  // surfaces; prunes >30-day rows opportunistically on each read.
  app.get("/api/ops/errors", async (req, reply) => {
    if (!opsAuthorized(req.headers["x-cron-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    await pruneOldErrors();
    const rows = await prisma.errorReport.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    });
    return reply.send({
      errors: rows.map((r) => ({
        id: r.id,
        source: r.source,
        message: r.message,
        url: r.url,
        requestId: r.requestId,
        fingerprint: r.fingerprint,
        day: r.dayKey,
        count: r.count,
        lastSeenAt: r.lastSeenAt,
        stack: r.stack?.split("\n").slice(0, 4).join("\n") ?? null,
      })),
    });
  });
}
