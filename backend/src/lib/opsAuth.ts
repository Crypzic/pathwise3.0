// The one way to check the ops secret (security hardening).
//
// Every internal endpoint used to compare `header === env.CRON_SECRET`
// directly — a non-constant-time comparison that in principle leaks match
// length/prefix through timing. Marginal over a network, but
// timingSafeEqual costs nothing and centralizing the check means the next
// ops endpoint can't get it wrong.
import { timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

/** Does this request carry the ops secret? Constant-time, empty-safe. */
export function opsAuthorized(headerValue: unknown): boolean {
  if (!env.CRON_SECRET || typeof headerValue !== "string") return false;
  const provided = Buffer.from(headerValue);
  const expected = Buffer.from(env.CRON_SECRET);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
