// The buddy graph, shared by DMs (Phase 12) and Study Rooms (Phases 11/19).
import { prisma } from "./prisma.js";

/**
 * Is there a block in either direction? Shared by DMs, buddy requests and
 * matching — a block silences every social surface, not just one.
 */
export async function isBlockedEitherWay(x: string, y: string): Promise<boolean> {
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: x, blockedId: y },
        { blockerId: y, blockedId: x },
      ],
    },
    select: { id: true },
  });
  return Boolean(block);
}

/** Every user blocked by or blocking this user — for filtering match pools. */
export async function blockedUserIds(userId: string): Promise<Set<string>> {
  const blocks = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(
    blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId))
  );
}

/** Is there an accepted buddy pair between these two users? */
export async function areBuddies(x: string, y: string): Promise<boolean> {
  const pair = await prisma.buddyRequest.findFirst({
    where: {
      status: "accepted",
      OR: [
        { fromId: x, toId: y },
        { fromId: y, toId: x },
      ],
    },
    select: { id: true },
  });
  return Boolean(pair);
}
