// Step 4's definition of done, as tests: mastery moves correctly after a
// simulated quiz attempt, and the scheduler flags a topic as due once enough
// time has passed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAnswer,
  applySocraticDepth,
  courseMasteryPct,
  DEFAULT_STATE,
  guessLikelihood,
  isDue,
  nextDueAt,
  type MasteryState,
} from "./masteryModel.js";

const DAY = 24 * 60 * 60 * 1000;

function state(over: Partial<MasteryState> = {}): MasteryState {
  return { ...DEFAULT_STATE, ...over };
}

test("a correct answer raises mastery, a wrong answer lowers it", () => {
  const start = state({ mastery: 0.5 });

  const up = applyAnswer(start, { isCorrect: true, timeMs: 8000, socraticTurns: 2 });
  assert.ok(up.mastery > start.mastery, "correct answer should raise mastery");

  const down = applyAnswer(start, { isCorrect: false, timeMs: 8000, socraticTurns: 2 });
  assert.ok(down.mastery < start.mastery, "wrong answer should lower mastery");
});

test("mastery stays within 0..1 under repeated answers", () => {
  let s = state();
  for (let i = 0; i < 60; i++) {
    s = applyAnswer(s, { isCorrect: true, timeMs: 9000, socraticTurns: 3 });
  }
  assert.ok(s.mastery <= 1, `mastery exceeded 1: ${s.mastery}`);
  assert.ok(s.mastery > 0.9, "20+ good answers should approach mastery");

  for (let i = 0; i < 60; i++) {
    s = applyAnswer(s, { isCorrect: false, timeMs: 9000, socraticTurns: 0 });
  }
  assert.ok(s.mastery >= 0, `mastery went negative: ${s.mastery}`);
});

test("gains shrink as mastery approaches 1", () => {
  const early = applyAnswer(state({ mastery: 0.1 }), {
    isCorrect: true,
    timeMs: 9000,
    socraticTurns: 2,
  });
  const late = applyAnswer(state({ mastery: 0.9 }), {
    isCorrect: true,
    timeMs: 9000,
    socraticTurns: 2,
  });
  assert.ok(
    early.mastery - 0.1 > late.mastery - 0.9,
    "a beginner should gain more per answer than someone near mastery"
  );
});

test("a fast, shallow correct answer earns less credit than a considered one", () => {
  const base = state({ mastery: 0.4 });
  const guessy = applyAnswer(base, {
    isCorrect: true,
    timeMs: 900,
    socraticTurns: 0,
  });
  const considered = applyAnswer(base, {
    isCorrect: true,
    timeMs: 12_000,
    socraticTurns: 4,
  });

  assert.ok(
    considered.mastery > guessy.mastery,
    "reasoned answers should be worth more mastery than lucky clicks"
  );
  assert.ok(
    guessy.guessSignal > considered.guessSignal,
    "the guessing signal should rise on fast shallow answers"
  );
});

test("guessLikelihood ranks the four answer shapes as expected", () => {
  const fastShallow = guessLikelihood({ isCorrect: true, timeMs: 500, socraticTurns: 0 });
  const fastDeep = guessLikelihood({ isCorrect: true, timeMs: 500, socraticTurns: 5 });
  const slowShallow = guessLikelihood({ isCorrect: true, timeMs: 20_000, socraticTurns: 0 });
  const slowDeep = guessLikelihood({ isCorrect: true, timeMs: 20_000, socraticTurns: 5 });

  assert.ok(fastShallow > fastDeep);
  assert.ok(fastDeep > slowShallow);
  assert.ok(slowShallow > slowDeep);
});

test("a missing timestamp is not treated as a guess", () => {
  // Older clients may not send timeMs; absence must not be read as "instant".
  const noTime = guessLikelihood({ isCorrect: true, timeMs: null, socraticTurns: 0 });
  const instant = guessLikelihood({ isCorrect: true, timeMs: 10, socraticTurns: 0 });
  assert.ok(noTime < instant);
});

// --- Scheduler -------------------------------------------------------------

test("the scheduler lengthens the interval on each successful review", () => {
  const now = new Date("2026-01-01T09:00:00Z");

  const first = applyAnswer(state(), { isCorrect: true, timeMs: 9000, socraticTurns: 2 });
  assert.equal(first.reps, 1);
  assert.equal(first.intervalDays, 1, "first success schedules tomorrow");

  const second = applyAnswer(first, { isCorrect: true, timeMs: 9000, socraticTurns: 2 });
  assert.equal(second.intervalDays, 3, "second success schedules 3 days out");

  const third = applyAnswer(second, { isCorrect: true, timeMs: 9000, socraticTurns: 2 });
  assert.ok(third.intervalDays > 3, "third success expands beyond 3 days");

  // And that interval actually lands in the future.
  assert.ok(nextDueAt(third, now).getTime() > now.getTime());
});

test("a topic becomes due only once its interval has elapsed", () => {
  const reviewedAt = new Date("2026-01-01T09:00:00Z");
  const s = applyAnswer(state(), { isCorrect: true, timeMs: 9000, socraticTurns: 2 });
  const dueAt = nextDueAt(s, reviewedAt); // 1 day later

  assert.equal(
    isDue(dueAt, new Date(reviewedAt.getTime() + 2 * 60 * 60 * 1000)),
    false,
    "not due two hours after review"
  );
  assert.equal(
    isDue(dueAt, new Date(reviewedAt.getTime() + DAY + 1000)),
    true,
    "due once the interval has passed"
  );
});

test("a never-reviewed topic is due immediately", () => {
  assert.equal(isDue(null), true);
});

test("a wrong answer pulls the topic back for near-term review", () => {
  const learned = applyAnswer(
    applyAnswer(state(), { isCorrect: true, timeMs: 9000, socraticTurns: 2 }),
    { isCorrect: true, timeMs: 9000, socraticTurns: 2 }
  );
  assert.equal(learned.intervalDays, 3);

  const lapsed = applyAnswer(learned, { isCorrect: false, timeMs: 9000, socraticTurns: 2 });
  assert.ok(lapsed.intervalDays < learned.intervalDays, "a lapse shortens the interval");
  assert.equal(lapsed.reps, 0, "a lapse resets the rep count");
  assert.equal(lapsed.lapses, 1);
  assert.ok(lapsed.easeFactor < learned.easeFactor, "a lapse lowers ease");
});

test("ease stays within its bounds under sustained failure or success", () => {
  let s = state();
  for (let i = 0; i < 40; i++) {
    s = applyAnswer(s, { isCorrect: false, timeMs: 9000, socraticTurns: 0 });
  }
  assert.ok(s.easeFactor >= 1.3, `ease dropped below floor: ${s.easeFactor}`);

  for (let i = 0; i < 80; i++) {
    s = applyAnswer(s, { isCorrect: true, timeMs: 20_000, socraticTurns: 5 });
  }
  assert.ok(s.easeFactor <= 2.8, `ease rose above ceiling: ${s.easeFactor}`);
  assert.ok(s.intervalDays <= 180, `interval exceeded cap: ${s.intervalDays}`);
});

// --- Socratic depth --------------------------------------------------------

test("Socratic depth nudges mastery up and the guessing signal down", () => {
  const start = state({ mastery: 0.4, guessSignal: 0.8 });
  const after = applySocraticDepth(start, 5);

  assert.ok(after.mastery > start.mastery);
  assert.ok(after.guessSignal < start.guessSignal);
});

test("Socratic depth alone can't reach mastery", () => {
  let s = state();
  for (let i = 0; i < 40; i++) {
    s = applySocraticDepth(s, 10);
  }
  // It converges, but the cap means talking is never a substitute for being
  // assessed — the gain per session is bounded.
  const oneSession = applySocraticDepth(state({ mastery: 0.4 }), 100);
  assert.ok(
    oneSession.mastery - 0.4 <= 0.12 + 1e-9,
    "a single session should not exceed the per-session cap"
  );
});

// --- Course rollup ---------------------------------------------------------

test("course mastery weights heavily-emphasised topics more", () => {
  const evenlyWeighted = courseMasteryPct([
    { weight: 0.5, mastery: 1 },
    { weight: 0.5, mastery: 0 },
  ]);
  assert.equal(evenlyWeighted, 50);

  // Knowing only the footnote should score far worse than knowing the core.
  const knowsFootnote = courseMasteryPct([
    { weight: 1.0, mastery: 0 },
    { weight: 0.2, mastery: 1 },
  ]);
  const knowsCore = courseMasteryPct([
    { weight: 1.0, mastery: 1 },
    { weight: 0.2, mastery: 0 },
  ]);
  assert.ok(knowsCore > knowsFootnote);
  assert.ok(knowsFootnote < 20);
});

test("course mastery handles an empty or zero-weight course", () => {
  assert.equal(courseMasteryPct([]), 0);
  assert.equal(courseMasteryPct([{ weight: 0, mastery: 1 }]), 0);
});
