// Study-plan scoring and quiz topic selection (Steps 5 and 6), as pure
// functions. No Prisma/env import, so all of it is unit-testable.
import { isDue, courseMasteryPct, type TopicWithMastery } from "./masteryModel.js";
import { XP } from "./progression.js";

// --- Quiz topic selection (Step 5 items 1-2) -------------------------------
//
// Difficulty is fixed per question — no adaptive difficulty, which the build
// plan explicitly defers. What *is* adaptive is which topics get asked about.

/**
 * How badly this topic needs asking about.
 *
 * Emphasis weight is the base — the material's own signal about what matters.
 * Mastery gap scales it, so a heavily-stressed topic you already know stops
 * dominating. Overdue topics get a boost so the spaced-repetition backlog
 * actually surfaces.
 */
export function topicPriority(t: TopicWithMastery, now = new Date()): number {
  const gap = 1 - t.mastery;
  let score = t.weight * (0.35 + 0.65 * gap);

  if (isDue(t.dueAt, now)) score *= 1.5;
  // Never-attempted topics should get their first look early.
  if (t.attemptCount === 0) score *= 1.3;
  // A high guessing signal means the mastery number isn't trustworthy —
  // re-test it even though mastery looks fine.
  score *= 1 + 0.4 * t.guessSignal;

  return score;
}

/** At most this many topics in a single quiz — 8 questions over 12 topics
 * teaches nothing. */
export const MAX_TOPICS_PER_QUIZ = 5;

/**
 * Allocate `count` questions across topics proportionally to priority, with
 * every selected topic guaranteed at least one question.
 */
export function allocateQuestions(
  topics: TopicWithMastery[],
  count: number,
  now = new Date()
): { topic: TopicWithMastery; questions: number }[] {
  if (topics.length === 0 || count <= 0) return [];

  const scored = topics
    .map((t) => ({ topic: t, score: topicPriority(t, now) }))
    .sort((a, b) => b.score - a.score);

  // Never select more topics than there are questions to go round.
  const poolSize = Math.min(MAX_TOPICS_PER_QUIZ, scored.length, count);
  const pool = scored.slice(0, poolSize);
  const total = pool.reduce((s, p) => s + p.score, 0);

  const alloc = pool.map((p) => ({
    topic: p.topic,
    questions:
      total > 0 ? Math.max(1, Math.round((p.score / total) * count)) : 1,
  }));

  // Rounding can overshoot or undershoot; settle on exactly `count` by taking
  // from the lowest-priority topics and giving to the highest.
  let sum = alloc.reduce((s, a) => s + a.questions, 0);
  while (sum > count) {
    // Walk from the back looking for something with slack.
    const idx = [...alloc].reverse().findIndex((a) => a.questions > 1);
    if (idx === -1) break; // everything is at the 1-question floor
    alloc[alloc.length - 1 - idx].questions -= 1;
    sum -= 1;
  }
  let i = 0;
  while (sum < count) {
    alloc[i % alloc.length].questions += 1;
    sum += 1;
    i += 1;
  }

  return alloc;
}

// --- Course Confidence Score (Step 6 item 3) -------------------------------

export type ConfidenceTier =
  | "Building"
  | "Finding your feet"
  | "Solid"
  | "Exam ready";

export interface Confidence {
  score: number; // 0..100
  tier: ConfidenceTier;
  // The three inputs, exposed so the UI can explain the number.
  components: { mastery: number; consistency: number; depth: number };
}

export function tierFor(score: number): ConfidenceTier {
  if (score >= 80) return "Exam ready";
  if (score >= 60) return "Solid";
  if (score >= 35) return "Finding your feet";
  return "Building";
}

/**
 * Confidence combines three things, weighted so mastery dominates but can't
 * stand alone:
 *
 *   - mastery (60%)     — weighted topic mastery across the course
 *   - consistency (25%) — recent quiz accuracy, discounted by the guessing
 *                         signal, so lucky streaks don't inflate it
 *   - depth (15%)       — Socratic engagement across the course's topics
 *
 * Coverage matters too: a course where you've only ever touched one topic
 * shouldn't read "Exam ready" because that one topic is at 100%.
 */
export function computeConfidence(input: {
  topics: TopicWithMastery[];
  recentAccuracy: number | null;
  avgGuessSignal: number;
}): Confidence {
  const { topics, recentAccuracy, avgGuessSignal } = input;

  if (topics.length === 0) {
    return {
      score: 0,
      tier: "Building",
      components: { mastery: 0, consistency: 0, depth: 0 },
    };
  }

  const mastery = courseMasteryPct(topics) / 100;

  // No quiz history yet reads as neutral-low rather than zero — the student
  // hasn't failed, they just haven't been assessed.
  const rawConsistency = recentAccuracy ?? 0.35;
  const consistency = Math.max(0, rawConsistency * (1 - 0.5 * avgGuessSignal));

  const topicsWithDepth = topics.filter((t) => t.socraticTurnCount > 0).length;
  const depth = Math.min(1, topicsWithDepth / Math.max(1, topics.length * 0.4));

  // Coverage penalty: fraction of topics ever attempted.
  const attempted = topics.filter((t) => t.attemptCount > 0).length;
  const coverage = attempted / topics.length;
  const coverageFactor = 0.55 + 0.45 * coverage;

  const blended = mastery * 0.6 + consistency * 0.25 + depth * 0.15;
  const score = Math.round(
    Math.max(0, Math.min(1, blended * coverageFactor)) * 100
  );

  return {
    score,
    tier: tierFor(score),
    components: {
      mastery: Math.round(mastery * 100),
      consistency: Math.round(consistency * 100),
      depth: Math.round(depth * 100),
    },
  };
}

// --- Quests (Step 6 item 1) ------------------------------------------------

export type QuestKind = "quiz" | "review" | "socratic" | "upload";

export interface Quest {
  id: string;
  kind: QuestKind;
  title: string;
  subtitle: string;
  xp: number;
  topicId: string | null;
  topicName: string | null;
  /** Drives the card's icon colour. */
  tone: "danger" | "warning" | "primary";
}

/**
 * Today's quests, in priority order:
 *   1. Spaced-repetition topics that are due (the backlog comes first)
 *   2. The weakest topic overall
 *   3. A Socratic deep-dive where mastery looks like guessing
 *
 * Capped at 4 — a wall of quests is a to-do list, not a plan.
 */
export function buildQuests(
  topics: TopicWithMastery[],
  now = new Date()
): Quest[] {
  if (topics.length === 0) {
    return [
      {
        id: "upload",
        kind: "upload",
        title: "Add your course material",
        subtitle: "Upload a syllabus or slides to build your study map",
        xp: 0,
        topicId: null,
        topicName: null,
        tone: "primary",
      },
    ];
  }

  const quests: Quest[] = [];
  const used = new Set<string>();

  // 1. Due for review.
  const due = topics
    .filter((t) => t.attemptCount > 0 && isDue(t.dueAt, now))
    .sort((a, b) => b.weight - a.weight);
  for (const t of due.slice(0, 2)) {
    quests.push({
      id: `review:${t.id}`,
      kind: "review",
      title: `Review: ${t.name}`,
      subtitle: "Spaced repetition — due today",
      xp: XP.reviewCompleted,
      topicId: t.id,
      topicName: t.name,
      tone: "warning",
    });
    used.add(t.id);
  }

  // 2. Weakest topic, favouring ones the material stresses.
  const weakest = topics
    .filter((t) => !used.has(t.id) && t.mastery < 0.6)
    .sort(
      (a, b) => a.mastery * (1 - a.weight) - b.mastery * (1 - b.weight)
    )[0];
  if (weakest) {
    quests.push({
      id: `quiz:${weakest.id}`,
      kind: "quiz",
      title: `Quiz: ${weakest.name}`,
      subtitle:
        weakest.attemptCount === 0
          ? "You haven't been tested on this yet"
          : "Your weakest topic right now",
      xp: XP.quizCompleted,
      topicId: weakest.id,
      topicName: weakest.name,
      tone: "danger",
    });
    used.add(weakest.id);
  }

  // 3. A topic where the score looks lucky rather than learned.
  const shaky = topics
    .filter((t) => !used.has(t.id) && t.attemptCount >= 2 && t.guessSignal > 0.5)
    .sort((a, b) => b.guessSignal - a.guessSignal)[0];
  const fallbackDeepDive = topics
    .filter(
      (t) => !used.has(t.id) && t.socraticTurnCount === 0 && t.weight >= 0.6
    )
    .sort((a, b) => b.weight - a.weight)[0];
  const deepDive = shaky ?? fallbackDeepDive;
  if (deepDive) {
    quests.push({
      id: `socratic:${deepDive.id}`,
      kind: "socratic",
      title: `Go deeper: ${deepDive.name}`,
      subtitle: shaky
        ? "Right answers, shaky reasoning — talk it through"
        : "Try Socratic mode on a heavily-weighted topic",
      xp: XP.socraticSession,
      topicId: deepDive.id,
      topicName: deepDive.name,
      tone: "primary",
    });
    used.add(deepDive.id);
  }

  // 4. Filler, so the plan is never empty.
  if (quests.length === 0) {
    quests.push({
      id: `quiz:${topics[0].id}`,
      kind: "quiz",
      title: "Practice quiz",
      subtitle: "Keep everything fresh",
      xp: XP.quizCompleted,
      topicId: null,
      topicName: null,
      tone: "primary",
    });
  }

  return quests.slice(0, 4);
}

// --- Confidence-drop banner (Step 6 item 4) --------------------------------

export interface ConfidenceAlert {
  topicId: string;
  topicName: string;
  message: string;
}

/**
 * The supportive banner. Fires on the highest-emphasis topic that has slipped:
 * previously learned (has attempts) but now overdue or looking shaky.
 *
 * Tone matters — it links straight into a review rather than scolding.
 */
export function confidenceAlert(
  topics: TopicWithMastery[],
  now = new Date()
): ConfidenceAlert | null {
  const slipping = topics
    .filter(
      (t) =>
        t.attemptCount >= 2 &&
        t.mastery < 0.6 &&
        (isDue(t.dueAt, now) || t.guessSignal > 0.6)
    )
    .sort((a, b) => b.weight - a.weight)[0];

  if (!slipping) return null;

  return {
    topicId: slipping.id,
    topicName: slipping.name,
    message: `${slipping.name} is slipping a bit — a quick review would help.`,
  };
}

/** Bead state for the quest-path visualisation. */
export function pathState(
  t: TopicWithMastery
): "mastered" | "mid" | "weak" | "locked" {
  if (t.attemptCount === 0 && t.socraticTurnCount === 0) return "locked";
  if (t.mastery >= 0.8) return "mastered";
  if (t.mastery >= 0.45) return "mid";
  return "weak";
}
