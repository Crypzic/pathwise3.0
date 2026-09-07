// Built-in error tracking (beta-readiness item) — pure rules.
//
// Testers report crashes; the public just leaves. This is the minimal
// channel that makes failures visible without a third-party service or a
// new dependency: errors are fingerprinted for grouping, deduped per day,
// and read back through the ops surface. A real Sentry can replace the
// transport later; the capture points stay where they are.
import { createHash } from "node:crypto";

export const MAX_MESSAGE = 500;
export const MAX_STACK = 4000;
export const MAX_URL = 300;

/** Local day key used for daily dedupe buckets. */
export function dayKeyOf(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Group errors that are "the same": normalized message + the first
 * meaningful stack frame. Ids, quoted values and line/col numbers are
 * stripped so "User abc123 not found at foo.ts:41:7" and the same error
 * for another user land in one bucket.
 */
export function fingerprintError(message: string, stack?: string | null): string {
  const normalizedMessage = normalize(message);
  const firstFrame = (stack ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("at ") || /\S+\.[jt]sx?/.test(l));
  const normalizedFrame = normalize(firstFrame ?? "");
  return createHash("sha256")
    .update(`${normalizedMessage}\n${normalizedFrame}`)
    .digest("hex")
    .slice(0, 16);
}

function normalize(s: string): string {
  return s
    .replace(/["'`][^"'`]*["'`]/g, '"…"') // quoted values
    .replace(/\b[0-9a-f]{8,}\b/gi, "«id»") // hashes/cuids
    .replace(/:\d+:\d+/g, "") // line:col
    .replace(/\d{3,}/g, "«n»") // long numbers
    .toLowerCase()
    .trim()
    .slice(0, 300);
}

/** Bound an incoming (possibly hostile) client report to safe sizes. */
export function boundReport(input: {
  message?: unknown;
  stack?: unknown;
  url?: unknown;
}): { message: string; stack: string | null; url: string | null } | null {
  const message =
    typeof input.message === "string" ? input.message.trim().slice(0, MAX_MESSAGE) : "";
  if (message.length === 0) return null;
  return {
    message,
    stack:
      typeof input.stack === "string" && input.stack.length > 0
        ? input.stack.slice(0, MAX_STACK)
        : null,
    url:
      typeof input.url === "string" && input.url.length > 0
        ? input.url.slice(0, MAX_URL)
        : null,
  };
}
