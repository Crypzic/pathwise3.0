// PATHWISE 2.0 Phase 14: curated video ranking + ops input validation.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VIDEOS,
  rankVideos,
  validateVideoInput,
  type VideoRecord,
} from "./videoModel.js";

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

test("topic overlap outranks subject affinity, which outranks nothing", () => {
  const me = {
    courseTopics: ["Mitosis", "Cell Membranes"],
    subjects: ["Biology"],
    topicsOfInterest: [],
  };
  const topicHit = video({ id: "t", subject: "Chemistry", topics: ["mitosis"] });
  const subjectHit = video({ id: "s", subject: "Biology", topics: ["Ecology"] });
  const miss = video({ id: "m", subject: "History", topics: ["Feudalism"] });

  const ranked = rankVideos(me, [miss, subjectHit, topicHit]);
  assert.deepEqual(ranked.map((r) => r.video.id), ["t", "s", "m"]);
  assert.match(ranked[0].reason ?? "", /Matches mitosis/i);
  assert.equal(ranked[1].reason, "You study Biology");
  assert.equal(ranked[2].reason, null);
  assert.equal(ranked[2].score, 0);
});

test("unmatched catalogs still come back (no empty shelf)", () => {
  const empty = { courseTopics: [], subjects: [], topicsOfInterest: [] };
  const ranked = rankVideos(empty, [video({ id: "a" }), video({ id: "b" })]);
  assert.equal(ranked.length, 2);
});

test("validateVideoInput enforces the required fields", () => {
  assert.equal(
    validateVideoInput({
      title: "A fine video",
      creator: "Someone",
      url: "https://youtube.com/watch?v=x",
      subject: "Physics",
    }),
    null
  );
  assert.match(validateVideoInput({ title: "ab" }) ?? "", /title/);
  assert.match(
    validateVideoInput({ title: "abc", creator: "xy", subject: "Physics", url: "notaurl" }) ?? "",
    /url/
  );
});

test("seed catalog is well-formed with unique urls", () => {
  const urls = new Set<string>();
  for (const s of DEFAULT_VIDEOS) {
    assert.equal(
      validateVideoInput(s),
      null,
      `seed invalid: ${s.title}`
    );
    assert.ok(!urls.has(s.url), `duplicate url ${s.url}`);
    urls.add(s.url);
    assert.ok(s.topics.length > 0, `${s.title} has no topics`);
  }
  assert.ok(DEFAULT_VIDEOS.length >= 8);
});
