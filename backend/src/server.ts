import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { env, corsOrigins } from "./lib/env.js";
import authPlugin from "./plugins/authenticate.js";
import authRoutes from "./routes/auth.js";
import courseRoutes from "./routes/courses.js";
import quizRoutes from "./routes/quiz.js";
import socraticRoutes from "./routes/socratic.js";
import studyPlanRoutes from "./routes/studyPlan.js";
import profileRoutes from "./routes/profile.js";
import onboardingRoutes from "./routes/onboarding.js";
import gardenRoutes from "./routes/garden.js";
import notificationRoutes from "./routes/notifications.js";
import billingRoutes from "./routes/billing.js";
import referralRoutes from "./routes/referrals.js";
import feedbackRoutes from "./routes/feedback.js";
import communityRoutes from "./routes/communities.js";
import buddyRoutes from "./routes/buddies.js";
import dmRoutes from "./routes/dms.js";
import videoRoutes from "./routes/videos.js";
import creatorRoutes from "./routes/creator.js";
import roomRoutes from "./routes/rooms.js";
import errorRoutes from "./routes/errors.js";
import topicRoutes from "./routes/topics.js";
import opsRoutes from "./routes/ops.js";
import { ai } from "./ai/index.js";
import { email } from "./email/index.js";
import { billing } from "./lib/billing.js";
import { seedBadges } from "./lib/gamification.js";
import { seedShopItems } from "./lib/garden.js";
import { seedCommunities } from "./lib/communities.js";
import { seedVideos } from "./lib/videos.js";
import { recordError } from "./lib/errors.js";
import { publicFeatures } from "./lib/features.js";

const app = Fastify({ logger: true });

// Accepts a comma-separated CORS_ORIGIN so local dev and the deployed
// frontend can both talk to one API.
await app.register(cors, { origin: corsOrigins, credentials: true });
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB

// Baseline security headers on every response. This is a JSON API — nothing
// here should ever be framed, sniffed into HTML, or load subresources.
app.addHook("onSend", async (_req, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  // Ignored over plain http, enforced the moment the API is behind TLS.
  reply.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
});

// Stripe webhook signatures are computed over the exact request bytes, so this
// route needs the raw body preserved. Every other JSON route is unaffected.
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body: string, done) => {
    if (req.url === "/api/billing/webhook") {
      (req as unknown as { rawBody: string }).rawBody = body;
    }
    try {
      done(null, body.length > 0 ? JSON.parse(body) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// Global baseline — generous, since most routes aren't sensitive.
// Auth, upload, AI and billing routes below set their own stricter limits.
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

// Built-in error tracking (beta readiness): every unexpected 5xx is
// recorded (grouped + deduped in ErrorReport) and answered with a generic
// message plus the request id, so a tester's screenshot is enough to find
// the matching row in /api/ops/errors. Expected errors (4xx from
// validation, rate limits, etc.) pass through untouched.
app.setErrorHandler(async (raw: unknown, req, reply) => {
  const err = (raw instanceof Error ? raw : new Error(String(raw))) as Error & {
    statusCode?: number;
    code?: string;
  };
  const statusCode =
    typeof err.statusCode === "number" && err.statusCode >= 400
      ? err.statusCode
      : 500;
  if (statusCode < 500) {
    return reply.code(statusCode).send({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
  req.log.error({ err, requestId: req.id }, "unhandled error");
  await recordError({
    source: "server",
    message: err.message || "Unknown server error",
    stack: err.stack ?? null,
    url: `${req.method} ${req.routeOptions?.url ?? req.url}`,
    requestId: String(req.id),
    userId: (req as { user?: { sub?: string } }).user?.sub ?? null,
  });
  return reply.code(500).send({
    error: "Something went wrong on our side.",
    requestId: String(req.id),
  });
});

await app.register(authPlugin);

await app.register(authRoutes);
await app.register(courseRoutes);
await app.register(quizRoutes);
await app.register(socraticRoutes);
await app.register(studyPlanRoutes);
await app.register(profileRoutes);
await app.register(onboardingRoutes);
await app.register(gardenRoutes);
await app.register(notificationRoutes);
await app.register(billingRoutes);
await app.register(referralRoutes);
await app.register(feedbackRoutes);
await app.register(communityRoutes);
await app.register(buddyRoutes);
await app.register(dmRoutes);
await app.register(videoRoutes);
await app.register(creatorRoutes);
await app.register(roomRoutes);
await app.register(errorRoutes);
await app.register(topicRoutes);
await app.register(opsRoutes);

app.get("/api/health", async () => ({
  status: "ok",
  aiProvider: ai.name,
  emailProvider: email.name,
  billingProvider: billing.name,
}));

// Public app configuration: which optional features are on. Read by the
// frontend at boot so hidden/frozen surfaces never render. Enforcement lives
// in the route handlers themselves — this endpoint is informational.
app.get("/api/config", async () => ({
  features: publicFeatures(),
}));

// Reference data the app needs before it can gate anything: badge definitions
// and the shop catalogue. Both upserts, so this is safe on every boot.
try {
  await seedBadges();
  await seedShopItems();
  await seedCommunities();
  await seedVideos();
} catch (err) {
  app.log.error({ err }, "Failed to seed reference data");
}

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(
    `Pathwise backend running on :${env.PORT} (AI: ${ai.name}, billing: ${billing.name})`
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
