// Communities (PATHWISE 2.0 Phase 9 / execution item 8) — pure rules.
// No database or config imports; unit-tested directly. Persistence lives in
// communities.ts, routes in routes/communities.ts.

export const POST_KINDS = ["question", "discussion", "resource"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "unsafe",
  "off_topic",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** URL-safe slug from a community name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics after NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function countLinks(text: string): number {
  return (text.match(/https?:\/\/|www\./gi) ?? []).length;
}

/**
 * Cheap spam heuristics that run before anything is stored. Deliberately
 * conservative — the goal is blocking obvious junk, not judging writing.
 * Full AI-assisted moderation arrives in the safety phase.
 */
export function screenText(text: string): { ok: boolean; reason?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Empty content" };
  }
  if (countLinks(trimmed) > 3) {
    return { ok: false, reason: "Too many links — keep it to 3 or fewer" };
  }
  // One character (or one short token) repeated to fill space.
  if (/(.)\1{29,}/.test(trimmed)) {
    return { ok: false, reason: "Repeated characters look like spam" };
  }
  const letters = trimmed.replace(/[^a-zA-Z]/g, "");
  if (
    letters.length >= 30 &&
    letters === letters.toUpperCase()
  ) {
    return { ok: false, reason: "All-caps posts read as shouting" };
  }
  return { ok: true };
}
