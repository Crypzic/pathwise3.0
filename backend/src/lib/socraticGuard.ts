// Socratic Mode answer-leak guard (Step 7 item 1).
//
// The system prompt tells the model never to give the answer. That is necessary
// but not sufficient: prompts get jailbroken, and "add a system prompt and
// hope" is exactly what the build plan warns against. So every reply is
// inspected before it reaches the student, and a leaking reply is regenerated
// once under a stronger instruction, then replaced with a safe probe if it
// still leaks.
//
// The detector is intentionally biased toward false positives. Wrongly
// replacing a good guiding question costs the student a little conversational
// warmth. Wrongly letting an answer through defeats the entire feature.

// A guiding question is short by nature. The system prompt asks for 1-3
// sentences; these are the outer bounds the guard enforces regardless.
const MAX_REPLY_WORDS = 70;
const MAX_REPLY_SENTENCES = 4;

/** Phrases that announce an answer outright. */
const ANSWER_ANNOUNCERS: RegExp[] = [
  /\bthe (?:correct )?answer is\b/i,
  /\bthe answer to (?:that|this|your question) is\b/i,
  /\bthe correct (?:option|choice|response) is\b/i,
  /\bthe solution is\b/i,
  /\bis defined as\b/i,
  /\bin short,?\s+(?:it|that)(?:'s| is)\b/i,
  /\bto summari[sz]e,?\s+(?:it|that)(?:'s| is)\b/i,
  /\bhere(?:'s| is) (?:the|your) (?:answer|solution)\b/i,
  /\bwhat happens is\b/i,
  /\bthis (?:happens )?because\b.*\btherefore\b/is,
  /\bso the result is\b/i,
  /\bthat (?:would )?(?:give|gives) (?:you )?\b.*\b(?:as the answer|the result)\b/i,
];

/** Confirming or denying a specific candidate answer — also a leak. */
const VERDICT_PATTERNS: RegExp[] = [
  /\b(?:yes|yep|correct|exactly|that's right|right)\b[,!.]?\s+(?:it|that|the answer)\s+(?:is|was)\b/i,
  /\bno,?\s+(?:it|that)(?:'s| is)\s+(?:actually|really)\b/i,
  /\bthe (?:right|correct) one is\s+(?:option\s+)?[a-d]\b/i,
  /\boption\s+[a-d]\s+is\s+(?:the\s+)?correct\b/i,
  /\bit(?:'s| is)\s+(?:option\s+)?[a-d]\b/i,
];

/** A worked solution: numbered or sequenced steps ending in a result. */
const WORKED_SOLUTION = /(?:^|\n)\s*(?:step\s*\d|[1-9][.)])\s+\S+[\s\S]*?(?:^|\n)\s*(?:step\s*\d|[2-9][.)])\s+/i;

/** "First… then… finally…" prose walkthroughs. */
const PROSE_WALKTHROUGH =
  /\bfirst\b[\s\S]{20,}\b(?:then|next)\b[\s\S]{20,}\b(?:finally|lastly|and you get|which gives)\b/i;

export interface LeakVerdict {
  leaked: boolean;
  reason: string | null;
}

/**
 * Does this reply hand the student an answer?
 *
 * Checked in order of confidence: explicit announcements, verdicts on a
 * candidate answer, worked solutions, then the structural check that a Socratic
 * turn should actually ask something.
 */
export function detectAnswerLeak(reply: string): LeakVerdict {
  const text = reply.trim();
  if (text.length === 0) {
    return { leaked: true, reason: "empty_reply" };
  }

  for (const re of ANSWER_ANNOUNCERS) {
    if (re.test(text)) return { leaked: true, reason: "announces_answer" };
  }
  for (const re of VERDICT_PATTERNS) {
    if (re.test(text)) return { leaked: true, reason: "verdict_on_candidate" };
  }
  if (WORKED_SOLUTION.test(text)) {
    return { leaked: true, reason: "worked_solution" };
  }
  if (PROSE_WALKTHROUGH.test(text)) {
    return { leaked: true, reason: "prose_walkthrough" };
  }

  // A Socratic turn hands the thinking back to the student. No question mark
  // means it's telling, not asking.
  if (!text.includes("?")) {
    return { leaked: true, reason: "no_question" };
  }

  // Length is the subtlest leak: a model can obey "end with a question" while
  // explaining the entire topic first. The prompt asks for 1-3 sentences, so
  // these bounds are already generous — anything past them is a lecture with a
  // question stapled on.
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > MAX_REPLY_WORDS) {
    return { leaked: true, reason: "too_long" };
  }
  const sentences = text.split(/[.!?]+\s|[.!?]+$/).filter((s) => s.trim().length > 0);
  if (sentences.length > MAX_REPLY_SENTENCES) {
    return { leaked: true, reason: "too_long" };
  }

  return { leaked: false, reason: null };
}

/** Does the student's message look like a deliberate extraction attempt? */
export function detectExtractionAttempt(message: string): boolean {
  const patterns = [
    /\bjust (?:tell|give) me (?:the )?answer\b/i,
    /\bwhat(?:'s| is) the answer\b/i,
    /\bstop asking (?:me )?questions\b/i,
    /\bignore (?:your|the|all) (?:previous )?(?:instructions|rules|prompt)\b/i,
    /\bi(?:'m| am) (?:the )?(?:teacher|lecturer|professor|instructor)\b/i,
    /\byou(?:'re| are) allowed to (?:tell|say)\b/i,
    /\bpretend (?:you(?:'re| are)|to be)\b/i,
    /\bfor (?:testing|debug) purposes\b/i,
    /\bdeveloper mode\b/i,
    /\bjust this once\b/i,
    /\bspoil(?:er)?\b.*\banswer\b/i,
  ];
  return patterns.some((re) => re.test(message));
}

/**
 * Replacement turns used when the model can't be coaxed into a clean reply.
 * Varied by turn index so a repeatedly-guarded conversation doesn't loop the
 * identical sentence back at the student.
 */
const FALLBACK_PROBES = [
  "I'm not going to hand you that one — you're closer than you think. What's the first thing you'd check?",
  "Let's stay with your reasoning. Which part of it are you least sure about?",
  "If you had to explain your current thinking to a classmate, where would you get stuck?",
  "What would have to be true for your answer to be right?",
  "Try the simplest version of this problem first — what does that tell you?",
  "What do you already know that rules one of the options out?",
];

export function fallbackProbe(turnIndex: number): string {
  return FALLBACK_PROBES[turnIndex % FALLBACK_PROBES.length];
}

/**
 * Extra instruction appended on the retry attempt. Naming the specific failure
 * gets a usable reply far more often than repeating the original rule.
 */
export function retryNudge(reason: string): string {
  switch (reason) {
    case "announces_answer":
    case "verdict_on_candidate":
      return "Your previous reply stated or confirmed the answer, which is forbidden. Ask a single short question that helps the student find it themselves. Do not evaluate whether their candidate answer is correct.";
    case "worked_solution":
    case "prose_walkthrough":
      return "Your previous reply walked through the solution, which is forbidden. Reply with one short question about the very first step only.";
    case "no_question":
      return "Your previous reply did not ask anything. Reply with a single guiding question, ending in a question mark.";
    case "too_long":
      return "Your previous reply was too long. Reply with at most two sentences, ending in a question.";
    default:
      return "Reply with a single short guiding question and no answer content.";
  }
}
