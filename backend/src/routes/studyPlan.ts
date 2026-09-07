// Study Plan + Dashboard APIs (Steps 6 and 8).
//
// Both read the same mastery state; they differ only in framing — the plan says
// "do this next", the dashboard says "here's where you stand".
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getStudyPlan, recentAccuracy } from "../lib/studyPlan.js";
import { computeConfidence } from "../lib/planning.js";
import { topicsWithMastery, courseMasteryPct } from "../lib/mastery.js";
import { rankFor, grantBadge } from "../lib/gamification.js";
import type { UserBadge, Badge } from "@prisma/client";

export default async function studyPlanRoutes(app: FastifyInstance) {
  // Step 6 — today's quests, confidence gauge, quest path, drop banner.
  app.get(
    "/api/courses/:id/study-plan",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const plan = await getStudyPlan(req.user.sub, id);
      if (!plan) return reply.code(404).send({ error: "Course not found" });

      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { xp: true, streakCount: true, bestStreak: true },
      });

      // 80% confidence is worth a badge.
      if (plan.confidence.score >= 80) {
        await grantBadge(req.user.sub, "course_confident");
      }

      return reply.send({
        plan,
        user: {
          xp: user?.xp ?? 0,
          rank: rankFor(user?.xp ?? 0),
          streakCount: user?.streakCount ?? 0,
          bestStreak: user?.bestStreak ?? 0,
        },
      });
    }
  );

  // Step 8 — the progress dashboard for one course.
  app.get(
    "/api/courses/:id/dashboard",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const course = await prisma.course.findFirst({
        where: { id, userId: req.user.sub },
        select: { id: true, name: true },
      });
      if (!course) return reply.code(404).send({ error: "Course not found" });

      const topics = await topicsWithMastery(req.user.sub, id);
      const accuracy = await recentAccuracy(req.user.sub, id);
      const avgGuessSignal =
        topics.length > 0
          ? topics.reduce((s, t) => s + t.guessSignal, 0) / topics.length
          : 0;

      const [user, badgeRows, deepDives, quizzes] = await Promise.all([
        prisma.user.findUnique({
          where: { id: req.user.sub },
          select: { xp: true, streakCount: true, bestStreak: true },
        }),
        prisma.userBadge.findMany({
          where: { userId: req.user.sub },
          include: { badge: true },
          orderBy: { earnedAt: "desc" },
        }),
        prisma.socraticSession.count({
          where: { userId: req.user.sub, courseId: id, status: "ended" },
        }),
        prisma.quizSession.count({
          where: { userId: req.user.sub, courseId: id, status: "completed" },
        }),
      ]);

      // "Guessing vs understanding" (Step 8 item 2). A topic counts as
      // understood when mastery is real and the guess signal is low; as
      // guessed when the score is decent but the signal says otherwise.
      //
      // The third bucket matters: a topic you've been quizzed on but haven't
      // got to 50% on is neither understood nor guessed — you're still
      // learning it. Without this, everything a new student has touched
      // silently belongs to no category and the whole view reads as empty.
      const assessed = topics.filter((t) => t.attemptCount > 0);
      const understanding = assessed.filter(
        (t) => t.mastery >= 0.5 && t.guessSignal <= 0.45
      );
      const guessing = assessed.filter(
        (t) => t.mastery >= 0.5 && t.guessSignal > 0.45
      );
      const learning = assessed.filter((t) => t.mastery < 0.5);

      return reply.send({
        course,
        confidence: computeConfidence({
          topics,
          recentAccuracy: accuracy,
          avgGuessSignal,
        }),
        masteryPct: courseMasteryPct(topics),
        // Heatmap source (Step 8 item 1).
        heatmap: topics.map((t) => ({
          topicId: t.id,
          name: t.name,
          mastery: Math.round(t.mastery * 100),
          weight: Number(t.weight.toFixed(2)),
          attempted: t.attemptCount > 0,
        })),
        understanding: {
          understood: understanding.length,
          guessing: guessing.length,
          learning: learning.length,
          // Everything the student has actually been tested on. The UI gates
          // on this, not on understood+guessing, so a course in progress still
          // renders.
          assessed: assessed.length,
          unassessed: topics.length - assessed.length,
          // Named so the UI can say *which* topics look shaky.
          shakyTopics: guessing
            .sort((a, b) => b.guessSignal - a.guessSignal)
            .slice(0, 4)
            .map((t) => ({ topicId: t.id, name: t.name })),
        },
        stats: {
          streakCount: user?.streakCount ?? 0,
          bestStreak: user?.bestStreak ?? 0,
          xp: user?.xp ?? 0,
          rank: rankFor(user?.xp ?? 0),
          badgeCount: badgeRows.length,
          deepDiveCount: deepDives,
          quizCount: quizzes,
          accuracy: accuracy === null ? null : Math.round(accuracy * 100),
        },
        badges: badgeRows.map((ub: UserBadge & { badge: Badge }) => ({
          key: ub.badge.key,
          name: ub.badge.name,
          description: ub.badge.description,
          icon: ub.badge.icon,
          earnedAt: ub.earnedAt,
        })),
      });
    }
  );
}
