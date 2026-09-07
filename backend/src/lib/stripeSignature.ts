// Stripe webhook signature verification (Step 13), without pulling in the SDK.
//
// Isolated from the route so it can be tested directly — a webhook verifier
// that silently accepts everything is how you end up granting free premium to
// anyone who can POST.
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Stripe's `t=…,v1=…` signature header against the raw request body.
 *
 * Signatures older than `toleranceSeconds` are rejected to blunt replay
 * attempts. `now` is injectable so the tolerance window is testable.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
  now: number = Date.now()
): boolean {
  if (!secret) return false;

  const parts = header.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const idx = part.indexOf("=");
    if (idx <= 0) return acc;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) return acc;
    (acc[key] ??= []).push(value);
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  // Constant-time compare against each provided signature.
  return signatures.some((sig) => {
    if (sig.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
    } catch {
      return false;
    }
  });
}

/** Build a valid header — used by tests, and handy for manual webhook replay. */
export function signPayload(
  rawBody: string,
  secret: string,
  timestampSeconds: number
): string {
  const sig = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestampSeconds},v1=${sig}`;
}
