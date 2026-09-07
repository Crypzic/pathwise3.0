// Persistence for the mastery engine (Step 4). The model itself — how mastery
// moves and when a topic falls due — lives in masteryModel.ts as pure
// functions; this file only reads and writes it.
import { prisma } from "./prisma.js";
import {
  applyAnswer,
  applySocraticDepth,
  courseMasteryPct,
  DEFAULT_STATE,
  isDue,
  nextDueAt,
  type MasteryState,
  type TopicWithMastery,
} from "./masteryModel.js";
// Generic defensive JSON-list parser (shared with onboarding).
import { parseStoredList } from "./onboardingModel.js";

// Re-exported so callers have one import for "mastery things".
export {
  applyAnswer,
  applySocraticDepth,
  courseMasteryPct,
  isDue,
  nextDueAt,
  guessLikelihood,
} from "./masteryModel.js";
export type {
  MasteryState,
  AnswerSignal,
  TopicWithMastery,
} from "./masteryModel.js";

/** Read a user's state for a topic, falling back to the default. */
export async function loadState(
  userId: string,
  topicId: string
): Promise<MasteryState & { socraticTurnCount: number }> {
  const row = await prisma.topicMastery.findUnique({
    where: { userId_topicId: { userId, topicId } },
  });
  if (!row) return { ...DEFAULT_STATE, socraticTurnCount: 0 };
  return {
    mastery: row.mastery,
    intervalDays: row.intervalDays,
    easeFactor: row.easeFactor,
    reps: row.reps,
    lapses: row.lapses,
    guessSignal: row.guessSignal,
    socraticTurnCount: row.socraticTurnCount,
  };
}

export interface RecordedAnswer {
  before: number;
  after: number;
  dueAt: Date;
}

/**
 * Record one graded quiz answer: updates mastery, the guessing signal, and the
 * next review date. Returns the delta so the caller can show feedback.
 */
export async function recordQuizAnswer(
  userId: string,
  topicId: string,
  input: { isCorrect: boolean; timeMs: number | null }
): Promise<RecordedAnswer> {
  const current = await loadState(userId, topicId);
  const next = applyAnswer(current, {
    isCorrect: input.isCorrect,
    timeMs: input.timeMs,
    socraticTurns: current.socraticTurnCount,
  });
  const now = new Date();
  const dueAt = nextDueAt(next, now);

  await prisma.topicMastery.upsert({
    where: { userId_topicId: { userId, topicId } },
    create: {
      userId,
      topicId,
      mastery: next.mastery,
      intervalDays: next.intervalDays,
      easeFactor: next.easeFactor,
      reps: next.reps,
      lapses: next.lapses,
      guessSignal: next.guessSignal,
      lastReviewedAt: now,
      dueAt,
      attemptCount: 1,
      correctCount: input.isCorrect ? 1 : 0,
    },
    update: {
      mastery: next.mastery,
      intervalDays: next.intervalDays,
      easeFactor: next.easeFactor,
      reps: next.reps,
      lapses: next.lapses,
      guessSignal: next.guessSignal,
      lastReviewedAt: now,
      dueAt,
      attemptCount: { increment: 1 },
      ...(input.isCorrect ? { correctCount: { increment: 1 } } : {}),
    },
  });

  return { before: current.mastery, after: next.mastery, dueAt };
}

/**
 * Record the reasoning depth of a Socratic session (Step 7 item 5 — the
 * "guessing vs understanding" signal).
 */
export async function recordSocraticDepth(
  userId: string,
  topicId: string,
  turns: number
): Promise<RecordedAnswer> {
  const current = await loadState(userId, topicId);
  const next = applySocraticDepth(current, turns);
  const now = new Date();

  // A Socratic session isn't a scored review, so it doesn't earn a long
  // interval — the topic still needs assessing.
  const intervalDays = Math.max(current.intervalDays, 1);
  const dueAt = nextDueAt({ ...next, intervalDays }, now);

  await prisma.topicMastery.upsert({
    where: { userId_topicId: { userId, topicId } },
    create: {
      userId,
      topicId,
      mastery: next.mastery,
      guessSignal: next.guessSignal,
      easeFactor: next.easeFactor,
      lastReviewedAt: now,
      intervalDays,
      dueAt,
      socraticTurnCount: turns,
    },
    update: {
      mastery: next.mastery,
      guessSignal: next.guessSignal,
      lastReviewedAt: now,
      socraticTurnCount: { increment: turns },
    },
  });

  return { before: current.mastery, after: next.mastery, dueAt };
}

/**
 * Every topic in a course joined to this user's mastery state. The single read
 * that Study Plan, Dashboard and quiz generation all build on.
 */
export async function topicsWithMastery(
  userId: string,
  courseId: string
): Promise<TopicWithMastery[]> {
  const map = await prisma.knowledgeMap.findUnique({
    where: { courseId },
    include: {
      topics: {
        include: { masteries: { where: { userId } } },
        orderBy: { weight: "desc" },
      },
    },
  });
  if (!map) return [];

  const now = new Date();
  return map.topics.map((t) => {
    const m = t.masteries[0];
    return {
      id: t.id,
      name: t.name,
      summary: t.summary,
      weight: t.weight,
      mastery: m?.mastery ?? 0,
      guessSignal: m?.guessSignal ?? 0,
      attemptCount: m?.attemptCount ?? 0,
      correctCount: m?.correctCount ?? 0,
      socraticTurnCount: m?.socraticTurnCount ?? 0,
      lastReviewedAt: m?.lastReviewedAt ?? null,
      dueAt: m?.dueAt ?? null,
      due: isDue(m?.dueAt ?? null, now),
      // Knowledge Layer 2.0: concept structure for quiz grounding and the
      // course detail view.
      difficulty: t.difficulty,
      misconceptions: parseStoredList(t.misconceptionsJson),
      objectives: parseStoredList(t.objectivesJson),
      prerequisites: parseStoredList(t.prerequisitesJson),
      sourceRef: t.sourceRef,
    };
  });
}
