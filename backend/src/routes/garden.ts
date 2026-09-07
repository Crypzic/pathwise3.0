// Sprout's Garden: companion, mini-game and shop (Step 11).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  getCompanion,
  leafMatchReward,
  LEAF_MATCH_PAIRS,
} from "../lib/garden.js";
import { track } from "../lib/analytics.js";
import { features } from "../lib/features.js";
import type { InventoryItem, ShopItem } from "@prisma/client";

// Phase 0 (PATHWISE 2.0): Leaf Match is frozen. Reads stay open — the
// companion and existing balances remain visible — but the XP economy
// (earning in the mini-game, spending in the shop) is refused server-side.
const FROZEN_REPLY = {
  error: "feature_disabled",
  message: "Leaf Match is taking a break while we build what replaces it.",
};

const finishSchema = z.object({
  pairsFound: z.number().int().min(0).max(LEAF_MATCH_PAIRS),
  completed: z.boolean(),
});

const purchaseSchema = z.object({
  itemKey: z.string().min(1),
});

const equipSchema = z.object({
  equipped: z.array(z.string()).max(6),
});

// A round can't be worth more than a perfect game, and rounds are rate-limited
// below — together that caps how fast Garden XP can be farmed.
export default async function gardenRoutes(app: FastifyInstance) {
  // Companion + wallet + inventory in one read.
  app.get("/api/garden", { preHandler: [app.authenticate] }, async (req, reply) => {
    const [companion, user, inventory] = await Promise.all([
      getCompanion(req.user.sub),
      prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { gardenXp: true, streakFreezes: true, subscription: true },
      }),
      prisma.inventoryItem.findMany({
        where: { userId: req.user.sub },
        include: { item: true },
      }),
    ]);

    const isPremium = user?.subscription?.tier === "premium";

    return reply.send({
      companion,
      wallet: {
        gardenXp: user?.gardenXp ?? 0,
        streakFreezes: user?.streakFreezes ?? 0,
      },
      inventory: inventory.map((i: InventoryItem & { item: ShopItem }) => ({
        key: i.item.key,
        name: i.item.name,
        slot: i.item.slot,
        quantity: i.quantity,
      })),
      isPremium,
      pairsPerRound: LEAF_MATCH_PAIRS,
    });
  });

  // Record a finished Leaf Match round and pay out Garden XP.
  app.post(
    "/api/garden/minigame/finish",
    {
      preHandler: [app.authenticate],
      // Calm game, calm limit — enough for genuine play, not for scripting.
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      if (!features.leafMatch) {
        return reply.code(403).send(FROZEN_REPLY);
      }
      const parsed = finishSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }
      const reward = leafMatchReward(parsed.data.pairsFound, parsed.data.completed);

      const user = await prisma.user.update({
        where: { id: req.user.sub },
        data: { gardenXp: { increment: reward } },
        select: { gardenXp: true },
      });

      await track(req.user.sub, "minigame_completed", {
        pairsFound: parsed.data.pairsFound,
        completed: parsed.data.completed,
        reward,
      });

      return reply.send({ gardenXpEarned: reward, gardenXp: user.gardenXp });
    }
  );

  // Shop catalogue, with affordability and ownership resolved server-side.
  app.get("/api/garden/shop", { preHandler: [app.authenticate] }, async (req, reply) => {
    const [items, user, owned] = await Promise.all([
      prisma.shopItem.findMany({ orderBy: { priceGardenXp: "asc" } }),
      prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { gardenXp: true, subscription: true },
      }),
      prisma.inventoryItem.findMany({
        where: { userId: req.user.sub },
        select: { itemId: true },
      }),
    ]);

    const gardenXp = user?.gardenXp ?? 0;
    const isPremium = user?.subscription?.tier === "premium";
    const ownedIds = new Set(owned.map((o) => o.itemId));

    return reply.send({
      gardenXp,
      isPremium,
      items: items.map((i: ShopItem) => ({
        key: i.key,
        name: i.name,
        description: i.description,
        kind: i.kind,
        slot: i.slot,
        price: i.priceGardenXp,
        icon: i.icon,
        premiumOnly: i.premiumOnly,
        // Consumables are always re-buyable; cosmetics are one-time.
        owned: i.kind === "cosmetic" && ownedIds.has(i.id),
        locked: i.premiumOnly && !isPremium,
        affordable: gardenXp >= i.priceGardenXp,
      })),
    });
  });

  // Buy an item. Spends Garden XP; premium-only items are gated (Step 13).
  app.post(
    "/api/garden/shop/purchase",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!features.leafMatch) {
        return reply.code(403).send(FROZEN_REPLY);
      }
      const parsed = purchaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }

      const item = await prisma.shopItem.findUnique({
        where: { key: parsed.data.itemKey },
      });
      if (!item) return reply.code(404).send({ error: "Item not found" });

      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { gardenXp: true, subscription: true },
      });
      if (!user) return reply.code(404).send({ error: "User not found" });

      if (item.premiumOnly && user.subscription?.tier !== "premium") {
        return reply.code(402).send({
          error: "premium_required",
          message: "This item is available on Pathwise Pro.",
        });
      }

      const existing = await prisma.inventoryItem.findUnique({
        where: { userId_itemId: { userId: req.user.sub, itemId: item.id } },
      });
      if (item.kind === "cosmetic" && existing) {
        return reply.code(409).send({ error: "You already own this." });
      }

      if (user.gardenXp < item.priceGardenXp) {
        return reply.code(402).send({
          error: "insufficient_garden_xp",
          message: `You need ${item.priceGardenXp - user.gardenXp} more Garden XP. Play Leaf Match to earn some.`,
        });
      }

      // Debit, then grant. A consumable increments quantity; the streak freeze
      // is special-cased because it lives as a counter on the user.
      const updated = await prisma.user.update({
        where: { id: req.user.sub },
        data: {
          gardenXp: { decrement: item.priceGardenXp },
          streakFreezes:
            item.key === "streak_freeze" ? { increment: 1 } : undefined,
        },
        select: { gardenXp: true, streakFreezes: true },
      });

      await prisma.inventoryItem.upsert({
        where: { userId_itemId: { userId: req.user.sub, itemId: item.id } },
        create: { userId: req.user.sub, itemId: item.id },
        update: { quantity: { increment: 1 } },
      });

      await track(req.user.sub, "shop_purchase", {
        itemKey: item.key,
        price: item.priceGardenXp,
      });

      return reply.send({
        ok: true,
        gardenXp: updated.gardenXp,
        streakFreezes: updated.streakFreezes,
      });
    }
  );

  // Equip cosmetics on the companion (shown on the Profile screen).
  app.post("/api/garden/equip", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = equipSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }

    // Only equip what the user actually owns.
    const owned = await prisma.inventoryItem.findMany({
      where: { userId: req.user.sub },
      include: { item: true },
    });
    const ownedKeys = new Set(
      owned
        .filter((o: InventoryItem & { item: ShopItem }) => o.item.kind === "cosmetic")
        .map((o: InventoryItem & { item: ShopItem }) => o.item.key)
    );
    const valid = parsed.data.equipped.filter((k) => ownedKeys.has(k));

    await prisma.companion.upsert({
      where: { userId: req.user.sub },
      create: { userId: req.user.sub, equippedJson: JSON.stringify(valid) },
      update: { equippedJson: JSON.stringify(valid) },
    });

    return reply.send({ equipped: valid });
  });

  // Rename the companion.
  app.patch("/api/garden/companion", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = z
      .object({ name: z.string().min(1).max(24) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid name" });
    }
    await prisma.companion.upsert({
      where: { userId: req.user.sub },
      create: { userId: req.user.sub, name: parsed.data.name },
      update: { name: parsed.data.name },
    });
    return reply.send({ name: parsed.data.name });
  });
}
