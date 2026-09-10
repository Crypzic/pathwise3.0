// Profile (Step 10) — editable details, notification toggles, rank-gated
// unlocks, and account deletion with a 30-day recovery window.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { rankFor, RANKS } from "../lib/gamification.js";
import { imageKindFor } from "../lib/parse.js";
import { matchesImageSignature } from "../lib/fileSignature.js";
import { saveUpload, storage } from "../lib/storage.js";
import { referralStatus } from "../lib/referrals.js";
import { track } from "../lib/analytics.js";
import type { UserBadge, Badge } from "@prisma/client";

const RECOVERY_WINDOW_DAYS = 30;

// Notifications are automatic now (in-app only, email just at
// registration) — the old notify* toggles are gone from this surface.
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
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

const deleteSchema = z.object({
  password: z.string().min(1),
});

// Avatar frames: three free designs anyone can wear, three earned by rank
// (never bought — that's what keeps them meaningful). The keys map to CSS
// frame classes in the frontend; each renders as a live preview there.
export const PROFILE_FRAMES = [
  { key: "classic", name: "Classic", description: "Clean solid ring in Pathwise green", requiredLevel: 1 },
  { key: "halo", name: "Halo", description: "Thin double ring with a soft glow", requiredLevel: 1 },
  { key: "sprout", name: "Sprout", description: "Dashed organic ring with a leaf accent", requiredLevel: 1 },
  { key: "bronze", name: "Bronze Scholar", description: "Warm bronze gradient with a metallic sheen", requiredLevel: 3 },
  { key: "laurel", name: "Golden Laurel", description: "Rich gold double ring", requiredLevel: 5 },
  { key: "prismatic", name: "Prismatic", description: "Slowly rotating rainbow — animated", requiredLevel: 7 },
] as const;

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

/** Public URL for a user's avatar; the path's uuid makes it cache-busting. */
export function avatarUrlFor(user: {
  id: string;
  avatarPath: string | null;
}): string | null {
  if (!user.avatarPath) return null;
  const version = user.avatarPath.split("/").pop()?.slice(0, 8) ?? "0";
  return `/api/users/${user.id}/avatar?v=${version}`;
}

const AVATAR_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

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
        avatarUrl: avatarUrlFor(user),
        avatarFrame: user.avatarFrame,
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
        selected: user.avatarFrame === f.key,
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
    });
  });

  // Upload a profile picture. Same defenses as course images: real magic
  // bytes or nothing, tight size cap, stored via the storage provider.
  app.post(
    "/api/profile/avatar",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: "No image uploaded" });

      const kind = imageKindFor(data.filename, data.mimetype);
      if (!kind) {
        return reply
          .code(415)
          .send({ error: "Use a PNG, JPG, or WebP image." });
      }
      const buffer = await data.toBuffer();
      if (buffer.length > MAX_AVATAR_BYTES) {
        return reply.code(413).send({ error: "Image too large (4MB max)." });
      }
      if (!matchesImageSignature(kind, buffer)) {
        return reply
          .code(415)
          .send({ error: "That file doesn't look like a real image." });
      }

      const previous = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { avatarPath: true },
      });
      const saved = await saveUpload(
        req.user.sub,
        `avatar.${kind}`,
        buffer
      );
      const user = await prisma.user.update({
        where: { id: req.user.sub },
        data: { avatarPath: saved.storagePath },
      });
      // The old picture is dead weight the moment the new one lands.
      if (previous?.avatarPath) {
        await storage.remove(previous.avatarPath).catch(() => {});
      }
      return reply.send({ avatarUrl: avatarUrlFor(user) });
    }
  );

  // Remove the profile picture (back to the initial).
  app.delete(
    "/api/profile/avatar",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { avatarPath: true },
      });
      if (user?.avatarPath) {
        await storage.remove(user.avatarPath).catch(() => {});
        await prisma.user.update({
          where: { id: req.user.sub },
          data: { avatarPath: null },
        });
      }
      return reply.send({ avatarUrl: null });
    }
  );

  // Serve an avatar. Public on purpose: <img> tags can't send auth headers,
  // and every surface that shows avatars requires sign-in anyway. The path
  // rotates per upload, so long immutable caching is safe.
  app.get("/api/users/:id/avatar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      select: { avatarPath: true, deletedAt: true },
    });
    if (!user?.avatarPath || user.deletedAt) {
      return reply.code(404).send({ error: "No avatar" });
    }
    try {
      const buffer = await storage.read(user.avatarPath);
      const ext = user.avatarPath.split(".").pop() ?? "png";
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      reply.type(AVATAR_MIME[ext] ?? "image/png");
      return reply.send(buffer);
    } catch {
      return reply.code(404).send({ error: "No avatar" });
    }
  });

  // Choose an avatar frame. Free frames for everyone; earned frames are
  // enforced here, not just hidden in the UI.
  app.post(
    "/api/profile/frame",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const parsed = z
        .object({ frame: z.string().min(1).max(30) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Send { frame }" });
      }
      const choice = PROFILE_FRAMES.find((f) => f.key === parsed.data.frame);
      if (!choice) {
        return reply.code(400).send({ error: "Unknown frame" });
      }
      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { xp: true },
      });
      const rank = rankFor(user?.xp ?? 0);
      if (rank.level < choice.requiredLevel) {
        return reply.code(403).send({
          error: `${choice.name} unlocks at level ${choice.requiredLevel}.`,
        });
      }
      await prisma.user.update({
        where: { id: req.user.sub },
        data: { avatarFrame: choice.key },
      });
      return reply.send({ avatarFrame: choice.key });
    }
  );

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
