// Knowledge Layer 2.0 retrieval (PATHWISE 2.0 Phase 6).
//
// Downstream features (Socratic grounding, Ask PATHWISE, recommendations)
// retrieve compact structured knowledge from here instead of re-processing
// source files. The pure shaping/formatting lives in knowledgeLayerModel.ts;
// this is the thin persistence layer.
import { prisma } from "./prisma.js";
import {
  formatConceptContext,
  toConceptView,
  type ConceptView,
} from "./knowledgeLayerModel.js";

export {
  formatConceptContext,
  toConceptView,
  difficultyLabel,
  type ConceptView,
} from "./knowledgeLayerModel.js";

/** Fetch one concept (ownership enforced via the course relation). */
export async function getConcept(
  userId: string,
  topicId: string
): Promise<ConceptView | null> {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, knowledgeMap: { course: { userId } } },
  });
  return topic ? toConceptView(topic) : null;
}

/**
 * Grounding block for a tutor session: the concept plus the student's
 * mastery of it. Null when the topic doesn't exist or isn't theirs.
 */
export async function getConceptContext(
  userId: string,
  topicId: string
): Promise<string | null> {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, knowledgeMap: { course: { userId } } },
  });
  if (!topic) return null;
  const mastery = await prisma.topicMastery.findUnique({
    where: { userId_topicId: { userId, topicId } },
    select: { mastery: true },
  });
  return formatConceptContext(toConceptView(topic), mastery?.mastery);
}

/**
 * A short excerpt of the student's ACTUAL uploaded material most relevant
 * to this topic (Socratic upgrade, UX overhaul Phase 4). Plain keyword
 * retrieval over stored extractedText — no extra AI call, so it's free and
 * instant, and it makes the tutor's questions come from THEIR document
 * rather than general knowledge.
 */
export async function getMaterialExcerpt(
  userId: string,
  topicId: string,
  maxChars = 1600
): Promise<string | null> {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, knowledgeMap: { course: { userId } } },
    select: { name: true, knowledgeMap: { select: { courseId: true } } },
  });
  if (!topic) return null;

  const uploads = await prisma.upload.findMany({
    where: {
      courseId: topic.knowledgeMap.courseId,
      status: "processed",
      extractedText: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { extractedText: true },
  });
  if (uploads.length === 0) return null;

  const words = topic.name
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
  if (words.length === 0) return null;

  const paras: { text: string; score: number }[] = [];
  for (const u of uploads) {
    for (const raw of (u.extractedText ?? "").split(/\n{2,}/)) {
      const text = raw.trim();
      if (text.length < 60) continue;
      const lower = text.toLowerCase();
      let score = 0;
      for (const w of words) if (lower.includes(w)) score += 1;
      if (score > 0) paras.push({ text: text.slice(0, 700), score });
    }
  }
  if (paras.length === 0) return null;

  paras.sort((a, b) => b.score - a.score);
  let out = "";
  for (const p of paras) {
    if (out.length + p.text.length > maxChars) break;
    out += (out ? "\n\n" : "") + p.text;
  }
  return out || null;
}

/** All concepts in a course, ordered by emphasis — for future retrieval. */
export async function listConcepts(
  userId: string,
  courseId: string
): Promise<ConceptView[]> {
  const topics = await prisma.topic.findMany({
    where: { knowledgeMap: { course: { id: courseId, userId } } },
    orderBy: { weight: "desc" },
  });
  return topics.map(toConceptView);
}
