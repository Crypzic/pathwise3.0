// Study Buddy Rooms (PATHWISE 2.0 Phases 11/19 — collaborative study MVP).
//
// A focused space for one buddy pair: chat, a shared focus topic (by NAME,
// never a link into private files), and the PATHWISE facilitator — which
// speaks ONLY when both participants have recently asked for help, and
// whose every reply passes the same anti-answer-leak guard as the 1:1
// tutor. It facilitates the pair's own reasoning; it doesn't replace it.
// Buddies-only, so guests can never reach this surface.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { pairKey } from "../lib/dmModel.js";
import { areBuddies } from "../lib/buddies.js";
import { bothWantHelp, helpActive, helpFieldFor } from "../lib/roomModel.js";
import { screenText } from "../lib/communityModel.js";
import { socraticReply } from "../lib/aiMeter.js";
import { detectAnswerLeak, fallbackProbe } from "../lib/socraticGuard.js";
import { AIBudgetExceededError } from "../lib/aiMeter.js";
import { track } from "../lib/analytics.js";
import type { ChatMessage } from "../ai/types.js";

function partnerName(u: { name: string; username: string | null }): string {
  return u.username ?? u.name;
}

function shapedMessage(m: {
  id: string;
  senderId: string | null;
  role: string;
  content: string;
  createdAt: Date;
}, me: string) {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    mine: m.senderId === me,
    content: m.content,
    createdAt: m.createdAt,
  };
}

export default async function roomRoutes(app: FastifyInstance) {
  // Open (or return) the room for a buddy pair.
  app.post(
    "/api/rooms",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const parsed = z
        .object({ buddyId: z.string().min(1) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Send { buddyId }" });
      }
      const { buddyId } = parsed.data;
      if (buddyId === req.user.sub) {
        return reply.code(400).send({ error: "That's you." });
      }
      if (!(await areBuddies(req.user.sub, buddyId))) {
        return reply
          .code(403)
          .send({ error: "Study rooms open between accepted buddies." });
      }
      const [aId, bId] = pairKey(req.user.sub, buddyId);
      const room = await prisma.studyRoom.upsert({
        where: { aId_bId: { aId, bId } },
        create: { aId, bId },
        // Re-opening an ended room revives it — the pair is the identity.
        update: { status: "active", endedAt: null },
      });
      await track(req.user.sub, "study_room_opened", { roomId: room.id });
      return reply.code(201).send({ room: { id: room.id } });
    }
  );

  // My rooms.
  app.get(
    "/api/rooms",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const me = req.user.sub;
      const rooms = await prisma.studyRoom.findMany({
        where: { OR: [{ aId: me }, { bId: me }], status: "active" },
        include: {
          a: { select: { id: true, name: true, username: true } },
          b: { select: { id: true, name: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({
        rooms: rooms.map((r) => ({
          id: r.id,
          with: partnerName(r.aId === me ? r.b : r.a),
          topicName: r.topicName,
        })),
      });
    }
  );

  // Room detail + transcript. Participants only.
  app.get(
    "/api/rooms/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const room = await prisma.studyRoom.findFirst({
        where: { id, OR: [{ aId: me }, { bId: me }] },
        include: {
          a: { select: { id: true, name: true, username: true } },
          b: { select: { id: true, name: true, username: true } },
          messages: { orderBy: { createdAt: "asc" }, take: 300 },
        },
      });
      if (!room) return reply.code(404).send({ error: "Room not found" });

      const myHelpField = helpFieldFor(room, me);
      const myHelpAt = myHelpField ? room[myHelpField] : null;
      const partnerHelpAt =
        myHelpField === "helpAAt" ? room.helpBAt : room.helpAAt;

      return reply.send({
        room: {
          id: room.id,
          with: partnerName(room.aId === me ? room.b : room.a),
          withId: room.aId === me ? room.bId : room.aId,
          topicName: room.topicName,
          status: room.status,
          myHelpPending: helpActive(myHelpAt),
          partnerWantsHelp: helpActive(partnerHelpAt),
          messages: room.messages.map((m) => shapedMessage(m, me)),
        },
      });
    }
  );

  // Chat. Screened + rate-limited like every text surface.
  app.post(
    "/api/rooms/:id/messages",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const parsed = z
        .object({ content: z.string().min(1).max(2000) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "A message needs 1-2000 characters." });
      }
      const room = await prisma.studyRoom.findFirst({
        where: { id, status: "active", OR: [{ aId: me }, { bId: me }] },
      });
      if (!room) return reply.code(404).send({ error: "Room not found" });
      const screened = screenText(parsed.data.content);
      if (!screened.ok) {
        return reply.code(400).send({ error: screened.reason });
      }
      const message = await prisma.studyRoomMessage.create({
        data: { roomId: id, senderId: me, content: parsed.data.content.trim() },
      });
      return reply.code(201).send({ message: shapedMessage(message, me) });
    }
  );

  // Set/change the focus topic (a NAME, bounded — derived metadata only).
  app.post(
    "/api/rooms/:id/topic",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const parsed = z
        .object({ topicName: z.string().min(2).max(80) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "topicName needs 2-80 characters." });
      }
      const room = await prisma.studyRoom.findFirst({
        where: { id, status: "active", OR: [{ aId: me }, { bId: me }] },
      });
      if (!room) return reply.code(404).send({ error: "Room not found" });
      const topicName = parsed.data.topicName.replace(/\s+/g, " ").trim();
      await prisma.studyRoom.update({ where: { id }, data: { topicName } });
      return reply.send({ topicName });
    }
  );

  // Ask PATHWISE for help. The facilitator only answers once BOTH
  // participants have an active request — one-sided asks just mark intent.
  app.post(
    "/api/rooms/:id/help",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 15, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const room = await prisma.studyRoom.findFirst({
        where: { id, status: "active", OR: [{ aId: me }, { bId: me }] },
      });
      if (!room) return reply.code(404).send({ error: "Room not found" });

      const field = helpFieldFor(room, me);
      if (!field) return reply.code(404).send({ error: "Room not found" });
      const now = new Date();
      const updated = await prisma.studyRoom.update({
        where: { id },
        data: { [field]: now },
      });

      if (!bothWantHelp(updated.helpAAt, updated.helpBAt, now)) {
        return reply.send({
          facilitated: false,
          message:
            "Noted — PATHWISE joins in when your buddy asks for help too.",
        });
      }

      // Both asked: build the recent transcript and get a GUARDED reply.
      const recent = await prisma.studyRoomMessage.findMany({
        where: { roomId: id },
        orderBy: { createdAt: "desc" },
        take: 12,
      });
      const history: ChatMessage[] = recent
        .reverse()
        .map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        }));
      if (history.length === 0) {
        history.push({
          role: "user",
          content: `We're studying ${room.topicName ?? "together"} and we're both stuck. Where should we start?`,
        });
      }

      let text: string;
      try {
        const raw = await socraticReply(
          me,
          "Study room",
          updated.topicName,
          history,
          {
            grounding:
              "You are facilitating TWO students studying together" +
              (updated.topicName ? ` on ${updated.topicName}` : "") +
              ". Address them as a pair, get them explaining to each other, " +
              "and never do the reasoning for them.",
          }
        );
        const verdict = detectAnswerLeak(raw);
        text = verdict.leaked ? fallbackProbe(history.length) : raw;
      } catch (err) {
        if (err instanceof AIBudgetExceededError) {
          return reply.code(429).send({ error: err.message });
        }
        throw err;
      }

      const message = await prisma.studyRoomMessage.create({
        data: { roomId: id, senderId: null, role: "assistant", content: text },
      });
      // Both requests are consumed by one intervention.
      await prisma.studyRoom.update({
        where: { id },
        data: { helpAAt: null, helpBAt: null },
      });
      await track(me, "study_room_facilitated", { roomId: id });
      return reply.send({
        facilitated: true,
        message: shapedMessage(message, me),
      });
    }
  );

  // End the session. Either participant can.
  app.post(
    "/api/rooms/:id/end",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const me = req.user.sub;
      const { id } = req.params as { id: string };
      const room = await prisma.studyRoom.findFirst({
        where: { id, status: "active", OR: [{ aId: me }, { bId: me }] },
        select: { id: true },
      });
      if (!room) return reply.code(404).send({ error: "Room not found" });
      await prisma.studyRoom.update({
        where: { id },
        data: { status: "ended", endedAt: new Date(), helpAAt: null, helpBAt: null },
      });
      return reply.send({ ended: true });
    }
  );
}
