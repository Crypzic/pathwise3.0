// Referrals (Step 14).
//
// Two deliberate choices from the build plan:
//   - The invite prompt is gated behind a first good moment (first completed
//     quiz or 3-day streak), never shown at signup.
//   - Both sides get rewarded, and only once the referee actually engages —
//     so a referral link can't be farmed with throwaway signups.
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import { track } from "./analytics.js";

const REWARD_GARDEN_XP = 60;
const REWARD_STREAK_FREEZES = 1;

/** Short, unambiguous code — no 0/O/1/I/l. */
function generateCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(7);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Get (or lazily create) this user's referral code. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (user?.referralCode) return user.referralCode;

  // Retry on the astronomically unlikely collision rather than 500ing.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const taken = await prisma.user.findUnique({ where: { referralCode: code } });
    if (taken) continue;
    await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
    return code;
  }
  throw new Error("Could not allocate a referral code");
}

/**
 * Called at signup when the new user arrived with a code. Records a pending
 * referral; nothing is paid out yet.
 */
export async function attachReferral(
  refereeId: string,
  code: string
): Promise<void> {
  const normalized = code.trim().toUpperCase();
  const referrer = await prisma.user.findUnique({
    where: { referralCode: normalized },
    select: { id: true, deletedAt: true },
  });
  // Silently ignore bad codes — a typo shouldn't block a signup.
  if (!referrer || referrer.deletedAt) return;
  if (referrer.id === refereeId) return; // no self-referral

  await prisma.user.update({
    where: { id: refereeId },
    data: { referredByCode: normalized },
  });
  await prisma.referral.create({
    data: { referrerId: referrer.id, refereeId, code: normalized },
  });
  await track(refereeId, "referral_signup", { code: normalized });
}

async function payOut(userId: string, role: "referrer" | "referee") {
  await prisma.user.update({
    where: { id: userId },
    data: {
      gardenXp: { increment: REWARD_GARDEN_XP },
      streakFreezes: { increment: REWARD_STREAK_FREEZES },
    },
  });
  await track(userId, "referral_rewarded", { role });
}

/**
 * Pay out a pending referral once the referee has reached a real milestone.
 * Idempotent — safe to call after every completed quiz.
 */
export async function maybeRewardReferral(refereeId: string): Promise<boolean> {
  const referral = await prisma.referral.findUnique({
    where: { refereeId },
  });
  if (!referral || referral.status !== "pending") return false;

  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: "rewarded", rewardedAt: new Date() },
  });

  await payOut(referral.referrerId, "referrer");
  await payOut(refereeId, "referee");
  return true;
}

export interface ReferralStatus {
  code: string;
  link: string;
  invited: number;
  rewarded: number;
  /** Whether the invite prompt should be shown yet (first good moment). */
  promptUnlocked: boolean;
}

/**
 * Referral state for the profile screen. `promptUnlocked` is the gate that
 * keeps the invite ask out of the signup flow.
 */
export async function referralStatus(
  userId: string,
  appUrl: string
): Promise<ReferralStatus> {
  const code = await ensureReferralCode(userId);

  const [invited, rewarded, user, completedQuizzes] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.count({ where: { referrerId: userId, status: "rewarded" } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { streakCount: true },
    }),
    prisma.quizSession.count({ where: { userId, status: "completed" } }),
  ]);

  return {
    code,
    link: `${appUrl}/signup?ref=${code}`,
    invited,
    rewarded,
    promptUnlocked: completedQuizzes > 0 || (user?.streakCount ?? 0) >= 3,
  };
}
