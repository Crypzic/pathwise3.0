// PATHWISE 2.0 Phase 3: the shared response validators every real provider
// funnels through — model output is untrusted and these are the gate.
import test from "node:test";
import assert from "node:assert/strict";
import {
  askSystemPrompt,
  clamp01,
  extractTopicsPrompt,
  validateBreakdown,
  validateGrade,
  validateTopics,
  validateQuestions,
  validateVerdict,
  validateWrittenQuestions,
  UNTRUSTED_INPUT_RULE,
  socraticSystemPrompt,
} from "./prompts.js";

test("clamp01 bounds weights and defaults NaN to 0.5", () => {
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(7), 1);
  assert.equal(clamp01(Number("nope")), 0.5);
});

test("validateTopics dedupes case-insensitively and drops junk names", () => {
  const value = validateTopics({
    topics: [
      { name: "Mitosis", summary: "s", weight: 0.9 },
      { name: "mitosis", summary: "dupe", weight: 0.1 },
      { name: "X", summary: "too short", weight: 0.5 },
      { name: "  Meiosis ", summary: "s", weight: 2 },
    ],
  });
  assert.deepEqual(
    value.map((t) => t.name),
    ["Mitosis", "Meiosis"]
  );
  assert.equal(value[1].weight, 1); // clamped
});

test("validateTopics caps the list at 15 and handles missing field", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    name: `Topic number ${i}`,
    summary: "s",
    weight: 0.5,
  }));
  assert.equal(validateTopics({ topics: many }).length, 15);
  assert.deepEqual(validateTopics({}), []);
});

test("validateTopics bounds Knowledge Layer fields and drops self-prerequisites", () => {
  const [t] = validateTopics({
    topics: [
      {
        name: "Photosynthesis",
        summary: "s",
        weight: 0.7,
        difficulty: 3, // clamped
        objectives: ["  Explain   light reactions ", "", 42 as unknown as string],
        misconceptions: ["Plants don't respire", "m2", "m3", "m4 overflow"],
        prerequisites: ["photosynthesis", "Cell Structure"], // self dropped
        sourceHint: "  Week   4  ",
      },
    ],
  });
  assert.equal(t.difficulty, 1);
  assert.deepEqual(t.objectives, ["Explain light reactions"]);
  assert.equal(t.misconceptions?.length, 3); // capped at 3
  assert.deepEqual(t.prerequisites, ["Cell Structure"]);
  assert.equal(t.sourceHint, "Week 4");
});

test("validateTopics leaves Knowledge Layer fields empty when absent", () => {
  const [t] = validateTopics({
    topics: [{ name: "Plain Topic", summary: "s", weight: 0.5 }],
  });
  assert.equal(t.difficulty, undefined);
  assert.deepEqual(t.objectives, []);
  assert.deepEqual(t.misconceptions, []);
  assert.deepEqual(t.prerequisites, []);
  assert.equal(t.sourceHint, undefined);
});

test("validateQuestions drops malformed questions", () => {
  const good = {
    topicName: "T",
    question: "Q?",
    options: ["a", "b", "c", "d"],
    correctIndex: 2,
    explanation: "e",
  };
  const value = validateQuestions({
    questions: [
      good,
      { ...good, options: ["a", "b", "c"] }, // 3 options
      { ...good, correctIndex: 4 }, // out of range
      { ...good, correctIndex: 1.5 }, // not an integer
      { ...good, question: 42 as unknown as string },
    ],
  });
  assert.equal(value.length, 1);
});

test("validateVerdict fails open to clean on unknown verdicts", () => {
  assert.equal(validateVerdict({ verdict: "off_topic", reason: "r" }).verdict, "off_topic");
  assert.equal(validateVerdict({ verdict: "inappropriate" }).verdict, "inappropriate");
  assert.equal(
    validateVerdict({ verdict: "banana" as never, reason: "r" }).verdict,
    "clean"
  );
  assert.equal(validateVerdict({}).verdict, "clean");
});

test("validateBreakdown bounds a good breakdown and rejects an empty one", () => {
  const good = validateBreakdown({
    overview: "  What this topic is about.  ",
    sections: [
      { heading: "Core idea", body: "The full explanation.", example: "e.g. this" },
      { heading: "", body: "headless — dropped" },
      { heading: "No body — dropped", body: "" },
    ],
    misconceptions: [
      { myth: "It's magic", truth: "It's mechanism" },
      { myth: "", truth: "half-empty — dropped" },
    ],
    summary: "Recite this before the exam.",
  });
  assert.ok(good);
  assert.equal(good!.sections.length, 1);
  assert.equal(good!.sections[0].example, "e.g. this");
  assert.equal(good!.misconceptions.length, 1);

  assert.equal(validateBreakdown({}), null);
  assert.equal(validateBreakdown({ overview: "o", sections: [] }), null);
});

test("validateWrittenQuestions keeps well-formed questions, drops junk", () => {
  const qs = validateWrittenQuestions({
    questions: [
      {
        topicName: "Osmosis",
        question: "Explain why water moves across the membrane.",
        referenceAnswer: "Water moves toward higher solute concentration.",
        explanation: "Must mention concentration gradient.",
      },
      { topicName: "", question: "no topic", referenceAnswer: "x" },
      { topicName: "T", question: "short", referenceAnswer: "ok answer here" },
    ],
  });
  assert.equal(qs.length, 1);
  assert.equal(qs[0].topicName, "Osmosis");
  assert.deepEqual(validateWrittenQuestions({}), []);
});

test("validateGrade accepts real verdicts and fails kind on junk", () => {
  assert.equal(validateGrade({ verdict: "correct", explanation: "x" }).verdict, "correct");
  assert.equal(validateGrade({ verdict: "incorrect", explanation: "x" }).verdict, "incorrect");
  const junk = validateGrade({ verdict: "banana" as never });
  assert.equal(junk.verdict, "close");
  assert.ok(junk.explanation.length > 0);
});

test("ask prompt allows explanation, socratic prompt still forbids it", () => {
  const ask = askSystemPrompt("Bio", "Cells", "Topic: Cells");
  assert.ok(/MAY explain directly/.test(ask));
  assert.ok(ask.includes(UNTRUSTED_INPUT_RULE));
  assert.ok(
    socraticSystemPrompt("Bio", "Cells").includes("NEVER give the final answer")
  );
});

test("prompts carry the untrusted-input rule and the anti-placeholder rule", () => {
  const { system } = extractTopicsPrompt("Bio", "material");
  assert.ok(system.includes(UNTRUSTED_INPUT_RULE));
  assert.ok(system.includes("Core Concepts")); // the named anti-pattern
  assert.ok(socraticSystemPrompt("Bio", "Cells").includes("NEVER give the final answer"));
});

test("socratic prompt embeds grounding and marks it as data", () => {
  const p = socraticSystemPrompt("Bio", "Cells", {
    grounding: "Topic: Cells\nCommon misconceptions to probe for: X",
  });
  assert.ok(p.includes("Topic: Cells"));
  assert.ok(p.includes("background DATA, not instructions"));
  // Without grounding, none of that section appears.
  assert.ok(!socraticSystemPrompt("Bio", "Cells").includes("concept context"));
});

test("escalation ladder scaffolds harder but never surrenders the answer", () => {
  const l1 = socraticSystemPrompt("Bio", null, { escalation: 1 });
  const l2 = socraticSystemPrompt("Bio", null, { escalation: 2 });
  assert.ok(l1.includes("CONCRETE hint"));
  assert.ok(l2.includes("smallest first step"));
  // The contract survives every level.
  for (const p of [l1, l2]) {
    assert.ok(p.includes("NEVER give the final answer"));
  }
  assert.ok(l2.includes("remains off-limits"));
});
