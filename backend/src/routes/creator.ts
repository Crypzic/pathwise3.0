// Hidden creator video infrastructure (PATHWISE 2.0 Phase 16).
//
// The full pipeline — upload → AI analysis → creator review → publish —
// plus the prepared interaction surface (views/likes/saves/shares,
// comments, follows). ALL of it is dark: while
// FEATURE_USER_VIDEO_POSTING=false, ordinary clients get 404s
// indistinguishable from "no such route". Internal testing stays possible
// with the CRON_SECRET header, per the roadmap ("Admin/internal testing can
// remain possible"). The flag check is server-side on every endpoint — a
// client cannot re-enable this by editing frontend state.
//
// Deliberately deferred to the async-worker phase: transcoding, thumbnail
// generation, audio transcription. The schema carries their fields; the
// synchronous pipeline runs screening + topic extraction on the metadata
// (title/caption/transcript) through the existing provider abstraction.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { opsAuthorized } from "../lib/opsAuth.js";
import { features } from "../lib/features.js";
import { isGuestUser } from "../lib/guests.js";
import { saveUpload, storage } from "../lib/storage.js";
import { matchesVideoSignature } from "../lib/fileSignature.js";
import {
  canPublish,
  cleanText,
  moderationFromVerdict,
  videoKindFor,
  type CreatorVideoStatus,
  type ModerationStatus,
} from "../lib/creatorModel.js";
import { classifyMaterial, extractTopics } from "../lib/aiMeter.js";
import { screenText } from "../lib/communityModel.js";
import { parseStoredList } from "../lib/onboardingModel.js";
import { track } from "../lib/analytics.js";

const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // matches the multipart limit

/** Internal testing bypass: ops secret opens the dark feature. */
function isInternalTester(req: FastifyRequest): boolean {
  return opsAuthorized(req.headers["x-cron-secret"]);
}

function creatorSurfaceOpen(req: FastifyRequest): boolean {
  return features.userVideoPosting || isInternalTester(req);
}

function shaped(v: {
  id: string;
  title: string;
  caption: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
  subject: string | null;
  topicsJson: string;
  status: string;
  moderationStatus: string;
  visibility: string;
  createdAt: Date;
}) {
  return {
    id: v.id,
    title: v.title,
    caption: v.caption,
    thumbnailUrl: v.thumbnailUrl,
    durationSec: v.durationSec,
    subject: v.subject,
    topics: parseStoredList(v.topicsJson),
    status: v.status,
    moderationStatus: v.moderationStatus,
    visibility: v.visibility,
    createdAt: v.createdAt,
  };
}

export default async function creatorRoutes(app: FastifyInstance) {
  // Upload: multipart file + title/caption fields. Runs the synchronous
  // analysis pipeline before answering, mirroring course uploads.
  app.post(
    "/api/creator/videos",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (!creatorSurfaceOpen(req)) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (await isGuestUser(req.user.sub)) {
        return reply
          .code(403)
          .send({ error: "Creating videos needs an account." });
      }

      const data = await req.file();
      if (!data) return reply.code(400).send({ error: "No file uploaded" });

      const kind = videoKindFor(data.filename, data.mimetype);
      if (!kind) {
        return reply
          .code(415)
          .send({ error: "Only MP4 or WebM video is supported." });
      }
      const buffer = await data.toBuffer();
      if (buffer.length > MAX_VIDEO_BYTES) {
        return reply.code(413).send({ error: "Video too large (25MB max for now)." });
      }
      if (!matchesVideoSignature(kind, buffer)) {
        return reply
          .code(415)
          .send({ error: "That file doesn't look like a real video." });
      }

      const fields = data.fields as Record<
        string,
        { value?: unknown } | undefined
      >;
      const title = cleanText(fields.title?.value, 140);
      const caption = cleanText(fields.caption?.value, 1000);
      if (title.length < 3) {
        return reply.code(400).send({ error: "Give the video a title (3+ chars)." });
      }
      const screened = screenText(`${title}\n${caption}`);
      if (!screened.ok) {
        return reply.code(400).send({ error: screened.reason });
      }

      const saved = await saveUpload(req.user.sub, data.filename, buffer);
      const video = await prisma.creatorVideo.create({
        data: {
          creatorId: req.user.sub,
          title,
          caption,
          storagePath: saved.storagePath,
        },
      });

      // Analysis (Phase 17 groundwork): screening + subject/topic extraction
      // on the metadata text, through the same provider abstraction the rest
      // of the product uses. Transcript-based analysis plugs in here once
      // transcription exists.
      const analysisText = `${title}\n${caption}`;
      let status: CreatorVideoStatus;
      let moderationStatus: ModerationStatus;
      let topics: string[] = [];
      let subject: string | null = null;
      try {
        const verdict = await classifyMaterial(
          req.user.sub,
          "creator-video",
          analysisText
        );
        const lane = moderationFromVerdict(verdict.verdict);
        status = lane.status;
        moderationStatus = lane.moderationStatus;
        if (status !== "rejected") {
          const extracted = await extractTopics(
            req.user.sub,
            title,
            analysisText
          );
          topics = extracted.map((t) => t.name).slice(0, 8);
          subject = topics[0] ?? null;
        }
      } catch {
        // Analysis failing must not lose the upload — park it for review.
        status = "pending_review";
        moderationStatus = "pending";
      }

      const updated = await prisma.creatorVideo.update({
        where: { id: video.id },
        data: {
          status,
          moderationStatus,
          subject,
          topicsJson: JSON.stringify(topics),
        },
      });
      await track(req.user.sub, "creator_video_uploaded", {
        videoId: video.id,
        status,
        moderationStatus,
      });
      return reply.code(201).send({ video: shaped(updated) });
    }
  );

  // The creator's own studio list.
  app.get(
    "/api/creator/videos",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!creatorSurfaceOpen(req)) {
        return reply.code(404).send({ error: "Not found" });
      }
      const videos = await prisma.creatorVideo.findMany({
        where: { creatorId: req.user.sub },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ videos: videos.map(shaped) });
    }
  );

  // Creator review → publish. The state machine (creatorModel.ts) refuses
  // anything unapproved; flagged videos need ops approval first.
  app.post(
    "/api/creator/videos/:id/publish",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!creatorSurfaceOpen(req)) {
        return reply.code(404).send({ error: "Not found" });
      }
      const { id } = req.params as { id: string };
      const video = await prisma.creatorVideo.findFirst({
        where: { id, creatorId: req.user.sub },
      });
      if (!video) return reply.code(404).send({ error: "Video not found" });

      const verdict = canPublish(
        video.status as CreatorVideoStatus,
        video.moderationStatus as ModerationStatus
      );
      if (!verdict.ok) {
        return reply.code(409).send({ error: verdict.reason });
      }
      const updated = await prisma.creatorVideo.update({
        where: { id },
        data: { status: "published", visibility: "public" },
      });
      await track(req.user.sub, "creator_video_published", { videoId: id });
      return reply.send({ video: shaped(updated) });
    }
  );

  // Creator takedown: removes the stored file too.
  app.delete(
    "/api/creator/videos/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!creatorSurfaceOpen(req)) {
        return reply.code(404).send({ error: "Not found" });
      }
      const { id } = req.params as { id: string };
      const video = await prisma.creatorVideo.findFirst({
        where: { id, creatorId: req.user.sub },
      });
      if (!video) return reply.code(404).send({ error: "Video not found" });
      await storage.remove(video.storagePath).catch(() => {});
      await prisma.creatorVideo.delete({ where: { id } });
      return reply.send({ removed: true });
    }
  );

  // --- Public consumption surface. STRICTLY flag-gated — no ops bypass:
  // there is deliberately no way for content to reach ordinary users while
  // the flag is off, which is the roadmap's whole point.
  app.get(
    "/api/creator/feed",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!features.userVideoPosting) {
        return reply.code(404).send({ error: "Not found" });
      }
      const videos = await prisma.creatorVideo.findMany({
        where: {
          status: "published",
          visibility: "public",
          moderationStatus: "approved",
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          creator: { select: { name: true, username: true } },
          _count: {
            select: {
              events: { where: { kind: "like" } },
              comments: { where: { status: "visible" } },
            },
          },
        },
      });
      return reply.send({
        feed: videos.map((v) => ({
          ...shaped(v),
          creator: v.creator.username ?? v.creator.name,
          likes: v._count.events,
          comments: v._count.comments,
        })),
      });
    }
  );

  // Interactions: view/share accumulate (with watch telemetry); like/save
  // toggle; report queues for moderation.
  app.post(
    "/api/creator/videos/:id/interact",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (!features.userVideoPosting) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (await isGuestUser(req.user.sub)) {
        return reply
          .code(403)
          .send({ error: "Create an account to interact with videos." });
      }
      const { id } = req.params as { id: string };
      const parsed = z
        .object({
          kind: z.enum(["view", "like", "save", "share", "report"]),
          watchMs: z.number().int().min(0).optional(),
          completed: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid interaction" });
      }
      const video = await prisma.creatorVideo.findFirst({
        where: { id, status: "published", visibility: "public" },
        select: { id: true },
      });
      if (!video) return reply.code(404).send({ error: "Video not found" });

      const { kind, watchMs, completed } = parsed.data;
      if (kind === "like" || kind === "save") {
        const existing = await prisma.creatorVideoEvent.findFirst({
          where: { userId: req.user.sub, videoId: id, kind },
        });
        if (existing) {
          await prisma.creatorVideoEvent.delete({ where: { id: existing.id } });
          return reply.send({ kind, active: false });
        }
      }
      await prisma.creatorVideoEvent.create({
        data: {
          userId: req.user.sub,
          videoId: id,
          kind,
          watchMs: watchMs ?? null,
          completed: completed ?? false,
        },
      });
      if (kind === "report") {
        await prisma.contentReport.create({
          data: {
            reporterId: req.user.sub,
            targetType: "creator_video",
            targetId: id,
            reason: "other",
          },
        });
      }
      return reply.send({ kind, active: true });
    }
  );

  app.post(
    "/api/creator/videos/:id/comments",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (!features.userVideoPosting) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: "Create an account to comment." });
      }
      const { id } = req.params as { id: string };
      const parsed = z
        .object({ body: z.string().min(1).max(1000) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "A comment needs 1-1000 characters." });
      }
      const screened = screenText(parsed.data.body);
      if (!screened.ok) {
        return reply.code(400).send({ error: screened.reason });
      }
      const video = await prisma.creatorVideo.findFirst({
        where: { id, status: "published", visibility: "public" },
        select: { id: true },
      });
      if (!video) return reply.code(404).send({ error: "Video not found" });
      const comment = await prisma.creatorVideoComment.create({
        data: {
          videoId: id,
          authorId: req.user.sub,
          body: parsed.data.body.trim(),
        },
      });
      return reply.code(201).send({ comment: { id: comment.id } });
    }
  );

  app.post(
    "/api/creator/follow",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!features.userVideoPosting) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: "Create an account to follow creators." });
      }
      const parsed = z
        .object({ creatorId: z.string().min(1), on: z.boolean() })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Send { creatorId, on }" });
      }
      const { creatorId, on } = parsed.data;
      if (creatorId === req.user.sub) {
        return reply.code(400).send({ error: "That's you." });
      }
      if (on) {
        await prisma.creatorFollow.upsert({
          where: {
            followerId_creatorId: { followerId: req.user.sub, creatorId },
          },
          create: { followerId: req.user.sub, creatorId },
          update: {},
        });
      } else {
        await prisma.creatorFollow.deleteMany({
          where: { followerId: req.user.sub, creatorId },
        });
      }
      return reply.send({ following: on });
    }
  );

  // --- Ops: the human half of moderation — approve flagged videos, reject
  // anything. Works regardless of the flag (it's how internal testing and
  // pre-launch review happen).
  app.post("/api/ops/creator-videos/:id/moderate", async (req, reply) => {
    if (!isInternalTester(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ action: z.enum(["approve", "reject"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "action must be approve|reject" });
    }
    const video = await prisma.creatorVideo.findUnique({ where: { id } });
    if (!video) return reply.code(404).send({ error: "Video not found" });
    const updated = await prisma.creatorVideo.update({
      where: { id },
      data:
        parsed.data.action === "approve"
          ? { moderationStatus: "approved" }
          : { moderationStatus: "rejected", status: "rejected", visibility: "private" },
    });
    return reply.send({ video: shaped(updated) });
  });
}
