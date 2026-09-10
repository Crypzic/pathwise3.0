// Communities (PATHWISE 2.0 Phase 9 / execution item 8).
//
// Topic- and subject-centered communities: join, ask, discuss, react, report.
// Learning relevance drives the graph — this is deliberately NOT a generic
// social network. Safety fundamentals ship with the surface, not after it:
// per-route rate limits, cheap spam screening, reporting, and an ops
// moderation queue. Communities are account-gated per the roadmap — guests
// get a 403 with a claim-your-account nudge, enforced here, not in the UI.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { opsAuthorized } from "../lib/opsAuth.js";
import { isGuestUser } from "../lib/guests.js";
import { membershipOf } from "../lib/communities.js";
import {
  POST_KINDS,
  REPORT_REASONS,
  screenText,
  slugify,
} from "../lib/communityModel.js";
import { parseStoredList } from "../lib/onboardingModel.js";
import {
  AIBudgetExceededError,
  classifyCommunityTopic,
} from "../lib/aiMeter.js";
import { AIUnavailableError } from "../ai/resilience.js";
import { track } from "../lib/analytics.js";

const postSchema = z.object({
  kind: z.enum(POST_KINDS).default("discussion"),
  title: z.string().min(4).max(140),
  body: z.string().min(1).max(5000),
});

const replySchema = z.object({
  body: z.string().min(1).max(3000),
});

const reportSchema = z.object({
  targetType: z.enum(["post", "reply"]),
  targetId: z.string().min(1),
  reason: z.enum(REPORT_REASONS),
  detail: z.string().max(1000).optional(),
});

const GUEST_MESSAGE =
  "Communities need an account — create one to keep your identity and join the conversation.";

function authorName(user: { name: string; username: string | null }): string {
  return user.username ?? user.name;
}

export default async function communityRoutes(app: FastifyInstance) {
  /** 403 for guests on every community route; social identity needs an account. */
  async function rejectGuests(userId: string): Promise<boolean> {
    return isGuestUser(userId);
  }

  // Communities matched to THIS learner (no hardcoded catalog): `?q=` is a
  // free search across all communities; without it, each entry carries a
  // `relevant` flag computed from the learner's field, subjects, interests
  // and course topic names, so the UI can show their world by default.
  app.get(
    "/api/communities",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { q } = req.query as { q?: string };
      const search = (q ?? "").trim().slice(0, 80);

      const [communities, mine, profile, topics] = await Promise.all([
        prisma.community.findMany({
          where: search
            ? {
                OR: [
                  { name: { contains: search } },
                  { description: { contains: search } },
                ],
              }
            : undefined,
          orderBy: { name: "asc" },
          include: {
            _count: { select: { members: true, posts: { where: { status: "visible" } } } },
          },
        }),
        prisma.communityMember.findMany({
          where: { userId: req.user.sub },
          select: { communityId: true },
        }),
        prisma.learnerProfile.findUnique({ where: { userId: req.user.sub } }),
        prisma.topic.findMany({
          where: { knowledgeMap: { course: { userId: req.user.sub } } },
          select: { name: true },
          take: 100,
        }),
      ]);
      const joined = new Set(mine.map((m) => m.communityId));

      // The learner's derived interest terms — same privacy posture as
      // matching: names and self-declared text only, never files.
      const terms = [
        profile?.field ?? "",
        ...parseStoredList(profile?.subjectsJson ?? "[]"),
        ...parseStoredList(profile?.communityInterestsJson ?? "[]"),
        ...topics.map((t) => t.name),
      ]
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 3);

      const isRelevant = (c: { name: string; description: string | null }) => {
        const hay = `${c.name} ${c.description ?? ""}`.toLowerCase();
        return terms.some(
          (t) => hay.includes(t) || t.includes(c.name.toLowerCase())
        );
      };

      return reply.send({
        communities: communities.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description,
          parentId: c.parentId,
          members: c._count.members,
          posts: c._count.posts,
          joined: joined.has(c.id),
          relevant: joined.has(c.id) || isRelevant(c),
        })),
        searched: search.length > 0,
      });
    }
  );

  // Create a community — behind the educational guardrail. The AI checks
  // that the title/description describe a real academic subject, course or
  // learning topic; anything else is refused with the exact product copy.
  app.post(
    "/api/communities",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const parsed = z
        .object({
          name: z.string().min(3).max(60),
          description: z.string().max(300).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Give the community a name (3-60 chars)." });
      }
      const name = parsed.data.name.replace(/\s+/g, " ").trim();
      const description = (parsed.data.description ?? "").trim();

      const screened = screenText(`${name}\n${description}`);
      if (!screened.ok) {
        return reply.code(400).send({ error: screened.reason });
      }

      let verdict;
      try {
        verdict = await classifyCommunityTopic(req.user.sub, name, description);
      } catch (err) {
        if (err instanceof AIBudgetExceededError) {
          return reply.code(429).send({ error: err.message });
        }
        if (err instanceof AIUnavailableError) {
          return reply.code(503).send({ error: err.message });
        }
        throw err;
      }
      if (!verdict.educational) {
        return reply.code(400).send({
          error: "Please create a community that aligns with any course or subject.",
        });
      }

      const slug = slugify(name);
      const existing = await prisma.community.findFirst({
        where: { OR: [{ slug }, { name }] },
        select: { id: true },
      });
      if (existing) {
        return reply
          .code(409)
          .send({ error: "A community with that name already exists." });
      }

      const community = await prisma.community.create({
        data: { name, slug, description },
      });
      // The founder is its first member.
      await prisma.communityMember.create({
        data: { communityId: community.id, userId: req.user.sub },
      });
      await track(req.user.sub, "community_created", {
        communityId: community.id,
        slug,
      });
      return reply.code(201).send({
        community: { id: community.id, slug, name, description },
      });
    }
  );

  app.post(
    "/api/communities/:id/join",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { id } = req.params as { id: string };
      const community = await prisma.community.findUnique({ where: { id } });
      if (!community) {
        return reply.code(404).send({ error: "Community not found" });
      }
      await prisma.communityMember.upsert({
        where: { communityId_userId: { communityId: id, userId: req.user.sub } },
        create: { communityId: id, userId: req.user.sub },
        update: {},
      });
      await track(req.user.sub, "community_joined", { communityId: id, slug: community.slug });
      return reply.send({ joined: true });
    }
  );

  app.post(
    "/api/communities/:id/leave",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { id } = req.params as { id: string };
      await prisma.communityMember.deleteMany({
        where: { communityId: id, userId: req.user.sub },
      });
      return reply.send({ joined: false });
    }
  );

  // Community detail: info + a page of visible posts (cursor = post id).
  app.get(
    "/api/communities/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { id } = req.params as { id: string };
      const { cursor } = req.query as { cursor?: string };
      const community = await prisma.community.findUnique({
        where: { id },
        include: {
          _count: { select: { members: true } },
          children: { select: { id: true, name: true, slug: true } },
        },
      });
      if (!community) {
        return reply.code(404).send({ error: "Community not found" });
      }

      const PAGE = 20;
      const posts = await prisma.communityPost.findMany({
        where: { communityId: id, status: "visible" },
        orderBy: { createdAt: "desc" },
        take: PAGE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          author: { select: { name: true, username: true } },
          _count: {
            select: {
              replies: { where: { status: "visible" } },
              reactions: true,
            },
          },
          reactions: { where: { userId: req.user.sub }, select: { id: true } },
        },
      });
      const hasMore = posts.length > PAGE;
      const page = posts.slice(0, PAGE);
      const membership = await membershipOf(req.user.sub, id);

      return reply.send({
        community: {
          id: community.id,
          slug: community.slug,
          name: community.name,
          description: community.description,
          parentId: community.parentId,
          members: community._count.members,
          children: community.children,
          joined: Boolean(membership),
        },
        posts: page.map((p) => ({
          id: p.id,
          kind: p.kind,
          title: p.title,
          author: authorName(p.author),
          mine: p.authorId === req.user.sub,
          replies: p._count.replies,
          helpful: p._count.reactions,
          reactedByMe: p.reactions.length > 0,
          createdAt: p.createdAt,
        })),
        nextCursor: hasMore ? page[page.length - 1]?.id : null,
      });
    }
  );

  // Create a post. Members only, rate-limited, spam-screened.
  app.post(
    "/api/communities/:id/posts",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { id } = req.params as { id: string };
      const parsed = postSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "A post needs a title (4-140 chars) and a body (up to 5000).",
        });
      }
      const membership = await membershipOf(req.user.sub, id);
      if (!membership) {
        return reply.code(403).send({ error: "Join the community to post in it." });
      }
      const screened = screenText(`${parsed.data.title}\n${parsed.data.body}`);
      if (!screened.ok) {
        return reply.code(400).send({ error: screened.reason });
      }

      const post = await prisma.communityPost.create({
        data: {
          communityId: id,
          authorId: req.user.sub,
          kind: parsed.data.kind,
          title: parsed.data.title.trim(),
          body: parsed.data.body.trim(),
        },
      });
      await track(req.user.sub, "community_post_created", {
        communityId: id,
        postId: post.id,
        kind: post.kind,
      });
      return reply.code(201).send({ post: { id: post.id } });
    }
  );

  // Post detail with visible replies.
  app.get(
    "/api/communities/posts/:postId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { postId } = req.params as { postId: string };
      const post = await prisma.communityPost.findFirst({
        where: { id: postId, status: "visible" },
        include: {
          author: { select: { name: true, username: true } },
          community: { select: { id: true, name: true, slug: true } },
          _count: { select: { reactions: true } },
          reactions: { where: { userId: req.user.sub }, select: { id: true } },
          replies: {
            where: { status: "visible" },
            orderBy: { createdAt: "asc" },
            take: 200,
            include: {
              author: { select: { name: true, username: true } },
              _count: { select: { reactions: true } },
              reactions: { where: { userId: req.user.sub }, select: { id: true } },
            },
          },
        },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }
      const membership = await membershipOf(req.user.sub, post.community.id);
      return reply.send({
        post: {
          id: post.id,
          kind: post.kind,
          title: post.title,
          body: post.body,
          author: authorName(post.author),
          mine: post.authorId === req.user.sub,
          helpful: post._count.reactions,
          reactedByMe: post.reactions.length > 0,
          createdAt: post.createdAt,
          community: post.community,
          canReply: Boolean(membership),
          replies: post.replies.map((r) => ({
            id: r.id,
            body: r.body,
            author: authorName(r.author),
            mine: r.authorId === req.user.sub,
            helpful: r._count.reactions,
            reactedByMe: r.reactions.length > 0,
            createdAt: r.createdAt,
          })),
        },
      });
    }
  );

  // Reply to a post. Requires membership of the post's community.
  app.post(
    "/api/communities/posts/:postId/replies",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { postId } = req.params as { postId: string };
      const parsed = replySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "A reply needs 1-3000 characters." });
      }
      const post = await prisma.communityPost.findFirst({
        where: { id: postId, status: "visible" },
        select: { communityId: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }
      const membership = await membershipOf(req.user.sub, post.communityId);
      if (!membership) {
        return reply.code(403).send({ error: "Join the community to reply." });
      }
      const screened = screenText(parsed.data.body);
      if (!screened.ok) {
        return reply.code(400).send({ error: screened.reason });
      }
      const row = await prisma.communityReply.create({
        data: {
          postId,
          authorId: req.user.sub,
          body: parsed.data.body.trim(),
        },
      });
      await track(req.user.sub, "community_reply_created", { postId, replyId: row.id });
      return reply.code(201).send({ reply: { id: row.id } });
    }
  );

  // Toggle a "helpful" reaction on a post or reply.
  app.post(
    "/api/communities/posts/:postId/react",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { postId } = req.params as { postId: string };
      const post = await prisma.communityPost.findFirst({
        where: { id: postId, status: "visible" },
        select: { id: true },
      });
      if (!post) return reply.code(404).send({ error: "Post not found" });
      const existing = await prisma.communityReaction.findFirst({
        where: { userId: req.user.sub, postId, kind: "helpful" },
      });
      if (existing) {
        await prisma.communityReaction.delete({ where: { id: existing.id } });
        return reply.send({ reacted: false });
      }
      await prisma.communityReaction.create({
        data: { userId: req.user.sub, postId, kind: "helpful" },
      });
      return reply.send({ reacted: true });
    }
  );

  app.post(
    "/api/communities/replies/:replyId/react",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { replyId } = req.params as { replyId: string };
      const row = await prisma.communityReply.findFirst({
        where: { id: replyId, status: "visible" },
        select: { id: true },
      });
      if (!row) return reply.code(404).send({ error: "Reply not found" });
      const existing = await prisma.communityReaction.findFirst({
        where: { userId: req.user.sub, replyId, kind: "helpful" },
      });
      if (existing) {
        await prisma.communityReaction.delete({ where: { id: existing.id } });
        return reply.send({ reacted: false });
      }
      await prisma.communityReaction.create({
        data: { userId: req.user.sub, replyId, kind: "helpful" },
      });
      return reply.send({ reacted: true });
    }
  );

  // Authors can take down their own content (soft delete keeps the audit trail).
  app.delete(
    "/api/communities/posts/:postId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { postId } = req.params as { postId: string };
      const post = await prisma.communityPost.findFirst({
        where: { id: postId, authorId: req.user.sub, status: "visible" },
        select: { id: true },
      });
      if (!post) return reply.code(404).send({ error: "Post not found" });
      await prisma.communityPost.update({
        where: { id: postId },
        data: { status: "removed" },
      });
      return reply.send({ removed: true });
    }
  );

  app.delete(
    "/api/communities/replies/:replyId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { replyId } = req.params as { replyId: string };
      const row = await prisma.communityReply.findFirst({
        where: { id: replyId, authorId: req.user.sub, status: "visible" },
        select: { id: true },
      });
      if (!row) return reply.code(404).send({ error: "Reply not found" });
      await prisma.communityReply.update({
        where: { id: replyId },
        data: { status: "removed" },
      });
      return reply.send({ removed: true });
    }
  );

  // Report content for review. Any signed-in non-guest can report.
  app.post(
    "/api/communities/reports",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await rejectGuests(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const parsed = reportSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid report" });
      }
      const { targetType, targetId, reason, detail } = parsed.data;
      const target =
        targetType === "post"
          ? await prisma.communityPost.findUnique({ where: { id: targetId }, select: { id: true } })
          : await prisma.communityReply.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!target) {
        return reply.code(404).send({ error: "Content not found" });
      }
      await prisma.contentReport.create({
        data: {
          reporterId: req.user.sub,
          targetType,
          targetId,
          reason,
          detail: detail ?? null,
        },
      });
      await track(req.user.sub, "content_reported", { targetType, targetId, reason });
      return reply.code(201).send({
        message: "Thanks — a human will review this.",
      });
    }
  );

  // --- Ops: the moderation queue. Same CRON_SECRET guard as other ops routes.
  app.get("/api/ops/reports", async (req, reply) => {
    if (!opsAuthorized(req.headers["x-cron-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const reports = await prisma.contentReport.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    // Attach the reported content so review doesn't need DB access.
    // (Explicitly typed: the relaxed production build has noImplicitAny off,
    // which turns a bare [] into never[].)
    const out: {
      id: string;
      targetType: string;
      targetId: string;
      reason: string;
      detail: string | null;
      content: string | null;
      createdAt: Date;
    }[] = [];
    for (const r of reports) {
      let content: string | null = null;
      if (r.targetType === "post") {
        const p = await prisma.communityPost.findUnique({
          where: { id: r.targetId },
          select: { title: true, body: true, status: true },
        });
        content = p ? `[${p.status}] ${p.title}\n${p.body.slice(0, 500)}` : null;
      } else if (r.targetType === "reply") {
        const rep = await prisma.communityReply.findUnique({
          where: { id: r.targetId },
          select: { body: true, status: true },
        });
        content = rep ? `[${rep.status}] ${rep.body.slice(0, 500)}` : null;
      } else if (r.targetType === "message") {
        // Reported DMs (Phase 12) land in the same queue.
        const dm = await prisma.directMessage.findUnique({
          where: { id: r.targetId },
          select: { body: true },
        });
        content = dm ? `[dm] ${dm.body.slice(0, 500)}` : null;
      } else if (r.targetType === "creator_video") {
        // Reported creator videos (Phase 16) too.
        const cv = await prisma.creatorVideo.findUnique({
          where: { id: r.targetId },
          select: { title: true, caption: true, status: true },
        });
        content = cv
          ? `[creator_video ${cv.status}] ${cv.title}\n${cv.caption.slice(0, 400)}`
          : null;
      } else if (r.targetType === "user") {
        // Reported users (safety spec). Resolution is human-only: "remove"
        // deliberately touches nothing here — accounts are never auto-deleted.
        const u = await prisma.user.findUnique({
          where: { id: r.targetId },
          select: { name: true, username: true, deletedAt: true },
        });
        content = u
          ? `[user${u.deletedAt ? " (deleted)" : ""}] ${u.username ?? u.name}`
          : null;
      }
      out.push({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        detail: r.detail,
        content,
        createdAt: r.createdAt,
      });
    }
    return reply.send({ reports: out });
  });

  app.post("/api/ops/reports/:id/resolve", async (req, reply) => {
    if (!opsAuthorized(req.headers["x-cron-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { id } = req.params as { id: string };
    const body = z
      .object({ action: z.enum(["remove", "dismiss"]) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "action must be remove|dismiss" });
    }
    const report = await prisma.contentReport.findUnique({ where: { id } });
    if (!report || report.status !== "open") {
      return reply.code(404).send({ error: "Open report not found" });
    }
    if (body.data.action === "remove") {
      if (report.targetType === "post") {
        await prisma.communityPost.updateMany({
          where: { id: report.targetId },
          data: { status: "removed" },
        });
      } else if (report.targetType === "reply") {
        await prisma.communityReply.updateMany({
          where: { id: report.targetId },
          data: { status: "removed" },
        });
      } else if (report.targetType === "message") {
        // DMs have no status column; moderation blanks the body so the
        // thread keeps its shape without keeping the content.
        await prisma.directMessage.updateMany({
          where: { id: report.targetId },
          data: { body: "[removed by moderation]" },
        });
      } else if (report.targetType === "creator_video") {
        await prisma.creatorVideo.updateMany({
          where: { id: report.targetId },
          data: {
            status: "rejected",
            moderationStatus: "rejected",
            visibility: "private",
          },
        });
      }
    }
    await prisma.contentReport.update({
      where: { id },
      data: {
        status: body.data.action === "remove" ? "actioned" : "dismissed",
        resolvedAt: new Date(),
      },
    });
    return reply.send({ resolved: true, action: body.data.action });
  });
}
