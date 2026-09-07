// Notification inbox + the cron trigger (Step 12).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { opsAuthorized } from "../lib/opsAuth.js";
import {
  runNotificationSweep,
  purgeExpiredAccounts,
} from "../lib/notifications.js";
import { purgeExpiredGuests } from "../lib/guests.js";
import type { NotificationLog } from "@prisma/client";

export default async function notificationRoutes(app: FastifyInstance) {
  // In-app inbox.
  app.get("/api/notifications", { preHandler: [app.authenticate] }, async (req, reply) => {
    const rows = await prisma.notificationLog.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return reply.send({
      notifications: rows.map((n: NotificationLog) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        deepLink: n.deepLink,
        read: n.readAt !== null,
        createdAt: n.createdAt,
      })),
      unreadCount: rows.filter((n: NotificationLog) => n.readAt === null).length,
    });
  });

  app.post(
    "/api/notifications/read",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const parsed = z
        .object({ ids: z.array(z.string()).optional() })
        .safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

      await prisma.notificationLog.updateMany({
        where: {
          userId: req.user.sub,
          readAt: null,
          ...(parsed.data.ids ? { id: { in: parsed.data.ids } } : {}),
        },
        data: { readAt: new Date() },
      });
      return reply.send({ ok: true });
    }
  );

  // Cron entry point. Guarded by a shared secret rather than a user token,
  // since the caller is a scheduler (Render cron, GitHub Actions, cron-job.org)
  // and there's no user session involved.
  app.post("/api/cron/sweep", async (req, reply) => {
    if (!opsAuthorized(req.headers["x-cron-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const notifications = await runNotificationSweep();
    const purged = await purgeExpiredAccounts();
    // Guest data expires automatically (PATHWISE 2.0 Phase 1) — rows AND
    // stored files.
    const purgedGuests = await purgeExpiredGuests();

    return reply.send({ notifications, purgedAccounts: purged, purgedGuests });
  });
}
