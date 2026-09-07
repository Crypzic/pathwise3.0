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
import { areBuddies } from "../lib/buddies.js";
import { screenText } from "../lib/communityModel.js";
import { deliver } from "../lib/notifications.js";
import { track } from "../lib/analytics.js";

const GUEST_MESSAGE = "Messages need an account — create one to keep your identity.";

const startSchema = z.object({
  toId: z.string().min(1),
  body: z.string().min(1).max(3000),
});

const messageSchema = z.object({
  body: z.string().min(1).max(3000),
});

function displayName(u: { name: string; username: string | null }): string {
  return u.username ?? u.name;
}

async function isBlockedEitherWay(x: string, y: string): Promise<boolean> {
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: x, blockedId: y },
        { blockerId: y, blockedId: x },
      ],
    },
    select: { id: true },
  });
  return Boolean(block);
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
          a: { select: { id: true, name: true, username: true } },
          b: { select: { id: true, name: true, username: true } },
          states: { where: { userId: me } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      const rows = [];
      for (const c of conversations) {
        const other = c.aId === me ? c.b : c.a;
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
          a: { select: { id: true, name: true, username: true } },
          b: { select: { id: true, name: true, username: true } },
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

      return reply.send({
        conversation: {
          id: c.id,
          with: displayName(other),
          withId: other.id,
          status: c.status,
          incomingRequest: c.status === "pending" && c.requesterId !== me,
          muted: Boolean(c.states[0]?.mutedAt),
          messages: c.messages.map((m) => ({
            id: m.id,
            mine: m.senderId === me,
            body: m.body,
            createdAt: m.createdAt,
          })),
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

      const message = await prisma.directMessage.create({
        data: { conversationId: id, senderId: me, body: parsed.data.body.trim() },
      });
      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: message.createdAt },
      });
      await track(me, "dm_sent", { conversationId: id, first: false });
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
