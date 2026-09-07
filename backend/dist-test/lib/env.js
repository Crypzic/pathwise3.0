// Central place to read and validate environment variables.
import { z } from "zod";
// Boolean env vars: z.coerce.boolean() would treat the string "false" as true
// (any non-empty string is truthy), so flags are parsed from their string form.
// Empty/unset falls back to the default.
const envBool = (def) => z.preprocess((v) => (v === undefined || v === "" ? undefined : String(v).toLowerCase()), z
    .enum(["true", "false", "1", "0"])
    .default(def ? "true" : "false")
    .transform((s) => s === "true" || s === "1"));
const schema = z.object({
    DATABASE_URL: z.string().default("file:./dev.db"),
    JWT_SECRET: z.string().min(1),
    // Login-token lifetime. Any 401 signs the client out, so shortening this
    // later needs no client change.
    JWT_TTL_DAYS: z.coerce.number().min(1).max(365).default(30),
    // Comma-separated list of allowed origins, so local dev and the deployed
    // frontend can both talk to one API (e.g. "http://localhost:5173,https://pathwise.vercel.app").
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    PORT: z.coerce.number().default(4000),
    // "gemini" is the testing-phase primary (PATHWISE 2.0 Phase 3), but nothing
    // outside src/ai/ may depend on which provider is active.
    AI_PROVIDER: z.enum(["mock", "openai", "gemini"]).default("mock"),
    OPENAI_API_KEY: z.string().default(""),
    OPENAI_MODEL: z.string().default("gpt-4o-mini"),
    GEMINI_API_KEY: z.string().default(""),
    // gemini-2.5-flash retires Oct 16 2026 and is already unstable ahead of
    // that date. gemini-3.1-flash-lite is Google's stable, long-term
    // workhorse model for this workload (extraction/quiz/chat) and is not on
    // a deprecation clock.
    GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
    // Fallback model tried once if the primary model call fails (timeout,
    // 5xx, malformed response) before dropping to the mock provider.
    GEMINI_FALLBACK_MODEL: z.string().default("gemini-2.5-flash-lite"),
    // Image uploads travel to the vision provider base64-encoded in one request
    // (2.0 Phase 5) — cap them tighter than documents.
    MAX_IMAGE_MB: z.coerce.number().min(1).max(20).default(8),
    // Above this, a PDF is parsed to text locally only — Gemini's inline
    // request body caps out around 20MB and base64 inflates size by ~33%,
    // so this stays well under that regardless of AI provider.
    MAX_INLINE_PDF_MB: z.coerce.number().min(1).max(20).default(15),
    FREE_COURSE_CAP: z.coerce.number().default(3),
    // Email — used for the forgot-password flow. Mock (default, free, logs to
    // console) or Resend (free tier, real email — see backend/README.md).
    EMAIL_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
    RESEND_API_KEY: z.string().default(""),
    EMAIL_FROM: z.string().default("Pathwise <onboarding@resend.dev>"),
    // Used to build the link inside password-reset emails.
    APP_URL: z.string().default("http://localhost:5173"),
    // Optional — only set these in production (e.g. Render). If present,
    // the Prisma client connects to Turso (hosted SQLite) instead of the
    // local DATABASE_URL file, which survives restarts/redeploys.
    TURSO_DATABASE_URL: z.string().optional(),
    TURSO_AUTH_TOKEN: z.string().optional(),
    // --- AI cost metering (Step 1 item 6) -----------------------------------
    // USD per 1M tokens for the configured model, used to estimate spend per
    // call. Defaults match gpt-4o-mini list pricing; override per model.
    AI_PRICE_INPUT_PER_MTOK: z.coerce.number().default(0.15),
    AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().default(0.6),
    // Hard daily ceiling on AI spend per user, in US cents. Requests past this
    // are refused rather than silently running up a bill. 0 disables the cap.
    AI_DAILY_USER_BUDGET_CENTS: z.coerce.number().default(50),
    // --- Quiz / study tuning (Steps 4-6) ------------------------------------
    QUIZ_DEFAULT_LENGTH: z.coerce.number().default(8),
    QUIZ_MAX_LENGTH: z.coerce.number().default(20),
    // --- Billing (Step 13) --------------------------------------------------
    // "mock" lets the whole upgrade/downgrade flow be exercised without Stripe
    // keys; "stripe" uses real Checkout + webhooks.
    BILLING_PROVIDER: z.enum(["mock", "stripe"]).default("mock"),
    STRIPE_SECRET_KEY: z.string().default(""),
    STRIPE_WEBHOOK_SECRET: z.string().default(""),
    STRIPE_PRICE_MONTHLY: z.string().default(""),
    STRIPE_PRICE_ANNUAL: z.string().default(""),
    // --- Content moderation (Step 15) ---------------------------------------
    // Uploaded material is checked before it becomes a knowledge map.
    MODERATION_ENABLED: envBool(true),
    // --- Feature flags (PATHWISE 2.0) ---------------------------------------
    // Enforced server-side; the frontend reads them from GET /api/config.
    // Leaf Match is frozen (Phase 0): the mini-game and shop stay in the code
    // for a clean future replacement by Wise Path, but earning/spending Garden
    // XP is disabled and the UI entry points are hidden while the flag is off.
    FEATURE_LEAF_MATCH: envBool(false),
    // Guest mode (Phase 1): try the core loop before creating an account.
    FEATURE_GUEST_MODE: envBool(true),
    // Hidden creator infrastructure (Phase 16): the user-video pipeline is
    // fully built but PUBLIC posting stays dark until moderation is proven.
    // Ordinary clients cannot reach creator endpoints while this is false;
    // internal testing goes through the CRON_SECRET header.
    FEATURE_USER_VIDEO_POSTING: envBool(false),
    // Two-phase quizzes: how many written-answer questions follow the MCQs.
    // 0 disables the written phase entirely.
    QUIZ_WRITTEN_COUNT: z.coerce.number().int().min(0).max(5).default(2),
    // --- Guest limits (PATHWISE 2.0 Phase 1) --------------------------------
    // All enforced server-side. Guests exist to sample the core loop, not to
    // be a free tier — tighter caps everywhere, and everything expires.
    GUEST_TTL_DAYS: z.coerce.number().min(1).max(90).default(7),
    GUEST_COURSE_CAP: z.coerce.number().min(1).default(1),
    // Total uploads across the guest's courses.
    GUEST_UPLOAD_CAP: z.coerce.number().min(1).default(3),
    // Per-file ceiling for guests (accounts get the global 25MB multipart cap).
    GUEST_MAX_FILE_MB: z.coerce.number().min(1).max(25).default(10),
    // Tighter daily AI budget for guests, in US cents. 0 disables the override.
    GUEST_AI_DAILY_BUDGET_CENTS: z.coerce.number().default(10),
    GUEST_SOCRATIC_MAX_TURNS: z.coerce.number().min(1).max(500).default(15),
    GUEST_QUIZ_SESSIONS_PER_DAY: z.coerce.number().min(1).default(5),
    // Terms of Service version. Bump to re-prompt every user for acceptance.
    TOS_VERSION: z.string().default("2026-07-01"),
    // Shared secret for the notification/maintenance cron endpoints, so an
    // external scheduler can trigger them but the public internet can't.
    CRON_SECRET: z.string().default(""),
    // --- File storage --------------------------------------------------------
    // "local" writes to backend/uploads (fine for dev; EPHEMERAL on Render —
    // files vanish on redeploy). "s3" works with any S3-compatible store:
    // Cloudflare R2 (free tier), AWS S3, Backblaze B2.
    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    S3_ENDPOINT: z.string().default(""), // e.g. https://<account>.r2.cloudflarestorage.com
    S3_BUCKET: z.string().default(""),
    S3_REGION: z.string().default("auto"), // "auto" for R2
    S3_ACCESS_KEY_ID: z.string().default(""),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    // Socratic sessions are the least bounded AI cost — one student can hold a
    // conversation open indefinitely. Hard per-session turn ceiling.
    SOCRATIC_MAX_TURNS: z.coerce.number().min(5).max(500).default(60),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error("❌ Invalid environment configuration:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}
export const env = parsed.data;
/** CORS_ORIGIN split into individual origins. */
export const corsOrigins = env.CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
// Boot-time nagging beats a silent weak deployment. Not fatal — dev secrets
// are legitimately short — but production shouldn't get to ignore it quietly.
if (env.JWT_SECRET.length < 32) {
    console.warn(`⚠️  JWT_SECRET is only ${env.JWT_SECRET.length} characters. Use 32+ random characters in production — every login token's integrity depends on it.`);
}
if (env.STORAGE_PROVIDER === "s3") {
    const missing = [
        ["S3_ENDPOINT", env.S3_ENDPOINT],
        ["S3_BUCKET", env.S3_BUCKET],
        ["S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID],
        ["S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY],
    ].filter(([, v]) => !v);
    if (missing.length > 0) {
        console.error(`❌ STORAGE_PROVIDER=s3 but missing: ${missing.map(([k]) => k).join(", ")}`);
        process.exit(1);
    }
}
