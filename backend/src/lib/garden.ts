// Companion persistence + shop seeding (Step 11). The growth curve, catalogue
// and mini-game scoring live in gardenModel.ts as pure values.
import { prisma } from "./prisma.js";
import { SHOP_ITEMS, stageFor } from "./gardenModel.js";

export {
  COMPANION_STAGES,
  LEAF_MATCH_PAIRS,
  SHOP_ITEMS,
  leafMatchReward,
  stageFor,
} from "./gardenModel.js";
export type { ShopItemKey, StageInfo } from "./gardenModel.js";

export interface CompanionState {
  name: string;
  growth: number;
  stage: number;
  stageName: string;
  nextStageAt: number | null;
  progress: number;
  equipped: string[];
}

export async function getCompanion(userId: string): Promise<CompanionState> {
  const row = await prisma.companion.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return {
    name: row.name,
    growth: row.growth,
    equipped: JSON.parse(row.equippedJson) as string[],
    ...stageFor(row.growth),
  };
}

/** Idempotent — safe on every boot. */
export async function seedShopItems(): Promise<void> {
  for (const item of SHOP_ITEMS) {
    await prisma.shopItem.upsert({
      where: { key: item.key },
      create: item,
      update: {
        name: item.name,
        description: item.description,
        priceGardenXp: item.priceGardenXp,
        icon: item.icon,
        premiumOnly: item.premiumOnly,
      },
    });
  }
}
