// Study Buddy Matching (PATHWISE 2.0 Phase 10).
//
// Suggested buddies from derived learning signals, then a request/accept
// handshake that creates the buddy pair later phases (rooms, DMs) build on.
// Strictly opt-in in BOTH directions: you see matches only while you're
// discoverable, and only discoverable people appear or can be requested.
// Account-gated like all social surfaces — guests get 403.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { isGuestUser } from "../lib/guests.js";
import { findMatches, signalsFor } from "../lib/matching.js";
import { deliver } from "../lib/notifications.js";
import { track } from "../lib/analytics.js";
import { screenText } from "../lib/communityModel.js";

const GUEST_MESSAGE =
  "Study buddies need an account — create one to keep your identity.";

const requestSchema = z.object({
  toId: z.string().min(1),
  message: z.string().max(500).optional(),
});

export default async function buddyRoutes(app: FastifyInstance) {
  // Suggested matches (empty + a flag while not discoverable).
  app.get(
    "/api/buddies/matches",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { discoverable, matches } = await findMatches(req.user.sub, 10);
      return reply.send({
        discoverable,
        matches: matches.map(({ candidate, match }) => ({
          userId: candidate.userId,
          name: candidate.name,
          field: candidate.field,
          academicLevel: candidate.academicLevel,
          studyStyle: candidate.studyStyle,
          score: Math.round(match.score * 100),
          reasons: match.reasons,
          sharedTopics: match.sharedTopics,
        })),
      });
    }
  );

  // Toggle discoverability — the privacy switch for the whole feature.
  app.post(
    "/api/buddies/discoverable",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const parsed = z.object({ on: z.boolean() }).safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Send { on: true | false }" });
      }
      const me = await signalsFor(req.user.sub);
      const nextPrefs = {
        ...(me?.buddyPrefs ?? {}),
        discoverable: parsed.data.on,
      };
      await prisma.learnerProfile.upsert({
        where: { userId: req.user.sub },
        create: {
          userId: req.user.sub,
          buddyPrefsJson: JSON.stringify(nextPrefs),
        },
        update: { buddyPrefsJson: JSON.stringify(nextPrefs) },
      });
      await track(req.user.sub, "buddy_discoverable_toggled", { on: parsed.data.on });
      return reply.send({ discoverable: parsed.data.on });
    }
  );

  // Send a buddy request. Both sides must be discoverable.
  app.post(
    "/api/buddies/requests",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }
      const { toId, message } = parsed.data;
      if (toId === req.user.sub) {
        return reply.code(400).send({ error: "That's you." });
      }
      if (message) {
        const screened = screenText(message);
        if (!screened.ok) {
          return reply.code(400).send({ error: screened.reason });
        }
      }

      const [me, them] = await Promise.all([
        signalsFor(req.user.sub),
        signalsFor(toId),
      ]);
      if (!me?.buddyPrefs.discoverable) {
        return reply
          .code(403)
          .send({ error: "Turn on discoverability to send buddy requests." });
      }
      if (!them?.buddyPrefs.discoverable) {
        return reply.code(404).send({ error: "That learner isn't discoverable." });
      }

      // A pair in either direction (pending or accepted) blocks a new request.
      const existing = await prisma.buddyRequest.findFirst({
        where: {
          OR: [
            { fromId: req.user.sub, toId },
            { fromId: toId, toId: req.user.sub },
          ],
          status: { in: ["pending", "accepted"] },
        },
      });
      if (existing) {
        return reply.code(409).send({
          error:
            existing.status === "accepted"
              ? "You're already buddies."
              : "There's already a pending request between you.",
        });
      }

      const request = await prisma.buddyRequest.create({
        data: {
          fromId: req.user.sub,
          toId,
          message: message?.trim() || null,
        },
      });
      await deliver(
        toId,
        {
          kind: "buddy",
          title: "New study buddy request",
          body: `${me.name} wants to study together.`,
          deepLink: "/buddies",
        },
        `buddy-request#${request.id}`
      );
      await track(req.user.sub, "buddy_request_sent", { toId });
      return reply.code(201).send({ request: { id: request.id } });
    }
  );

  // Incoming + outgoing requests.
  app.get(
    "/api/buddies/requests",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const [incoming, outgoing] = await Promise.all([
        prisma.buddyRequest.findMany({
          where: { toId: req.user.sub, status: "pending" },
          orderBy: { createdAt: "desc" },
          include: { from: { select: { name: true, username: true } } },
        }),
        prisma.buddyRequest.findMany({
          where: { fromId: req.user.sub, status: "pending" },
          orderBy: { createdAt: "desc" },
          include: { to: { select: { name: true, username: true } } },
        }),
      ]);
      return reply.send({
        incoming: incoming.map((r) => ({
          id: r.id,
          from: r.from.username ?? r.from.name,
          fromId: r.fromId,
          message: r.message,
          createdAt: r.createdAt,
        })),
        outgoing: outgoing.map((r) => ({
          id: r.id,
          to: r.to.username ?? r.to.name,
          toId: r.toId,
          createdAt: r.createdAt,
        })),
      });
    }
  );

  // Accept or decline — recipient only.
  app.post(
    "/api/buddies/requests/:id/respond",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const { id } = req.params as { id: string };
      const parsed = z
        .object({ action: z.enum(["accept", "decline"]) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "action must be accept|decline" });
      }
      const request = await prisma.buddyRequest.findFirst({
        where: { id, toId: req.user.sub, status: "pending" },
        include: { to: { select: { name: true, username: true } } },
      });
      if (!request) {
        return reply.code(404).send({ error: "Pending request not found" });
      }
      const status = parsed.data.action === "accept" ? "accepted" : "declined";
      await prisma.buddyRequest.update({
        where: { id },
        data: { status, respondedAt: new Date() },
      });
      if (status === "accepted") {
        await deliver(
          request.fromId,
          {
            kind: "buddy",
            title: "Buddy request accepted",
            body: `${request.to.username ?? request.to.name} accepted — you're study buddies now.`,
            deepLink: "/buddies",
          },
          `buddy-accepted#${request.id}`
        );
      }
      await track(req.user.sub, "buddy_request_responded", { id, status });
      return reply.send({ status });
    }
  );

  // Accepted buddies, either direction.
  app.get(
    "/api/buddies",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (await isGuestUser(req.user.sub)) {
        return reply.code(403).send({ error: GUEST_MESSAGE });
      }
      const pairs = await prisma.buddyRequest.findMany({
        where: {
          status: "accepted",
          OR: [{ fromId: req.user.sub }, { toId: req.user.sub }],
        },
        orderBy: { respondedAt: "desc" },
        include: {
          from: { select: { id: true, name: true, username: true } },
          to: { select: { id: true, name: true, username: true } },
        },
      });
      return reply.send({
        buddies: pairs.map((p) => {
          const other = p.fromId === req.user.sub ? p.to : p.from;
          return {
            userId: other.id,
            name: other.username ?? other.name,
            since: p.respondedAt,
          };
        }),
      });
    }
  );
}
