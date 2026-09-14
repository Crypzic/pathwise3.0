// Direct Messaging (PATHWISE 2.0 Phase 12).
//
// Private learner-to-learner conversations. Buddies talk immediately;
// anyone else's first message is a MESSAGE REQUEST the recipient accepts or
// declines. Abuse controls ship with the surface: block (both directions
// silenced), mute, report-a-message into the ops queue, spam screening and
// rate limits. Account-gated per the roadmap — guests get 403.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { isGuestUser } from "../lib/guests.js";
import { canSend, pairKey } from "../lib/dmModel.js";
import { areBuddies, blockedUserIds, isBlockedEitherWay } from "../lib/buddies.js";
import { screenText } from "../lib/communityModel.js";
import { deliver } from "../lib/notifications.js";
import { track } from "../lib/analytics.js";
import { avatarUrlFor } from "./profile.js";
import { mentionsPathwise, pathwiseBotId, respondInDm } from "../lib/pathwiseBot.js";

const GUEST_MESSAGE = "Messages need an account — create one to keep your identity.";

const startSchema = z.object({
  toId: z.string().min(1),
  body: z.string().min(1).max(3000),
});

const messageSchema = z.object({
  body: z.string().min(1).max(3000),
  // Swipe-to-reply (Phase 2): id of the message being quoted, if any.
  replyToId: z.string().min(1).optional(),
});

function displayName(u: { name: string; username: string | null }): string {
  return u.username ?? u.name;
}

export default async function dmRoutes(app: FastifyInstance) {
  // Conversation list: active + incoming requests, with unread counts.
  app.get(
    "/api/dms",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const conversations = await prisma.conversation.findMany({
        where: {
          OR: [{ aId: me }, { bId: me }],
          status: { in: ["pending", "active"] },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 50,
        include: {
          a: { select: { id: true, name: true, username: true, avatarPath: true, avatarFrame: true } },
          b: { select: { id: true, name: true, username: true, avatarPath: true, avatarFrame: true } },
          states: { where: { userId: me } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      const rows: {
        id: string;
        with: string;
        withId: string;
        withAvatarUrl: string | null;
        withAvatarFrame: string;
        status: string;
        incomingRequest: boolean;
        muted: boolean;
        unread: number;
        lastMessage: string | null;
        lastMessageAt: Date;
      }[] = [];
      // Blocked pairs vanish from the inbox — the thread comes back if the
      // block is lifted, nothing is deleted.
      const blocked = await blockedUserIds(me);
      for (const c of conversations) {
        const other = c.aId === me ? c.b : c.a;
        if (blocked.has(other.id)) continue;
        const state = c.states[0];
        const unread = await prisma.directMessage.count({
          where: {
            conversationId: c.id,
            senderId: { not: me },
            ...(state?.lastReadAt ? { createdAt: { gt: state.lastReadAt } } : {}),
          },
        });
        rows.push({
          id: c.id,
          with: displayName(other),
          withId: other.id,
          withAvatarUrl: avatarUrlFor({ id: other.id, avatarPath: other.avatarPath ?? null }),
          withAvatarFrame: other.avatarFrame ?? "classic",
          status: c.status,
          // A pending conversation is an incoming request only for the
          // recipient; for the requester it's just "waiting".
          incomingRequest: c.status === "pending" && c.requesterId !== me,
          muted: Boolean(state?.mutedAt),
          unread,
          lastMessage: c.messages[0]?.body.slice(0, 80) ?? null,
          lastMessageAt: c.lastMessageAt,
        });
      }
      return reply.send({ conversations: rows });
    }
  );

  // Start a conversation (or add to your own pending request).
  app.post(
    "/api/dms",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "A message needs 1-3000 characters." });
      }
      const { toId, body } = parsed.data;
      if (toId === me) {
        return reply.code(400).send({ error: "That's you." });
      }
      const them = await prisma.user.findFirst({
        where: { id: toId, isGuest: false, deletedAt: null },
        select: { id: true },
      });
      if (!them) {
        return reply.code(404).send({ error: "Learner not found" });
      }
      if (await isBlockedEitherWay(me, toId)) {
        return reply.code(403).send({ error: "You can't message this learner." });
      }
      const screened = screenText(body);
      if (!screened.ok) {
        return reply.code(400).send({ error: screened.reason });
      }

      const [aId, bId] = pairKey(me, toId);
      const buddies = await areBuddies(me, toId);

      let conversation = await prisma.conversation.findUnique({
        where: { aId_bId: { aId, bId } },
      });
      if (conversation?.status === "declined") {
        return reply.code(403).send({ error: "This conversation was declined." });
      }
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            aId,
            bId,
            requesterId: me,
            status: buddies ? "active" : "pending",
          },
        });
        if (!buddies) {
          await deliver(
            toId,
            {
              kind: "buddy",
              title: "New message request",
              body: "Someone studying similar things wants to talk.",
              deepLink: "/messages",
            },
            `dm-request#${conversation.id}`
          );
        }
      } else {
        const sendable = canSend(conversation, me);
        if (!sendable.ok) {
          return reply.code(403).send({ error: sendable.reason });
        }
      }

      const message = await prisma.directMessage.create({
        data: { conversationId: conversation.id, senderId: me, body: body.trim() },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.createdAt },
      });
      await track(me, "dm_sent", { conversationId: conversation.id, first: true });
      return reply.code(201).send({
        conversation: { id: conversation.id, status: conversation.status },
      });
    }
  );

  // One conversation with its messages. Reading marks it read.
  app.get(
    "/api/dms/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const c = await prisma.conversation.findFirst({
        where: { id, OR: [{ aId: me }, { bId: me }] },
        include: {
          a: { select: { id: true, name: true, username: true, avatarPath: true, avatarFrame: true } },
          b: { select: { id: true, name: true, username: true, avatarPath: true, avatarFrame: true } },
          messages: { orderBy: { createdAt: "asc" }, take: 200 },
          states: { where: { userId: me } },
        },
      });
      if (!c || c.status === "declined") {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      const other = c.aId === me ? c.b : c.a;

      await prisma.conversationState.upsert({
        where: { conversationId_userId: { conversationId: id, userId: me } },
        create: { conversationId: id, userId: me, lastReadAt: new Date() },
        update: { lastReadAt: new Date() },
      });

      // @pathwise replies render under the assistant's own identity, and
      // quoted messages resolve against this same page of the thread.
      const botId = await pathwiseBotId();
      const byId = new Map(c.messages.map((m) => [m.id, m]));

      return reply.send({
        conversation: {
          id: c.id,
          with: displayName(other),
          withId: other.id,
          withAvatarUrl: avatarUrlFor({ id: other.id, avatarPath: other.avatarPath ?? null }),
          withAvatarFrame: other.avatarFrame ?? "classic",
          status: c.status,
          incomingRequest: c.status === "pending" && c.requesterId !== me,
          muted: Boolean(c.states[0]?.mutedAt),
          messages: c.messages.map((m) => {
            const quoted = m.replyToId ? byId.get(m.replyToId) : undefined;
            return {
              id: m.id,
              mine: m.senderId === me,
              fromAi: m.senderId === botId,
              body: m.body,
              replyTo: quoted
                ? {
                    id: quoted.id,
                    body: quoted.body.slice(0, 140),
                    mine: quoted.senderId === me,
                    fromAi: quoted.senderId === botId,
                  }
                : null,
              createdAt: m.createdAt,
            };
          }),
        },
      });
    }
  );

  // Send into an existing conversation.
  app.post(
    "/api/dms/:id/messages",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const parsed = messageSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "A message needs 1-3000 characters." });
      }
      const c = await prisma.conversation.findFirst({
        where: { id, OR: [{ aId: me }, { bId: me }] },
      });
      if (!c) return reply.code(404).send({ error: "Conversation not found" });

      const other = c.aId === me ? c.bId : c.aId;
      if (await isBlockedEitherWay(me, other)) {
        return reply.code(403).send({ error: "You can't message this learner." });
      }
      const sendable = canSend(c, me);
      if (!sendable.ok) {
        return reply.code(403).send({ error: sendable.reason });
      }
      const screened = screenText(parsed.data.body);
      if (!screened.ok) {
        return reply.code(400).send({ error: screened.reason });
      }

      // A quoted message must belong to THIS conversation.
      let replyToId: string | null = null;
      if (parsed.data.replyToId) {
        const quoted = await prisma.directMessage.findFirst({
          where: { id: parsed.data.replyToId, conversationId: id },
          select: { id: true },
        });
        replyToId = quoted?.id ?? null;
      }

      const message = await prisma.directMessage.create({
        data: {
          conversationId: id,
          senderId: me,
          body: parsed.data.body.trim(),
          replyToId,
        },
      });
      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: message.createdAt },
      });
      await track(me, "dm_sent", { conversationId: id, first: false });

      // "@pathwise …" summons the assistant (Phase 2.4). Background — the
      // send stays instant; the thread poll picks the reply up.
      if (mentionsPathwise(parsed.data.body)) {
        void respondInDm(id, me).catch((err) =>
          req.log.error({ err, conversationId: id }, "@pathwise dm reply failed")
        );
      }

      return reply.code(201).send({
        message: { id: message.id, body: message.body, createdAt: message.createdAt, mine: true },
      });
    }
  );

  // Accept or decline a message request — recipient only.
  app.post(
    "/api/dms/:id/respond",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const parsed = z
        .object({ action: z.enum(["accept", "decline"]) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "action must be accept|decline" });
      }
      const c = await prisma.conversation.findFirst({
        where: {
          id,
          status: "pending",
          requesterId: { not: me },
          OR: [{ aId: me }, { bId: me }],
        },
      });
      if (!c) {
        return reply.code(404).send({ error: "Pending request not found" });
      }
      const status = parsed.data.action === "accept" ? "active" : "declined";
      await prisma.conversation.update({ where: { id }, data: { status } });
      await track(me, "dm_request_responded", { id, status });
      return reply.send({ status });
    }
  );

  // Mute / unmute a conversation (stops nothing server-side but hides noise).
  app.post(
    "/api/dms/:id/mute",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const parsed = z.object({ on: z.boolean() }).safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Send { on: true | false }" });
      }
      const c = await prisma.conversation.findFirst({
        where: { id, OR: [{ aId: me }, { bId: me }] },
        select: { id: true },
      });
      if (!c) return reply.code(404).send({ error: "Conversation not found" });
      await prisma.conversationState.upsert({
        where: { conversationId_userId: { conversationId: id, userId: me } },
        create: { conversationId: id, userId: me, mutedAt: parsed.data.on ? new Date() : null },
        update: { mutedAt: parsed.data.on ? new Date() : null },
      });
      return reply.send({ muted: parsed.data.on });
    }
  );

  // Block / unblock a user. Blocking silences both directions immediately.
  app.post(
    "/api/dms/block",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const parsed = z
        .object({ userId: z.string().min(1), on: z.boolean() })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Send { userId, on }" });
      }
      const { userId, on } = parsed.data;
      if (userId === me) {
        return reply.code(400).send({ error: "That's you." });
      }
      if (on) {
        await prisma.userBlock.upsert({
          where: { blockerId_blockedId: { blockerId: me, blockedId: userId } },
          create: { blockerId: me, blockedId: userId },
          update: {},
        });
      } else {
        await prisma.userBlock.deleteMany({
          where: { blockerId: me, blockedId: userId },
        });
      }
      await track(me, "dm_block_toggled", { userId, on });
      return reply.send({ blocked: on });
    }
  );

  // Nav badge counts (Phase 2.2): unread DMs, pending buddy requests, and
  // unread community notifications — one cheap call the shell can poll.
  app.get(
    "/api/badges",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const me = req.user.sub;
      if (await isGuestUser(me)) {
        return reply.send({ messages: 0, buddies: 0, communities: 0 });
      }
      const conversations = await prisma.conversation.findMany({
        where: { OR: [{ aId: me }, { bId: me }], status: { in: ["pending", "active"] } },
        select: {
          id: true,
          aId: true,
          bId: true,
          states: { where: { userId: me }, select: { lastReadAt: true } },
        },
        take: 50,
      });
      const blocked = await blockedUserIds(me);
      let messages = 0;
      for (const c of conversations) {
        const otherId = c.aId === me ? c.bId : c.aId;
        if (blocked.has(otherId)) continue;
        const lastReadAt = c.states[0]?.lastReadAt;
        messages += await prisma.directMessage.count({
          where: {
            conversationId: c.id,
            senderId: { not: me },
            ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
          },
        });
      }
      const [buddies, communities] = await Promise.all([
        prisma.buddyRequest.count({ where: { toId: me, status: "pending" } }),
        prisma.notificationLog.count({
          where: { userId: me, readAt: null, kind: "community" },
        }),
      ]);
      return reply.send({ messages, buddies, communities });
    }
  );

  // Find learners by username/name (Phase 2.3) — the "new message" search.
  // Guests, deleted, system identities and blocked pairs never appear.
  app.get(
    "/api/users/search",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const me = req.user.sub;
      if (await isGuestUser(me)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { q } = req.query as { q?: string };
      const query = (q ?? "").trim();
      if (query.length < 2) {
        return reply.send({ users: [] });
      }
      const blocked = await blockedUserIds(me);
      const found = await prisma.user.findMany({
        where: {
          id: { not: me },
          isGuest: false,
          isSystem: false,
          deletedAt: null,
          OR: [{ username: { contains: query } }, { name: { contains: query } }],
        },
        select: {
          id: true,
          name: true,
          username: true,
          avatarPath: true,
          avatarFrame: true,
        },
        take: 12,
      });
      return reply.send({
        users: found
          .filter((u) => !blocked.has(u.id))
          .map((u) => ({
            userId: u.id,
            name: displayName(u),
            avatarUrl: avatarUrlFor({ id: u.id, avatarPath: u.avatarPath }),
            avatarFrame: u.avatarFrame ?? "classic",
          })),
      });
    }
  );

  // Who have I blocked? Powers the "Blocked users" manager in settings.
  app.get(
    "/api/dms/blocked",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const rows = await prisma.userBlock.findMany({
        where: { blockerId: req.user.sub },
        orderBy: { createdAt: "desc" },
        include: {
          blocked: { select: { id: true, name: true, username: true } },
        },
      });
      return reply.send({
        blocked: rows.map((b) => ({
          userId: b.blocked.id,
          name: displayName(b.blocked),
          since: b.createdAt,
        })),
      });
    }
  );

  // Find my conversation with one user — lets a buddy row jump straight
  // into the thread. Buddy pairs from before conversations auto-opened on
  // accept get healed here: if we're buddies and no conversation exists,
  // one is created (active) on the spot.
  app.get(
    "/api/dms/with/:userId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const me = req.user.sub;
      const { userId } = req.params as { userId: string };
      const [aId, bId] = pairKey(me, userId);
      let conversation = await prisma.conversation.findUnique({
        where: { aId_bId: { aId, bId } },
        select: { id: true, status: true },
      });
      if (
        !conversation &&
        !(await isBlockedEitherWay(me, userId)) &&
        (await areBuddies(me, userId))
      ) {
        conversation = await prisma.conversation.create({
          data: { aId, bId, requesterId: me, status: "active" },
          select: { id: true, status: true },
        });
      }
      return reply.send({ conversation });
    }
  );

  // Report a USER (not a specific message) into the same moderation queue.
  // Reasons follow the safety spec; the reviewer decides what happens next —
  // resolution never deletes an account automatically.
  app.post(
    "/api/users/:userId/report",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const { userId } = req.params as { userId: string };
      if (userId === me) {
        return reply.code(400).send({ error: "That's you." });
      }
      const parsed = z
        .object({
          reason: z.enum(["harassment", "abuse", "spam", "inappropriate", "other"]),
          detail: z.string().max(1000).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid report" });
      }
      const target = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      });
      if (!target) {
        return reply.code(404).send({ error: "Learner not found" });
      }
      await prisma.contentReport.create({
        data: {
          reporterId: me,
          targetType: "user",
          targetId: userId,
          reason: parsed.data.reason,
          detail: parsed.data.detail ?? null,
        },
      });
      await track(me, "user_reported", { userId, reason: parsed.data.reason });
      return reply
        .code(201)
        .send({ message: "Thanks — a human will review this." });
    }
  );

  // Report a message into the ops moderation queue.
  app.post(
    "/api/dms/messages/:messageId/report",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const me = req.user.sub;
      const { messageId } = req.params as { messageId: string };
      const parsed = z
        .object({
          reason: z.enum(["spam", "harassment", "unsafe", "off_topic", "other"]),
          detail: z.string().max(1000).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid report" });
      }
      // Only a participant can report, and never their own message.
      const message = await prisma.directMessage.findFirst({
        where: {
          id: messageId,
          senderId: { not: me },
          conversation: { OR: [{ aId: me }, { bId: me }] },
        },
        select: { id: true },
      });
      if (!message) {
        return reply.code(404).send({ error: "Message not found" });
      }
      await prisma.contentReport.create({
        data: {
          reporterId: me,
          targetType: "message",
          targetId: messageId,
          reason: parsed.data.reason,
          detail: parsed.data.detail ?? null,
        },
      });
      await track(me, "content_reported", { targetType: "message", targetId: messageId });
      return reply.code(201).send({ message: "Thanks — a human will review this." });
    }
  );
}
