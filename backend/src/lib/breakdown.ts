// Topic Breakdown (learning layer): the lecturer-grade explanation of one
// topic, generated from the course's OWN uploaded material and cached on
// the Topic row — one AI call per topic, ever.
import { prisma } from "./prisma.js";
import { explainTopic } from "./aiMeter.js";
import { formatConceptContext, toConceptView } from "./knowledgeLayer.js";
import type { TopicBreakdown } from "../ai/types.js";

const MATERIAL_CAP = 14_000;

/**
 * The course's own material as grounding text. Uploads already store their
 * extracted text (including vision transcriptions of photos), so this is a
 * read, not a re-parse.
 */
async function gatherMaterialText(courseId: string): Promise<string> {
  const uploads = await prisma.upload.findMany({
    where: { courseId, status: "processed", extractedText: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { filename: true, extractedText: true },
  });

  let combined = "";
  for (const upload of uploads) {
    if (combined.length >= MATERIAL_CAP) break;
    combined += `\n\n--- From ${upload.filename} ---\n${upload.extractedText}`;
  }
  return combined.slice(0, MATERIAL_CAP);
}

export interface BreakdownResult {
  breakdown: TopicBreakdown;
  cached: boolean;
  topicName: string;
  courseId: string;
  courseName: string;
}

/**
 * Cached breakdown for a topic, generating (and storing) it on first
 * request. Ownership is enforced here. Null when generation failed.
 */
export async function getOrCreateBreakdown(
  userId: string,
  topicId: string
): Promise<BreakdownResult | null> {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, knowledgeMap: { course: { userId } } },
    include: {
      knowledgeMap: {
        select: { course: { select: { id: true, name: true } } },
      },
    },
  });
  if (!topic) return null;
  const course = topic.knowledgeMap.course;

  if (topic.breakdownJson) {
    try {
      return {
        breakdown: JSON.parse(topic.breakdownJson) as TopicBreakdown,
        cached: true,
        topicName: topic.name,
        courseId: course.id,
        courseName: course.name,
      };
    } catch {
      // Corrupt cache — fall through and regenerate.
    }
  }

  const conceptContext = formatConceptContext(toConceptView(topic));
  const materialText = await gatherMaterialText(course.id);
  const breakdown = await explainTopic(
    userId,
    course.name,
    topic.name,
    conceptContext,
    materialText
  );
  if (!breakdown) return null;

  await prisma.topic.update({
    where: { id: topic.id },
    data: {
      breakdownJson: JSON.stringify(breakdown),
      breakdownAt: new Date(),
    },
  });

  return {
    breakdown,
    cached: false,
    topicName: topic.name,
    courseId: course.id,
    courseName: course.name,
  };
}
