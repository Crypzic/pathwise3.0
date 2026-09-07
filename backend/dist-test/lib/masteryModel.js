// The mastery model + spaced-repetition scheduler (Step 4), as pure functions.
//
// Kept free of any Prisma/env import so it can be unit-tested directly (see
// masteryModel.test.ts). lib/mastery.ts wraps these with persistence.
//
// The scheduler is deliberately driven ONLY by last-reviewed time and
// performance. Exam dates are not an input — the blueprint rules them out — so
// this stays a forgetting-curve model rather than a cram planner.
// --- Tuning knobs ----------------------------------------------------------
// How fast mastery moves. A single answer should nudge, not swing.
const LEARN_RATE_CORRECT = 0.28;
const LEARN_RATE_WRONG = 0.34; // losses hurt slightly more than wins help
// Socratic sessions move mastery gently — reasoning through a topic is real
// evidence of understanding, but it isn't a scored assessment.
const SOCRATIC_RATE = 0.06;
const SOCRATIC_MAX_PER_SESSION = 0.12;
// Under this many milliseconds, a correct multiple-choice answer looks more
// like a lucky click than recall.
export const FAST_ANSWER_MS = 2500;
// EWMA weight for the guessing signal.
const GUESS_RATE = 0.3;
// SM-2-ish scheduler bounds.
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const FIRST_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 3;
const MAX_INTERVAL_DAYS = 180;
export const DEFAULT_STATE = {
    mastery: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    reps: 0,
    lapses: 0,
    guessSignal: 0,
};
function clamp01(n) {
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(1, n));
}
function clampEase(e) {
    return Math.max(MIN_EASE, Math.min(MAX_EASE, e));
}
/**
 * How guess-like a single answer looks, 0..1.
 *
 * A correct answer given in under FAST_ANSWER_MS with no Socratic engagement on
 * the topic is the classic pattern of recognising an option rather than knowing
 * the material. Wrong answers aren't "guessing" — they're just wrong, and they
 * already cost mastery, so they sit mid-range here.
 */
export function guessLikelihood(signal) {
    if (!signal.isCorrect)
        return 0.35;
    const fast = signal.timeMs !== null && signal.timeMs < FAST_ANSWER_MS;
    const shallow = signal.socraticTurns === 0;
    if (fast && shallow)
        return 0.9;
    if (fast)
        return 0.55;
    if (shallow)
        return 0.3;
    return 0.1;
}
/**
 * Move mastery for one graded answer, and reschedule the topic.
 *
 * Correct answers pull mastery toward 1, wrong answers toward 0, with the step
 * size proportional to the remaining distance — so 0.1 -> 0.3 is easy and
 * 0.9 -> 0.95 is slow. An answer that looks like a guess earns only a fraction
 * of the credit.
 */
export function applyAnswer(state, signal) {
    const guess = guessLikelihood(signal);
    const nextGuessSignal = clamp01(state.guessSignal * (1 - GUESS_RATE) + guess * GUESS_RATE);
    let mastery;
    if (signal.isCorrect) {
        // Discount the gain by how guess-like the answer looked.
        const credit = LEARN_RATE_CORRECT * (1 - 0.6 * guess);
        mastery = state.mastery + (1 - state.mastery) * credit;
    }
    else {
        mastery = state.mastery - state.mastery * LEARN_RATE_WRONG;
    }
    let { easeFactor, intervalDays, reps, lapses } = state;
    if (signal.isCorrect) {
        reps += 1;
        // Ease drifts up on confident recall, down on guess-like recall.
        easeFactor = clampEase(easeFactor + (guess > 0.6 ? -0.08 : 0.04));
        if (reps === 1)
            intervalDays = FIRST_INTERVAL_DAYS;
        else if (reps === 2)
            intervalDays = SECOND_INTERVAL_DAYS;
        else
            intervalDays = Math.min(MAX_INTERVAL_DAYS, intervalDays * easeFactor);
    }
    else {
        lapses += 1;
        reps = 0;
        easeFactor = clampEase(easeFactor - 0.2);
        // A lapse doesn't reset all the way — same-day re-review is enough.
        intervalDays = 0.5;
    }
    return {
        mastery: clamp01(mastery),
        intervalDays,
        easeFactor,
        reps,
        lapses,
        guessSignal: nextGuessSignal,
    };
}
/**
 * Credit a Socratic session's reasoning depth toward mastery.
 *
 * Capped per session so a student can't talk their way to mastery without ever
 * being assessed — it's a supporting signal, not a substitute for the quiz.
 */
export function applySocraticDepth(state, turns) {
    const gain = Math.min(SOCRATIC_MAX_PER_SESSION, turns * SOCRATIC_RATE);
    return {
        ...state,
        mastery: clamp01(state.mastery + (1 - state.mastery) * gain),
        // Reasoning at length is the opposite of guessing.
        guessSignal: clamp01(state.guessSignal - 0.12 * Math.min(1, turns / 3)),
    };
}
/** When should this topic come back for review? */
export function nextDueAt(state, from = new Date()) {
    const ms = Math.max(0.25, state.intervalDays) * 24 * 60 * 60 * 1000;
    return new Date(from.getTime() + ms);
}
export function isDue(dueAt, now = new Date()) {
    // A topic never reviewed is due immediately — that's the whole backlog.
    if (!dueAt)
        return true;
    return dueAt.getTime() <= now.getTime();
}
/**
 * Course mastery %, weighted by topic emphasis — a heavily-stressed topic you
 * haven't learned should drag the number down more than a footnote does.
 */
export function courseMasteryPct(topics) {
    if (topics.length === 0)
        return 0;
    const totalWeight = topics.reduce((s, t) => s + t.weight, 0);
    if (totalWeight === 0)
        return 0;
    const weighted = topics.reduce((s, t) => s + t.weight * t.mastery, 0);
    return Math.round((weighted / totalWeight) * 100);
}
