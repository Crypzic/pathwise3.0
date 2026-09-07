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
