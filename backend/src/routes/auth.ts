import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { email } from "../email/index.js";
import { env } from "../lib/env.js";
import { rankFor } from "../lib/progression.js";
import { attachReferral } from "../lib/referrals.js";
import { track } from "../lib/analytics.js";
import { features } from "../lib/features.js";
import { createGuestUser } from "../lib/guests.js";
import { guestDaysLeft } from "../lib/guestPolicy.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const signupSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  timezone: z.string().optional(),
  // Present when the user arrived via an invite link (Step 14).
  referralCode: z.string().max(32).optional(),
});

const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

// Shape returned to the client — never includes the password hash.
function publicUser(
  u: {
    id: string;
    name: string;
    email: string;
    username: string | null;
    privacyAcceptedAt: Date | null;
    socraticIntroSeenAt: Date | null;
    xp: number;
    streakCount: number;
    bestStreak: number;
    isGuest: boolean;
    guestExpiresAt: Date | null;
    // Present when the caller included the learner profile (Phase 2).
    learnerProfile?: { onboardedAt: Date | null } | null;
  },
  isPremium = false
) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    privacyAccepted: u.privacyAcceptedAt !== null,
    socraticIntroSeen: u.socraticIntroSeenAt !== null,
    xp: u.xp,
    streakCount: u.streakCount,
    bestStreak: u.bestStreak,
    rank: rankFor(u.xp),
    isPremium,
    isGuest: u.isGuest,
    // What the guest banner counts down; null for real accounts.
    guestDaysLeft: u.isGuest ? guestDaysLeft(u.guestExpiresAt, new Date()) : null,
    // Whether the onboarding wizard has been finished or skipped (Phase 2).
    onboarded: Boolean(u.learnerProfile?.onboardedAt),
  };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/signup",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { name, email, password, timezone, referralCode } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "An account with that email already exists." });
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        timezone: timezone ?? "UTC",
        tosAcceptedVersion: env.TOS_VERSION,
        subscription: { create: {} }, // default free tier
        companion: { create: {} },
      },
    });

    // Records a pending referral. Nothing is paid out until the new user
    // reaches their first real milestone (Step 14 item 2).
    if (referralCode) {
      await attachReferral(user.id, referralCode);
    }
    await track(user.id, "signup", { referred: Boolean(referralCode) });

    const token = app.jwt.sign({ sub: user.id, email: user.email });
      return reply.code(201).send({ token, user: publicUser(user) });
    }
  );

  // Guest mode (PATHWISE 2.0 Phase 1): try the core loop with no account.
  // A guest is a real user row with a synthetic, un-sign-in-able identity;
  // limits are enforced on the capped routes and everything expires.
  app.post(
    "/api/auth/guest",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      if (!features.guestMode) {
        return reply.code(403).send({ error: "feature_disabled" });
      }
      const parsed = z
        .object({ timezone: z.string().max(64).optional() })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }

      const user = await createGuestUser(parsed.data.timezone);
      await track(user.id, "guest_started", {});

      // The token dies with the guest — no point outliving the data.
      const token = app.jwt.sign(
        { sub: user.id, email: user.email },
        { expiresIn: `${env.GUEST_TTL_DAYS}d` }
      );
      return reply.code(201).send({ token, user: publicUser(user) });
    }
  );

  // Claim a guest session: the guest keeps every course, quiz, mastery row
  // and streak — the row simply becomes a real account.
  app.post(
    "/api/auth/claim",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const { name, email, password, timezone, referralCode } = parsed.data;

      const me = await prisma.user.findUnique({ where: { id: req.user.sub } });
      if (!me || me.deletedAt) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (!me.isGuest) {
        return reply
          .code(409)
          .send({ error: "already_account", message: "You already have an account." });
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply
          .code(409)
          .send({ error: "An account with that email already exists." });
      }

      const user = await prisma.user.update({
        where: { id: me.id },
        data: {
          name,
          email,
          passwordHash: await hashPassword(password),
          timezone: timezone ?? me.timezone,
          isGuest: false,
          guestExpiresAt: null,
          notifyEmail: true,
          tosAcceptedVersion: env.TOS_VERSION,
        },
        include: { learnerProfile: { select: { onboardedAt: true } } },
      });

      if (referralCode) {
        await attachReferral(user.id, referralCode);
      }
      await track(user.id, "guest_claimed", { referred: Boolean(referralCode) });

      // Re-sign: the old token carries the synthetic email and guest TTL.
      const token = app.jwt.sign({ sub: user.id, email: user.email });
      return reply.send({ token, user: publicUser(user) });
    }
  );

  app.post(
    "/api/auth/signin",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
    const parsed = signinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        subscription: true,
        learnerProfile: { select: { onboardedAt: true } },
      },
    });
    if (!user) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }

    // A soft-deleted account inside its recovery window gets a pointed message
    // rather than a generic failure — the owner can still get it back.
    if (user.deletedAt) {
      const recoverable = !user.purgeAfter || user.purgeAfter > new Date();
      return reply.code(403).send({
        error: recoverable ? "account_deleted_recoverable" : "account_deleted",
        message: recoverable
          ? "This account is scheduled for deletion. You can restore it now."
          : "This account has been deleted.",
        recoverableUntil: recoverable ? user.purgeAfter : null,
      });
    }

    await track(user.id, "session_start", {});

    const token = app.jwt.sign({ sub: user.id, email: user.email });
      return reply.send({
        token,
        user: publicUser(user, user.subscription?.tier === "premium"),
      });
    }
  );

  app.get("/api/auth/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: {
        subscription: true,
        learnerProfile: { select: { onboardedAt: true } },
      },
    });
    if (!user || user.deletedAt) {
      return reply.code(404).send({ error: "User not found" });
    }
    return reply.send({
      user: publicUser(user, user.subscription?.tier === "premium"),
    });
  });

  // Records the one-time privacy statement acceptance shown right after signup.
  app.post(
    "/api/auth/accept-privacy",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = await prisma.user.update({
        where: { id: req.user.sub },
        data: {
          privacyAcceptedAt: new Date(),
          tosAcceptedVersion: env.TOS_VERSION,
        },
        include: {
          subscription: true,
          learnerProfile: { select: { onboardedAt: true } },
        },
      });
      await track(user.id, "privacy_accepted", { tosVersion: env.TOS_VERSION });
      return reply.send({
        user: publicUser(user, user.subscription?.tier === "premium"),
      });
    }
  );

  // Requests a reset link. Always returns the same generic success message —
  // whether or not the email actually exists — so this endpoint can't be used
  // to check which emails have an account (user enumeration).
  app.post(
    "/api/auth/forgot-password",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }
    const { email: toEmail } = parsed.data;
    const genericResponse = {
      message: "If an account exists for that email, a reset link has been sent.",
    };

    const user = await prisma.user.findUnique({ where: { email: toEmail } });
    if (!user || user.deletedAt) {
      return reply.send(genericResponse);
    }

    const rawToken = randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashToken(rawToken),
        resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${env.APP_URL}/reset-password?token=${rawToken}`;
      await email.sendPasswordReset(toEmail, resetUrl);

      return reply.send(genericResponse);
    }
  );

  // Completes a reset: verifies the token hash + expiry, sets the new password.
  app.post("/api/auth/reset-password", async (req, reply) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { token, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { resetTokenHash: hashToken(token) },
    });

    if (
      !user ||
      user.deletedAt ||
      !user.resetTokenExpiresAt ||
      user.resetTokenExpiresAt < new Date()
    ) {
      return reply.code(400).send({ error: "This reset link is invalid or has expired." });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });

    return reply.send({ message: "Password updated. You can now sign in." });
  });
}
