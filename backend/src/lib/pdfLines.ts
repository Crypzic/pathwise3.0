// Rebuilding line structure from pdfjs text items (Step 2, parsing pipeline).
//
// Its own module, with no imports, so it can be unit-tested without pulling in
// pdfjs/mammoth/jszip.
//
// Why this exists: pdfjs hands back positioned text fragments, not lines.
// Joining them all with a space turns a whole page into one enormous line,
// which destroys exactly the signal topic extraction depends on — headings,
// numbered lists, and "Learning objective:" lead-ins. With the structure gone,
// the heuristic extractor falls back to generic placeholders and the AI prompt
// gets a wall of text, so the knowledge map looks populated while containing
// nothing from the actual syllabus.

/** A pdfjs text item. Only the fields we rely on are described. */
interface TextItemLike {
  str: string;
  hasEOL?: boolean;
  /** [a, b, c, d, e, f] — f is the baseline's y position. */
  transform?: number[];
}

// Absorbs sub/superscripts and baseline jitter within one visual line.
const BASELINE_TOLERANCE = 2;

function isTextItem(value: unknown): value is TextItemLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "str" in value &&
    typeof (value as { str: unknown }).str === "string"
  );
}

/**
 * Turn positioned pdfjs fragments back into lines.
 *
 * `hasEOL` marks a line end when the producing tool sets it. Plenty of PDFs
 * don't, so we also break whenever the baseline moves vertically — that's what
 * a new line physically is.
 */
export function itemsToLines(items: unknown[]): string {
  const lines: string[] = [];
  let current = "";
  let lastY: number | null = null;

  for (const raw of items) {
    if (!isTextItem(raw)) continue;

    const y = Array.isArray(raw.transform) ? raw.transform[5] : null;

    if (
      lastY !== null &&
      typeof y === "number" &&
      Math.abs(y - lastY) > BASELINE_TOLERANCE
    ) {
      if (current.trim()) lines.push(current.trim());
      current = "";
    }
    if (typeof y === "number") lastY = y;

    current += raw.str;

    if (raw.hasEOL) {
      if (current.trim()) lines.push(current.trim());
      current = "";
      // hasEOL already ended the line; don't break again on the next item's
      // y jump for the same break.
      lastY = null;
    } else if (raw.str.length > 0 && !raw.str.endsWith(" ")) {
      // Fragments within a line arrive without their separating space.
      current += " ";
    }
  }

  if (current.trim()) lines.push(current.trim());
  return lines.join("\n");
}
