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
import { ai } from "../ai/index.js";
/** Raised when a user has burned through their daily AI budget. */
export class AIBudgetExceededError extends Error {
    spentCents;
    constructor(spentCents) {
        super("Daily AI limit reached for this account. It resets at midnight UTC.");
        this.spentCents = spentCents;
        this.name = "AIBudgetExceededError";
    }
}
function microUsdFor(usage) {
    const inputUsd = (usage.promptTokens / 1_000_000) * env.AI_PRICE_INPUT_PER_MTOK;
    const outputUsd = (usage.completionTokens / 1_000_000) * env.AI_PRICE_OUTPUT_PER_MTOK;
    return Math.round((inputUsd + outputUsd) * 1_000_000);
}
function startOfUtcDay() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
/** Total micro-USD this user has spent on AI since midnight UTC. */
export async function spentTodayMicroUsd(userId) {
    const agg = await prisma.aIUsage.aggregate({
        where: { userId, createdAt: { gte: startOfUtcDay() } },
        _sum: { costMicroUsd: true },
    });
    return agg._sum.costMicroUsd ?? 0;
}
async function assertWithinBudget(userId) {
    if (!userId)
        return;
    // The mock provider is free — never gate it.
    if (ai.name === "mock")
        return;
    // Guests get a tighter daily ceiling (PATHWISE 2.0 Phase 1).
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isGuest: true },
    });
    const budgetCents = user?.isGuest && env.GUEST_AI_DAILY_BUDGET_CENTS > 0
        ? env.GUEST_AI_DAILY_BUDGET_CENTS
        : env.AI_DAILY_USER_BUDGET_CENTS;
    if (budgetCents <= 0)
        return;
    const spent = await spentTodayMicroUsd(userId);
    const capMicro = budgetCents * 10_000; // cents -> micro-USD
    if (spent >= capMicro) {
        throw new AIBudgetExceededError(Math.round(spent / 10_000));
    }
}
/**
 * Run an AI call, recording tokens/cost/duration whether it succeeds or not.
 */
async function meter(operation, userId, run) {
    await assertWithinBudget(userId);
    const startedAt = Date.now();
    let usage = {
        model: env.AI_PROVIDER === "openai"
            ? env.OPENAI_MODEL
            : env.AI_PROVIDER === "gemini"
                ? env.GEMINI_MODEL
                : "mock",
        promptTokens: 0,
        completionTokens: 0,
    };
    let ok = true;
    let error = null;
    try {
        const result = await run();
        usage = result.usage;
        return result.value;
    }
    catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
        throw err;
    }
    finally {
        // Never let a logging failure break the request that earned the money.
        void prisma.aIUsage
            .create({
            data: {
                userId,
                provider: ai.name,
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
            .catch((e) => {
            console.error("⚠️  Failed to record AI usage:", e);
        });
    }
}
// --- Metered wrappers around every AI capability ----------------------------
export function extractTopics(userId, courseName, materialText, documentInput) {
    return meter("extract_topics", userId, () => ai.extractTopics(courseName, materialText, documentInput));
}
export function generateQuiz(userId, courseName, topics, count) {
    return meter("generate_quiz", userId, () => ai.generateQuiz(courseName, topics, count));
}
export function socraticReply(userId, courseName, topicName, history, ctx) {
    return meter("socratic_reply", userId, () => ai.socraticReply(courseName, topicName, history, ctx));
}
export function classifyMaterial(userId, courseName, materialText) {
    return meter("moderate", userId, () => ai.classifyMaterial(courseName, materialText));
}
export function evaluateCommunityPost(userId, communityName, title, body) {
    return meter("evaluate_community_post", userId, () => ai.evaluateCommunityPost(communityName, title, body));
}
export function transcribeImage(userId, courseName, image) {
    return meter("transcribe_image", userId, () => ai.transcribeImage(courseName, image));
}
// --- Learning layer -------------------------------------------------------
export function explainTopic(userId, courseName, topicName, conceptContext, materialText) {
    return meter("explain_topic", userId, () => ai.explainTopic(courseName, topicName, conceptContext, materialText));
}
export function askReply(userId, courseName, topicName, history, grounding) {
    return meter("ask_reply", userId, () => ai.askReply(courseName, topicName, history, grounding));
}
export function generateWrittenQuestions(userId, courseName, topics, count) {
    return meter("written_questions", userId, () => ai.generateWrittenQuestions(courseName, topics, count));
}
export function gradeWrittenAnswer(userId, question, referenceAnswer, studentAnswer) {
    return meter("grade_written", userId, () => ai.gradeWrittenAnswer(question, referenceAnswer, studentAnswer));
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
