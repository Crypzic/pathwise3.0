// Content moderation for uploaded material (Step 15 item 1).
//
// The Step 1 baseline was file-type restriction only — that stops a .exe, not a
// student uploading something that has no business being in a study app. This
// runs before the knowledge map is built, so rejected material never becomes
// topics and never reaches the quiz generator.
import { env } from "./env.js";
import { classifyMaterial } from "./aiMeter.js";

export interface ModerationResult {
  verdict: "clean" | "off_topic" | "inappropriate";
  reason: string;
  allowed: boolean;
}

// A fast local screen runs first so obvious cases never cost an AI call.
const HARD_BLOCK_PATTERNS: RegExp[] = [
  /\bchild (?:sexual|abuse|porn)/i,
  /\b(?:cp|csam)\b.*\b(?:download|share|trade)\b/i,
  /\bhow to (?:make|build) (?:a )?(?:bomb|explosive|pipe bomb)\b/i,
  /\bsynthesi[sz]e (?:meth|fentanyl|sarin)\b/i,
];

/** Too little extractable text to be real course material. */
const MIN_USABLE_CHARS = 120;

export async function moderateMaterial(
  userId: string,
  courseName: string,
  text: string
): Promise<ModerationResult> {
  if (!env.MODERATION_ENABLED) {
    return { verdict: "clean", reason: "Moderation disabled.", allowed: true };
  }

  const trimmed = text.trim();

  if (trimmed.length < MIN_USABLE_CHARS) {
    return {
      verdict: "off_topic",
      reason:
        "We couldn't read enough text from this file to build a study map. If it's a scanned document, try a text-based PDF.",
      allowed: false,
    };
  }

  for (const re of HARD_BLOCK_PATTERNS) {
    if (re.test(trimmed)) {
      return {
        verdict: "inappropriate",
        reason: "This file contains content we can't process.",
        allowed: false,
      };
    }
  }

  // Then the model-based check on an excerpt.
  try {
    const result = await classifyMaterial(userId, courseName, trimmed);
    if (result.verdict === "inappropriate") {
      return {
        verdict: "inappropriate",
        reason: "This file contains content we can't process.",
        allowed: false,
      };
    }
    if (result.verdict === "off_topic") {
      return {
        verdict: "off_topic",
        reason:
          "This doesn't look like course material. Try uploading a syllabus, lecture slides, or reading notes.",
        allowed: false,
      };
    }
    return { verdict: "clean", reason: result.reason, allowed: true };
  } catch (err) {
    // A moderation outage shouldn't block a student's legitimate upload — the
    // hard-block screen above already ran. Log loudly and let it through.
    console.error("⚠️  Moderation check failed, allowing upload:", err);
    return {
      verdict: "clean",
      reason: "Moderation check unavailable.",
      allowed: true,
    };
  }
}
