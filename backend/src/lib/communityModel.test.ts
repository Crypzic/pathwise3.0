// PATHWISE 2.0 Phase 9: community rules — slugs and spam screening.
// (No seeded catalog anymore: communities are user-created behind the
// educational guardrail.)
import test from "node:test";
import assert from "node:assert/strict";
import { countLinks, screenText, slugify } from "./communityModel.js";

test("slugify produces url-safe, stable slugs", () => {
  assert.equal(slugify("Computer Science"), "computer-science");
  assert.equal(slugify("  Médecine & Santé!  "), "medecine-sante");
  assert.equal(slugify("C++ / Systems Programming"), "c-systems-programming");
  assert.equal(slugify("---"), "");
  assert.ok(slugify("x".repeat(200)).length <= 60);
});

test("countLinks finds urls in both forms", () => {
  assert.equal(countLinks("no links here"), 0);
  assert.equal(
    countLinks("see https://a.com and http://b.com plus www.c.com"),
    3
  );
});

test("screenText passes normal study content", () => {
  for (const text of [
    "How do I tell mitosis apart from meiosis on an exam diagram?",
    "Here's a resource that helped me: https://example.com/notes",
    "WHY does entropy increase? sorry for caps, genuinely confused about the second law here",
  ]) {
    assert.equal(screenText(text).ok, true, text);
  }
});

test("screenText blocks obvious junk", () => {
  assert.equal(screenText("").ok, false);
  assert.equal(screenText("   ").ok, false);
  assert.equal(
    screenText("buy now https://a.com https://b.com https://c.com https://d.com").ok,
    false
  );
  assert.equal(screenText("a".repeat(40)).ok, false);
  assert.equal(
    screenText("THIS IS ALL CAPS SHOUTING ABOUT NOTHING IN PARTICULAR AT ALL").ok,
    false
  );
});

