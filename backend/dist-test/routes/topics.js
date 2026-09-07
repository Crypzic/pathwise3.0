import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getOrCreateBreakdown } from "../lib/breakdown.js";
import { getConceptContext } from "../lib/knowledgeLayer.js";
import { askReply, AIBudgetExceededError } from "../lib/aiMeter.js";
import { track } from "../lib/analytics.js";
const askSchema = z.object({
    messages: z
        .array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
    }))
        .min(1)
        .max(12),
});
export default async function topicRoutes(app) {
    // The breakdown. First call generates and caches; later calls are free.
    app.get("/api/topics/:id/breakdown", {
        preHandler: [app.authenticate],
        config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    }, async (req, reply) => {
        const { id } = req.params;
        try {
            const result = await getOrCreateBreakdown(req.user.sub, id);
            if (!result) {
                return reply.code(404).send({
                    error: "Couldn't build a breakdown for this topic right now — try again shortly.",
                });
            }
            if (!result.cached) {
                await track(req.user.sub, "breakdown_generated", { topicId: id });
            }
            return reply.send(result);
        }
        catch (err) {
            if (err instanceof AIBudgetExceededError) {
                return reply.code(429).send({ error: err.message });
            }
            throw err;
        }
    });
    // Ask PATHWISE, on the topic page. Explanatory mode — grounded in the
    // concept AND the cached breakdown, so answers match what they're reading.
    app.post("/api/topics/:id/ask", {
        preHandler: [app.authenticate],
        config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
    }, async (req, reply) => {
        const { id } = req.params;
        const parsed = askSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "Invalid conversation" });
        }
        const topic = await prisma.topic.findFirst({
            where: { id, knowledgeMap: { course: { userId: req.user.sub } } },
            include: {
                knowledgeMap: { select: { course: { select: { name: true } } } },
            },
        });
        if (!topic)
            return reply.code(404).send({ error: "Topic not found" });
        const conceptContext = (await getConceptContext(req.user.sub, id)) ?? `Topic: ${topic.name}`;
        let grounding = conceptContext;
        if (topic.breakdownJson) {
            try {
                const b = JSON.parse(topic.breakdownJson);
                grounding += `\n\nBreakdown overview: ${b.overview}\nBreakdown summary: ${b.summary}`;
            }
            catch {
                // Grounding is best-effort.
            }
        }
        try {
            const replyText = await askReply(req.user.sub, topic.knowledgeMap.course.name, topic.name, parsed.data.messages, grounding);
            await track(req.user.sub, "topic_asked", { topicId: id });
            return reply.send({ reply: replyText });
        }
        catch (err) {
            if (err instanceof AIBudgetExceededError) {
                return reply.code(429).send({ error: err.message });
            }
            throw err;
        }
    });
}
