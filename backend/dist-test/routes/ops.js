import { prisma } from "../lib/prisma.js";
import { usageSummary } from "../lib/aiMeter.js";
import { funnel } from "../lib/analytics.js";
import { opsAuthorized as authorized } from "../lib/opsAuth.js";
export default async function opsRoutes(app) {
    app.get("/api/ops/metrics", async (req, reply) => {
        if (!authorized(req.headers["x-cron-secret"])) {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        const days = Number(req.query.days ?? 7);
        const window = Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : 7;
        const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
        const [aiByOperation, activation, totals, guardTrips, socraticSessions] = await Promise.all([
            usageSummary(window),
            funnel(window),
            prisma.aIUsage.aggregate({
                where: { createdAt: { gte: since } },
                _sum: { costMicroUsd: true },
                _count: { _all: true },
            }),
            prisma.socraticSession.aggregate({
                where: { createdAt: { gte: since } },
                _sum: { guardTrips: true, turnCount: true },
            }),
            prisma.socraticSession.count({ where: { createdAt: { gte: since } } }),
        ]);
        const totalTurns = guardTrips._sum.turnCount ?? 0;
        const trips = guardTrips._sum.guardTrips ?? 0;
        return reply.send({
            windowDays: window,
            ai: {
                totalCostUsd: Number(((totals._sum.costMicroUsd ?? 0) / 1_000_000).toFixed(4)),
                calls: totals._count._all,
                byOperation: aiByOperation,
            },
            activation,
            // Step 7's health metric: how often the leak guard has to intervene.
            // A rising rate means the prompt is degrading.
            socratic: {
                sessions: socraticSessions,
                turns: totalTurns,
                guardTrips: trips,
                guardTripRate: totalTurns > 0 ? Number((trips / totalTurns).toFixed(4)) : 0,
            },
        });
    });
}
