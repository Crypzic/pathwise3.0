// PATHWISE 2.0 Phases 11/19: when may the facilitator speak? Both learners,
// both recent — the "intervene when both request help" rule.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bothWantHelp,
  HELP_WINDOW_MS,
  helpActive,
  helpFieldFor,
} from "./roomModel.js";

const now = new Date("2026-09-05T12:00:00Z");
const fresh = new Date(now.getTime() - 60_000);
const stale = new Date(now.getTime() - HELP_WINDOW_MS - 1);

test("facilitator needs BOTH requests, both fresh", () => {
  assert.equal(bothWantHelp(fresh, fresh, now), true);
  assert.equal(bothWantHelp(fresh, null, now), false);
  assert.equal(bothWantHelp(null, fresh, now), false);
  assert.equal(bothWantHelp(null, null, now), false);
  assert.equal(bothWantHelp(fresh, stale, now), false);
  assert.equal(bothWantHelp(stale, stale, now), false);
});

test("single-request freshness for the UI", () => {
  assert.equal(helpActive(fresh, now), true);
  assert.equal(helpActive(stale, now), false);
  assert.equal(helpActive(null, now), false);
});

test("participants map to their own help column, outsiders to none", () => {
  const room = { aId: "alice", bId: "bob" };
  assert.equal(helpFieldFor(room, "alice"), "helpAAt");
  assert.equal(helpFieldFor(room, "bob"), "helpBAt");
  assert.equal(helpFieldFor(room, "mallory"), null);
});
