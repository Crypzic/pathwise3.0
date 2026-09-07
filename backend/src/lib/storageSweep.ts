// One authoritative answer to "delete everything this user has in storage"
// (GDPR/public-launch item). Every purge path — expired guests, the 30-day
// account purge — calls THIS, so a new file-bearing feature only has to be
// added here once. Currently: course uploads and creator videos.
import { prisma } from "./prisma.js";
import { storage } from "./storage.js";

/** Collect every storage path belonging to a user. */
export async function collectUserStoragePaths(userId: string): Promise<string[]> {
  const [uploads, creatorVideos] = await Promise.all([
    prisma.upload.findMany({
      where: { course: { userId } },
      select: { storagePath: true },
    }),
    prisma.creatorVideo.findMany({
      where: { creatorId: userId },
      select: { storagePath: true },
    }),
  ]);
  return [
    ...uploads.map((u) => u.storagePath),
    ...creatorVideos.map((v) => v.storagePath),
  ];
}

/**
 * Best-effort removal of all of a user's stored files. The caller's DB
 * delete is authoritative either way — a failed object delete is logged,
 * never fatal, and the next sweep of an orphaned bucket can retry.
 * Returns how many removals were attempted.
 */
export async function removeUserStoredFiles(userId: string): Promise<number> {
  const paths = await collectUserStoragePaths(userId);
  for (const storagePath of paths) {
    await storage.remove(storagePath).catch((err) => {
      console.warn(
        `⚠️  storage sweep: failed to remove ${storagePath}:`,
        err instanceof Error ? err.message : err
      );
    });
  }
  return paths.length;
}
