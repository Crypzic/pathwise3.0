// Hidden creator video infrastructure (PATHWISE 2.0 Phase 16) — pure rules.
//
// The pipeline exists in full; PUBLIC posting stays behind
// FEATURE_USER_VIDEO_POSTING=false until moderation is proven. These are the
// state-machine rules the routes enforce, kept pure so the lifecycle is
// unit-tested without a database.
import type { VideoKind } from "./fileSignature.js";

/** Creator lifecycle: upload → analysis → creator review → publish. */
export type CreatorVideoStatus =
  | "processing"
  | "pending_review" // analysis done; creator decides whether to publish
  | "published"
  | "rejected"; // moderation refused it outright

export type ModerationStatus = "pending" | "approved" | "flagged" | "rejected";

export function videoKindFor(
  filename: string,
  mimetype: string
): VideoKind | null {
  const name = filename.toLowerCase();
  const mime = mimetype.toLowerCase();
  if (mime === "video/mp4" || name.endsWith(".mp4") || name.endsWith(".m4v")) {
    return "mp4";
  }
  if (mime === "video/webm" || name.endsWith(".webm")) {
    return "webm";
  }
  return null;
}

/**
 * Map the AI screening verdict onto the moderation lane. "off_topic" is
 * flagged for human review (a vlog isn't dangerous, just not educational);
 * "inappropriate" is rejected outright.
 */
export function moderationFromVerdict(
  verdict: "clean" | "off_topic" | "inappropriate"
): { moderationStatus: ModerationStatus; status: CreatorVideoStatus } {
  switch (verdict) {
    case "clean":
      return { moderationStatus: "approved", status: "pending_review" };
    case "off_topic":
      return { moderationStatus: "flagged", status: "pending_review" };
    case "inappropriate":
      return { moderationStatus: "rejected", status: "rejected" };
  }
}

/**
 * May the creator publish this video? Only after analysis, and only with an
 * approved moderation pass — a flagged video needs a human (ops) to approve
 * first, and a rejected one never publishes.
 */
export function canPublish(
  status: CreatorVideoStatus,
  moderationStatus: ModerationStatus
): { ok: boolean; reason?: string } {
  if (status === "published") {
    return { ok: false, reason: "Already published." };
  }
  if (status === "processing") {
    return { ok: false, reason: "Still processing — try again shortly." };
  }
  if (status === "rejected" || moderationStatus === "rejected") {
    return { ok: false, reason: "This video was rejected by moderation." };
  }
  if (moderationStatus !== "approved") {
    return {
      ok: false,
      reason: "Awaiting moderation review before it can be published.",
    };
  }
  return { ok: true };
}

/** Bound and clean a caption/title once, in one place. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
