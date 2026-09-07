// Curated Educational Videos (PATHWISE 2.0 Phase 14).
//
// Editorial content only — user uploads stay behind a disabled flag until a
// much later phase. Students get a relevance-ranked shelf ("why this" comes
// from their own topic names); likes/saves/views are the signals the
// Personalized FYP (Phase 15) will rank on. Browsing is open to guests —
// it's learning content, not social — but persistent engagement (like/save/
// watch history) needs an account, per the roadmap's account-gated list.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { opsAuthorized } from "../lib/opsAuth.js";
import { isGuestUser } from "../lib/guests.js";
import { rankedVideosFor } from "../lib/videos.js";
import { buildFeed } from "../lib/fyp.js";
import { validateVideoInput } from "../lib/videoModel.js";
import { parseStoredList } from "../lib/onboardingModel.js";
import { track } from "../lib/analytics.js";

export default async function videoRoutes(app: FastifyInstance) {
  // Personalized FYP (Phase 15): the full-context feed — mastery gaps,
  // course topics, taste from likes/saves, watch-history demotion — with a
  // "quiz yourself" action wherever a video maps onto the learner's own
  // topics. Recommendations route back into learning, not endless scroll.
  app.get(
    "/api/fyp",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const feed = await buildFeed(req.user.sub);

      const engagements = await prisma.videoEngagement.findMany({
        where: { userId: req.user.sub, kind: { in: ["like", "save"] } },
        select: { videoId: true, kind: true },
      });
      const liked = new Set(
        engagements.filter((e) => e.kind === "like").map((e) => e.videoId)
      );
      const saved = new Set(
        engagements.filter((e) => e.kind === "save").map((e) => e.videoId)
      );

      return reply.send({
        feed: feed.slice(0, 20).map((f) => ({
          id: f.video.id,
          title: f.video.title,
          creator: f.video.creator,
          url: f.video.url,
          thumbnailUrl: f.video.thumbnailUrl,
          subject: f.video.subject,
          topics: f.video.topics,
          durationSec: f.video.durationSec,
          reason: f.reason,
          likedByMe: liked.has(f.video.id),
          savedByMe: saved.has(f.video.id),
          action: f.action,
        })),
      });
    }
  );

  // The shelf: ranked for the learner, filterable by subject.
  app.get(
    "/api/videos",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { subject } = req.query as { subject?: string };
      const ranked = await rankedVideosFor(req.user.sub);

      const engagements = await prisma.videoEngagement.findMany({
        where: { userId: req.user.sub, kind: { in: ["like", "save"] } },
        select: { videoId: true, kind: true },
      });
      const liked = new Set(
        engagements.filter((e) => e.kind === "like").map((e) => e.videoId)
      );
      const saved = new Set(
        engagements.filter((e) => e.kind === "save").map((e) => e.videoId)
      );

      const rows = ranked
        .filter(
          (r) =>
            !subject ||
            r.video.subject.toLowerCase() === subject.toLowerCase()
        )
        .map((r) => ({
          id: r.video.id,
          title: r.video.title,
          creator: r.video.creator,
          url: r.video.url,
          thumbnailUrl: r.video.thumbnailUrl,
          subject: r.video.subject,
          topics: r.video.topics,
          difficulty: r.video.difficulty,
          durationSec: r.video.durationSec,
          reason: r.reason,
          likedByMe: liked.has(r.video.id),
          savedByMe: saved.has(r.video.id),
        }));

      const subjects = [...new Set(ranked.map((r) => r.video.subject))].sort();
      return reply.send({ videos: rows, subjects });
    }
  );

  // Engagement: view (accumulates), like/save (toggle). Account-gated —
  // persistent history is on the roadmap's account-only list.
  app.post(
    "/api/videos/:id/engage",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({
          error: "Create an account to keep likes, saves and watch history.",
        });
      }
      const { id } = req.params as { id: string };
      const parsed = z
        .object({ kind: z.enum(["view", "like", "save"]) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "kind must be view|like|save" });
      }
      const video = await prisma.curatedVideo.findFirst({
        where: { id, status: "published" },
        select: { id: true },
      });
      if (!video) return reply.code(404).send({ error: "Video not found" });

      const { kind } = parsed.data;
      if (kind === "view") {
        await prisma.videoEngagement.create({
          data: { userId: req.user.sub, videoId: id, kind },
        });
        await track(req.user.sub, "video_engaged", { videoId: id, kind });
        return reply.send({ kind, active: true });
      }

      const existing = await prisma.videoEngagement.findFirst({
        where: { userId: req.user.sub, videoId: id, kind },
      });
      if (existing) {
        await prisma.videoEngagement.delete({ where: { id: existing.id } });
        return reply.send({ kind, active: false });
      }
      await prisma.videoEngagement.create({
        data: { userId: req.user.sub, videoId: id, kind },
      });
      await track(req.user.sub, "video_engaged", { videoId: id, kind });
      return reply.send({ kind, active: true });
    }
  );

  // --- Ops: catalog management. Same CRON_SECRET guard as the other ops
  // routes; there is deliberately no in-app admin surface yet.
  function authorized(req: { headers: Record<string, unknown> }): boolean {
    return opsAuthorized(req.headers["x-cron-secret"]);
  }

  app.get("/api/ops/videos", async (req, reply) => {
    if (!authorized(req)) return reply.code(401).send({ error: "Unauthorized" });
    const videos = await prisma.curatedVideo.findMany({
      orderBy: { createdAt: "desc" },
    });
    return reply.send({
      videos: videos.map((v) => ({
        id: v.id,
        title: v.title,
        creator: v.creator,
        url: v.url,
        subject: v.subject,
        topics: parseStoredList(v.topicsJson),
        status: v.status,
        createdAt: v.createdAt,
      })),
    });
  });

  app.post("/api/ops/videos", async (req, reply) => {
    if (!authorized(req)) return reply.code(401).send({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const invalid = validateVideoInput(body);
    if (invalid) return reply.code(400).send({ error: invalid });

    const topics = Array.isArray(body.topics)
      ? (body.topics as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
    const video = await prisma.curatedVideo.create({
      data: {
        title: String(body.title).trim(),
        creator: String(body.creator).trim(),
        url: String(body.url).trim(),
        thumbnailUrl:
          typeof body.thumbnailUrl === "string" ? body.thumbnailUrl : null,
        subject: String(body.subject).trim(),
        topicsJson: JSON.stringify(topics.slice(0, 12)),
        difficulty:
          typeof body.difficulty === "number"
            ? Math.max(0, Math.min(1, body.difficulty))
            : null,
        durationSec:
          typeof body.durationSec === "number"
            ? Math.max(0, Math.round(body.durationSec))
            : null,
      },
    });
    return reply.code(201).send({ video: { id: video.id } });
  });

  app.post("/api/ops/videos/:id", async (req, reply) => {
    if (!authorized(req)) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ status: z.enum(["published", "hidden"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "status must be published|hidden" });
    }
    const video = await prisma.curatedVideo.findUnique({ where: { id } });
    if (!video) return reply.code(404).send({ error: "Video not found" });
    await prisma.curatedVideo.update({
      where: { id },
      data: { status: parsed.data.status },
    });
    return reply.send({ status: parsed.data.status });
  });
}
