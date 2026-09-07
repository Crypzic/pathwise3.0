// Quiz Mode API (Step 5).
//
// The question's correct answer is never sent to the client before it answers —
// the grading happens server-side and the explanation comes back with the
// result. Otherwise every answer is in the network tab.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { buildQuizSession } from "../lib/quiz.js";
import { recordQuizAnswer } from "../lib/mastery.js";
import { awardXp, grantBadge, XP } from "../lib/gamification.js";
import { track } from "../lib/analytics.js";
import { AIBudgetExceededError, gradeWrittenAnswer } from "../lib/aiMeter.js";
import { maybeRewardReferral } from "../lib/referrals.js";
import { isGuestUser } from "../lib/guests.js";
import { guestMayStartQuiz } from "../lib/guestPolicy.js";
import type { QuizItem } from "@prisma/client";

const startSchema = z.object({
  courseId: z.string().min(1),
  kind: z.enum(["practice", "review", "weakest"]).default("practice"),
  count: z.coerce.number().int().min(1).max(50).optional(),
  topicId: z.string().optional(),
});

const answerSchema = z.object({
  // MCQ answers send selectedIndex; written answers send answerText.
  selectedIndex: z.number().int().min(0).max(3).optional(),
  answerText: z.string().min(1).max(3000).optional(),
  timeMs: z.number().int().min(0).max(1000 * 60 * 30).optional(),
});

/** Client shape for an unanswered question — no correctIndex, no explanation. */
function publicItem(item: QuizItem, total: number) {
  return {
    id: item.id,
    position: item.position,
    number: item.position + 1,
    total,
    kind: item.kind,
    topicName: item.topicName,
    question: item.question,
    options: JSON.parse(item.optionsJson) as string[],
    answered: item.answeredAt !== null,
    // Only present once answered.
    selectedIndex: item.selectedIndex,
    isCorrect: item.isCorrect,
  };
}

export default async function quizRoutes(app: FastifyInstance) {
  // Start a new quiz session for a course.
  app.post("/api/quiz/sessions", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }
    const { courseId, kind, count, topicId } = parsed.data;

    // Guest cap (PATHWISE 2.0 Phase 1): a handful of quizzes a day is plenty
    // to feel the product; generation is a paid AI call.
    if (await isGuestUser(req.user.sub)) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const startedToday = await prisma.quizSession.count({
        where: { userId: req.user.sub, createdAt: { gte: startOfDay } },
      });
      if (!guestMayStartQuiz(startedToday, env.GUEST_QUIZ_SESSIONS_PER_DAY)) {
        return reply.code(429).send({
          error: "guest_limit",
          message: `Guests can start ${env.GUEST_QUIZ_SESSIONS_PER_DAY} quizzes a day. Create a free account to keep going — your progress comes with you.`,
        });
      }
    }

    try {
      const built = await buildQuizSession(req.user.sub, courseId, {
        kind,
        count: count ?? env.QUIZ_DEFAULT_LENGTH,
        topicId,
      });
      await track(req.user.sub, "quiz_started", {
        courseId,
        kind,
        total: built.total,
      });
      return reply.code(201).send(built);
    } catch (err) {
      if (err instanceof AIBudgetExceededError) {
        return reply.code(429).send({ error: err.message });
      }
      const message =
        err instanceof Error ? err.message : "Couldn't start a quiz.";
      return reply.code(400).send({ error: message });
    }
  });

  // Fetch a session's state and its current (first unanswered) question.
  app.get("/api/quiz/sessions/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await prisma.quizSession.findFirst({
      where: { id, userId: req.user.sub },
      include: {
        items: { orderBy: { position: "asc" } },
        course: { select: { id: true, name: true } },
      },
    });
    if (!session) return reply.code(404).send({ error: "Quiz not found" });

    const total = session.items.length;
    const answered = session.items.filter((i) => i.answeredAt !== null);
    const current = session.items.find((i) => i.answeredAt === null) ?? null;
    const correctCount = answered.filter((i) => i.isCorrect).length;

    return reply.send({
      session: {
        id: session.id,
        kind: session.kind,
        status: session.status,
        courseId: session.courseId,
        courseName: session.course.name,
        total,
        answeredCount: answered.length,
        correctCount,
        xpAwarded: session.xpAwarded,
      },
      // Progress dots: which positions are done, and which is live.
      progress: session.items.map((i) => ({
        position: i.position,
        answered: i.answeredAt !== null,
        isCorrect: i.isCorrect,
      })),
      current: current ? publicItem(current, total) : null,
    });
  });

  // Answer the current question: grades it, moves mastery, awards XP.
  app.post(
    "/api/quiz/sessions/:id/answer",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = answerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }
      const { selectedIndex, answerText, timeMs } = parsed.data;

      const session = await prisma.quizSession.findFirst({
        where: { id, userId: req.user.sub },
        include: { items: { orderBy: { position: "asc" } } },
      });
      if (!session) return reply.code(404).send({ error: "Quiz not found" });
      if (session.status !== "active") {
        return reply.code(409).send({ error: "This quiz is already finished." });
      }

      const item = session.items.find((i) => i.answeredAt === null);
      if (!item) {
        return reply.code(409).send({ error: "No question left to answer." });
      }

      // Grade by item kind. Written answers (phase 2) go to the AI grader:
      // "close" counts as correct for mastery/XP (partial understanding is
      // still understanding) but the verdict reaches the UI honestly.
      let isCorrect: boolean;
      let verdict: "correct" | "close" | "incorrect" | null = null;
      let gradeExplanation: string | null = null;

      if (item.kind === "written") {
        if (!answerText) {
          return reply.code(400).send({ error: "Type an answer first." });
        }
        let grade;
        try {
          grade = await gradeWrittenAnswer(
            req.user.sub,
            item.question,
            item.referenceAnswer ?? item.explanation,
            answerText
          );
        } catch (err) {
          if (err instanceof AIBudgetExceededError) {
            return reply.code(429).send({ error: err.message });
          }
          throw err;
        }
        verdict = grade.verdict;
        gradeExplanation = grade.explanation;
        isCorrect = grade.verdict !== "incorrect";
        await track(req.user.sub, "written_answered", {
          sessionId: session.id,
          verdict: grade.verdict,
        });
      } else {
        if (selectedIndex === undefined) {
          return reply.code(400).send({ error: "Pick an option first." });
        }
        const options = JSON.parse(item.optionsJson) as string[];
        if (selectedIndex >= options.length) {
          return reply.code(400).send({ error: "Invalid option." });
        }
        isCorrect = selectedIndex === item.correctIndex;
      }

      await prisma.quizItem.update({
        where: { id: item.id },
        data: {
          selectedIndex: item.kind === "written" ? null : selectedIndex,
          writtenAnswer: item.kind === "written" ? answerText : null,
          verdict,
          isCorrect,
          answeredAt: new Date(),
          timeMs: timeMs ?? null,
        },
      });

      // Move mastery + the spaced-repetition schedule (Step 4).
      let masteryDelta: { before: number; after: number } | null = null;
      if (item.topicId) {
        const recorded = await recordQuizAnswer(req.user.sub, item.topicId, {
          isCorrect,
          timeMs: timeMs ?? null,
        });
        masteryDelta = { before: recorded.before, after: recorded.after };
        await track(req.user.sub, "mastery_changed", {
          topicId: item.topicId,
          before: recorded.before,
          after: recorded.after,
          source: "quiz",
        });
      }

      const award = await awardXp(
        req.user.sub,
        isCorrect ? XP.quizCorrect : XP.quizIncorrect,
        isCorrect ? "quiz_correct" : "quiz_incorrect"
      );

      await track(req.user.sub, "quiz_answer", {
        sessionId: session.id,
        topicId: item.topicId,
        isCorrect,
        timeMs: timeMs ?? null,
      });

      // 90%+ on a topic is worth a badge.
      const newBadges = [...award.newBadges];
      if (masteryDelta && masteryDelta.after >= 0.9 && masteryDelta.before < 0.9) {
        const b = await grantBadge(req.user.sub, "topic_mastered");
        if (b) newBadges.push(b);
      }

      // Was that the last question?
      const remaining = session.items.filter(
        (i) => i.answeredAt === null && i.id !== item.id
      ).length;

      let completion: {
        correctCount: number;
        total: number;
        xpBonus: number;
        perfect: boolean;
      } | null = null;

      if (remaining === 0) {
        const graded = await prisma.quizItem.findMany({
          where: { sessionId: session.id },
        });
        const correctCount = graded.filter((i) => i.isCorrect).length;
        const perfect = correctCount === graded.length;

        const bonus =
          session.kind === "review" ? XP.reviewCompleted : XP.quizCompleted;
        const bonusAward = await awardXp(
          req.user.sub,
          bonus,
          session.kind === "review" ? "review_completed" : "quiz_completed"
        );
        newBadges.push(...bonusAward.newBadges);

        await prisma.quizSession.update({
          where: { id: session.id },
          data: {
            status: "completed",
            completedAt: new Date(),
            xpAwarded: { increment: bonus },
          },
        });

        const firstQuizBadge = await grantBadge(req.user.sub, "first_quiz");
        if (firstQuizBadge) newBadges.push(firstQuizBadge);
        if (perfect) {
          const b = await grantBadge(req.user.sub, "perfect_quiz");
          if (b) newBadges.push(b);
        }

        await track(req.user.sub, "quiz_completed", {
          sessionId: session.id,
          courseId: session.courseId,
          kind: session.kind,
          correctCount,
          total: graded.length,
        });
        if (session.kind === "review") {
          await track(req.user.sub, "review_completed", {
            sessionId: session.id,
          });
        }

        // First completed quiz is the "first good moment" that unlocks the
        // referral prompt and pays out a pending referral (Step 14 item 2).
        await maybeRewardReferral(req.user.sub);

        completion = {
          correctCount,
          total: graded.length,
          xpBonus: bonus,
          perfect,
        };
      }

      return reply.send({
        result: {
          kind: item.kind,
          isCorrect,
          // MCQ fields (meaningless for written items).
          correctIndex: item.kind === "written" ? null : item.correctIndex,
          selectedIndex: item.kind === "written" ? null : selectedIndex,
          // Written fields: the AI's verdict + teaching explanation, and the
          // model answer to compare against.
          verdict,
          referenceAnswer: item.kind === "written" ? item.referenceAnswer : null,
          explanation: gradeExplanation ?? item.explanation,
        },
        mastery: masteryDelta
          ? {
              before: Math.round(masteryDelta.before * 100),
              after: Math.round(masteryDelta.after * 100),
            }
          : null,
        xp: {
          gained: isCorrect ? XP.quizCorrect : XP.quizIncorrect,
          total: award.xp,
          rank: award.rank,
          rankedUp: award.rankedUp,
        },
        streak: { count: award.streakCount, best: award.bestStreak },
        newBadges,
        remaining,
        completion,
      });
    }
  );

  // Flashcards: the finished quiz's questions and answers as review cards.
  // Completed sessions only — during the quiz the answers stay server-side.
  app.get(
    "/api/quiz/sessions/:id/review",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const session = await prisma.quizSession.findFirst({
        where: { id, userId: req.user.sub, status: "completed" },
        include: { items: { orderBy: { position: "asc" } } },
      });
      if (!session) {
        return reply.code(404).send({ error: "Finished quiz not found" });
      }
      return reply.send({
        cards: session.items.map((i) => {
          const options = JSON.parse(i.optionsJson) as string[];
          return {
            id: i.id,
            topicName: i.topicName,
            front: i.question,
            back:
              i.kind === "written"
                ? (i.referenceAnswer ?? i.explanation)
                : (options[i.correctIndex] ?? ""),
            explanation: i.explanation,
            gotIt: i.isCorrect ?? false,
          };
        }),
      });
    }
  );

  // Abandon an in-progress quiz (leaves mastery changes already recorded).
  app.post(
    "/api/quiz/sessions/:id/abandon",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const session = await prisma.quizSession.findFirst({
        where: { id, userId: req.user.sub, status: "active" },
      });
      if (!session) return reply.code(404).send({ error: "Quiz not found" });

      await prisma.quizSession.update({
        where: { id },
        data: { status: "abandoned", completedAt: new Date() },
      });
      return reply.send({ ok: true });
    }
  );

  // The most recent active quiz, so "Quiz" in the nav can resume rather than
  // always starting a fresh one.
  app.get("/api/quiz/active", { preHandler: [app.authenticate] }, async (req, reply) => {
    const session = await prisma.quizSession.findFirst({
      where: { userId: req.user.sub, status: "active" },
      orderBy: { createdAt: "desc" },
      include: { course: { select: { id: true, name: true } } },
    });
    if (!session) return reply.send({ session: null });
    return reply.send({
      session: {
        id: session.id,
        courseId: session.courseId,
        courseName: session.course.name,
        kind: session.kind,
      },
    });
  });
}
