// Gamification persistence (Step 9): XP, streaks, badges, streak freeze.
//
// Every study action funnels through awardXp(), which is also where the streak
// is touched and rank-ups / badges are detected. Keeping it in one place means
// a new XP source can't accidentally skip the streak update.
//
// The pure logic (XP values, rank thresholds, streak transitions) lives in
// progression.ts.
import { prisma } from "./prisma.js";
import { track } from "./analytics.js";
import { localDayKey, nextStreak, rankFor } from "./progression.js";

export { XP, RANKS, rankFor, localDayKey, nextStreak } from "./progression.js";
export type { Rank, StreakResult } from "./progression.js";

// A freeze is granted every this many streak days, so consistency earns
// protection (Step 9 item 4) without it becoming hoardable.
const FREEZE_EVERY_N_DAYS = 7;
const MAX_EARNED_FREEZES = 3;

// --- Badges ----------------------------------------------------------------

export const BADGE_DEFS = [
  { key: "first_upload", name: "First Steps", description: "Uploaded your first course material.", icon: "upload" },
  { key: "first_quiz", name: "Quiz Curious", description: "Completed your first quiz.", icon: "puzzle" },
  { key: "first_socratic", name: "Deep Thinker", description: "Finished your first Socratic session.", icon: "sparkles" },
  { key: "streak_3", name: "Getting Going", description: "Studied 3 days in a row.", icon: "flame" },
  { key: "streak_7", name: "Week Strong", description: "Studied 7 days in a row.", icon: "flame" },
  { key: "streak_30", name: "Unstoppable", description: "Studied 30 days in a row.", icon: "flame" },
  { key: "topic_mastered", name: "Topic Mastered", description: "Took a topic past 90% mastery.", icon: "award" },
  { key: "course_confident", name: "Exam Ready", description: "Reached 80% confidence in a course.", icon: "trending-up" },
  { key: "socratic_10", name: "Ten Deep Dives", description: "Completed 10 Socratic sessions.", icon: "brain" },
  { key: "perfect_quiz", name: "Flawless", description: "Answered every question in a quiz correctly.", icon: "check" },
] as const;

export type BadgeKey = (typeof BADGE_DEFS)[number]["key"];

/** Idempotent — safe to call on every boot. */
export async function seedBadges(): Promise<void> {
  for (const def of BADGE_DEFS) {
    await prisma.badge.upsert({
      where: { key: def.key },
      create: def,
      update: { name: def.name, description: def.description, icon: def.icon },
    });
  }
}

export interface AwardedBadge {
  key: string;
  name: string;
  description: string;
  icon: string;
}

/**
 * Grant a badge if the user doesn't already have it. Returns the badge when it
 * was newly earned (so the caller can surface an unlock notification), or null.
 */
export async function grantBadge(
  userId: string,
  key: BadgeKey
): Promise<AwardedBadge | null> {
  const badge = await prisma.badge.findUnique({ where: { key } });
  if (!badge) return null;

  const existing = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId: badge.id } },
  });
  if (existing) return null;

  await prisma.userBadge.create({ data: { userId, badgeId: badge.id } });
  await track(userId, "badge_earned", { key });

  const awarded: AwardedBadge = {
    key: badge.key,
    name: badge.name,
    description: badge.description,
    icon: badge.icon,
  };

  // Unlock notification (Step 12 item 3). Imported lazily to keep the module
  // graph acyclic — notifications reads mastery, which reads this.
  const { notifyUnlock } = await import("./notifications.js");
  await notifyUnlock(userId, `Badge unlocked: ${badge.name}`, badge.description);

  return awarded;
}

// --- The single XP entry point --------------------------------------------

export interface AwardResult {
  xp: number;
  xpGained: number;
  rank: ReturnType<typeof rankFor>;
  rankedUp: boolean;
  streakCount: number;
  bestStreak: number;
  freezeUsed: boolean;
  newBadges: AwardedBadge[];
}

/**
 * Award XP for a study action. Also advances the streak, grows the companion,
 * and detects rank-ups + streak badges.
 */
export async function awardXp(
  userId: string,
  amount: number,
  reason: string
): Promise<AwardResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`User ${userId} not found`);

  const beforeRank = rankFor(user.xp);
  const todayKey = localDayKey(user.timezone);
  const streak = nextStreak(
    {
      streakCount: user.streakCount,
      bestStreak: user.bestStreak,
      lastActiveDay: user.lastActiveDay,
      streakFreezes: user.streakFreezes,
    },
    todayKey
  );

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      xp: { increment: amount },
      streakCount: streak.streakCount,
      bestStreak: streak.bestStreak,
      lastActiveDay: todayKey,
      ...(streak.freezeUsed ? { streakFreezes: { decrement: 1 } } : {}),
    },
  });

  if (streak.freezeUsed) {
    await track(userId, "streak_freeze_used", { streak: streak.streakCount });
  }

  const afterRank = rankFor(updated.xp);
  const rankedUp = afterRank.level > beforeRank.level;

  // Studying grows the companion passively (Step 11 item 1) — the pet advances
  // whether or not the student ever opens the mini-game.
  await prisma.companion.upsert({
    where: { userId },
    create: { userId, growth: amount },
    update: { growth: { increment: amount } },
  });

  const newBadges: AwardedBadge[] = [];
  for (const [threshold, key] of [
    [3, "streak_3"],
    [7, "streak_7"],
    [30, "streak_30"],
  ] as const) {
    if (streak.streakCount >= threshold) {
      const b = await grantBadge(userId, key);
      if (b) newBadges.push(b);
    }
  }

  // Consistency earns a freeze, capped so they can't be stockpiled.
  if (
    streak.advanced &&
    streak.streakCount > 0 &&
    streak.streakCount % FREEZE_EVERY_N_DAYS === 0 &&
    updated.streakFreezes < MAX_EARNED_FREEZES
  ) {
    await prisma.user.update({
      where: { id: userId },
      data: { streakFreezes: { increment: 1 } },
    });
  }

  await track(userId, "xp_awarded", { amount, reason, rank: afterRank.level });
  if (rankedUp) {
    await track(userId, "rank_up", { level: afterRank.level });
    const { notifyUnlock } = await import("./notifications.js");
    await notifyUnlock(
      userId,
      `New rank: ${afterRank.name}`,
      `You reached level ${afterRank.level}. New profile frames may be available.`
    );
  }

  return {
    xp: updated.xp,
    xpGained: amount,
    rank: afterRank,
    rankedUp,
    streakCount: updated.streakCount,
    bestStreak: updated.bestStreak,
    freezeUsed: streak.freezeUsed,
    newBadges,
  };
}
