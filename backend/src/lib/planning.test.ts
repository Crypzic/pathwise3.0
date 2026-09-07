// Steps 5 and 6: quiz topic allocation, the Course Confidence Score, quest
// selection and the confidence-drop banner.
import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateQuestions,
  buildQuests,
  computeConfidence,
  confidenceAlert,
  tierFor,
  topicPriority,
} from "./planning.js";
import type { TopicWithMastery } from "./masteryModel.js";

const NOW = new Date("2026-06-01T10:00:00Z");
const FUTURE = new Date("2026-06-10T10:00:00Z");
const PAST = new Date("2026-05-20T10:00:00Z");

function topic(over: Partial<TopicWithMastery> = {}): TopicWithMastery {
  return {
    id: "t1",
    name: "Topic",
    summary: null,
    weight: 0.5,
    mastery: 0.5,
    guessSignal: 0,
    attemptCount: 3,
    correctCount: 2,
    socraticTurnCount: 0,
    lastReviewedAt: PAST,
    dueAt: FUTURE,
    due: false,
    ...over,
  };
}

// --- Topic priority --------------------------------------------------------

test("a weaker topic outranks a stronger one at equal emphasis", () => {
  const weak = topic({ id: "weak", mastery: 0.2 });
  const strong = topic({ id: "strong", mastery: 0.9 });
  assert.ok(topicPriority(weak, NOW) > topicPriority(strong, NOW));
});

test("a heavily-emphasised topic outranks a footnote at equal mastery", () => {
  const core = topic({ id: "core", weight: 1 });
  const footnote = topic({ id: "foot", weight: 0.15 });
  assert.ok(topicPriority(core, NOW) > topicPriority(footnote, NOW));
});

test("an overdue topic is prioritised over one not yet due", () => {
  const overdue = topic({ id: "overdue", dueAt: PAST });
  const scheduled = topic({ id: "later", dueAt: FUTURE });
  assert.ok(topicPriority(overdue, NOW) > topicPriority(scheduled, NOW));
});

test("a topic with a high guessing signal is re-tested despite good mastery", () => {
  const shaky = topic({ id: "shaky", mastery: 0.85, guessSignal: 0.9 });
  const solid = topic({ id: "solid", mastery: 0.85, guessSignal: 0 });
  assert.ok(topicPriority(shaky, NOW) > topicPriority(solid, NOW));
});

// --- Question allocation ---------------------------------------------------

test("allocation always lands on exactly the requested question count", () => {
  const topics = Array.from({ length: 9 }, (_, i) =>
    topic({ id: `t${i}`, name: `T${i}`, weight: 0.2 + i * 0.08, mastery: i / 10 })
  );

  for (const count of [1, 2, 3, 5, 8, 12, 20]) {
    const alloc = allocateQuestions(topics, count, NOW);
    const sum = alloc.reduce((s, a) => s + a.questions, 0);
    assert.equal(sum, count, `expected ${count} questions, allocated ${sum}`);
    assert.ok(
      alloc.every((a) => a.questions >= 1),
      "no selected topic should get zero questions"
    );
  }
});

test("allocation never selects more topics than there are questions", () => {
  const topics = Array.from({ length: 8 }, (_, i) => topic({ id: `t${i}` }));
  const alloc = allocateQuestions(topics, 2, NOW);
  assert.ok(alloc.length <= 2);
});

test("allocation caps how many topics one quiz covers", () => {
  const topics = Array.from({ length: 15 }, (_, i) => topic({ id: `t${i}` }));
  const alloc = allocateQuestions(topics, 12, NOW);
  assert.ok(alloc.length <= 5, "a 12-question quiz shouldn't span 15 topics");
});

test("allocation gives the highest-priority topic the most questions", () => {
  const topics = [
    topic({ id: "weak", weight: 1, mastery: 0.05, dueAt: PAST }),
    topic({ id: "known", weight: 0.3, mastery: 0.95, dueAt: FUTURE }),
  ];
  const alloc = allocateQuestions(topics, 8, NOW);
  const weak = alloc.find((a) => a.topic.id === "weak");
  const known = alloc.find((a) => a.topic.id === "known");
  assert.ok(weak && known);
  assert.ok(weak.questions > known.questions);
});

test("allocation handles no topics and a zero count", () => {
  assert.deepEqual(allocateQuestions([], 8, NOW), []);
  assert.deepEqual(allocateQuestions([topic()], 0, NOW), []);
});

// --- Confidence ------------------------------------------------------------

test("an untouched course has zero confidence", () => {
  const c = computeConfidence({ topics: [], recentAccuracy: null, avgGuessSignal: 0 });
  assert.equal(c.score, 0);
  assert.equal(c.tier, "Building");
});

test("confidence rises with mastery", () => {
  const mk = (mastery: number) =>
    computeConfidence({
      topics: [
        topic({ id: "a", mastery, attemptCount: 4 }),
        topic({ id: "b", mastery, attemptCount: 4 }),
      ],
      recentAccuracy: 0.8,
      avgGuessSignal: 0.1,
    }).score;

  assert.ok(mk(0.9) > mk(0.5));
  assert.ok(mk(0.5) > mk(0.1));
});

test("a high guessing signal drags confidence down", () => {
  const topics = [topic({ id: "a", mastery: 0.8, attemptCount: 5 })];
  const honest = computeConfidence({ topics, recentAccuracy: 0.9, avgGuessSignal: 0 });
  const lucky = computeConfidence({ topics, recentAccuracy: 0.9, avgGuessSignal: 0.9 });
  assert.ok(honest.score > lucky.score, "guessed accuracy shouldn't read as confidence");
});

test("mastering one topic out of ten doesn't read as exam ready", () => {
  const topics = [
    topic({ id: "known", mastery: 1, weight: 1, attemptCount: 10, socraticTurnCount: 5 }),
    ...Array.from({ length: 9 }, (_, i) =>
      topic({ id: `unknown${i}`, mastery: 0, weight: 0.8, attemptCount: 0 })
    ),
  ];
  const c = computeConfidence({ topics, recentAccuracy: 1, avgGuessSignal: 0 });
  assert.notEqual(c.tier, "Exam ready");
  assert.ok(c.score < 50, `coverage penalty should apply, got ${c.score}`);
});

test("a fully-learned, fully-covered course reaches the top tier", () => {
  const topics = Array.from({ length: 6 }, (_, i) =>
    topic({
      id: `t${i}`,
      mastery: 0.95,
      weight: 0.8,
      attemptCount: 8,
      socraticTurnCount: 4,
    })
  );
  const c = computeConfidence({ topics, recentAccuracy: 0.95, avgGuessSignal: 0.05 });
  assert.equal(c.tier, "Exam ready");
});

test("confidence stays within 0..100 and reports its components", () => {
  const topics = [topic({ mastery: 1, attemptCount: 5, socraticTurnCount: 9 })];
  const c = computeConfidence({ topics, recentAccuracy: 1, avgGuessSignal: 0 });
  assert.ok(c.score >= 0 && c.score <= 100);
  assert.ok(c.components.mastery >= 0 && c.components.mastery <= 100);
  assert.ok(c.components.consistency >= 0 && c.components.consistency <= 100);
  assert.ok(c.components.depth >= 0 && c.components.depth <= 100);
});

test("tier boundaries are where they claim to be", () => {
  assert.equal(tierFor(0), "Building");
  assert.equal(tierFor(34), "Building");
  assert.equal(tierFor(35), "Finding your feet");
  assert.equal(tierFor(59), "Finding your feet");
  assert.equal(tierFor(60), "Solid");
  assert.equal(tierFor(79), "Solid");
  assert.equal(tierFor(80), "Exam ready");
  assert.equal(tierFor(100), "Exam ready");
});

// --- Quests ----------------------------------------------------------------

test("a course with no topics asks the student to upload material", () => {
  const quests = buildQuests([], NOW);
  assert.equal(quests.length, 1);
  assert.equal(quests[0].kind, "upload");
});

test("due topics become review quests, ahead of everything else", () => {
  const topics = [
    topic({ id: "due", name: "Due Topic", weight: 0.9, dueAt: PAST, attemptCount: 3 }),
    topic({ id: "weak", name: "Weak Topic", mastery: 0.1, dueAt: FUTURE, attemptCount: 2 }),
  ];
  const quests = buildQuests(topics, NOW);
  assert.equal(quests[0].kind, "review");
  assert.equal(quests[0].topicId, "due");
});

test("the weakest topic becomes a quiz quest", () => {
  const topics = [
    topic({ id: "strong", mastery: 0.95, dueAt: FUTURE }),
    topic({ id: "weak", name: "Weak", mastery: 0.1, dueAt: FUTURE }),
  ];
  const quests = buildQuests(topics, NOW);
  const quiz = quests.find((q) => q.kind === "quiz");
  assert.ok(quiz);
  assert.equal(quiz.topicId, "weak");
});

test("a shaky topic becomes a Socratic quest", () => {
  const topics = [
    topic({
      id: "shaky",
      name: "Shaky",
      mastery: 0.75,
      guessSignal: 0.85,
      attemptCount: 6,
      dueAt: FUTURE,
    }),
  ];
  const quests = buildQuests(topics, NOW);
  const socratic = quests.find((q) => q.kind === "socratic");
  assert.ok(socratic, "a high guessing signal should suggest talking it through");
  assert.equal(socratic.topicId, "shaky");
});

test("the plan never returns more than four quests and never none", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    topic({ id: `t${i}`, name: `T${i}`, mastery: 0.1, dueAt: PAST, attemptCount: 3 })
  );
  assert.ok(buildQuests(many, NOW).length <= 4);

  // A fully-mastered course still gets something to do.
  const mastered = Array.from({ length: 4 }, (_, i) =>
    topic({
      id: `m${i}`,
      mastery: 1,
      dueAt: FUTURE,
      attemptCount: 9,
      socraticTurnCount: 3,
      weight: 0.4,
    })
  );
  assert.ok(buildQuests(mastered, NOW).length >= 1);
});

test("quest ids are unique so React keys don't collide", () => {
  const topics = Array.from({ length: 6 }, (_, i) =>
    topic({ id: `t${i}`, name: `T${i}`, mastery: i / 10, dueAt: PAST, attemptCount: 3 })
  );
  const ids = buildQuests(topics, NOW).map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
});

// --- Confidence-drop banner ------------------------------------------------

test("the banner fires on a slipping topic and names it", () => {
  const topics = [
    topic({
      id: "slip",
      name: "Cellular Respiration",
      mastery: 0.3,
      weight: 0.9,
      attemptCount: 4,
      dueAt: PAST,
    }),
  ];
  const alert = confidenceAlert(topics, NOW);
  assert.ok(alert);
  assert.equal(alert.topicId, "slip");
  assert.match(alert.message, /Cellular Respiration/);
});

test("the banner stays quiet for a healthy course", () => {
  const topics = [
    topic({ id: "ok", mastery: 0.85, attemptCount: 5, dueAt: FUTURE, guessSignal: 0.1 }),
  ];
  assert.equal(confidenceAlert(topics, NOW), null);
});

test("the banner doesn't fire on a topic the student has never studied", () => {
  // Never-attempted topics belong in a quest, not a "you're slipping" warning.
  const topics = [topic({ id: "new", mastery: 0, attemptCount: 0, dueAt: null })];
  assert.equal(confidenceAlert(topics, NOW), null);
});

test("the banner picks the most heavily-emphasised slipping topic", () => {
  const topics = [
    topic({ id: "minor", name: "Minor", mastery: 0.2, weight: 0.3, attemptCount: 3, dueAt: PAST }),
    topic({ id: "major", name: "Major", mastery: 0.2, weight: 0.95, attemptCount: 3, dueAt: PAST }),
  ];
  const alert = confidenceAlert(topics, NOW);
  assert.equal(alert?.topicId, "major");
});
