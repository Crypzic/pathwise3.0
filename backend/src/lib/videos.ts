// Curated video persistence (PATHWISE 2.0 Phase 14). Pure ranking lives in
// videoModel.ts; learner signals come from the same derived-only source the
// buddy matcher uses (matching.ts) — nothing here reads files either.
import { prisma } from "./prisma.js";
import { parseStoredList } from "./onboardingModel.js";
import { signalsFor } from "./matching.js";
import {
  DEFAULT_VIDEOS,
  rankVideos,
  type RankedVideo,
  type VideoRecord,
} from "./videoModel.js";

/** Seed the starter catalog. Matches on url, so re-seeding never duplicates. */
export async function seedVideos(): Promise<void> {
  for (const seed of DEFAULT_VIDEOS) {
    const existing = await prisma.curatedVideo.findFirst({
      where: { url: seed.url },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.curatedVideo.create({
      data: {
        title: seed.title,
        creator: seed.creator,
        url: seed.url,
        thumbnailUrl: seed.thumbnailUrl ?? null,
        subject: seed.subject,
        topicsJson: JSON.stringify(seed.topics),
        difficulty: seed.difficulty ?? null,
        durationSec: seed.durationSec ?? null,
      },
    });
  }
}

function toRecord(v: {
  id: string;
  title: string;
  creator: string;
  url: string;
  thumbnailUrl: string | null;
  subject: string;
  topicsJson: string;
  difficulty: number | null;
  durationSec: number | null;
}): VideoRecord {
  return {
    id: v.id,
    title: v.title,
    creator: v.creator,
    url: v.url,
    thumbnailUrl: v.thumbnailUrl,
    subject: v.subject,
    topics: parseStoredList(v.topicsJson),
    difficulty: v.difficulty,
    durationSec: v.durationSec,
  };
}

/** Published videos ranked for one learner (unmatched ones still included). */
export async function rankedVideosFor(userId: string): Promise<RankedVideo[]> {
  const [videos, signals] = await Promise.all([
    prisma.curatedVideo.findMany({ where: { status: "published" } }),
    signalsFor(userId),
  ]);
  const records = videos.map(toRecord);
  return rankVideos(
    {
      courseTopics: signals?.courseTopics ?? [],
      subjects: signals?.subjects ?? [],
      topicsOfInterest: signals?.topicsOfInterest ?? [],
    },
    records
  );
}
