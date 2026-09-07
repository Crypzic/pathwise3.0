# Backend — Pathwise API (Node + Fastify + Prisma + SQLite)

> **Action needed if you're pulling this update**: the schema gained the quiz,
> Socratic, gamification, companion, notification, analytics and referral
> models, plus new columns on `User`, `Upload` and `Subscription`. Run:
> ```bash
> npm install
> npm run prisma:migrate    # applies migrations/20260727015243_feature_engines
> ```

TypeScript backend. All AI features go through a swappable provider (mock by
default, OpenAI when configured), so the whole app runs for free in development.

> Note: the original docs suggested Python + FastAPI. We build in TypeScript so
> the whole stack shares one language and runs with no extra toolchain.

## Setup

```bash
npm install
cp .env.example .env      # then edit if you like (defaults work out of the box)
npm run prisma:migrate    # creates the SQLite database
npm run dev               # starts the API on http://localhost:4000
```

The dev server auto-loads `.env` and restarts on file changes.

> **Dev runner note:** we compile with `tsc` and run the output with Node's
> built-in `--watch` (see the `dev` script) rather than using `tsx`. On some
> machines esbuild — which `tsx` shells out to — can't spawn its service
> worker (`Error: spawn UNKNOWN`), and when that happens it surfaces as a
> mysterious failure rather than a clear one. `npm test` compiles the same way
> for the same reason, so a working test run never depends on esbuild.

## Environment (`.env`)

| Var | Meaning |
|---|---|
| `DATABASE_URL` | SQLite file location (default `file:./dev.db`) |
| `JWT_SECRET` | Secret for signing login tokens — change in production |
| `CORS_ORIGIN` | Frontend origin (default `http://localhost:5173`) |
| `PORT` | API port (default `4000`) |
| `AI_PROVIDER` | `mock` (free, default) or `openai` |
| `OPENAI_API_KEY` | Only needed when `AI_PROVIDER=openai` |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |
| `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK` | USD per 1M tokens, used to estimate spend |
| `AI_DAILY_USER_BUDGET_CENTS` | Per-user daily AI ceiling (default 50¢, `0` disables) |
| `FREE_COURSE_CAP` | Free-tier course limit (default `3`) |
| `QUIZ_DEFAULT_LENGTH` / `QUIZ_MAX_LENGTH` | Quiz sizing (default 8 / 20) |
| `EMAIL_PROVIDER` | `mock` (free, default — logs reset links to console) or `resend` |
| `RESEND_API_KEY` | Only needed when `EMAIL_PROVIDER=resend` |
| `EMAIL_FROM` | Sender address for real email |
| `APP_URL` | Used for password-reset links, referral links and checkout redirects |
| `BILLING_PROVIDER` | `mock` (default, no payment taken) or `stripe` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Only for `BILLING_PROVIDER=stripe` |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` | Stripe recurring price IDs |
| `MODERATION_ENABLED` | Screen uploads before mapping them (default `true`) |
| `TOS_VERSION` | Bump to re-prompt everyone for Terms acceptance |
| `CRON_SECRET` | Shared secret for `/api/cron/sweep`, `/api/ops/metrics`, `/api/ops/feedback` |
| `JWT_TTL_DAYS` | Login-token lifetime (default 30; any 401 signs the client out) |
| `STORAGE_PROVIDER` | `local` (dev; ephemeral on Render) or `s3` (R2/S3/B2 — see DEPLOYMENT.md) |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Only for `STORAGE_PROVIDER=s3` |
| `SOCRATIC_MAX_TURNS` | Per-session AI-call ceiling (default 60 — see docs/product/cost-model.md) |

To use real AI later: set `AI_PROVIDER=openai` and paste your key into
`OPENAI_API_KEY`, then restart. Everything else stays the same.

## AI cost metering (Step 1 item 6)

The AI pipeline is the only part of the system that costs money per use, so it
is metered rather than trusted. Features never call the provider directly —
they go through `src/lib/aiMeter.ts`, which:

- writes an `AIUsage` row for every call (operation, model, tokens, estimated
  cost in micro-USD, duration, success/failure), and
- refuses the call with a `429` once a user passes `AI_DAILY_USER_BUDGET_CENTS`
  for the day.

`GET /api/ops/metrics` (header `x-cron-secret`) returns spend by operation, the
activation funnel, and the Socratic guard-trip rate.

## Scheduled jobs

Point any external scheduler at the sweep endpoint every 15–30 minutes:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" https://your-api/api/cron/sweep
```

It sends due streak and review reminders (each at most once per user per local
day) and hard-deletes accounts whose 30-day recovery window has expired.

## Endpoints

Auth is a Bearer JWT: `Authorization: Bearer <token>`.

### Auth & account
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/api/health` | — | Health + active AI/email/billing provider |
| GET  | `/api/config` | — | Public feature flags (PATHWISE 2.0) |
| POST | `/api/auth/signup` | — | Create account (rate limited 5/10min); accepts `referralCode` |
| POST | `/api/auth/signin` | — | Log in (rate limited 10/10min) |
| POST | `/api/auth/guest` | — | Start a guest session (Phase 1; rate limited 5/10min) |
| POST | `/api/auth/claim` | ✔ | Convert the current guest into a real account, keeping all progress |
| GET  | `/api/auth/me` | ✔ | Current user |
| POST | `/api/auth/accept-privacy` | ✔ | Record one-time privacy + ToS acceptance |
| POST | `/api/auth/forgot-password` | — | Request a reset link (generic response either way) |
| POST | `/api/auth/reset-password` | — | Complete a reset |
| GET  | `/api/onboarding` | ✔ | Learner profile + option catalogs (Phase 2) |
| PUT  | `/api/onboarding` | ✔ | Save learner profile; `complete: true` finishes the wizard |
| GET  | `/api/communities` | ✔ | Subject tree with membership (2.0 Phase 9; guests 403) |
| POST | `/api/communities/:id/join` / `.../leave` | ✔ | Membership |
| GET  | `/api/communities/:id` | ✔ | Community + paginated posts |
| POST | `/api/communities/:id/posts` | ✔ | Create post (members, rate-limited, spam-screened) |
| GET  | `/api/communities/posts/:postId` | ✔ | Thread with replies |
| POST | `/api/communities/posts/:postId/replies` | ✔ | Reply (members) |
| POST | `/api/communities/posts/:postId/react` | ✔ | Toggle "helpful" (same for `replies/:replyId/react`) |
| DELETE | `/api/communities/posts/:postId` | ✔ | Author takedown (soft; same for replies) |
| POST | `/api/communities/reports` | ✔ | Report content for review |
| GET  | `/api/ops/reports` | cron secret | Moderation queue; resolve via `POST .../:id/resolve` |
| GET  | `/api/buddies/matches` | ✔ | Suggested study buddies (2.0 Phase 10; opt-in both ways) |
| POST | `/api/buddies/discoverable` | ✔ | `{on}` — the matching privacy switch (default off) |
| POST | `/api/buddies/requests` | ✔ | Send a buddy request (both sides discoverable) |
| GET  | `/api/buddies/requests` | ✔ | Incoming + outgoing pending requests |
| POST | `/api/buddies/requests/:id/respond` | ✔ | `{action: accept\|decline}` (recipient only) |
| GET  | `/api/buddies` | ✔ | Accepted buddy pairs |
| GET  | `/api/dms` | ✔ | Conversations + requests with unread counts (2.0 Phase 12) |
| POST | `/api/dms` | ✔ | Start a conversation (buddies: active; others: message request) |
| GET  | `/api/dms/:id` | ✔ | Thread (marks read) |
| POST | `/api/dms/:id/messages` | ✔ | Send (rate-limited, spam-screened, block-aware) |
| POST | `/api/dms/:id/respond` | ✔ | Accept/decline a message request (recipient only) |
| POST | `/api/dms/:id/mute` | ✔ | Per-conversation mute |
| POST | `/api/dms/block` | ✔ | Block/unblock a user (silences both directions) |
| POST | `/api/dms/messages/:messageId/report` | ✔ | Report a DM into the ops queue |
| GET  | `/api/fyp` | ✔ | Personalized feed: gaps > topics > taste, with quiz actions (2.0 Phase 15) |
| GET  | `/api/videos` | ✔ | Curated shelf ranked for the learner (2.0 Phase 14); `?subject=` filters |
| POST | `/api/videos/:id/engage` | ✔ | `{kind: view\|like\|save}` — FYP signals; guests 403 |
| GET/POST | `/api/ops/videos` | cron secret | Catalog management; `POST .../:id` publishes/hides |
| * | `/api/creator/*` | ✔ + flag | Creator pipeline (2.0 Phase 16) — 404 unless `FEATURE_USER_VIDEO_POSTING=true` or internal cron-secret testing |
| POST | `/api/ops/creator-videos/:id/moderate` | cron secret | Human moderation: approve flagged / reject |
| POST | `/api/rooms` | ✔ | Open the study room for a buddy pair (2.0 Phases 11/19) |
| GET  | `/api/rooms` / `/api/rooms/:id` | ✔ | My rooms / transcript (participants only) |
| POST | `/api/rooms/:id/messages` | ✔ | Room chat (screened, rate-limited) |
| POST | `/api/rooms/:id/topic` | ✔ | Set the shared focus topic (a name, never a file) |
| POST | `/api/rooms/:id/help` | ✔ | Ask PATHWISE — facilitates only when BOTH have asked; leak-guarded |
| POST | `/api/rooms/:id/end` | ✔ | End the session (either side) |
| GET  | `/api/topics/:id/breakdown` | ✔ | Lecturer-grade topic breakdown from your material (cached) |
| POST | `/api/topics/:id/ask` | ✔ | Ask PATHWISE — explanatory tutoring on the topic page |
| GET  | `/api/quiz/sessions/:id/review` | ✔ | Flashcards from a finished quiz |
| POST | `/api/client-errors` | — | Frontend crash reports (rate-limited, bounded, deduped) |
| GET  | `/api/ops/errors` | cron secret | Grouped error buckets, last 30 days |

### Courses & materials (Steps 2–3)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/api/courses` | ✔ | Course grid with weighted mastery + cap meta |
| POST | `/api/courses` | ✔ | Create a course (enforces free-tier cap) |
| GET  | `/api/courses/:id` | ✔ | Knowledge map + per-topic mastery + materials |
| PATCH | `/api/courses/:id` | ✔ | Rename / re-icon |
| DELETE | `/api/courses/:id` | ✔ | Delete a course and everything derived from it |
| POST | `/api/courses/:id/uploads` | ✔ | Upload material (PDF/DOCX/PPTX or PNG/JPG/WebP image); parse or vision-transcribe, moderate, expand the map |
| DELETE | `/api/courses/:id/uploads/:uploadId` | ✔ | Remove one material |

### Quiz (Step 5)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/quiz/sessions` | ✔ | Build a quiz (`practice` \| `review` \| `weakest`) |
| GET  | `/api/quiz/sessions/:id` | ✔ | Session state + the current question |
| POST | `/api/quiz/sessions/:id/answer` | ✔ | Grade, move mastery, award XP |
| POST | `/api/quiz/sessions/:id/abandon` | ✔ | Abandon an in-progress quiz |
| GET  | `/api/quiz/active` | ✔ | Resume the most recent active quiz |

The correct answer is never sent before the student answers — grading is
server-side, and the explanation comes back with the result.

### Socratic tutor (Step 7)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/socratic/sessions` | ✔ | Start a session (`origin`, optional `topicId`/`contextNote`) |
| GET  | `/api/socratic/sessions/:id` | ✔ | Session + transcript |
| POST | `/api/socratic/sessions/:id/messages` | ✔ | Send a turn, get one guarded reply |
| POST | `/api/socratic/sessions/:id/end` | ✔ | End, credit reasoning depth to mastery |
| POST | `/api/socratic/intro-seen` | ✔ | Mark the first-time explainer as seen |

### Study plan & dashboard (Steps 6, 8)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/courses/:id/study-plan` | ✔ | Quests, confidence score, quest path, drop banner |
| GET | `/api/courses/:id/dashboard` | ✔ | Heatmap, guessing-vs-understanding, streak, badges |

### Profile, garden, notifications, billing, referrals (Steps 10–14)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/profile` | ✔ | Profile, rank, frames, badges, referral, subscription |
| PATCH | `/api/profile` | ✔ | Edit details + notification toggles |
| POST | `/api/profile/password` | ✔ | Change password (requires the current one) |
| POST | `/api/profile/delete` | ✔ | Soft delete, 30-day recovery window |
| POST | `/api/profile/restore` | — | Restore inside the window (email + password) |
| GET | `/api/profile/export` | ✔ | Full data export (GDPR access request) |
| GET | `/api/garden` | ✔ | Companion state + wallet + inventory |
| POST | `/api/garden/minigame/finish` | ✔ | Record a Leaf Match round, pay Garden XP |
| GET | `/api/garden/shop` | ✔ | Catalogue with ownership/affordability resolved |
| POST | `/api/garden/shop/purchase` | ✔ | Buy an item |
| POST | `/api/garden/equip` | ✔ | Equip owned cosmetics |
| PATCH | `/api/garden/companion` | ✔ | Rename the companion |
| GET | `/api/notifications` | ✔ | In-app inbox |
| POST | `/api/notifications/read` | ✔ | Mark read |
| GET | `/api/billing/plans` | ✔ | Plans + entitlements |
| POST | `/api/billing/checkout` | ✔ | Start checkout |
| POST | `/api/billing/mock/complete` | ✔ | Mock-only upgrade (refused on a live provider) |
| POST | `/api/billing/cancel` | ✔ | Cancel |
| POST | `/api/billing/webhook` | — | Stripe webhook (signature-verified) |
| GET | `/api/referrals` | ✔ | Code, link, counts, and whether to show the prompt |

### Internal
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/cron/sweep` | `x-cron-secret` | Notification sweep + expired-account purge |
| GET | `/api/ops/metrics` | `x-cron-secret` | AI spend, activation funnel, guard-trip rate |

## Course Intelligence pipeline (Step 2)

`POST /api/courses/:id/uploads` runs synchronously:
`save file → extract text (src/lib/parse.ts) → moderate (src/lib/moderation.ts)
→ extract & weight topics (metered AI) → merge into the Knowledge Map
(src/lib/knowledge.ts)`. Re-uploading more materials **expands** the same map —
repeated topics gain emphasis weight rather than duplicating. A file that
parses but isn't course material comes back `422` with a readable reason and
never becomes topics.

### Line structure is load-bearing

Both parsers deliberately preserve line breaks, and there's a regression suite
(`src/lib/parse.test.ts`) enforcing it.

pdfjs returns positioned text fragments, not lines; joining them with a space
collapses a whole page into one enormous line. PPTX has the same trap — the
runs inside a slide flatten into a single blob unless you split on paragraphs.
Either way the headings, numbered lists and bullet points disappear, and those
are precisely the signal topic extraction reads. When it happened, the
heuristic extractor stopped finding any headings and fell back to generic
placeholders ("Core Concepts", "Key Definitions"), so a course's knowledge map
looked populated while containing nothing from the student's actual syllabus.
The AI provider degrades the same way — a wall of text hides the
learning-objective and repetition cues that drive emphasis weighting.

The fix lives in `src/lib/pdfLines.ts` (breaks on `hasEOL` and on baseline
changes) and in `parsePptx`'s per-`<a:p>` extraction.

## Mastery & spaced repetition (Step 4)

`src/lib/masteryModel.ts` holds the model as pure functions:

- Correct answers pull mastery toward 1, wrong answers toward 0, with the step
  proportional to the remaining distance.
- A **guessing signal** discounts credit for answers that arrive suspiciously
  fast with no Socratic engagement — that signal also drives the dashboard's
  "understanding vs guessing" view and re-tests topics whose score looks lucky.
- Review scheduling is SM-2-flavoured and driven **only** by last-reviewed time
  and performance. Exam dates are deliberately not an input.

## Socratic answer-leak guard (Step 7)

The system prompt tells the model never to answer. That's necessary, not
sufficient. Every reply also passes through `src/lib/socraticGuard.ts`, which
blocks announced answers, verdicts on a candidate answer, worked solutions,
replies that ask nothing, and lectures. A blocked reply is regenerated once with
a nudge naming the specific failure; if it still leaks, a safe probe is
substituted and `guardTrips` is incremented on the session.

`src/lib/socraticGuard.test.ts` is the adversarial suite the build plan asks
for — ~40 leak shapes and extraction attempts that must not get through.

## Layout

```
prisma/schema.prisma   → database models
src/lib/
  env, prisma, auth    → configuration and primitives
  aiMeter              → metered AI wrappers + per-user budget
  parse, pdfLines*     → file text extraction (line structure preserved)
  storage              → disk storage for uploads
  moderation           → upload content screening (Step 15)
  knowledge            → the Course Intelligence pipeline (Step 2)
  masteryModel*        → mastery + spaced repetition, pure (Step 4)
  mastery              → its persistence layer
  progression*         → XP, ranks, streaks, pure (Step 9)
  gamification         → its persistence layer + badges
  planning*            → confidence, quests, quiz allocation, pure (Steps 5-6)
  studyPlan, quiz      → their persistence layers
  gardenModel*, garden → companion, shop, Leaf Match (Step 11)
  notifications        → sweep + delivery (Step 12)
  billing              → provider abstraction + entitlements (Step 13)
  stripeSignature*     → webhook verification, pure
  referrals            → codes, attachment, payout (Step 14)
  analytics            → success-metric events (Step 16)
src/ai/                → AI provider interface + mock + openai adapters
src/email/             → Email provider interface + mock + resend adapters
src/plugins/           → JWT auth guard
src/routes/            → all HTTP routes
src/server.ts          → Fastify app entry

* = pure, no database import, directly unit-tested
```

## Handy commands

- `npm test` — the pure-logic suite (136 tests, no DB or API keys needed)
- `npm run typecheck` — typecheck without emitting
- `npm run prisma:studio` — visual database browser
- `npm run prisma:migrate` — create/apply a migration after editing the schema
- `node scripts/apply-migration-manually.mjs` — fallback `migrate deploy` that
  runs through the query engine, for machines where antivirus quarantines
  Prisma's schema-engine binary (applies all pending migrations, transactional,
  records them in `_prisma_migrations` with correct checksums)
- `node scripts/check-real-ai.mjs <file>` — run a REAL syllabus through the
  REAL AI provider and judge the output (see DEPLOYMENT.md step 0)
- `npm run build && npm start` — production build + run
