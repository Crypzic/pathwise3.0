// Billing provider abstraction (Step 13).
//
// Same pattern as the AI and email providers: "mock" lets the full
// upgrade -> premium -> cancel -> revert loop be exercised (and tested) with no
// Stripe account, "stripe" does it for real. Premium gating logic never has to
// know which is active.
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { track } from "./analytics.js";

export type PlanInterval = "monthly" | "annual";

export interface Plan {
  interval: PlanInterval;
  priceCents: number;
  label: string;
  /** Percent saved vs paying monthly for a year — 0 for the monthly plan. */
  savingsPct: number;
}

// The annual plan is the discounted one (Step 13 item 2).
const MONTHLY_CENTS = 599;
const ANNUAL_CENTS = 4990; // ~$4.16/mo

export const PLANS: Plan[] = [
  {
    interval: "monthly",
    priceCents: MONTHLY_CENTS,
    label: "Monthly",
    savingsPct: 0,
  },
  {
    interval: "annual",
    priceCents: ANNUAL_CENTS,
    label: "Annual",
    savingsPct: Math.round((1 - ANNUAL_CENTS / (MONTHLY_CENTS * 12)) * 100),
  },
];

export interface CheckoutSession {
  /** Where to send the browser. The mock provider returns an internal URL. */
  url: string;
  /** True when no real payment will be taken. */
  mock: boolean;
}

export interface BillingProvider {
  readonly name: string;
  createCheckout(
    userId: string,
    email: string,
    interval: PlanInterval
  ): Promise<CheckoutSession>;
  cancel(userId: string): Promise<void>;
}

function periodEnd(interval: PlanInterval, from = new Date()): Date {
  const d = new Date(from);
  if (interval === "annual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Flip a user to premium. Shared by both providers and the webhook. */
export async function activatePremium(
  userId: string,
  interval: PlanInterval,
  opts: { provider: string; externalId?: string; customerId?: string } = {
    provider: "mock",
  }
): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      tier: "premium",
      interval,
      status: "active",
      provider: opts.provider,
      externalId: opts.externalId ?? null,
      customerId: opts.customerId ?? null,
      currentPeriodEnd: periodEnd(interval),
      cancelAtPeriodEnd: false,
    },
    update: {
      tier: "premium",
      interval,
      status: "active",
      provider: opts.provider,
      externalId: opts.externalId ?? undefined,
      customerId: opts.customerId ?? undefined,
      currentPeriodEnd: periodEnd(interval),
      cancelAtPeriodEnd: false,
    },
  });
  await track(userId, "premium_activated", { interval, provider: opts.provider });
}

/**
 * Revert to free. Called on cancellation at period end, or on a failed renewal.
 *
 * Courses over the free cap are NOT deleted — they become read-only, which the
 * course-cap check enforces by blocking new courses rather than removing old
 * ones. Deleting a student's uploaded material because a card expired would be
 * indefensible.
 */
export async function revertToFree(userId: string): Promise<void> {
  await prisma.subscription.update({
    where: { userId },
    data: {
      tier: "free",
      interval: null,
      status: "canceled",
      cancelAtPeriodEnd: false,
    },
  });
  await track(userId, "premium_canceled", {});
}

// --- Mock provider ---------------------------------------------------------

class MockBillingProvider implements BillingProvider {
  readonly name = "mock";

  async createCheckout(
    userId: string,
    _email: string,
    interval: PlanInterval
  ): Promise<CheckoutSession> {
    void _email;
    // No payment is taken. The frontend calls /api/billing/mock/complete to
    // finish, which keeps the "real test payment" path identical in shape.
    return {
      url: `${env.APP_URL}/upgrade?mock_checkout=${interval}&uid=${userId}`,
      mock: true,
    };
  }

  async cancel(userId: string): Promise<void> {
    // Mock cancellation is immediate so the revert path is easy to verify.
    await revertToFree(userId);
  }
}

// --- Stripe provider -------------------------------------------------------

class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe";

  private priceFor(interval: PlanInterval): string {
    return interval === "annual"
      ? env.STRIPE_PRICE_ANNUAL
      : env.STRIPE_PRICE_MONTHLY;
  }

  // Stripe's SDK isn't a dependency yet — calling its REST API directly keeps
  // the install lean and the request shape obvious. Swap in the SDK if the
  // billing surface grows.
  private async post(
    path: string,
    body: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = json.error as { message?: string } | undefined;
      throw new Error(err?.message ?? `Stripe request failed (${res.status})`);
    }
    return json;
  }

  async createCheckout(
    userId: string,
    email: string,
    interval: PlanInterval
  ): Promise<CheckoutSession> {
    const price = this.priceFor(interval);
    if (!price) {
      throw new Error(
        `No Stripe price configured for the ${interval} plan (set STRIPE_PRICE_${interval.toUpperCase()}).`
      );
    }

    const session = await this.post("checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      customer_email: email,
      client_reference_id: userId,
      "metadata[userId]": userId,
      "metadata[interval]": interval,
      success_url: `${env.APP_URL}/upgrade?status=success`,
      cancel_url: `${env.APP_URL}/upgrade?status=canceled`,
    });

    return { url: String(session.url), mock: false };
  }

  async cancel(userId: string): Promise<void> {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub?.externalId) {
      // Nothing to cancel upstream — just reflect it locally.
      await revertToFree(userId);
      return;
    }

    // Cancel at period end: the student keeps what they paid for.
    await this.post(`subscriptions/${sub.externalId}`, {
      cancel_at_period_end: "true",
    });
    await prisma.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true },
    });
  }
}

function createProvider(): BillingProvider {
  if (env.BILLING_PROVIDER === "stripe") {
    if (!env.STRIPE_SECRET_KEY) {
      console.warn(
        "⚠️  BILLING_PROVIDER=stripe but STRIPE_SECRET_KEY is empty — falling back to mock."
      );
      return new MockBillingProvider();
    }
    return new StripeBillingProvider();
  }
  return new MockBillingProvider();
}

export const billing: BillingProvider = createProvider();

// --- Premium gating --------------------------------------------------------

export interface Entitlements {
  isPremium: boolean;
  courseCap: number | null; // null = unlimited
  /** Days of history the analytics screens may show. null = unlimited. */
  analyticsHistoryDays: number | null;
  premiumCosmetics: boolean;
}

const FREE_ANALYTICS_HISTORY_DAYS = 14;

export async function entitlementsFor(userId: string): Promise<Entitlements> {
  // Guests get the tightest tier of all — they exist to sample the core
  // loop, not to be a free plan (PATHWISE 2.0 Phase 1).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isGuest: true },
  });
  if (user?.isGuest) {
    return {
      isPremium: false,
      courseCap: env.GUEST_COURSE_CAP,
      analyticsHistoryDays: FREE_ANALYTICS_HISTORY_DAYS,
      premiumCosmetics: false,
    };
  }

  const sub = await prisma.subscription.findUnique({ where: { userId } });

  // A canceled-but-still-paid subscription keeps its benefits until the period
  // actually ends.
  const stillPaid =
    sub?.tier === "premium" &&
    (sub.status === "active" ||
      (sub.currentPeriodEnd !== null && sub.currentPeriodEnd > new Date()));

  if (stillPaid) {
    return {
      isPremium: true,
      courseCap: null,
      analyticsHistoryDays: null,
      premiumCosmetics: true,
    };
  }

  return {
    isPremium: false,
    courseCap: env.FREE_COURSE_CAP,
    analyticsHistoryDays: FREE_ANALYTICS_HISTORY_DAYS,
    premiumCosmetics: false,
  };
}
