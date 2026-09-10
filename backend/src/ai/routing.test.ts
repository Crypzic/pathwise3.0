// Per-task AI routing: every operation maps to exactly one group, and the
// groups carve the operation space the way the env docs promise.
import test from "node:test";
import assert from "node:assert/strict";
import { routeGroupFor, type AIOperationName } from "./routing.js";

test("every operation maps to its documented group", () => {
  const expectations: Record<AIOperationName, string> = {
    socratic_reply: "tutor",
    ask_reply: "tutor",
    explain_topic: "tutor",
    generate_quiz: "quiz",
    written_questions: "quiz",
    grade_written: "quiz",
    moderate: "moderation",
    community_check: "moderation",
    extract_topics: "extract",
    transcribe_image: "extract",
    video_query: "extract",
  };
  for (const [op, group] of Object.entries(expectations)) {
    assert.equal(
      routeGroupFor(op as AIOperationName),
      group,
      `${op} should route to ${group}`
    );
  }
});
