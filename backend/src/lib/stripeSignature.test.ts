// Step 13: the webhook verifier must reject anything it didn't sign.
import test from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifyStripeSignature } from "./stripeSignature.js";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ type: "checkout.session.completed", data: {} });
const NOW_MS = Date.parse("2026-06-01T12:00:00Z");
const NOW_S = Math.floor(NOW_MS / 1000);

test("accepts a correctly signed, fresh payload", () => {
  const header = signPayload(BODY, SECRET, NOW_S);
  assert.equal(verifyStripeSignature(BODY, header, SECRET, 300, NOW_MS), true);
});

test("rejects a payload signed with the wrong secret", () => {
  const header = signPayload(BODY, "whsec_attacker", NOW_S);
  assert.equal(verifyStripeSignature(BODY, header, SECRET, 300, NOW_MS), false);
});

test("rejects a tampered body", () => {
  const header = signPayload(BODY, SECRET, NOW_S);
  const tampered = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { client_reference_id: "someone-else" } },
  });
  assert.equal(verifyStripeSignature(tampered, header, SECRET, 300, NOW_MS), false);
});

test("rejects a stale signature (replay)", () => {
  const old = NOW_S - 3600;
  const header = signPayload(BODY, SECRET, old);
  assert.equal(verifyStripeSignature(BODY, header, SECRET, 300, NOW_MS), false);
});

test("rejects a future-dated signature outside tolerance", () => {
  const ahead = NOW_S + 3600;
  const header = signPayload(BODY, SECRET, ahead);
  assert.equal(verifyStripeSignature(BODY, header, SECRET, 300, NOW_MS), false);
});

test("rejects malformed or empty headers", () => {
  for (const header of ["", "garbage", "t=", "v1=abc", "t=123", "t=123,v1="]) {
    assert.equal(
      verifyStripeSignature(BODY, header, SECRET, 300, NOW_MS),
      false,
      `should have rejected header: "${header}"`
    );
  }
});

test("rejects a non-numeric timestamp", () => {
  assert.equal(
    verifyStripeSignature(BODY, "t=notanumber,v1=deadbeef", SECRET, 300, NOW_MS),
    false
  );
});

test("refuses to verify when no secret is configured", () => {
  // Otherwise an unconfigured deployment would accept every webhook.
  const header = signPayload(BODY, "", NOW_S);
  assert.equal(verifyStripeSignature(BODY, header, "", 300, NOW_MS), false);
});

test("accepts when Stripe sends multiple v1 signatures during key rotation", () => {
  const valid = signPayload(BODY, SECRET, NOW_S).split("v1=")[1];
  const header = `t=${NOW_S},v1=${"0".repeat(valid.length)},v1=${valid}`;
  assert.equal(verifyStripeSignature(BODY, header, SECRET, 300, NOW_MS), true);
});
