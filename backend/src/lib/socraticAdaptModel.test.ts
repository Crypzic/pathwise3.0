// PATHWISE 2.0 Phase 7: when does the tutor escalate support? Stuck signals
// must be recognized without ever mistaking real reasoning for stuckness.
import test from "node:test";
import assert from "node:assert/strict";
import { isStuckMessage, stuckLevel } from "./socraticAdaptModel.js";
import type { ChatMessage } from "../ai/types.js";

const u = (content: string): ChatMessage => ({ role: "user", content });
const a = (content: string): ChatMessage => ({ role: "assistant", content });

test("classic stuck phrases are recognized", () => {
  for (const msg of [
    "idk",
    "I don't know",
    "i dont get it",
    "no idea",
    "not sure",
    "help",
    "I'm stuck".replace("I'm ", ""), // "stuck"
    "???",
    "huh?",
    "i give up",
    "",
  ]) {
    assert.equal(isStuckMessage(msg), true, `expected stuck: "${msg}"`);
  }
});

test("real reasoning is never treated as stuck", () => {
  for (const msg of [
    "I think it's related to osmosis because water moves",
    "Maybe the answer is B since the slope is negative?",
    "I don't know if this is right, but my reasoning is that the membrane blocks large molecules so transport must be active", // long = reasoning
    "the mitochondria makes ATP",
  ]) {
    assert.equal(isStuckMessage(msg), false, `expected not stuck: "${msg}"`);
  }
});

test("escalation climbs with consecutive stuck turns and caps at 2", () => {
  assert.equal(stuckLevel([u("What is osmosis about?")]), 0);
  assert.equal(stuckLevel([a("q?"), u("idk")]), 1);
  assert.equal(stuckLevel([u("idk"), a("hint?"), u("no idea")]), 2);
  assert.equal(
    stuckLevel([u("idk"), a("h?"), u("???"), a("h2?"), u("i give up")]),
    2
  );
});

test("a reasoned turn resets the stuck streak", () => {
  const history = [
    u("idk"),
    a("What part is fuzzy?"),
    u("I think it has to do with concentration gradients"),
    a("Good — which direction?"),
    u("not sure"),
  ];
  assert.equal(stuckLevel(history), 1);
});
