// Extract plain text from uploaded course materials (Step 2, parsing pipeline).
// Supports PDF, DOCX, and PPTX — the only types the app accepts.
//
// Every parser library is imported dynamically inside the function that needs
// it. They're large CJS packages, and only one of the three is ever used for a
// given upload, so a static import would slow every boot to load two parsers
// that won't run.
//
// No filesystem access here — callers hand in the bytes. That keeps parsing
// storage-agnostic (local disk in dev, S3/R2 in production; see storage.ts).
import { extname } from "node:path";
import { itemsToLines } from "./pdfLines.js";

export { itemsToLines } from "./pdfLines.js";

export type ParseKind = "pdf" | "docx" | "pptx";

// Image uploads (PATHWISE 2.0 Phase 5). Images don't parse locally — a
// vision-capable AI provider transcribes them into text, which then flows
// through the same screening/topic pipeline as documents.
export type ImageKind = "png" | "jpg" | "webp";

export const IMAGE_MIME: Record<ImageKind, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export function imageKindFor(
  filename: string,
  mimeType: string
): ImageKind | null {
  const ext = extname(filename).toLowerCase();
  if (mimeType === "image/png" || ext === ".png") return "png";
  if (mimeType === "image/jpeg" || ext === ".jpg" || ext === ".jpeg")
    return "jpg";
  if (mimeType === "image/webp" || ext === ".webp") return "webp";
  return null;
}

export function kindFor(filename: string, mimeType: string): ParseKind | null {
  const ext = extname(filename).toLowerCase();
  if (mimeType === "application/pdf" || ext === ".pdf") return "pdf";
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  )
    return "docx";
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === ".pptx"
  )
    return "pptx";
  return null;
}

async function parsePdf(buffer: Buffer): Promise<string> {
  // Use the legacy build — it runs in Node without a browser worker.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    // Silence noisy font warnings during extraction.
    verbosity: 0,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Reinstates line breaks — see pdfLines.ts for why this matters.
    pages.push(itemsToLines(content.items));
  }
  await doc.destroy();
  return pages.join("\n");
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function parsePptx(buffer: Buffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  // Slide XML files, in slide order.
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const n = (p: string) => Number(p.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return n(a) - n(b);
    });

  const out: string[] = [];
  for (const path of slidePaths) {
    const xml = await zip.files[path].async("string");
    // <a:t> holds run text in DrawingML. Each paragraph (<a:p>) is a line —
    // slide decks are mostly bullet lists, and those bullets are the topic
    // signal, so they must not be flattened into one blob.
    const paragraphs = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((m) =>
      [...m[0].matchAll(/<a:t>(.*?)<\/a:t>/gs)]
        .map((t) => decodeXmlEntities(t[1]))
        .join("")
        .trim()
    );
    const lines = paragraphs.filter((p) => p.length > 0);
    if (lines.length) out.push(lines.join("\n"));
  }
  return out.join("\n");
}

/** Extract text from file bytes. Throws on unsupported types. */
export async function extractText(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const kind = kindFor(filename, mimeType);
  if (!kind) throw new Error(`Unsupported file type: ${filename} (${mimeType})`);

  switch (kind) {
    case "pdf":
      return normalize(await parsePdf(buffer));
    case "docx":
      return normalize(await parseDocx(buffer));
    case "pptx":
      return normalize(await parsePptx(buffer));
  }
}

// Collapse excess whitespace but keep line breaks (topic heuristics use them).
function normalize(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
