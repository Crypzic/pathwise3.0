// Monetization API (Step 13).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { verifyStripeSignature } from "../lib/stripeSignature.js";
import { env } from "../lib/env.js";
import {
  billing,
  PLANS,
  activatePremium,
  revertToFree,
  entitlementsFor,
  type PlanInterval,
} from "../lib/billing.js";
import { track } from "../lib/analytics.js";

const checkoutSchema = z.object({
  interval: z.enum(["monthly", "annual"]),
});

export default async function billingRoutes(app: FastifyInstance) {
  // Plans + this user's current entitlements, for the upgrade screen.
  app.get("/api/billing/plans", { preHandler: [app.authenticate] }, async (req, reply) => {
    const entitlements = await entitlementsFor(req.user.sub);
    const sub = await prisma.subscription.findUnique({
      where: { userId: req.user.sub },
    });

    await track(req.user.sub, "upgrade_viewed", {});

    return reply.send({
      plans: PLANS,
      provider: billing.name,
      entitlements,
      subscription: {
        tier: sub?.tier ?? "free",
        interval: sub?.interval ?? null,
        status: sub?.status ?? "active",
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      },
    });
  });

  // Start checkout. Returns a URL to redirect to (Stripe Checkout, or the
  // in-app mock confirmation).
  app.post("/api/billing/checkout", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Pick a monthly or annual plan." });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.code(404).send({ error: "User not found" });

    // A guest has a synthetic email and expiring data — money must never be
    // attached to that (PATHWISE 2.0 Phase 1). Claim an account first.
    if (user.isGuest) {
      return reply.code(403).send({
        error: "guest_not_allowed",
        message: "Create your free account first — then you can upgrade.",
      });
    }

    try {
      const session = await billing.createCheckout(
        user.id,
        user.email,
        parsed.data.interval
      );
      await track(user.id, "checkout_started", {
        interval: parsed.data.interval,
        provider: billing.name,
      });
      return reply.send(session);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't start checkout.";
      return reply.code(502).send({ error: message });
    }
  });

  // Mock-only completion, so the upgrade flow is testable end-to-end without
  // Stripe. Refuses to run when a real provider is configured — otherwise it
  // would be a free-premium endpoint.
  app.post(
    "/api/billing/mock/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (billing.name !== "mock") {
        return reply.code(403).send({ error: "Not available with a live payment provider." });
      }
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }
      await activatePremium(req.user.sub, parsed.data.interval, {
        provider: "mock",
      });
      const entitlements = await entitlementsFor(req.user.sub);
      return reply.send({ ok: true, entitlements });
    }
  );

  // Cancel. Stripe cancels at period end; mock reverts immediately.
  app.post("/api/billing/cancel", { preHandler: [app.authenticate] }, async (req, reply) => {
    const sub = await prisma.subscription.findUnique({
      where: { userId: req.user.sub },
    });
    if (!sub || sub.tier !== "premium") {
      return reply.code(400).send({ error: "You're not on a paid plan." });
    }

    await billing.cancel(req.user.sub);
    const entitlements = await entitlementsFor(req.user.sub);
    return reply.send({ ok: true, entitlements });
  });

  // Stripe webhook. Registered with a raw-body parser because signature
  // verification runs over the exact bytes Stripe sent — a re-serialized JSON
  // object won't match.
  app.post(
    "/api/billing/webhook",
    {
      config: { rateLimit: { max: 200, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const raw = (req as unknown as { rawBody?: string }).rawBody;
      const signature = req.headers["stripe-signature"];

      if (!env.STRIPE_WEBHOOK_SECRET) {
        return reply.code(503).send({ error: "Webhooks are not configured." });
      }
      if (typeof raw !== "string" || typeof signature !== "string") {
        return reply.code(400).send({ error: "Missing signature or body." });
      }
      if (!verifyStripeSignature(raw, signature, env.STRIPE_WEBHOOK_SECRET)) {
        return reply.code(400).send({ error: "Invalid signature." });
      }

      let event: StripeEvent;
      try {
        event = JSON.parse(raw) as StripeEvent;
      } catch {
        return reply.code(400).send({ error: "Malformed payload." });
      }

      const obj = event.data?.object ?? {};

      switch (event.type) {
        case "checkout.session.completed": {
          const userId =
            obj.client_reference_id ?? obj.metadata?.userId ?? null;
          const interval = (obj.metadata?.interval ?? "monthly") as PlanInterval;
          if (userId) {
            await activatePremium(userId, interval, {
              provider: "stripe",
              externalId: obj.subscription ?? undefined,
              customerId: obj.customer ?? undefined,
            });
          }
          break;
        }

        case "customer.subscription.updated": {
          // Renewal, plan change, or a scheduled cancellation.
          const sub = await prisma.subscription.findFirst({
            where: { externalId: obj.id ?? "__none__" },
          });
          if (sub) {
            const active = obj.status === "active" || obj.status === "trialing";
            await prisma.subscription.update({
              where: { id: sub.id },
              data: {
                tier: active ? "premium" : "free",
                status: obj.status ?? sub.status,
                cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
                currentPeriodEnd: obj.current_period_end
                  ? new Date(obj.current_period_end * 1000)
                  : sub.currentPeriodEnd,
              },
            });
          }
          break;
        }

        case "customer.subscription.deleted": {
          const sub = await prisma.subscription.findFirst({
            where: { externalId: obj.id ?? "__none__" },
          });
          if (sub) await revertToFree(sub.userId);
          break;
        }

        case "invoice.payment_failed": {
          const sub = await prisma.subscription.findFirst({
            where: { externalId: obj.subscription ?? "__none__" },
          });
          if (sub) {
            // Don't yank access on the first failure — Stripe retries.
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { status: "past_due" },
            });
          }
          break;
        }

        default:
          // Unhandled event types are acknowledged, not errored — otherwise
          // Stripe retries them forever.
          break;
      }

      return reply.send({ received: true });
    }
  );
}

interface StripeEvent {
  type: string;
  data?: {
    object?: {
      id?: string;
      status?: string;
      customer?: string;
      subscription?: string;
      client_reference_id?: string;
      cancel_at_period_end?: boolean;
      current_period_end?: number;
      metadata?: { userId?: string; interval?: string };
    };
  };
}
