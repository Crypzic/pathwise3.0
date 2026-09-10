// Communities persistence (PATHWISE 2.0 Phase 9). Pure rules live in
// communityModel.ts; this file reads and writes them.
//
// There is deliberately NO seeded catalog anymore (2.0 frontend spec):
// communities are user-created behind the educational guardrail in
// routes/communities.ts, and surfaced by interest match.
import { prisma } from "./prisma.js";

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
