// PATHWISE 2.0 Phase 16: creator video lifecycle — the rules that keep the
// dark pipeline safe even before a human ever flips the flag.
import test from "node:test";
import assert from "node:assert/strict";
import {
  canPublish,
  cleanText,
  moderationFromVerdict,
  videoKindFor,
} from "./creatorModel.js";
import { matchesVideoSignature } from "./fileSignature.js";

test("video kinds resolve by mimetype or extension", () => {
  assert.equal(videoKindFor("clip.mp4", ""), "mp4");
  assert.equal(videoKindFor("clip.m4v", "application/octet-stream"), "mp4");
  assert.equal(videoKindFor("x", "video/webm"), "webm");
  assert.equal(videoKindFor("doc.pdf", "application/pdf"), null);
  assert.equal(videoKindFor("clip.avi", "video/x-msvideo"), null);
});

test("video signatures accept real headers and reject disguises", () => {
  const mp4 = Buffer.alloc(16);
  mp4.write("ftyp", 4, "latin1");
  assert.equal(matchesVideoSignature("mp4", mp4), true);

  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(matchesVideoSignature("webm", webm), true);

  const exe = Buffer.from("MZ\x90\x00 not a video at all", "latin1");
  assert.equal(matchesVideoSignature("mp4", exe), false);
  assert.equal(matchesVideoSignature("webm", exe), false);
  assert.equal(matchesVideoSignature("mp4", Buffer.alloc(4)), false);
});

test("screening verdicts map onto the right moderation lanes", () => {
  assert.deepEqual(moderationFromVerdict("clean"), {
    moderationStatus: "approved",
    status: "pending_review",
  });
  assert.deepEqual(moderationFromVerdict("off_topic"), {
    moderationStatus: "flagged",
    status: "pending_review",
  });
  assert.deepEqual(moderationFromVerdict("inappropriate"), {
    moderationStatus: "rejected",
    status: "rejected",
  });
});

test("publish requires analysis done AND an approved moderation pass", () => {
  assert.equal(canPublish("pending_review", "approved").ok, true);
  assert.equal(canPublish("processing", "approved").ok, false);
  assert.equal(canPublish("pending_review", "pending").ok, false);
  assert.match(
    canPublish("pending_review", "flagged").reason ?? "",
    /moderation review/i
  );
  assert.match(
    canPublish("rejected", "rejected").reason ?? "",
    /rejected/i
  );
  assert.equal(canPublish("published", "approved").ok, false);
});

test("cleanText bounds and normalizes", () => {
  assert.equal(cleanText("  a   lot\n of   space  ", 100), "a lot of space");
  assert.equal(cleanText(undefined, 10), "");
  assert.equal(cleanText("x".repeat(50), 10).length, 10);
});
