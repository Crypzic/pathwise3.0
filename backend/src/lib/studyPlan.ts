// Study Plan assembly (Step 6). The scoring itself is in planning.ts; this
// file only supplies it with data.
//
// Quests are derived, never stored: recomputing on each open means the plan
// reflects mastery as of right now, with no stale-quest invalidation to get
// wrong.
import { prisma } from "./prisma.js";
import { topicsWithMastery, courseMasteryPct, isDue } from "./mastery.js";
import {
  buildQuests,
  computeConfidence,
  confidenceAlert,
  pathState,
  type Confidence,
  type ConfidenceAlert,
  type Quest,
} from "./planning.js";

export {
  computeConfidence,
  tierFor,
  buildQuests,
  confidenceAlert,
} from "./planning.js";
export type { Confidence, ConfidenceTier, Quest, QuestKind } from "./planning.js";

/** Recent quiz accuracy for a course, or null with no graded answers. */
export async function recentAccuracy(
  userId: string,
  courseId: string,
  sampleSize = 40
): Promise<number | null> {
  const items = await prisma.quizItem.findMany({
    where: { session: { userId, courseId }, answeredAt: { not: null } },
    orderBy: { answeredAt: "desc" },
    take: sampleSize,
    select: { isCorrect: true },
  });
  if (items.length === 0) return null;
  return items.filter((i) => i.isCorrect).length / items.length;
}

export interface StudyPlan {
  courseId: string;
  courseName: string;
  confidence: Confidence;
  quests: Quest[];
  alert: ConfidenceAlert | null;
  path: {
    topicId: string;
    name: string;
    mastery: number;
    state: "mastered" | "mid" | "weak" | "locked";
  }[];
  masteryPct: number;
  dueCount: number;
  topicCount: number;
}

export async function getStudyPlan(
  userId: string,
  courseId: string
): Promise<StudyPlan | null> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { id: true, name: true },
  });
  if (!course) return null;

  const topics = await topicsWithMastery(userId, courseId);
  const accuracy = await recentAccuracy(userId, courseId);
  const avgGuessSignal =
    topics.length > 0
      ? topics.reduce((s, t) => s + t.guessSignal, 0) / topics.length
      : 0;

  const now = new Date();

  return {
    courseId: course.id,
    courseName: course.name,
    confidence: computeConfidence({
      topics,
      recentAccuracy: accuracy,
      avgGuessSignal,
    }),
    quests: buildQuests(topics, now),
    alert: confidenceAlert(topics, now),
    // The path follows the material's own emphasis order, which is how a
    // student would work through a syllabus.
    path: topics.slice(0, 8).map((t) => ({
      topicId: t.id,
      name: t.name,
      mastery: Math.round(t.mastery * 100),
      state: pathState(t),
    })),
    masteryPct: courseMasteryPct(topics),
    dueCount: topics.filter((t) => t.attemptCount > 0 && isDue(t.dueAt, now))
      .length,
    topicCount: topics.length,
  };
}
