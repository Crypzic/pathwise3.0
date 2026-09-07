// PATHWISE 2.0 Phase 12: DM rules — canonical pair keys and who may send.
import test from "node:test";
import assert from "node:assert/strict";
import { canSend, pairKey } from "./dmModel.js";

test("pairKey is order-independent and canonical", () => {
  assert.deepEqual(pairKey("alice", "bob"), ["alice", "bob"]);
  assert.deepEqual(pairKey("bob", "alice"), ["alice", "bob"]);
  assert.deepEqual(pairKey("x", "x2"), ["x", "x2"]);
});

test("active conversations accept messages from either side", () => {
  const c = { status: "active", requesterId: "a" };
  assert.equal(canSend(c, "a").ok, true);
  assert.equal(canSend(c, "b").ok, true);
});

test("pending requests accept only the requester's messages", () => {
  const c = { status: "pending", requesterId: "a" };
  assert.equal(canSend(c, "a").ok, true);
  const denied = canSend(c, "b");
  assert.equal(denied.ok, false);
  assert.match(denied.reason ?? "", /accept/i);
});

test("declined conversations accept nothing", () => {
  const c = { status: "declined", requesterId: "a" };
  assert.equal(canSend(c, "a").ok, false);
  assert.equal(canSend(c, "b").ok, false);
});
