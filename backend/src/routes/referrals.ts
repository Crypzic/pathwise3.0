// Referrals API (Step 14).
import type { FastifyInstance } from "fastify";
import { env } from "../lib/env.js";
import { referralStatus } from "../lib/referrals.js";
import { track } from "../lib/analytics.js";

export default async function referralRoutes(app: FastifyInstance) {
  app.get("/api/referrals", { preHandler: [app.authenticate] }, async (req, reply) => {
    const status = await referralStatus(req.user.sub, env.APP_URL);
    if (status.promptUnlocked) {
      await track(req.user.sub, "referral_prompt_shown", {});
    }
    return reply.send(status);
  });
}
