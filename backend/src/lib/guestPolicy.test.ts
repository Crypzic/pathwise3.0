// PATHWISE 2.0 Phase 1: guest-mode rules — expiry, the banner countdown,
// synthetic identity, and the server-side limit gates.
import test from "node:test";
import assert from "node:assert/strict";
import {
  guestExpiry,
  isGuestExpired,
  guestDaysLeft,
  syntheticGuestEmail,
  isSyntheticGuestEmail,
  guestFileTooLarge,
  guestMayUpload,
  guestMayStartQuiz,
} from "./guestPolicy.js";

const NOW = new Date("2026-09-02T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

// --- Expiry ----------------------------------------------------------------

test("guestExpiry lands exactly ttlDays ahead", () => {
  assert.equal(guestExpiry(NOW, 7).getTime(), NOW.getTime() + 7 * DAY_MS);
  assert.equal(guestExpiry(NOW, 1).getTime(), NOW.getTime() + DAY_MS);
});

test("isGuestExpired flips at the boundary, never for null", () => {
  assert.equal(isGuestExpired(null, NOW), false);
  assert.equal(isGuestExpired(new Date(NOW.getTime() + 1), NOW), false);
  assert.equal(isGuestExpired(NOW, NOW), true);
  assert.equal(isGuestExpired(new Date(NOW.getTime() - 1), NOW), true);
});

test("guestDaysLeft counts whole days, shows 1 inside the final day, 0 after", () => {
  assert.equal(guestDaysLeft(null, NOW), null);
  assert.equal(guestDaysLeft(new Date(NOW.getTime() + 7 * DAY_MS), NOW), 7);
  assert.equal(guestDaysLeft(new Date(NOW.getTime() + 6.5 * DAY_MS), NOW), 7);
  // Two hours before deletion the banner still says 1 day, not 0.
  assert.equal(guestDaysLeft(new Date(NOW.getTime() + 2 * 60 * 60 * 1000), NOW), 1);
  assert.equal(guestDaysLeft(new Date(NOW.getTime() - 1), NOW), 0);
});

// --- Synthetic identity ----------------------------------------------------

test("synthetic guest emails round-trip through the recognizer", () => {
  const email = syntheticGuestEmail("0123456789abcdef");
  assert.equal(email, "guest-0123456789abcdef@guest.pathwise.internal");
  assert.equal(isSyntheticGuestEmail(email), true);
});

test("synthetic guest email refuses weak randomness", () => {
  assert.throws(() => syntheticGuestEmail("abc"));
  assert.throws(() => syntheticGuestEmail("not-hex-not-hex-not-hex"));
});

test("real emails are never mistaken for guest identities", () => {
  assert.equal(isSyntheticGuestEmail("student@uni.edu"), false);
  assert.equal(isSyntheticGuestEmail("guest-hi@guest.pathwise.internal"), false);
  assert.equal(isSyntheticGuestEmail("guest-0123456789abcdef@gmail.com"), false);
});

// --- Limit gates -----------------------------------------------------------

test("guest file-size gate trips just past the cap", () => {
  assert.equal(guestFileTooLarge(10 * 1024 * 1024, 10), false);
  assert.equal(guestFileTooLarge(10 * 1024 * 1024 + 1, 10), true);
});

test("guest upload gate allows up to the cap, then refuses", () => {
  assert.equal(guestMayUpload(0, 3), true);
  assert.equal(guestMayUpload(2, 3), true);
  assert.equal(guestMayUpload(3, 3), false);
});

test("guest quiz gate allows up to the daily cap, then refuses", () => {
  assert.equal(guestMayStartQuiz(0, 5), true);
  assert.equal(guestMayStartQuiz(4, 5), true);
  assert.equal(guestMayStartQuiz(5, 5), false);
});
