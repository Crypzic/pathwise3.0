// Course Intelligence pipeline (Step 2): a saved upload -> extracted text ->
// moderation screen -> weighted topics -> merged into the course's Knowledge Map.
//
// Runs synchronously per upload (no queue at MVP, per the blueprint). Adding
// more materials later reinforces existing topics and adds new ones — the map
// "expands" rather than being rebuilt from scratch.
import { prisma } from "./prisma.js";
import { extractText, imageKindFor, IMAGE_MIME } from "./parse.js";
import { storage } from "./storage.js";
import {
  AIBudgetExceededError,
  extractTopics,
  transcribeImage,
} from "./aiMeter.js";
import { moderateMaterial } from "./moderation.js";
import { track } from "./analytics.js";
import { grantBadge } from "./gamification.js";
import type { Topic } from "@prisma/client";

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// A malformed PDF can send pdfjs into effectively unbounded work, pinning the
// upload request forever (observed with a synthetic file). Bound the wait:
// the request fails cleanly and the student can retry with a healthier file.
// (The stray parse may keep burning CPU until it gives up — the real cure is
// the async upload worker the roadmap schedules; this caps user-facing harm.)
const PARSE_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} took too long — the file may be corrupted.`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

// A topic seen again in new material gets an emphasis bump (capped at 1).
function reinforce(existing: number, incoming: number): number {
  return Math.min(1, Math.max(existing, incoming) + 0.12);
}

// Knowledge Layer 2.0 list merge: keep what's known, add what's new, stay
// bounded. Case-insensitive so "Cell membranes" doesn't duplicate
// "cell membranes" across uploads.
function mergeList(existingJson: string, incoming: string[], cap: number): string {
  let existing: string[] = [];
  try {
    const parsed = JSON.parse(existingJson);
    if (Array.isArray(parsed)) {
      existing = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // Corrupt stored value reads as empty.
  }
  const seen = new Set(existing.map((s) => s.toLowerCase()));
  for (const item of incoming) {
    if (seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    existing.push(item);
    if (existing.length >= cap) break;
  }
  return JSON.stringify(existing.slice(0, cap));
}

export interface ProcessResult {
  status: "processed" | "failed" | "rejected";
  error?: string;
  topicCount: number;
  newTopicCount?: number;
}

export async function processUpload(
  uploadId: string,
  userId: string
): Promise<ProcessResult> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    include: { course: { include: { knowledgeMap: true } } },
  });
  if (!upload) throw new Error(`Upload ${uploadId} not found`);

  await prisma.upload.update({
    where: { id: uploadId },
    data: { status: "parsing" },
  });

  // --- Parse -------------------------------------------------------------
  // Documents parse locally; images go through the AI provider's vision
  // transcription (2.0 Phase 5) and re-enter the pipeline as text — from
  // here on, nothing downstream knows the material arrived as pixels.
  let text: string;
  try {
    const buffer = await storage.read(upload.storagePath);
    const imageKind = imageKindFor(upload.filename, upload.mimeType);
    if (imageKind) {
      text = await transcribeImage(userId, upload.course.name, {
        data: buffer,
        mimeType: IMAGE_MIME[imageKind],
      });
      if (text.trim().length === 0) {
        const message =
          "Couldn't read any study content from this image — try a clearer photo.";
        await prisma.upload.update({
          where: { id: uploadId },
          data: { status: "failed", error: message },
        });
        await track(userId, "upload_failed", { uploadId, reason: "empty_image" });
        return { status: "failed", error: message, topicCount: 0 };
      }
    } else {
      text = await withTimeout(
        extractText(buffer, upload.filename, upload.mimeType),
        PARSE_TIMEOUT_MS,
        "Reading this file"
      );
    }
  } catch (err) {
    // The daily AI budget gate belongs to the route (429), not a "failed"
    // upload row — the student did nothing wrong.
    if (err instanceof AIBudgetExceededError) throw err;
    const message = err instanceof Error ? err.message : "Failed to parse file";
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "failed", error: message },
    });
    await track(userId, "upload_failed", { uploadId, reason: "parse_error" });
    return { status: "failed", error: message, topicCount: 0 };
  }

  // --- Moderate (Step 15) ------------------------------------------------
  const verdict = await moderateMaterial(userId, upload.course.name, text);
  if (!verdict.allowed) {
    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: "rejected",
        error: verdict.reason,
        moderation: verdict.verdict,
        moderationNote: verdict.reason,
      },
    });
    await track(userId, "upload_rejected", {
      uploadId,
      verdict: verdict.verdict,
    });
    return { status: "rejected", error: verdict.reason, topicCount: 0 };
  }

  // Ensure a knowledge map exists for the course.
  let mapId = upload.course.knowledgeMap?.id;
  if (!mapId) {
    const map = await prisma.knowledgeMap.create({
      data: { courseId: upload.courseId },
    });
    mapId = map.id;
  }

  // --- Extract topics ----------------------------------------------------
  let extracted;
  try {
    extracted = await extractTopics(userId, upload.course.name, text);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Topic extraction failed";
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "failed", error: message },
    });
    await track(userId, "upload_failed", { uploadId, reason: "ai_error" });
    return { status: "failed", error: message, topicCount: 0 };
  }

  // --- Merge into the existing map (reinforce or add) --------------------
  const existingTopics = await prisma.topic.findMany({
    where: { knowledgeMapId: mapId },
  });
  const byName = new Map(existingTopics.map((t: Topic) => [normalizeName(t.name), t]));

  let newTopicCount = 0;
  for (const t of extracted) {
    const key = normalizeName(t.name);
    const match = byName.get(key);
    // Where this concept came from (Knowledge Layer 2.0 source grounding).
    const sourceRef = t.sourceHint
      ? `${upload.filename} — ${t.sourceHint}`
      : upload.filename;
    if (match) {
      await prisma.topic.update({
        where: { id: match.id },
        data: {
          weight: reinforce(match.weight, t.weight),
          summary: match.summary || t.summary,
          // Enrich, never clobber: new material fills gaps and extends lists.
          difficulty: match.difficulty ?? t.difficulty ?? null,
          objectivesJson: mergeList(match.objectivesJson, t.objectives ?? [], 6),
          misconceptionsJson: mergeList(
            match.misconceptionsJson,
            t.misconceptions ?? [],
            5
          ),
          prerequisitesJson: mergeList(
            match.prerequisitesJson,
            t.prerequisites ?? [],
            5
          ),
          sourceRef: match.sourceRef ?? sourceRef,
        },
      });
    } else {
      const created = await prisma.topic.create({
        data: {
          knowledgeMapId: mapId,
          name: t.name,
          summary: t.summary,
          weight: t.weight,
          difficulty: t.difficulty ?? null,
          objectivesJson: JSON.stringify(t.objectives ?? []),
          misconceptionsJson: JSON.stringify(t.misconceptions ?? []),
          prerequisitesJson: JSON.stringify(t.prerequisites ?? []),
          sourceRef,
        },
      });
      byName.set(key, created);
      newTopicCount += 1;
    }
  }

  await prisma.knowledgeMap.update({
    where: { id: mapId },
    data: { updatedAt: new Date() },
  });

  await prisma.upload.update({
    where: { id: uploadId },
    data: {
      status: "processed",
      extractedText: text.slice(0, 20000),
      moderation: verdict.verdict,
      error: null,
    },
  });

  const topicCount = await prisma.topic.count({ where: { knowledgeMapId: mapId } });

  await track(userId, "upload_completed", {
    uploadId,
    courseId: upload.courseId,
    topicCount,
    newTopicCount,
  });
  await track(userId, "knowledge_map_built", {
    courseId: upload.courseId,
    topicCount,
  });
  await grantBadge(userId, "first_upload");

  return { status: "processed", topicCount, newTopicCount };
}
