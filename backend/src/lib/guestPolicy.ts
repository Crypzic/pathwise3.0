// Guest-mode rules (PATHWISE 2.0 Phase 1) — pure functions, no database or
// config imports, so the decisions that gate what a guest may do are directly
// unit-testable like masteryModel/progression/planning.

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a guest created `now` expires. */
export function guestExpiry(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * DAY_MS);
}

/** True when a guest is past its expiry and should be purged. */
export function isGuestExpired(
  guestExpiresAt: Date | null,
  now: Date
): boolean {
  return guestExpiresAt !== null && guestExpiresAt.getTime() <= now.getTime();
}

/**
 * Whole days left before a guest's work is deleted — what the banner shows.
 * Never negative; a guest inside its final day reads 1, not 0, so the UI
 * never claims "0 days left" while the session still works.
 */
export function guestDaysLeft(
  guestExpiresAt: Date | null,
  now: Date
): number | null {
  if (guestExpiresAt === null) return null;
  const ms = guestExpiresAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/**
 * Synthetic guest identity. The domain is reserved-by-us and non-routable, so
 * a guest "email" can never collide with a real signup or receive mail; the
 * random part comes from the caller (crypto), keeping this pure.
 */
export function syntheticGuestEmail(randomHex: string): string {
  if (!/^[0-9a-f]{16,}$/.test(randomHex)) {
    throw new Error("guest email randomness must be at least 16 hex chars");
  }
  return `guest-${randomHex}@guest.pathwise.internal`;
}

/** True when an email belongs to the synthetic guest domain. */
export function isSyntheticGuestEmail(email: string): boolean {
  return /^guest-[0-9a-f]{16,}@guest\.pathwise\.internal$/.test(email);
}

/** File-size gate for guest uploads. */
export function guestFileTooLarge(sizeBytes: number, maxMb: number): boolean {
  return sizeBytes > maxMb * 1024 * 1024;
}

/** Upload-count gate: `existingCount` uploads already stored, may one more be added? */
export function guestMayUpload(existingCount: number, cap: number): boolean {
  return existingCount < cap;
}

/** Daily quiz-session gate for guests. */
export function guestMayStartQuiz(startedToday: number, perDay: number): boolean {
  return startedToday < perDay;
}
