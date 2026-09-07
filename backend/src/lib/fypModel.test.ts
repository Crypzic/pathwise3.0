// PATHWISE 2.0 Phase 15: FYP ranking — gaps first, taste second, watched
// demoted — and the watch → quiz bridge targeting the weakest topic.
import test from "node:test";
import assert from "node:assert/strict";
import { quizTarget, rankFeed, type FypSignals } from "./fypModel.js";
import type { VideoRecord } from "./videoModel.js";

function video(partial: Partial<VideoRecord> & { id: string }): VideoRecord {
  return {
    title: partial.id,
    creator: "c",
    url: "https://example.com/v",
    thumbnailUrl: null,
    subject: "Biology",
    topics: [],
    difficulty: null,
    durationSec: null,
    ...partial,
  };
}

function signals(partial: Partial<FypSignals> = {}): FypSignals {
  return {
    courseTopics: [],
    weakTopics: [],
    subjects: [],
    topicsOfInterest: [],
    communityInterests: [],
    likedTopics: [],
    likedSubjects: [],
    watchedVideoIds: [],
    ...partial,
  };
}

test("mastery gaps outrank everything else", () => {
  const me = signals({
    courseTopics: ["Mitosis", "Photosynthesis"],
    weakTopics: ["Photosynthesis"],
    subjects: ["Biology"],
  });
  const gap = video({ id: "gap", topics: ["Photosynthesis"], subject: "History" });
  const strongTopic = video({ id: "known", topics: ["Mitosis"], subject: "Biology" });

  const ranked = rankFeed(me, [strongTopic, gap]);
  assert.equal(ranked[0].video.id, "gap");
  assert.match(ranked[0].reason ?? "", /weak spot: Photosynthesis/);
});

test("taste from likes lifts similar content with a because-you-liked reason", () => {
  const me = signals({ likedTopics: ["Neural Networks"] });
  const similar = video({ id: "s", topics: ["Neural Networks"], subject: "CS" });
  const other = video({ id: "o", topics: ["Feudalism"], subject: "History" });
  const ranked = rankFeed(me, [other, similar]);
  assert.equal(ranked[0].video.id, "s");
  assert.match(ranked[0].reason ?? "", /Because you liked/);
});

test("watched videos are demoted but not hidden", () => {
  const me = signals({ courseTopics: ["Vectors"], watchedVideoIds: ["a"] });
  const watched = video({ id: "a", topics: ["Vectors"] });
  const fresh = video({ id: "b", topics: ["Vectors"] });
  const ranked = rankFeed(me, [watched, fresh]);
  assert.equal(ranked[0].video.id, "b");
  assert.equal(ranked.length, 2);
  assert.ok(ranked[1].score < ranked[0].score);
});

test("quizTarget picks the weakest matching topic", () => {
  const v = video({ id: "v", topics: ["Mitosis", "Meiosis"] });
  const target = quizTarget(v, [
    { topicId: "t1", courseId: "c1", name: "mitosis", mastery: 0.8 },
    { topicId: "t2", courseId: "c1", name: "Meiosis", mastery: 0.2 },
    { topicId: "t3", courseId: "c2", name: "Feudalism", mastery: 0.0 },
  ]);
  assert.deepEqual(target, { topicId: "t2", courseId: "c1", topicName: "Meiosis" });
});

test("quizTarget returns null when nothing matches", () => {
  const v = video({ id: "v", topics: ["Entropy"] });
  assert.equal(
    quizTarget(v, [{ topicId: "t", courseId: "c", name: "Mitosis", mastery: 0 }]),
    null
  );
});
