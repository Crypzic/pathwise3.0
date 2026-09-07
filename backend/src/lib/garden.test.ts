// Step 11: companion growth stages and Leaf Match rewards.
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPANION_STAGES,
  LEAF_MATCH_PAIRS,
  leafMatchReward,
  stageFor,
} from "./gardenModel.js";

test("companion stages advance with growth", () => {
  assert.equal(stageFor(0).stage, 0);
  assert.equal(stageFor(119).stage, 0);
  assert.equal(stageFor(120).stage, 1);
  assert.equal(stageFor(999).stage, 3);
  assert.equal(
    stageFor(999_999).stage,
    COMPANION_STAGES[COMPANION_STAGES.length - 1].stage
  );
});

test("stage progress runs 0..1 and saturates at the final stage", () => {
  assert.equal(stageFor(120).progress, 0);
  const mid = stageFor(260); // halfway between 120 and 400
  assert.ok(mid.progress > 0.4 && mid.progress < 0.6);

  const top = stageFor(999_999);
  assert.equal(top.nextStageAt, null);
  assert.equal(top.progress, 1);
});

test("stage thresholds increase monotonically", () => {
  for (let i = 1; i < COMPANION_STAGES.length; i++) {
    assert.ok(COMPANION_STAGES[i].minGrowth > COMPANION_STAGES[i - 1].minGrowth);
  }
});

test("Leaf Match pays per pair, with a bonus only for a full clear", () => {
  const partial = leafMatchReward(3, false);
  const allPairsNotFlagged = leafMatchReward(LEAF_MATCH_PAIRS, false);
  const complete = leafMatchReward(LEAF_MATCH_PAIRS, true);

  assert.ok(partial > 0);
  assert.ok(allPairsNotFlagged > partial);
  assert.ok(complete > allPairsNotFlagged, "the completion bonus should apply");
});

test("Leaf Match rewards can't be inflated past a perfect game", () => {
  // The route validates its input too, but the scoring function must not be
  // the weak link if that ever changes.
  const perfect = leafMatchReward(LEAF_MATCH_PAIRS, true);
  assert.equal(leafMatchReward(9999, true), perfect);
  assert.equal(leafMatchReward(-5, false), 0);
});
