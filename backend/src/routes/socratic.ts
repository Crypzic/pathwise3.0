// Socratic Tutor Mode API (Step 7).
//
// Sessions can be started from anywhere (Study Plan, mid-quiz, a course page),
// which is why `origin` and `contextNote` are part of the create payload — the
// tutor needs to know the student got stuck on a specific quiz question, not
// just that they're studying this course.
//
// Every model reply passes through lib/socraticGuard.ts before it is stored or
// returned. A leaking reply is regenerated once with a targeted nudge; if it
// still leaks, a safe probe is substituted and the trip is recorded.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { socraticReply, AIBudgetExceededError } from "../lib/aiMeter.js";
import {
  detectAnswerLeak,
  detectExtractionAttempt,
  fallbackProbe,
  retryNudge,
} from "../lib/socraticGuard.js";
import { recordSocraticDepth } from "../lib/mastery.js";
import { isGuestUser } from "../lib/guests.js";
import { getConceptContext } from "../lib/knowledgeLayer.js";
import { stuckLevel } from "../lib/socraticAdaptModel.js";
import { awardXp, grantBadge, XP } from "../lib/gamification.js";
import { track } from "../lib/analytics.js";
import type { ChatMessage, SocraticContext } from "../ai/types.js";
import type { SocraticMessage } from "@prisma/client";

const createSchema = z.object({
  courseId: z.string().min(1),
  topicId: z.string().optional(),
  origin: z.enum(["study_plan", "quiz", "course", "dashboard"]).default("course"),
  contextNote: z.string().max(1000).optional(),
});

const messageSchema = z.object({
  content: z.string().min(1).max(2000),
});

// The opening turn is deterministic rather than model-generated: it costs
// nothing, it's reliably on-message, and it never leaks.
function openingTurn(topicName: string | null, contextNote?: string | null): string {
  if (contextNote) {
    return `Let's work through this together — I won't just tell you the answer. You're looking at: "${contextNote.slice(0, 200)}". What's your first instinct, and what makes you lean that way?`;
  }
  if (topicName) {
    return `Let's think about ${topicName} together. I won't hand you answers — I'll ask questions instead. What do you already understand about it, and where does it start feeling fuzzy?`;
  }
  return "Let's think this through together — I'll ask rather than tell. What are you working on, and what part is giving you trouble?";
}

function publicMessage(m: SocraticMessage) {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    createdAt: m.createdAt,
  };
}

/**
 * Get one guarded tutor reply.
 *
 * Returns the text to show plus whether the guard had to intervene, so the
 * session's guardTrips counter stays an honest prompt-quality metric.
 */
async function guardedReply(
  userId: string,
  courseName: string,
  topicName: string | null,
  history: ChatMessage[],
  turnIndex: number,
  ctx?: SocraticContext
): Promise<{ text: string; guarded: boolean; reason: string | null }> {
  const first = await socraticReply(userId, courseName, topicName, history, ctx);
  const firstVerdict = detectAnswerLeak(first);
  if (!firstVerdict.leaked) {
    return { text: first, guarded: false, reason: null };
  }

  // One retry, told exactly what went wrong.
  const retryHistory: ChatMessage[] = [
    ...history,
    { role: "assistant", content: first },
    { role: "user", content: retryNudge(firstVerdict.reason ?? "") },
  ];
  const second = await socraticReply(
    userId,
    courseName,
    topicName,
    retryHistory,
    ctx
  );
  const secondVerdict = detectAnswerLeak(second);
  if (!secondVerdict.leaked) {
    return { text: second, guarded: true, reason: firstVerdict.reason };
  }

  // Still leaking — never show it.
  return {
    text: fallbackProbe(turnIndex),
    guarded: true,
    reason: secondVerdict.reason,
  };
}

export default async function socraticRoutes(app: FastifyInstance) {
  // Start a session. The opening tutor turn is created with it.
  app.post("/api/socratic/sessions", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }
    const { courseId, topicId, origin, contextNote } = parsed.data;

    const course = await prisma.course.findFirst({
      where: { id: courseId, userId: req.user.sub },
    });
    if (!course) return reply.code(404).send({ error: "Course not found" });

    let topicName: string | null = null;
    if (topicId) {
      const topic = await prisma.topic.findFirst({
        where: { id: topicId, knowledgeMap: { courseId } },
      });
      if (!topic) return reply.code(404).send({ error: "Topic not found" });
      topicName = topic.name;
    }

    const session = await prisma.socraticSession.create({
      data: {
        userId: req.user.sub,
        courseId,
        topicId: topicId ?? null,
        origin,
        contextNote: contextNote ?? null,
        messages: {
          create: {
            role: "assistant",
            content: openingTurn(topicName, contextNote),
          },
        },
      },
      include: { messages: true },
    });

    await track(req.user.sub, "socratic_started", { courseId, topicId, origin });

    return reply.code(201).send({
      session: {
        id: session.id,
        courseId,
        courseName: course.name,
        topicId: session.topicId,
        topicName,
        status: session.status,
        turnCount: 0,
      },
      messages: session.messages.map(publicMessage),
    });
  });

  // Fetch a session with its transcript.
  app.get("/api/socratic/sessions/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await prisma.socraticSession.findFirst({
      where: { id, userId: req.user.sub },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        course: { select: { name: true } },
        topic: { select: { name: true } },
      },
    });
    if (!session) return reply.code(404).send({ error: "Session not found" });

    return reply.send({
      session: {
        id: session.id,
        courseId: session.courseId,
        courseName: session.course.name,
        topicId: session.topicId,
        topicName: session.topic?.name ?? null,
        status: session.status,
        turnCount: session.turnCount,
      },
      messages: session.messages.map(publicMessage),
    });
  });

  // Send a student message and get one guarded tutor reply back.
  app.post(
    "/api/socratic/sessions/:id/messages",
    {
      preHandler: [app.authenticate],
      // Tighter than the global limit: each turn is a paid AI call.
      config: { rateLimit: { max: 30, timeWindow: "5 minutes" } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = messageSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }
      const { content } = parsed.data;

      const session = await prisma.socraticSession.findFirst({
        where: { id, userId: req.user.sub },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          course: { select: { name: true } },
          topic: { select: { name: true } },
        },
      });
      if (!session) return reply.code(404).send({ error: "Session not found" });
      if (session.status !== "active") {
        return reply.code(409).send({ error: "This session has ended." });
      }

      // Hard per-session ceiling (cost control). Every turn is a paid AI call
      // — sometimes two, when the leak guard retries — and a session is the
      // one thing a student can keep open indefinitely. The rate limit slows
      // the burn; this bounds it. Guests get a tighter ceiling (Phase 1).
      const maxTurns = (await isGuestUser(req.user.sub))
        ? env.GUEST_SOCRATIC_MAX_TURNS
        : env.SOCRATIC_MAX_TURNS;
      if (session.turnCount >= maxTurns) {
        return reply.code(409).send({
          error: "session_turn_limit",
          message:
            "This has been a long session — end it to bank your progress, then start a fresh one.",
        });
      }

      await prisma.socraticMessage.create({
        data: { sessionId: id, role: "user", content },
      });

      const extraction = detectExtractionAttempt(content);
      if (extraction) {
        await track(req.user.sub, "socratic_leak_blocked", {
          sessionId: id,
          stage: "user_request",
        });
      }

      // Only the recent window goes to the model — full transcripts get
      // expensive fast, and the last few turns carry the thread.
      const history: ChatMessage[] = [
        ...session.messages.slice(-10).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content },
      ];

      // Socratic 3.0: ground the tutor in the Knowledge Layer concept (with
      // the student's mastery) and escalate scaffolding when they're stuck.
      const grounding = session.topicId
        ? await getConceptContext(req.user.sub, session.topicId)
        : null;
      const ctx: SocraticContext = {
        grounding,
        escalation: stuckLevel(history),
      };

      let result;
      try {
        result = await guardedReply(
          req.user.sub,
          session.course.name,
          session.topic?.name ?? null,
          history,
          session.turnCount,
          ctx
        );
      } catch (err) {
        if (err instanceof AIBudgetExceededError) {
          return reply.code(429).send({ error: err.message });
        }
        throw err;
      }

      const assistantMessage = await prisma.socraticMessage.create({
        data: {
          sessionId: id,
          role: "assistant",
          content: result.text,
          wasGuarded: result.guarded,
        },
      });

      const updated = await prisma.socraticSession.update({
        where: { id },
        data: {
          turnCount: { increment: 1 },
          guardTrips: result.guarded ? { increment: 1 } : undefined,
        },
      });

      if (result.guarded) {
        await track(req.user.sub, "socratic_leak_blocked", {
          sessionId: id,
          stage: "model_reply",
          reason: result.reason,
        });
      }

      const award = await awardXp(req.user.sub, XP.socraticTurn, "socratic_turn");
      await track(req.user.sub, "socratic_message", {
        sessionId: id,
        turn: updated.turnCount,
        extractionAttempt: extraction,
      });

      return reply.send({
        message: publicMessage(assistantMessage),
        turnCount: updated.turnCount,
        xp: { gained: XP.socraticTurn, total: award.xp, rank: award.rank },
        newBadges: award.newBadges,
      });
    }
  );

  // End a session: credits reasoning depth to mastery and pays the bonus.
  app.post(
    "/api/socratic/sessions/:id/end",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const session = await prisma.socraticSession.findFirst({
        where: { id, userId: req.user.sub },
      });
      if (!session) return reply.code(404).send({ error: "Session not found" });
      if (session.status === "ended") {
        return reply.send({ ok: true, alreadyEnded: true });
      }

      await prisma.socraticSession.update({
        where: { id },
        data: { status: "ended", endedAt: new Date() },
      });

      // A one-turn session isn't a deep dive — no mastery credit, no bonus.
      const meaningful = session.turnCount >= 2;
      let mastery: { before: number; after: number } | null = null;

      if (meaningful && session.topicId) {
        const recorded = await recordSocraticDepth(
          req.user.sub,
          session.topicId,
          session.turnCount
        );
        mastery = {
          before: Math.round(recorded.before * 100),
          after: Math.round(recorded.after * 100),
        };
        await track(req.user.sub, "mastery_changed", {
          topicId: session.topicId,
          before: recorded.before,
          after: recorded.after,
          source: "socratic",
        });
      }

      const newBadges = [];
      if (meaningful) {
        const award = await awardXp(
          req.user.sub,
          XP.socraticSession,
          "socratic_session"
        );
        newBadges.push(...award.newBadges);
        await prisma.socraticSession.update({
          where: { id },
          data: { xpAwarded: XP.socraticSession },
        });

        const first = await grantBadge(req.user.sub, "first_socratic");
        if (first) newBadges.push(first);

        const total = await prisma.socraticSession.count({
          where: { userId: req.user.sub, status: "ended" },
        });
        if (total >= 10) {
          const b = await grantBadge(req.user.sub, "socratic_10");
          if (b) newBadges.push(b);
        }
      }

      await track(req.user.sub, "socratic_ended", {
        sessionId: id,
        turnCount: session.turnCount,
        guardTrips: session.guardTrips,
      });

      return reply.send({
        ok: true,
        turnCount: session.turnCount,
        mastery,
        xpAwarded: meaningful ? XP.socraticSession : 0,
        newBadges,
      });
    }
  );

  // Marks the first-time explainer as seen (Step 7 item 4).
  app.post(
    "/api/socratic/intro-seen",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      await prisma.user.update({
        where: { id: req.user.sub },
        data: { socraticIntroSeenAt: new Date() },
      });
      return reply.send({ ok: true });
    }
  );
}
