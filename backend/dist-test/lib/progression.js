// XP values, ranks and streak transitions (Step 9), as pure functions.
//
// No Prisma/env import, so the branching is unit-testable. lib/gamification.ts
// wraps these with persistence.
// --- XP values -------------------------------------------------------------
export const XP = {
    quizCorrect: 10,
    quizIncorrect: 2, // effort still counts — this is a study app, not a test
    quizCompleted: 15,
    socraticTurn: 4,
    socraticSession: 20,
    reviewCompleted: 15,
};
// --- Ranks -----------------------------------------------------------------
// Cumulative XP thresholds. Deliberately front-loaded so the first few ranks
// arrive quickly and the later ones stay meaningful.
export const RANKS = [
    { level: 1, name: "Seedling", minXp: 0 },
    { level: 2, name: "Sprout", minXp: 150 },
    { level: 3, name: "Sapling", minXp: 400 },
    { level: 4, name: "Explorer", minXp: 800 },
    { level: 5, name: "Pathfinder", minXp: 1500 },
    { level: 6, name: "Scholar", minXp: 2600 },
    { level: 7, name: "Sage", minXp: 4200 },
    { level: 8, name: "Luminary", minXp: 6500 },
];
export function rankFor(xp) {
    let idx = 0;
    for (let i = 0; i < RANKS.length; i++) {
        if (xp >= RANKS[i].minXp)
            idx = i;
    }
    const current = RANKS[idx];
    const next = RANKS[idx + 1] ?? null;
    const span = next ? next.minXp - current.minXp : 0;
    return {
        level: current.level,
        name: current.name,
        minXp: current.minXp,
        nextXp: next?.minXp ?? null,
        progress: span > 0 ? Math.min(1, (xp - current.minXp) / span) : 1,
    };
}
// --- Streaks ---------------------------------------------------------------
/** "YYYY-MM-DD" for `at` as seen in `timezone`. */
export function localDayKey(timezone, at = new Date()) {
    try {
        // en-CA gives ISO-ordered date parts.
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(at);
    }
    catch {
        // An invalid stored timezone shouldn't break every study action.
        return at.toISOString().slice(0, 10);
    }
}
export function dayDiff(fromKey, toKey) {
    const from = Date.parse(`${fromKey}T00:00:00Z`);
    const to = Date.parse(`${toKey}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to))
        return 0;
    return Math.round((to - from) / 86_400_000);
}
/**
 * The streak transition.
 *
 * - Same day: nothing changes (studying twice doesn't double-count).
 * - Next day: streak advances.
 * - Exactly one day skipped with a freeze available: the freeze is spent and
 *   the streak survives.
 * - Anything longer: streak resets to 1.
 */
export function nextStreak(prev, todayKey) {
    if (prev.lastActiveDay === todayKey) {
        return {
            streakCount: prev.streakCount,
            bestStreak: prev.bestStreak,
            advanced: false,
            freezeUsed: false,
        };
    }
    const gap = prev.lastActiveDay
        ? dayDiff(prev.lastActiveDay, todayKey)
        : Infinity;
    let streakCount;
    let freezeUsed = false;
    if (gap === 1) {
        streakCount = prev.streakCount + 1;
    }
    else if (gap === 2 && prev.streakFreezes > 0) {
        // One missed day, covered.
        streakCount = prev.streakCount + 1;
        freezeUsed = true;
    }
    else {
        streakCount = 1;
    }
    return {
        streakCount,
        bestStreak: Math.max(prev.bestStreak, streakCount),
        advanced: true,
        freezeUsed,
    };
}
