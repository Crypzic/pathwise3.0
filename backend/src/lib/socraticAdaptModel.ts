// Socratic 3.0 adaptivity (PATHWISE 2.0 Phase 7) — pure functions.
//
// The tutor escalates support when the student is genuinely stuck: first a
// more concrete hint, then decomposition into the smallest first step. The
// pedagogical contract (never the answer) is untouched — escalation changes
// how much scaffolding the QUESTION carries, and the leak guard still
// inspects every reply.
import type { ChatMessage } from "../ai/types.js";

/** 0 = normal probing, 1 = concrete hint, 2 = decompose to the first step. */
export type EscalationLevel = 0 | 1 | 2;

// Short, low-content replies that signal "I'm stuck", not reasoning.
const STUCK_PATTERNS: RegExp[] = [
  /^i\s*(don'?t|do\s*not)\s*(know|understand|get)/i,
  /^(idk|dunno|dk)\b/i,
  /^no\s*(idea|clue)/i,
  /^not\s*sure/i,
  /^(help|stuck|lost|confused)\b/i,
  /^i\s*(give\s*up|can'?t)/i,
  /^(\?+|\.+)$/,
  /^what\??$/i,
  /^huh\??$/i,
];

/** Does one student message read as a stuck signal rather than reasoning? */
export function isStuckMessage(content: string): boolean {
  const cleaned = content.trim();
  if (cleaned.length === 0) return true;
  // A long message contains reasoning to engage with, even if it starts
  // with "I don't know" — only short messages count as stuck.
  if (cleaned.length > 60) return false;
  return STUCK_PATTERNS.some((p) => p.test(cleaned));
}

/**
 * How stuck the student is right now: consecutive stuck messages counted
 * back from their latest turn, capped at 2. One shaky message earns a more
 * concrete hint; two or more earn decomposition.
 */
export function stuckLevel(history: ChatMessage[]): EscalationLevel {
  let level = 0;
  for (let i = history.length - 1; i >= 0 && level < 2; i--) {
    const m = history[i];
    if (m.role !== "user") continue;
    if (!isStuckMessage(m.content)) break;
    level += 1;
  }
  return level as EscalationLevel;
}
