// PATHWISE 2.0 Phase 6: Knowledge Layer shaping — JSON columns to typed
// concepts, and the grounding block tutors are fed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  difficultyLabel,
  formatConceptContext,
  toConceptView,
} from "./knowledgeLayerModel.js";

const ROW = {
  id: "t1",
  name: "Cell Membranes",
  summary: "How substances move in and out of cells.",
  weight: 0.8,
  difficulty: 0.5,
  objectivesJson: '["Explain osmosis","Predict transport direction"]',
  misconceptionsJson: '["Diffusion requires energy"]',
  prerequisitesJson: '["Cell Structure"]',
  sourceRef: "syllabus.pdf — Week 2",
};

test("toConceptView parses JSON columns and survives corrupt data", () => {
  const c = toConceptView(ROW);
  assert.deepEqual(c.objectives, ["Explain osmosis", "Predict transport direction"]);
  assert.deepEqual(c.misconceptions, ["Diffusion requires energy"]);
  assert.deepEqual(c.prerequisites, ["Cell Structure"]);

  const broken = toConceptView({ ...ROW, objectivesJson: "not json" });
  assert.deepEqual(broken.objectives, []);
});

test("difficulty labels split at thirds", () => {
  assert.equal(difficultyLabel(0.1), "introductory");
  assert.equal(difficultyLabel(0.5), "intermediate");
  assert.equal(difficultyLabel(0.9), "advanced");
});

test("concept context carries every populated field", () => {
  const text = formatConceptContext(toConceptView(ROW), 0.42);
  assert.match(text, /Topic: Cell Membranes/);
  assert.match(text, /Level in this course: intermediate/);
  assert.match(text, /Explain osmosis/);
  assert.match(text, /misconceptions to probe for: Diffusion requires energy/);
  assert.match(text, /Builds on: Cell Structure/);
  assert.match(text, /mastery: 42%/);
  assert.match(text, /Source: syllabus\.pdf — Week 2/);
});

test("concept context omits what isn't known", () => {
  const sparse = toConceptView({
    ...ROW,
    summary: null,
    difficulty: null,
    objectivesJson: "[]",
    misconceptionsJson: "[]",
    prerequisitesJson: "[]",
    sourceRef: null,
  });
  const text = formatConceptContext(sparse);
  assert.equal(text, "Topic: Cell Membranes");
});
