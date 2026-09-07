// Step 9: XP, ranks and streak transitions — including the streak-freeze rule.
import test from "node:test";
import assert from "node:assert/strict";
import { rankFor, nextStreak, localDayKey, dayDiff, RANKS } from "./progression.js";

// --- Ranks -----------------------------------------------------------------

test("rank thresholds map XP to the right level", () => {
  assert.equal(rankFor(0).level, 1);
  assert.equal(rankFor(149).level, 1);
  assert.equal(rankFor(150).level, 2);
  assert.equal(rankFor(799).level, 3);
  assert.equal(rankFor(800).level, 4);
  assert.equal(rankFor(1_000_000).level, RANKS[RANKS.length - 1].level);
});

test("rank progress runs 0..1 within a level and saturates at the top", () => {
  const justRanked = rankFor(150);
  assert.equal(justRanked.progress, 0);

  const midway = rankFor(275); // halfway between 150 and 400
  assert.ok(midway.progress > 0.4 && midway.progress < 0.6);

  const max = rankFor(999_999);
  assert.equal(max.nextXp, null);
  assert.equal(max.progress, 1);
});

test("rank thresholds are monotonically increasing", () => {
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(
      RANKS[i].minXp > RANKS[i - 1].minXp,
      `rank ${i} threshold must exceed the previous one`
    );
  }
});

// --- Streaks ---------------------------------------------------------------

const base = { streakCount: 5, bestStreak: 9, lastActiveDay: "2026-03-10", streakFreezes: 0 };

test("studying twice on the same day doesn't advance the streak", () => {
  const r = nextStreak(base, "2026-03-10");
  assert.equal(r.streakCount, 5);
  assert.equal(r.advanced, false);
  assert.equal(r.freezeUsed, false);
});

test("studying the next day advances the streak", () => {
  const r = nextStreak(base, "2026-03-11");
  assert.equal(r.streakCount, 6);
  assert.equal(r.advanced, true);
});

test("a missed day resets the streak when no freeze is held", () => {
  const r = nextStreak(base, "2026-03-12"); // skipped the 11th
  assert.equal(r.streakCount, 1);
  assert.equal(r.freezeUsed, false);
});

test("a held freeze covers exactly one missed day", () => {
  const r = nextStreak({ ...base, streakFreezes: 1 }, "2026-03-12");
  assert.equal(r.streakCount, 6, "the streak should survive and advance");
  assert.equal(r.freezeUsed, true);
});

test("a freeze does not cover two missed days", () => {
  const r = nextStreak({ ...base, streakFreezes: 1 }, "2026-03-13");
  assert.equal(r.streakCount, 1);
  assert.equal(r.freezeUsed, false, "the freeze should not be spent for nothing");
});

test("the first ever study day starts the streak at 1", () => {
  const r = nextStreak(
    { streakCount: 0, bestStreak: 0, lastActiveDay: null, streakFreezes: 0 },
    "2026-03-10"
  );
  assert.equal(r.streakCount, 1);
  assert.equal(r.bestStreak, 1);
});

test("bestStreak only ever rises", () => {
  const broken = nextStreak(base, "2026-03-20"); // long gap, resets to 1
  assert.equal(broken.streakCount, 1);
  assert.equal(broken.bestStreak, 9, "the personal best must be preserved");
});

test("day arithmetic crosses month and year boundaries", () => {
  assert.equal(dayDiff("2026-02-28", "2026-03-01"), 1, "2026 is not a leap year");
  assert.equal(dayDiff("2024-02-28", "2024-02-29"), 1, "2024 is a leap year");
  assert.equal(dayDiff("2026-12-31", "2027-01-01"), 1);

  const newYear = nextStreak(
    { ...base, lastActiveDay: "2026-12-31" },
    "2027-01-01"
  );
  assert.equal(newYear.streakCount, 6, "the streak should survive New Year");
});

// --- Timezones -------------------------------------------------------------

test("localDayKey resolves the day in the user's own timezone", () => {
  // 23:30 UTC on the 10th is already the 11th in Tokyo, still the 10th in NYC.
  const at = new Date("2026-03-10T23:30:00Z");
  assert.equal(localDayKey("UTC", at), "2026-03-10");
  assert.equal(localDayKey("Asia/Tokyo", at), "2026-03-11");
  assert.equal(localDayKey("America/New_York", at), "2026-03-10");
});

test("an invalid stored timezone falls back to UTC instead of throwing", () => {
  const at = new Date("2026-03-10T12:00:00Z");
  assert.equal(localDayKey("Not/AZone", at), "2026-03-10");
});
