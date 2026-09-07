// Study Buddy Matching persistence (PATHWISE 2.0 Phase 10). The scoring is
// pure (matchModel.ts); this file assembles each user's DERIVED signals.
//
// Privacy invariant: nothing here ever reads Upload rows or file contents.
// Signals are the self-declared learner profile, topic NAMES from knowledge
// maps, and community membership ids — exactly what the roadmap allows.
import { prisma } from "./prisma.js";
import {
  normalizeBuddyPrefs,
  parseStoredList,
} from "./onboardingModel.js";
import {
  rankMatches,
  type MatchSignals,
} from "./matchModel.js";

export async function signalsFor(userId: string): Promise<MatchSignals | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      isGuest: true,
      deletedAt: true,
      learnerProfile: true,
      communityMemberships: { select: { communityId: true } },
      courses: {
        select: {
          knowledgeMap: {
            select: { topics: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!user || user.isGuest || user.deletedAt) return null;

  const profile = user.learnerProfile;
  const courseTopics = user.courses.flatMap(
    (c) => c.knowledgeMap?.topics.map((t) => t.name) ?? []
  );

  return {
    userId: user.id,
    name: user.username ?? user.name,
    field: profile?.field ?? null,
    academicLevel: profile?.academicLevel ?? null,
    studyStyle: profile?.studyStyle ?? null,
    subjects: profile ? parseStoredList(profile.subjectsJson) : [],
    topicsOfInterest: profile ? parseStoredList(profile.topicsJson) : [],
    courseTopics,
    communityIds: user.communityMemberships.map((m) => m.communityId),
    buddyPrefs: normalizeBuddyPrefs(
      profile ? safeParse(profile.buddyPrefsJson) : {}
    ),
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Top matches for a user. Both sides must be discoverable — matching is
 * strictly opt-in in both directions.
 */
export async function findMatches(userId: string, limit = 10) {
  const me = await signalsFor(userId);
  if (!me) return { discoverable: false, matches: [] };
  if (!me.buddyPrefs.discoverable) {
    return { discoverable: false, matches: [] };
  }

  // Candidate pool: real accounts with a learner profile. Discoverability
  // lives inside buddyPrefsJson (SQLite has no JSON queries via Prisma), so
  // it's filtered after load — fine at beta scale, bounded by take.
  const candidates = await prisma.user.findMany({
    where: {
      id: { not: userId },
      isGuest: false,
      deletedAt: null,
      learnerProfile: { isNot: null },
    },
    select: { id: true },
    take: 500,
  });

  const signals: MatchSignals[] = [];
  for (const c of candidates) {
    const s = await signalsFor(c.id);
    if (s?.buddyPrefs.discoverable) signals.push(s);
  }

  return { discoverable: true, matches: rankMatches(me, signals, limit) };
}
