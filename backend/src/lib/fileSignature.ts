// Content-based file validation (security review item).
//
// Extension and mimetype are both attacker-chosen: a renamed .exe arrives as
// "notes.pdf" with whatever Content-Type the client claims. The first bytes of
// the file are the only part the uploader can't freely lie about while still
// having the parsers accept it, so uploads are checked against the real
// signatures before anything is stored.
//
// Pure module — tested directly in fileSignature.test.ts.
import type { ImageKind, ParseKind } from "./parse.js";

// The PDF spec permits junk before the header; readers (including pdfjs)
// accept %PDF within the first 1024 bytes.
const PDF_HEADER_WINDOW = 1024;

/** Does the buffer actually begin like the format the filename claims? */
export function matchesSignature(kind: ParseKind, buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  switch (kind) {
    case "pdf": {
      const window = buffer.subarray(0, PDF_HEADER_WINDOW).toString("latin1");
      return window.includes("%PDF");
    }
    case "docx":
    case "pptx": {
      // OOXML files are ZIP archives: local-file-header magic PK\x03\x04.
      // (PK\x05\x06 would be a zip with no entries — nothing to parse.)
      return (
        buffer[0] === 0x50 && // P
        buffer[1] === 0x4b && // K
        buffer[2] === 0x03 &&
        buffer[3] === 0x04
      );
    }
  }
}

/** Video uploads (PATHWISE 2.0 Phase 16 — creator infrastructure). */
export type VideoKind = "mp4" | "webm";

export function matchesVideoSignature(kind: VideoKind, buffer: Buffer): boolean {
  if (buffer.length < 12) return false;

  switch (kind) {
    case "mp4":
      // ISO BMFF: a size box then "ftyp" at offset 4.
      return buffer.subarray(4, 8).toString("latin1") === "ftyp";
    case "webm":
      // Matroska/WebM EBML header.
      return (
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
      );
  }
}

/** Same idea for image uploads (PATHWISE 2.0 Phase 5). */
export function matchesImageSignature(kind: ImageKind, buffer: Buffer): boolean {
  if (buffer.length < 12) return false;

  switch (kind) {
    case "png":
      // \x89PNG\r\n\x1a\n
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    case "jpg":
      // JPEG SOI + marker prefix.
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "webp":
      // RIFF container: "RIFF" .... "WEBP".
      return (
        buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
        buffer.subarray(8, 12).toString("latin1") === "WEBP"
      );
  }
}
