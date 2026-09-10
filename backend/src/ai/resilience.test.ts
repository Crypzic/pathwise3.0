// AI transport resilience: which failures retry, and how backoff grows.
import test from "node:test";
import assert from "node:assert/strict";
import {
  AIUnavailableError,
  backoffMs,
  isRetryableStatus,
  MAX_ATTEMPTS,
} from "./resilience.js";

test("retryable statuses are rate limits and server overload only", () => {
  for (const s of [429, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(s), true, `${s} should retry`);
  }
  for (const s of [400, 401, 403, 404, 413]) {
    assert.equal(isRetryableStatus(s), false, `${s} should NOT retry`);
  }
});

test("backoff grows exponentially and caps at 10s", () => {
  assert.equal(backoffMs(0), 800);
  assert.equal(backoffMs(1), 2400);
  assert.equal(backoffMs(2), 7200);
  assert.equal(backoffMs(3), 10_000); // capped
  assert.ok(MAX_ATTEMPTS >= 2);
});

test("the unavailable error carries a user-facing message", () => {
  const err = new AIUnavailableError("Gemini 503: high demand");
  assert.match(err.message, /briefly unavailable/i);
  assert.equal(err.cause, "Gemini 503: high demand");
});
