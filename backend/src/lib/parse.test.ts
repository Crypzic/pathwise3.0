// Step 2: PDF text extraction must preserve line structure.
//
// This is a regression suite for a real bug. pdfjs returns positioned text
// fragments, and joining them with a space collapsed each page into one
// enormous line. Topic extraction then found no headings and fell back to
// generic placeholders ("Core Concepts", "Key Definitions") — the knowledge
// map looked populated while containing nothing from the actual syllabus.
//
// itemsToLines lives in its own dependency-free module, so it's tested
// directly without a PDF fixture or any parser library.
import test from "node:test";
import assert from "node:assert/strict";
import { itemsToLines } from "./pdfLines.js";
import { imageKindFor, kindFor } from "./parse.js";

/** A pdfjs-shaped text item at baseline y. */
function item(str: string, y: number, hasEOL = false) {
  return { str, hasEOL, transform: [1, 0, 0, 1, 40, y] };
}

test("a vertical baseline change starts a new line", () => {
  const text = itemsToLines([
    item("BIO 201 Cell Biology Syllabus", 760),
    item("1. Cell Structure and organelles", 742),
    item("2. Membranes and transport", 724),
  ]);
  assert.equal(text.split("\n").length, 3);
  assert.match(text, /^BIO 201 Cell Biology Syllabus$/m);
  assert.match(text, /^1\. Cell Structure and organelles$/m);
});

test("fragments on the same baseline join into one line", () => {
  // pdfjs commonly splits a line at font or spacing changes.
  const text = itemsToLines([
    item("Learning", 700),
    item("objectives", 700),
    item("for this course", 700),
  ]);
  assert.equal(text.split("\n").length, 1);
  assert.equal(text, "Learning objectives for this course");
});

test("hasEOL ends a line even without a baseline change", () => {
  // Some producers emit hasEOL and keep the reported y constant.
  const text = itemsToLines([
    item("First line", 700, true),
    item("Second line", 700, true),
  ]);
  assert.deepEqual(text.split("\n"), ["First line", "Second line"]);
});

test("small baseline jitter does not split a line", () => {
  // Sub/superscripts and rounding shouldn't fragment a heading.
  const text = itemsToLines([
    item("Cellular Respiration and ATP", 600),
    item("synthesis", 601),
  ]);
  assert.equal(text.split("\n").length, 1);
});

test("items lacking a transform still produce text", () => {
  // Defensive: not every item shape is guaranteed.
  const text = itemsToLines([
    { str: "No transform here", hasEOL: true },
    { str: "Second", hasEOL: true },
  ]);
  assert.match(text, /No transform here/);
  assert.match(text, /Second/);
});

test("non-text entries are skipped rather than throwing", () => {
  const text = itemsToLines([
    item("Real text", 700, true),
    null,
    undefined,
    { type: "beginMarkedContent" },
    42,
    item("More text", 682, true),
  ]);
  assert.deepEqual(text.split("\n"), ["Real text", "More text"]);
});

test("empty input yields empty output", () => {
  assert.equal(itemsToLines([]), "");
});

test("blank fragments do not create empty lines", () => {
  const text = itemsToLines([
    item("Heading", 700, true),
    item("   ", 682, true),
    item("Body", 664, true),
  ]);
  assert.deepEqual(text.split("\n"), ["Heading", "Body"]);
});

test("extracted structure survives the topic heuristics", () => {
  // The actual point of the fix: numbered syllabus lines must stay separable,
  // because that's the signal topic extraction reads.
  const text = itemsToLines([
    item("BIO 201 Syllabus", 760, true),
    item("1. Cell Structure", 742, true),
    item("2. Membranes", 724, true),
    item("3. Cell Division", 706, true),
    item("4. Cellular Respiration", 688, true),
  ]);
  const numbered = text.split("\n").filter((l) => /^\d+\./.test(l));
  assert.equal(numbered.length, 4, `expected 4 numbered lines, got: ${text}`);
});

// --- File-type gate (Step 1 baseline for Step 15) --------------------------

test("only PDF, DOCX and PPTX are accepted", () => {
  assert.equal(kindFor("syllabus.pdf", "application/pdf"), "pdf");
  assert.equal(
    kindFor("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "docx"
  );
  assert.equal(
    kindFor("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    "pptx"
  );

  assert.equal(kindFor("notes.txt", "text/plain"), null);
  assert.equal(kindFor("photo.png", "image/png"), null);
  assert.equal(kindFor("archive.zip", "application/zip"), null);
  assert.equal(kindFor("payload.exe", "application/octet-stream"), null);
});

test("the extension is honoured when the browser sends a vague mimetype", () => {
  // Browsers routinely send application/octet-stream for .docx.
  assert.equal(kindFor("essay.docx", "application/octet-stream"), "docx");
  assert.equal(kindFor("DECK.PPTX", "application/octet-stream"), "pptx");
});

// --- Image kinds (PATHWISE 2.0 Phase 5) -------------------------------------

test("images resolve to their kind by mimetype or extension", () => {
  assert.equal(imageKindFor("notes.png", "image/png"), "png");
  assert.equal(imageKindFor("board.jpeg", ""), "jpg");
  assert.equal(imageKindFor("photo.JPG", "application/octet-stream"), "jpg");
  assert.equal(imageKindFor("scan.webp", "image/webp"), "webp");
});

test("documents and junk are not image kinds", () => {
  assert.equal(imageKindFor("syllabus.pdf", "application/pdf"), null);
  assert.equal(imageKindFor("notes.txt", "text/plain"), null);
  assert.equal(imageKindFor("clip.mp4", "video/mp4"), null);
});
