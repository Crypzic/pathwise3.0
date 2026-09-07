// Quiz generation (Step 5 items 1-2).
//
// Difficulty is fixed per question — no adaptive difficulty, which the build
// plan explicitly defers. What *is* adaptive is topic selection: which topics
// get asked about, and how many questions each gets.
import { prisma } from "./prisma.js";
import { generateQuiz, generateWrittenQuestions } from "./aiMeter.js";
import { env } from "./env.js";
import { topicsWithMastery, isDue } from "./mastery.js";
import { allocateQuestions } from "./planning.js";

export type QuizKind = "practice" | "review" | "weakest";

export { topicPriority, allocateQuestions } from "./planning.js";

/**
 * Shuffle a question's options, tracking where the correct one lands.
 *
 * The generator is instructed to randomise answer positions, but language
 * models cluster them anyway — and a quiz where "B" is usually right teaches
 * pattern-matching, not the material. Shuffling server-side makes the
 * distribution a property of this code instead of the model's mood.
 */
export function shuffleOptions(
  options: string[],
  correctIndex: number
): { options: string[]; correctIndex: number } {
  const indexed = options.map((text, i) => ({ text, wasCorrect: i === correctIndex }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  return {
    options: indexed.map((o) => o.text),
    correctIndex: indexed.findIndex((o) => o.wasCorrect),
  };
}

export interface BuiltQuiz {
  sessionId: string;
  kind: QuizKind;
  total: number;
}

/**
 * Build a quiz session for a course. `kind` narrows the candidate topics:
 *   - "practice": everything, priority-ordered
 *   - "review":   only topics the scheduler says are due
 *   - "weakest":  only the lowest-mastery topics
 */
export async function buildQuizSession(
  userId: string,
  courseId: string,
  opts: { kind?: QuizKind; count?: number; topicId?: string } = {}
): Promise<BuiltQuiz> {
  const kind = opts.kind ?? "practice";
  const count = Math.min(
    env.QUIZ_MAX_LENGTH,
    Math.max(1, opts.count ?? env.QUIZ_DEFAULT_LENGTH)
  );

  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
  });
  if (!course) throw new Error("Course not found");

  const all = await topicsWithMastery(userId, courseId);
  if (all.length === 0) {
    throw new Error(
      "This course has no topics yet — upload some material first."
    );
  }

  const now = new Date();
  let candidates = all;
  if (opts.topicId) {
    candidates = all.filter((t) => t.id === opts.topicId);
  } else if (kind === "review") {
    candidates = all.filter((t) => isDue(t.dueAt, now));
  } else if (kind === "weakest") {
    candidates = [...all].sort((a, b) => a.mastery - b.mastery).slice(0, 3);
  }
  // Falling back to everything keeps "review" usable when nothing is due yet.
  if (candidates.length === 0) candidates = all;

  const allocation = allocateQuestions(candidates, count, now);

  const questions = await generateQuiz(
    userId,
    course.name,
    allocation.map((a) => ({
      name: a.topic.name,
      weight: a.topic.weight,
      // Knowledge Layer 2.0: the course's own documented misconceptions
      // become the distractors; difficulty tunes the question's pitch.
      ...(a.topic.difficulty != null ? { difficulty: a.topic.difficulty } : {}),
      ...(a.topic.misconceptions && a.topic.misconceptions.length > 0
        ? { misconceptions: a.topic.misconceptions }
        : {}),
    })),
    count
  );
  if (questions.length === 0) {
    throw new Error("Couldn't generate questions for this course right now.");
  }

  // Phase 2: written-answer questions on the quiz's strongest-priority
  // topics. Best-effort — a failed written generation never sinks the quiz.
  let written: Awaited<ReturnType<typeof generateWrittenQuestions>> = [];
  if (env.QUIZ_WRITTEN_COUNT > 0) {
    try {
      written = await generateWrittenQuestions(
        userId,
        course.name,
        allocation.slice(0, 3).map((a) => ({
          name: a.topic.name,
          weight: a.topic.weight,
        })),
        env.QUIZ_WRITTEN_COUNT
      );
    } catch {
      written = [];
    }
  }

  // Map each generated question back to a real topic id by name, so grading
  // can update the right mastery row. Anything unmatched falls to the
  // highest-priority topic rather than being dropped.
  const byName = new Map(
    candidates.map((t) => [t.name.trim().toLowerCase(), t.id])
  );
  const fallbackTopicId = allocation[0]?.topic.id ?? candidates[0].id;

  const session = await prisma.quizSession.create({
    data: {
      userId,
      courseId,
      kind,
      items: {
        create: [
          ...questions.map((q, i) => {
            // Server-side shuffle — see shuffleOptions for why the model
            // isn't trusted with answer-position randomness.
            const shuffled = shuffleOptions(q.options, q.correctIndex);
            return {
              position: i,
              topicId:
                byName.get(q.topicName.trim().toLowerCase()) ?? fallbackTopicId,
              topicName: q.topicName,
              question: q.question,
              optionsJson: JSON.stringify(shuffled.options),
              correctIndex: shuffled.correctIndex,
              explanation: q.explanation,
            };
          }),
          ...written.map((w, i) => ({
            position: questions.length + i,
            kind: "written",
            topicId:
              byName.get(w.topicName.trim().toLowerCase()) ?? fallbackTopicId,
            topicName: w.topicName,
            question: w.question,
            optionsJson: "[]",
            correctIndex: 0,
            referenceAnswer: w.referenceAnswer,
            explanation: w.explanation,
          })),
        ],
      },
    },
  });

  return { sessionId: session.id, kind, total: questions.length + written.length };
}
