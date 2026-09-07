// Beta feedback (launch prep).
//
// A closed beta lives or dies on hearing from testers, and "DM me on WhatsApp"
// loses everything. One box in the profile, one table, readable via the ops
// endpoint — no third-party widget ahead of the privacy review.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { opsAuthorized } from "../lib/opsAuth.js";

const feedbackSchema = z.object({
  message: z.string().min(3).max(2000),
  // Route the tester was on, e.g. "/quiz/abc123" — makes reports actionable.
  context: z.string().max(200).optional(),
});

export default async function feedbackRoutes(app: FastifyInstance) {
  app.post(
    "/api/feedback",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const parsed = feedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Tell us a bit more — 3 to 2000 characters." });
      }

      await prisma.feedback.create({
        data: {
          userId: req.user.sub,
          message: parsed.data.message.trim(),
          context: parsed.data.context ?? null,
        },
      });

      return reply.code(201).send({
        message: "Got it — thank you. Beta feedback genuinely shapes what gets fixed first.",
      });
    }
  );

  // Read side for whoever runs the beta. Same CRON_SECRET guard as ops.
  app.get("/api/ops/feedback", async (req, reply) => {
    if (!opsAuthorized(req.headers["x-cron-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const rows = await prisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { email: true, name: true } } },
    });
    return reply.send({
      feedback: rows.map((f) => ({
        id: f.id,
        message: f.message,
        context: f.context,
        from: f.user ? `${f.user.name} <${f.user.email}>` : "deleted user",
        createdAt: f.createdAt,
      })),
    });
  });
}
