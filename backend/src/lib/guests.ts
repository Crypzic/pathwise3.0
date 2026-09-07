// Guest accounts (PATHWISE 2.0 Phase 1) — the thin persistence layer over
// lib/guestPolicy.ts, same split as mastery.ts / masteryModel.ts.
//
// A guest is an ordinary User row with a synthetic identity and an expiry, so
// every ownership check, quiz, Socratic session and mastery write works
// unchanged. What differs is enforced at the edges: tighter caps (courses,
// uploads, AI budget, turns) and automatic cleanup here.
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { hashPassword } from "./auth.js";
import { removeUserStoredFiles } from "./storageSweep.js";
import { guestExpiry, syntheticGuestEmail } from "./guestPolicy.js";
import type { User } from "@prisma/client";

/** Create a guest user. The password is random and never revealed, so the
 * synthetic identity cannot be signed into — only the issued token works. */
export async function createGuestUser(timezone?: string): Promise<User> {
  const email = syntheticGuestEmail(randomBytes(16).toString("hex"));
  return prisma.user.create({
    data: {
      name: "Guest",
      email,
      passwordHash: await hashPassword(randomBytes(32).toString("hex")),
      timezone: timezone ?? "UTC",
      isGuest: true,
      guestExpiresAt: guestExpiry(new Date(), env.GUEST_TTL_DAYS),
      tosAcceptedVersion: env.TOS_VERSION,
      // A synthetic address must never be emailed.
      notifyEmail: false,
      subscription: { create: {} },
      companion: { create: {} },
    },
  });
}

/** One cheap indexed lookup — the per-request guard used by capped routes. */
export async function isGuestUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isGuest: true },
  });
  return user?.isGuest ?? false;
}

/**
 * Hard-delete guests past their expiry, sweeping their stored files first —
 * guest data must clean up automatically, including out of the bucket.
 * DB cascades handle every child row.
 */
export async function purgeExpiredGuests(now = new Date()): Promise<number> {
  const expired = await prisma.user.findMany({
    where: { isGuest: true, guestExpiresAt: { lt: now } },
    select: { id: true },
  });

  for (const guest of expired) {
    // Shared sweeper covers every file-bearing feature (uploads, creator
    // videos, whatever comes next) in one place.
    await removeUserStoredFiles(guest.id);
    await prisma.user.delete({ where: { id: guest.id } });
  }
  return expired.length;
}
