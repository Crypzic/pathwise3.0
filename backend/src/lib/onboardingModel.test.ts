// PATHWISE 2.0 Phase 2: onboarding normalization — what gets stored is
// bounded, deduped and drawn from known catalogs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACADEMIC_LEVELS,
  CONTENT_PREFS,
  STUDY_STYLES,
  isAcademicLevel,
  isStudyStyle,
  normalizeContentPrefs,
  normalizeFreeList,
  normalizeBuddyPrefs,
  parseStoredList,
} from "./onboardingModel.js";

test("catalog keys are unique", () => {
  for (const catalog of [ACADEMIC_LEVELS, CONTENT_PREFS, STUDY_STYLES]) {
    const keys = catalog.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test("level and style validators accept catalog keys, reject junk", () => {
  assert.equal(isAcademicLevel("undergraduate"), true);
  assert.equal(isAcademicLevel("wizard"), false);
  assert.equal(isStudyStyle("buddy"), true);
  assert.equal(isStudyStyle("alone-in-the-dark"), false);
});

test("content prefs keep only known keys, deduped, in catalog order", () => {
  const out = normalizeContentPrefs([
    "exam_prep",
    "nonsense",
    "short_explanations",
    "exam_prep",
  ]);
  assert.deepEqual(out, ["short_explanations", "exam_prep"]);
});

test("free lists trim, collapse whitespace and dedupe case-insensitively", () => {
  const out = normalizeFreeList([
    "  Cell   Biology  ",
    "cell biology",
    "",
    "   ",
    "Genetics",
  ]);
  assert.deepEqual(out, ["Cell Biology", "Genetics"]);
});

test("free lists are capped in count and item length", () => {
  const many = Array.from({ length: 30 }, (_, i) => `Topic ${i}`);
  assert.equal(normalizeFreeList(many).length, 12);
  const long = normalizeFreeList(["x".repeat(500)]);
  assert.equal(long[0].length, 60);
});

test("buddy prefs coerce arbitrary shapes into a well-formed object", () => {
  assert.deepEqual(normalizeBuddyPrefs(undefined), {
    similarLevel: false,
    sameSubjects: false,
    availability: null,
    discoverable: false,
  });
  assert.deepEqual(
    normalizeBuddyPrefs({
      similarLevel: true,
      sameSubjects: "yes", // not a boolean true -> false
      availability: "evenings",
      discoverable: true,
    }),
    {
      similarLevel: true,
      sameSubjects: false,
      availability: "evenings",
      discoverable: true,
    }
  );
  assert.equal(normalizeBuddyPrefs({ availability: "3am" }).availability, null);
  // Privacy default: never discoverable unless explicitly true.
  assert.equal(normalizeBuddyPrefs({ discoverable: "yes" }).discoverable, false);
});

test("stored lists parse defensively", () => {
  assert.deepEqual(parseStoredList('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseStoredList("not json"), []);
  assert.deepEqual(parseStoredList('{"a":1}'), []);
  assert.deepEqual(parseStoredList('["a", 3, null, "b"]'), ["a", "b"]);
});
