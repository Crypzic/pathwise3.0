// Beta readiness: error grouping — same failure, one bucket; different
// failure, different bucket; hostile input bounded.
import test from "node:test";
import assert from "node:assert/strict";
import {
  boundReport,
  dayKeyOf,
  fingerprintError,
  MAX_MESSAGE,
  MAX_STACK,
} from "./errorModel.js";

test("the same error with different ids/lines shares a fingerprint", () => {
  const a = fingerprintError(
    'User "cku7x9aab0001" not found',
    "Error: nope\n    at findUser (src/lib/users.ts:41:7)"
  );
  const b = fingerprintError(
    'User "cku8zzq1c0999" not found',
    "Error: nope\n    at findUser (src/lib/users.ts:97:13)"
  );
  assert.equal(a, b);
});

test("different errors get different fingerprints", () => {
  const a = fingerprintError("Cannot read properties of undefined", "at render (App.tsx:10:1)");
  const b = fingerprintError("Network request failed", "at fetcher (api.ts:22:3)");
  assert.notEqual(a, b);
});

test("dayKeyOf is a stable YYYY-MM-DD", () => {
  assert.equal(dayKeyOf(new Date("2026-09-05T23:59:00Z")), "2026-09-05");
});

test("boundReport enforces sizes and requires a message", () => {
  assert.equal(boundReport({}), null);
  assert.equal(boundReport({ message: "   " }), null);
  const bounded = boundReport({
    message: "x".repeat(10_000),
    stack: "y".repeat(100_000),
    url: "/somewhere",
  });
  assert.equal(bounded?.message.length, MAX_MESSAGE);
  assert.equal(bounded?.stack?.length, MAX_STACK);
  assert.equal(bounded?.url, "/somewhere");
});
