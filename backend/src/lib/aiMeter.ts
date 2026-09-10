// AI usage + cost metering (Step 1 item 6).
//
// The AI pipeline is the only part of Pathwise that costs real money per use,
// so every call goes through here: token counts and estimated cost land in the
// AIUsage table, and a per-user daily budget stops a runaway loop (or an
// abusive account) from quietly running up a bill.
//
// Features import these wrappers, never `ai` directly — that's what keeps the
// spend ledger complete.
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { providerFor } from "../ai/index.js";
import type {
  AIProvider,
  AIResult,
  ChatMessage,
  ExtractedTopic,
  ImageInput,
  MaterialVerdict,
  QuizQuestion,
  QuizTopicInput,
  SocraticContext,
  TokenUsage,
  TopicBreakdown,
  WrittenGrade,
  WrittenQuestion,
} from "../ai/types.js";

export type AIOperation =
  | "extract_topics"
  | "generate_quiz"
  | "socratic_reply"
  | "moderate"
  // 2.0 Phase 5: image -> text, feeding the same pipeline as documents.
  | "transcribe_image"
  // Learning layer: breakdowns, Ask PATHWISE, written-answer quizzes.
  | "explain_topic"
  | "ask_reply"
  | "written_questions"
  | "grade_written"
  // Community-creation guardrail + video search intent.
  | "community_check"
  | "video_query";

/** Raised when a user has burned through their daily AI budget. */
export class AIBudgetExceededError extends Error {
  constructor(public readonly spentCents: number) {
    super("Daily AI limit reached for this account. It resets at midnight UTC.");
    this.name = "AIBudgetExceededError";
  }
}

function microUsdFor(usage: TokenUsage): number {
  const inputUsd = (usage.promptTokens / 1_000_000) * env.AI_PRICE_INPUT_PER_MTOK;
  const outputUsd =
    (usage.completionTokens / 1_000_000) * env.AI_PRICE_OUTPUT_PER_MTOK;
  return Math.round((inputUsd + outputUsd) * 1_000_000);
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

/** Total micro-USD this user has spent on AI since midnight UTC. */
export async function spentTodayMicroUsd(userId: string): Promise<number> {
  const agg = await prisma.aIUsage.aggregate({
    where: { userId, createdAt: { gte: startOfUtcDay() } },
    _sum: { costMicroUsd: true },
  });
  return agg._sum.costMicroUsd ?? 0;
}

async function assertWithinBudget(
  userId: string | null,
  provider: AIProvider
): Promise<void> {
  if (!userId) return;
  // The mock provider is free — never gate it.
  if (provider.name === "mock") return;

  // Guests get a tighter daily ceiling (PATHWISE 2.0 Phase 1).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isGuest: true },
  });
  const budgetCents =
    user?.isGuest && env.GUEST_AI_DAILY_BUDGET_CENTS > 0
      ? env.GUEST_AI_DAILY_BUDGET_CENTS
      : env.AI_DAILY_USER_BUDGET_CENTS;
  if (budgetCents <= 0) return;

  const spent = await spentTodayMicroUsd(userId);
  const capMicro = budgetCents * 10_000; // cents -> micro-USD
  if (spent >= capMicro) {
    throw new AIBudgetExceededError(Math.round(spent / 10_000));
  }
}

/**
 * Run an AI call, recording tokens/cost/duration whether it succeeds or not.
 * `provider` is the resolved (possibly route-overridden) provider handling
 * this operation — its name goes on the usage row.
 */
async function meter<T>(
  operation: AIOperation,
  userId: string | null,
  provider: AIProvider,
  run: () => Promise<AIResult<T>>
): Promise<T> {
  await assertWithinBudget(userId, provider);

  const startedAt = Date.now();
  let usage: TokenUsage = {
    // Placeholder until the call reports real usage (kept on errors).
    model: provider.name,
    promptTokens: 0,
    completionTokens: 0,
  };
  let ok = true;
  let error: string | null = null;

  try {
    const result = await run();
    usage = result.usage;
    return result.value;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // Never let a logging failure break the request that earned the money.
    void prisma.aIUsage
      .create({
        data: {
          userId,
          provider: provider.name,
          model: usage.model,
          operation,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costMicroUsd: microUsdFor(usage),
          durationMs: Date.now() - startedAt,
          ok,
          error,
        },
      })
      .catch((e: unknown) => {
        console.error("⚠️  Failed to record AI usage:", e);
      });
  }
}

// --- Metered wrappers around every AI capability ----------------------------

export function extractTopics(
  userId: string | null,
  courseName: string,
  materialText: string
): Promise<ExtractedTopic[]> {
  const p = providerFor("extract_topics");
  return meter("extract_topics", userId, p, () =>
    p.extractTopics(courseName, materialText)
  );
}

export function generateQuiz(
  userId: string | null,
  courseName: string,
  topics: QuizTopicInput[],
  count: number
): Promise<QuizQuestion[]> {
  const p = providerFor("generate_quiz");
  return meter("generate_quiz", userId, p, () =>
    p.generateQuiz(courseName, topics, count)
  );
}

export function socraticReply(
  userId: string | null,
  courseName: string,
  topicName: string | null,
  history: ChatMessage[],
  ctx?: SocraticContext
): Promise<string> {
  const p = providerFor("socratic_reply");
  return meter("socratic_reply", userId, p, () =>
    p.socraticReply(courseName, topicName, history, ctx)
  );
}

export function classifyMaterial(
  userId: string | null,
  courseName: string,
  materialText: string
): Promise<MaterialVerdict> {
  const p = providerFor("moderate");
  return meter("moderate", userId, p, () =>
    p.classifyMaterial(courseName, materialText)
  );
}

export function transcribeImage(
  userId: string | null,
  courseName: string,
  image: ImageInput
): Promise<string> {
  const p = providerFor("transcribe_image");
  return meter("transcribe_image", userId, p, () =>
    p.transcribeImage(courseName, image)
  );
}

// --- Learning layer -------------------------------------------------------

export function explainTopic(
  userId: string | null,
  courseName: string,
  topicName: string,
  conceptContext: string,
  materialText: string
): Promise<TopicBreakdown | null> {
  const p = providerFor("explain_topic");
  return meter("explain_topic", userId, p, () =>
    p.explainTopic(courseName, topicName, conceptContext, materialText)
  );
}

export function askReply(
  userId: string | null,
  courseName: string,
  topicName: string,
  history: ChatMessage[],
  grounding: string
): Promise<string> {
  const p = providerFor("ask_reply");
  return meter("ask_reply", userId, p, () =>
    p.askReply(courseName, topicName, history, grounding)
  );
}

export function generateWrittenQuestions(
  userId: string | null,
  courseName: string,
  topics: QuizTopicInput[],
  count: number
): Promise<WrittenQuestion[]> {
  const p = providerFor("written_questions");
  return meter("written_questions", userId, p, () =>
    p.generateWrittenQuestions(courseName, topics, count)
  );
}

export function gradeWrittenAnswer(
  userId: string | null,
  question: string,
  referenceAnswer: string,
  studentAnswer: string
): Promise<WrittenGrade> {
  const p = providerFor("grade_written");
  return meter("grade_written", userId, p, () =>
    p.gradeWrittenAnswer(question, referenceAnswer, studentAnswer)
  );
}

export function classifyCommunityTopic(
  userId: string | null,
  name: string,
  description: string
): Promise<{ educational: boolean; reason: string }> {
  const p = providerFor("community_check");
  return meter("community_check", userId, p, () =>
    p.classifyCommunityTopic(name, description)
  );
}

export function refineVideoQuery(
  userId: string | null,
  query: string
): Promise<string> {
  const p = providerFor("video_query");
  return meter("video_query", userId, p, () => p.refineVideoQuery(query));
}

/** Aggregate spend for the ops dashboard / cost alerting. */
export async function usageSummary(sinceDays = 7) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.aIUsage.groupBy({
    by: ["operation"],
    where: { createdAt: { gte: since } },
    _sum: { costMicroUsd: true, promptTokens: true, completionTokens: true },
    _count: { _all: true },
  });
  return rows.map((r) => ({
    operation: r.operation,
    calls: r._count._all,
    promptTokens: r._sum.promptTokens ?? 0,
    completionTokens: r._sum.completionTokens ?? 0,
    costUsd: Number(((r._sum.costMicroUsd ?? 0) / 1_000_000).toFixed(4)),
  }));
}
