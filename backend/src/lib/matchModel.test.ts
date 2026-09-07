// PATHWISE 2.0 Phase 10: study-buddy scoring — overlap math, preference
// handling, and the privacy-shaped input (derived signals only).
import test from "node:test";
import assert from "node:assert/strict";
import {
  overlap,
  rankMatches,
  scoreMatch,
  type MatchSignals,
} from "./matchModel.js";

function signals(partial: Partial<MatchSignals> & { userId: string }): MatchSignals {
  return {
    name: partial.userId,
    field: null,
    academicLevel: null,
    studyStyle: null,
    subjects: [],
    topicsOfInterest: [],
    courseTopics: [],
    communityIds: [],
    buddyPrefs: {
      similarLevel: false,
      sameSubjects: false,
      availability: null,
      discoverable: true,
    },
    ...partial,
  };
}

test("overlap is case-insensitive and keeps first spelling", () => {
  assert.deepEqual(
    overlap(["Cell Biology", "genetics"], ["cell biology", "Physics"]),
    ["Cell Biology"]
  );
  assert.deepEqual(overlap([], ["a"]), []);
});

test("shared course topics dominate the score", () => {
  const a = signals({
    userId: "a",
    courseTopics: ["Mitosis", "Meiosis", "DNA Replication"],
  });
  const b = signals({
    userId: "b",
    courseTopics: ["mitosis", "meiosis", "dna replication"],
  });
  const c = signals({ userId: "c", courseTopics: ["Contract Law"] });

  const ab = scoreMatch(a, b);
  const ac = scoreMatch(a, c);
  assert.ok(ab.score > ac.score);
  assert.ok(ab.score >= 0.35 - 1e-9);
  assert.equal(ac.score, 0);
  assert.deepEqual(ab.sharedTopics, ["Mitosis", "Meiosis", "DNA Replication"]);
  assert.ok(ab.reasons.some((r) => r.includes("Mitosis")));
});

test("same level helps; a violated similar-level preference hurts", () => {
  const base = { courseTopics: ["Algebra"] };
  const me = signals({
    userId: "me",
    ...base,
    academicLevel: "undergraduate",
    buddyPrefs: {
      similarLevel: true,
      sameSubjects: false,
      availability: null,
      discoverable: true,
    },
  });
  const peer = signals({ userId: "p", ...base, academicLevel: "undergraduate" });
  const mismatch = signals({ userId: "m", ...base, academicLevel: "high_school" });

  assert.ok(scoreMatch(me, peer).score > scoreMatch(me, mismatch).score);
  assert.ok(scoreMatch(me, peer).reasons.includes("Same academic level"));
});

test("availability and communities contribute with readable reasons", () => {
  const a = signals({
    userId: "a",
    courseTopics: ["X"],
    communityIds: ["c1", "c2"],
    buddyPrefs: {
      similarLevel: false,
      sameSubjects: false,
      availability: "evenings",
      discoverable: true,
    },
  });
  const b = signals({
    userId: "b",
    courseTopics: ["X"],
    communityIds: ["c2"],
    buddyPrefs: {
      similarLevel: false,
      sameSubjects: false,
      availability: "evenings",
      discoverable: true,
    },
  });
  const r = scoreMatch(a, b);
  assert.ok(r.reasons.includes("Both free evenings"));
  assert.ok(r.reasons.includes("You share a community"));
});

test("score stays within 0..1 and empty profiles score 0", () => {
  const empty = scoreMatch(signals({ userId: "a" }), signals({ userId: "b" }));
  assert.equal(empty.score, 0);

  const max = scoreMatch(
    signals({
      userId: "a",
      field: "Biology",
      academicLevel: "graduate",
      studyStyle: "group",
      subjects: ["Biology"],
      courseTopics: ["T1", "T2"],
      communityIds: ["c1"],
      buddyPrefs: {
        similarLevel: true,
        sameSubjects: true,
        availability: "mornings",
        discoverable: true,
      },
    }),
    signals({
      userId: "b",
      field: "Biology",
      academicLevel: "graduate",
      studyStyle: "group",
      subjects: ["Biology"],
      courseTopics: ["t1", "t2"],
      communityIds: ["c1"],
      buddyPrefs: {
        similarLevel: true,
        sameSubjects: true,
        availability: "mornings",
        discoverable: true,
      },
    })
  );
  assert.ok(max.score > 0.9);
  assert.ok(max.score <= 1);
});

test("rankMatches excludes self and zero-score candidates, sorts desc", () => {
  const me = signals({ userId: "me", courseTopics: ["Thermodynamics", "Entropy"] });
  const strong = signals({ userId: "s", courseTopics: ["Thermodynamics", "Entropy"] });
  const weak = signals({ userId: "w", courseTopics: ["Entropy", "Poetry"] });
  const none = signals({ userId: "n", courseTopics: ["Poetry"] });

  const ranked = rankMatches(me, [none, weak, me, strong]);
  assert.deepEqual(
    ranked.map((r) => r.candidate.userId),
    ["s", "w"]
  );
});
