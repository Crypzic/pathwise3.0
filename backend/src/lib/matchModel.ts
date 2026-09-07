// Study Buddy Matching (PATHWISE 2.0 Phase 10) — pure scoring.
//
// Matches are computed from DERIVED signals only: the learner profile people
// filled in themselves, topic NAMES from their knowledge maps, and community
// membership. Never file contents, never course materials — the roadmap's
// privacy rule ("match on derived topic metadata without granting access to
// source documents") is enforced by what this module is allowed to see.
import type { BuddyPrefs } from "./onboardingModel.js";

export interface MatchSignals {
  userId: string;
  name: string;
  field: string | null;
  academicLevel: string | null;
  studyStyle: string | null;
  subjects: string[];
  topicsOfInterest: string[];
  /** Topic names derived from the user's knowledge maps — names only. */
  courseTopics: string[];
  communityIds: string[];
  buddyPrefs: BuddyPrefs;
}

export interface MatchResult {
  score: number; // 0..1
  reasons: string[];
  sharedTopics: string[];
  sharedSubjects: string[];
}

const fold = (s: string) => s.trim().toLowerCase();

/** Case-insensitive intersection, keeping the first side's spelling. */
export function overlap(a: string[], b: string[]): string[] {
  const bSet = new Set(b.map(fold));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of a) {
    const key = fold(item);
    if (bSet.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(item.trim());
    }
  }
  return out;
}

/** Overlap size scaled against the smaller list, 0..1. */
function overlapRatio(a: string[], b: string[]): number {
  const smaller = Math.min(a.length, b.length);
  if (smaller === 0) return 0;
  return overlap(a, b).length / smaller;
}

/**
 * Score how well two learners fit as study buddies. Symmetric except for
 * `a`'s own similar-level preference (each side sees their own ranking).
 */
export function scoreMatch(a: MatchSignals, b: MatchSignals): MatchResult {
  const reasons: string[] = [];

  // Shared study material is the strongest signal there is: two people whose
  // knowledge maps overlap are literally studying the same thing.
  const allTopicsA = [...a.courseTopics, ...a.topicsOfInterest];
  const allTopicsB = [...b.courseTopics, ...b.topicsOfInterest];
  const sharedTopics = overlap(allTopicsA, allTopicsB).slice(0, 6);
  const topicScore = overlapRatio(allTopicsA, allTopicsB);
  if (sharedTopics.length > 0) {
    reasons.push(
      sharedTopics.length === 1
        ? `You're both studying ${sharedTopics[0]}`
        : `You're both studying ${sharedTopics[0]} and ${sharedTopics.length - 1} more topic${sharedTopics.length > 2 ? "s" : ""}`
    );
  }

  const sharedSubjects = overlap(a.subjects, b.subjects);
  let subjectScore = overlapRatio(a.subjects, b.subjects);
  if (
    sharedSubjects.length === 0 &&
    a.field &&
    b.field &&
    fold(a.field) === fold(b.field)
  ) {
    subjectScore = 0.5; // same declared field still counts for something
    reasons.push(`Same field: ${a.field}`);
  } else if (sharedSubjects.length > 0) {
    reasons.push(`Shared subject${sharedSubjects.length > 1 ? "s" : ""}: ${sharedSubjects.slice(0, 3).join(", ")}`);
  }

  let levelScore = 0;
  if (a.academicLevel && b.academicLevel) {
    if (a.academicLevel === b.academicLevel) {
      levelScore = 1;
      reasons.push("Same academic level");
    } else if (a.buddyPrefs.similarLevel) {
      levelScore = -0.5; // they asked for similar level; this isn't it
    }
  }

  let styleScore = 0;
  if (a.studyStyle && b.studyStyle) {
    if (
      a.studyStyle === b.studyStyle ||
      a.studyStyle === "mixed" ||
      b.studyStyle === "mixed"
    ) {
      styleScore = 1;
      if (a.studyStyle === b.studyStyle && a.studyStyle !== "mixed") {
        reasons.push("Matching study style");
      }
    }
  }

  let availabilityScore = 0;
  if (
    a.buddyPrefs.availability &&
    a.buddyPrefs.availability === b.buddyPrefs.availability
  ) {
    availabilityScore = 1;
    reasons.push(`Both free ${a.buddyPrefs.availability}`);
  }

  const communityScore = overlapRatio(a.communityIds, b.communityIds);
  if (communityScore > 0) {
    reasons.push("You share a community");
  }

  const raw =
    0.35 * topicScore +
    0.2 * subjectScore +
    0.1 * levelScore +
    0.1 * styleScore +
    0.1 * availabilityScore +
    0.15 * communityScore;

  return {
    score: Math.max(0, Math.min(1, raw)),
    reasons,
    sharedTopics,
    sharedSubjects,
  };
}

/**
 * Rank candidates for one learner. Only candidates with a positive score
 * appear — an empty result is honest, not a bug.
 */
export function rankMatches(
  me: MatchSignals,
  candidates: MatchSignals[],
  limit = 10
): Array<{ candidate: MatchSignals; match: MatchResult }> {
  return candidates
    .filter((c) => c.userId !== me.userId)
    .map((candidate) => ({ candidate, match: scoreMatch(me, candidate) }))
    .filter((r) => r.match.score > 0)
    .sort((x, y) => y.match.score - x.match.score)
    .slice(0, limit);
}
