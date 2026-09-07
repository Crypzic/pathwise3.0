// Companion growth, shop catalogue and mini-game scoring (Step 11), as pure
// data + functions. No Prisma/env import, so it's unit-testable.
//
// Two separate currencies on purpose:
//   - Study XP grows the companion passively (see gamification.awardXp). The
//     pet advances whether or not the student ever opens the mini-game.
//   - Garden XP is earned only in the mini-game and is the only thing that
//     buys cosmetics and streak freezes.
//
// That split is what stops the shop from turning studying into a grind.

export const COMPANION_STAGES = [
  { stage: 0, name: "Seed", minGrowth: 0 },
  { stage: 1, name: "Sprout", minGrowth: 120 },
  { stage: 2, name: "Seedling", minGrowth: 400 },
  { stage: 3, name: "Leafy", minGrowth: 900 },
  { stage: 4, name: "Blooming", minGrowth: 1800 },
  { stage: 5, name: "Flourishing", minGrowth: 3200 },
] as const;

export interface StageInfo {
  stage: number;
  stageName: string;
  nextStageAt: number | null;
  progress: number; // 0..1 toward the next stage
}

export function stageFor(growth: number): StageInfo {
  let idx = 0;
  for (let i = 0; i < COMPANION_STAGES.length; i++) {
    if (growth >= COMPANION_STAGES[i].minGrowth) idx = i;
  }
  const current = COMPANION_STAGES[idx];
  const next = COMPANION_STAGES[idx + 1] ?? null;
  const span = next ? next.minGrowth - current.minGrowth : 0;
  return {
    stage: current.stage,
    stageName: current.name,
    nextStageAt: next?.minGrowth ?? null,
    progress: span > 0 ? Math.min(1, (growth - current.minGrowth) / span) : 1,
  };
}

// --- Shop catalogue --------------------------------------------------------

export const SHOP_ITEMS = [
  {
    key: "streak_freeze",
    name: "Streak Freeze",
    description: "Protects your streak if you miss a day.",
    kind: "consumable",
    slot: "utility",
    priceGardenXp: 40,
    icon: "snowflake",
    premiumOnly: false,
  },
  {
    key: "tiny_crown",
    name: "Tiny Crown",
    description: "Cosmetic — companion accessory.",
    kind: "cosmetic",
    slot: "companion",
    priceGardenXp: 25,
    icon: "gem",
    premiumOnly: false,
  },
  {
    key: "garden_pot",
    name: "Garden Pot Upgrade",
    description: "Cosmetic — habitat decoration.",
    kind: "cosmetic",
    slot: "habitat",
    priceGardenXp: 30,
    icon: "flower",
    premiumOnly: false,
  },
  {
    key: "dew_lantern",
    name: "Dew Lantern",
    description: "Cosmetic — a soft glow for the habitat.",
    kind: "cosmetic",
    slot: "habitat",
    priceGardenXp: 45,
    icon: "droplet",
    premiumOnly: false,
  },
  {
    key: "aurora_wings",
    name: "Aurora Wings",
    description: "Cosmetic — Pro members only.",
    kind: "cosmetic",
    slot: "companion",
    priceGardenXp: 60,
    icon: "sparkles",
    premiumOnly: true,
  },
] as const;

export type ShopItemKey = (typeof SHOP_ITEMS)[number]["key"];

// --- Leaf Match scoring ----------------------------------------------------

// Deliberately calm: no timer, no fail state. Garden XP comes from pairs found,
// with a small completion bonus — so a slow, careful game earns the same as a
// fast one.
const XP_PER_PAIR = 4;
const COMPLETION_BONUS = 8;
export const LEAF_MATCH_PAIRS = 6;

/** How much Garden XP a finished round is worth. */
export function leafMatchReward(pairsFound: number, completed: boolean): number {
  const capped = Math.max(0, Math.min(LEAF_MATCH_PAIRS, pairsFound));
  const bonus = completed && capped === LEAF_MATCH_PAIRS ? COMPLETION_BONUS : 0;
  return capped * XP_PER_PAIR + bonus;
}
