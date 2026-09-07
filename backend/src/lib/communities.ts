// Communities persistence (PATHWISE 2.0 Phase 9). Pure rules live in
// communityModel.ts; this file reads and writes them.
import { prisma } from "./prisma.js";
import { DEFAULT_COMMUNITIES, type CommunitySeed } from "./communityModel.js";

/**
 * Seed the default subject tree. Upserts by slug, so it's safe on every
 * boot and never touches communities added later.
 */
export async function seedCommunities(): Promise<void> {
  async function upsertTree(seed: CommunitySeed, parentId: string | null) {
    const row = await prisma.community.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        parentId,
      },
      // Descriptions may be refined between releases; names/slugs are stable.
      update: { name: seed.name, description: seed.description, parentId },
    });
    for (const child of seed.children ?? []) {
      await upsertTree(child, row.id);
    }
  }
  for (const seed of DEFAULT_COMMUNITIES) {
    await upsertTree(seed, null);
  }
}

/** Is this user a member of the community? (Everything social requires it.) */
export async function membershipOf(
  userId: string,
  communityId: string
): Promise<{ role: string } | null> {
  const m = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { role: true },
  });
  return m;
}
