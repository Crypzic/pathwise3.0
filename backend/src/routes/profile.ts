// Profile (Step 10) — editable details, notification toggles, rank-gated
// unlocks, and account deletion with a 30-day recovery window.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { rankFor, RANKS } from "../lib/gamification.js";
import { referralStatus } from "../lib/referrals.js";
import { track } from "../lib/analytics.js";
import type { UserBadge, Badge } from "@prisma/client";

const RECOVERY_WINDOW_DAYS = 30;

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscores only")
    .optional(),
  email: z.string().email().optional(),
  timezone: z.string().max(64).optional(),
  notifyStreak: z.boolean().optional(),
  notifyReviewDue: z.boolean().optional(),
  notifyUnlocks: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  notifyHour: z.number().int().min(0).max(23).optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

const deleteSchema = z.object({
  password: z.string().min(1),
});

// Rank-gated cosmetic unlocks (Step 10 item 2). Frames are earned, never
// bought — that's what keeps them meaningful.
const PROFILE_FRAMES = [
  { key: "frame_leaf", name: "Leaf Frame", requiredLevel: 1 },
  { key: "frame_bloom", name: "Bloom Frame", requiredLevel: 3 },
  { key: "frame_lantern", name: "Lantern Frame", requiredLevel: 4 },
  { key: "frame_constellation", name: "Constellation Frame", requiredLevel: 6 },
  { key: "frame_aurora", name: "Aurora Frame", requiredLevel: 8 },
] as const;

export default async function profileRoutes(app: FastifyInstance) {
  // Everything the Profile screen needs in one read.
  app.get("/api/profile", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: {
        subscription: true,
        badges: { include: { badge: true }, orderBy: { earnedAt: "desc" } },
        companion: true,
      },
    });
    if (!user || user.deletedAt) {
      return reply.code(404).send({ error: "User not found" });
    }

    const rank = rankFor(user.xp);
    const referral = await referralStatus(user.id, env.APP_URL);

    return reply.send({
      profile: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        timezone: user.timezone,
        createdAt: user.createdAt,
      },
      notifications: {
        streak: user.notifyStreak,
        reviewDue: user.notifyReviewDue,
        unlocks: user.notifyUnlocks,
        email: user.notifyEmail,
        hour: user.notifyHour,
      },
      progress: {
        xp: user.xp,
        rank,
        streakCount: user.streakCount,
        bestStreak: user.bestStreak,
        streakFreezes: user.streakFreezes,
        gardenXp: user.gardenXp,
      },
      subscription: {
        tier: user.subscription?.tier ?? "free",
        interval: user.subscription?.interval ?? null,
        status: user.subscription?.status ?? "active",
        currentPeriodEnd: user.subscription?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: user.subscription?.cancelAtPeriodEnd ?? false,
      },
      badges: user.badges.map((ub: UserBadge & { badge: Badge }) => ({
        key: ub.badge.key,
        name: ub.badge.name,
        description: ub.badge.description,
        icon: ub.badge.icon,
        earnedAt: ub.earnedAt,
      })),
      // Locked items come back too, with their requirement, so the UI can show
      // what's next rather than hiding it.
      frames: PROFILE_FRAMES.map((f) => ({
        ...f,
        unlocked: rank.level >= f.requiredLevel,
      })),
      ranks: RANKS.map((r) => ({ ...r, reached: user.xp >= r.minXp })),
      referral,
      companion: user.companion
        ? {
            name: user.companion.name,
            growth: user.companion.growth,
            equipped: JSON.parse(user.companion.equippedJson) as string[],
          }
        : null,
    });
  });

  // Edit details + notification toggles.
  app.patch("/api/profile", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    // Guests change their email by claiming an account (POST /api/auth/claim),
    // not here — otherwise a guest could hold a real address hostage while
    // its row is still scheduled to expire (PATHWISE 2.0 Phase 1).
    if (data.email) {
      const me = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { isGuest: true },
      });
      if (me?.isGuest) {
        return reply.code(403).send({
          error: "guest_not_allowed",
          message: "Create your free account to set an email address.",
        });
      }
    }

    // Uniqueness is checked up front so the client gets a readable message
    // rather than a Prisma constraint error.
    if (data.email) {
      const taken = await prisma.user.findFirst({
        where: { email: data.email, id: { not: req.user.sub } },
      });
      if (taken) {
        return reply.code(409).send({ error: "That email is already in use." });
      }
    }
    if (data.username) {
      const taken = await prisma.user.findFirst({
        where: { username: data.username, id: { not: req.user.sub } },
      });
      if (taken) {
        return reply.code(409).send({ error: "That username is taken." });
      }
    }

    const user = await prisma.user.update({
      where: { id: req.user.sub },
      data,
    });

    return reply.send({
      profile: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        timezone: user.timezone,
      },
      notifications: {
        streak: user.notifyStreak,
        reviewDue: user.notifyReviewDue,
        unlocks: user.notifyUnlocks,
        email: user.notifyEmail,
        hour: user.notifyHour,
      },
    });
  });

  // Change password — requires the current one even though the user is signed
  // in, so a hijacked session can't lock the owner out.
  app.post(
    "/api/profile/password",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const parsed = passwordSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "New password must be at least 8 characters." });
      }
      const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
      if (!user) return reply.code(404).send({ error: "User not found" });

      const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
      if (!ok) {
        return reply.code(401).send({ error: "Current password is incorrect." });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(parsed.data.newPassword) },
      });
      return reply.send({ message: "Password updated." });
    }
  );

  // Soft delete (Step 10 item 3). Data is retained for 30 days so an
  // accidental or regretted deletion is recoverable; a maintenance job hard
  // deletes once purgeAfter passes.
  app.post(
    "/api/profile/delete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const parsed = deleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Password required." });
      }
      const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
      if (!user) return reply.code(404).send({ error: "User not found" });

      const ok = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!ok) return reply.code(401).send({ error: "Password is incorrect." });

      const now = new Date();
      const purgeAfter = new Date(
        now.getTime() + RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );

      await prisma.user.update({
        where: { id: user.id },
        data: { deletedAt: now, purgeAfter },
      });
      await track(user.id, "session_start", { event: "account_deleted" });

      return reply.send({
        message: `Your account is scheduled for deletion. Sign in before ${purgeAfter.toISOString().slice(0, 10)} to recover it.`,
        recoverableUntil: purgeAfter,
      });
    }
  );

  // Recovery: called with email + password during the window. Deliberately
  // unauthenticated, because a soft-deleted user can't sign in to get a token.
  app.post(
    "/api/profile/restore",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const parsed = z
        .object({ email: z.string().email(), password: z.string().min(1) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }

      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
      });
      // Same generic message either way — don't confirm which emails exist.
      const generic = {
        error: "That account can't be restored.",
      };
      if (!user || !user.deletedAt) return reply.code(400).send(generic);
      if (user.purgeAfter && user.purgeAfter < new Date()) {
        return reply.code(400).send(generic);
      }

      const ok = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!ok) return reply.code(400).send(generic);

      await prisma.user.update({
        where: { id: user.id },
        data: { deletedAt: null, purgeAfter: null },
      });

      const token = app.jwt.sign({ sub: user.id, email: user.email });
      return reply.send({ token, message: "Welcome back — your account is restored." });
    }
  );

  // Data export (Step 15 item 3 / GDPR access request). Everything we hold on
  // the requesting user, as JSON.
  app.get("/api/profile/export", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: {
        subscription: true,
        badges: { include: { badge: true } },
        companion: true,
        inventory: { include: { item: true } },
        courses: {
          include: {
            uploads: {
              select: {
                filename: true,
                sizeBytes: true,
                status: true,
                createdAt: true,
              },
            },
            knowledgeMap: { include: { topics: true } },
          },
        },
        masteries: true,
        quizSessions: { include: { items: true } },
        socraticSessions: { include: { messages: true } },
      },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });

    const { passwordHash: _passwordHash, resetTokenHash: _resetTokenHash, ...safe } = user;
    void _passwordHash;
    void _resetTokenHash;

    reply.header(
      "Content-Disposition",
      `attachment; filename="pathwise-export-${user.id}.json"`
    );
    return reply.send({ exportedAt: new Date(), data: safe });
  });
}
