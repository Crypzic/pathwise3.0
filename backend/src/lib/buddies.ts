// The buddy graph, shared by DMs (Phase 12) and Study Rooms (Phases 11/19).
import { prisma } from "./prisma.js";

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
