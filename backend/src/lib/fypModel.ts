// Personalized Educational FYP (PATHWISE 2.0 Phase 15) — pure ranking.
//
// The feed ranks the curated catalog against a learner's full context:
// mastery gaps first (this is a learning product, not an attention product),
// then their actual course topics, then taste learned from likes/saves,
// then declared interests. Already-watched videos are demoted, not hidden.
// All inputs are DERIVED signals — no file contents.
import { overlap } from "./matchModel.js";
import type { VideoRecord } from "./videoModel.js";

export interface FypSignals {
  /** Topic names across the learner's knowledge maps. */
  courseTopics: string[];
  /** Weak spots: low or unassessed mastery — the gaps worth closing. */
  weakTopics: string[];
  /** Self-declared subjects + topics + community interests. */
  subjects: string[];
  topicsOfInterest: string[];
  communityInterests: string[];
  /** Taste: topics/subjects of videos the learner liked or saved. */
  likedTopics: string[];
  likedSubjects: string[];
  /** Videos already viewed (demoted so the feed stays fresh). */
  watchedVideoIds: string[];
}

export interface FeedItem {
  video: VideoRecord;
  score: number;
  reason: string | null;
}

const fold = (s: string) => s.trim().toLowerCase();

export function rankFeed(me: FypSignals, videos: VideoRecord[]): FeedItem[] {
  const watched = new Set(me.watchedVideoIds);
  const mySubjects = new Set(me.subjects.map(fold));
  const likedSubjects = new Set(me.likedSubjects.map(fold));
  const declared = [...me.topicsOfInterest, ...me.communityInterests];

  return videos
    .map((video) => {
      const gapHits = overlap(video.topics, me.weakTopics);
      const courseHits = overlap(video.topics, me.courseTopics);
      const tasteHits = overlap(video.topics, me.likedTopics);
      const declaredHits = overlap(video.topics, declared);
      const subjectHit = mySubjects.has(fold(video.subject));
      const tasteSubjectHit = likedSubjects.has(fold(video.subject));

      let score =
        Math.min(1, gapHits.length) * 0.35 +
        Math.min(1, courseHits.length / 2) * 0.25 +
        (tasteHits.length > 0 || tasteSubjectHit ? 0.2 : 0) +
        Math.min(1, declaredHits.length) * 0.1 +
        (subjectHit ? 0.1 : 0);

      // Watched content resurfaces only when nothing fresh outranks it.
      if (watched.has(video.id)) score *= 0.4;

      let reason: string | null = null;
      if (gapHits.length > 0) {
        reason = `Targets a weak spot: ${gapHits[0]}`;
      } else if (courseHits.length > 0) {
        reason = `You're studying ${courseHits[0]}`;
      } else if (tasteHits.length > 0) {
        reason = `Because you liked videos about ${tasteHits[0]}`;
      } else if (tasteSubjectHit) {
        reason = `More ${video.subject}, which you've liked`;
      } else if (declaredHits.length > 0) {
        reason = `Matches your interest in ${declaredHits[0]}`;
      } else if (subjectHit) {
        reason = `You study ${video.subject}`;
      }

      return { video, score, reason };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * The learning bridge: given a video and the learner's topics, name the
 * course topic a follow-up quiz should target — prefer the weakest hit so
 * "watch → quiz → mastery moves" closes the loop where it matters most.
 */
export function quizTarget(
  video: VideoRecord,
  topics: Array<{
    topicId: string;
    courseId: string;
    name: string;
    mastery: number;
  }>
): { topicId: string; courseId: string; topicName: string } | null {
  const videoTopicSet = new Set(video.topics.map(fold));
  const hits = topics.filter((t) => videoTopicSet.has(fold(t.name)));
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.mastery - b.mastery);
  const weakest = hits[0];
  return {
    topicId: weakest.topicId,
    courseId: weakest.courseId,
    topicName: weakest.name,
  };
}
