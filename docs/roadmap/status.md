# Build Plan — Status

*Companion to [build-plan.md](./build-plan.md). Says what's built, where it
lives, and what's deliberately still open. Update this alongside the code.*

Last updated: 2026-09-02 (PATHWISE 2.0 phases begin)

## PATHWISE 2.0 (2026-09-02 →)

The 2.0 roadmap (see decision 0002) now drives development. Progress:

- **Phase 0 — Freeze Leaf Match: done.** `FEATURE_LEAF_MATCH` (default off)
  disables the Garden XP economy server-side; the UI hides every entry point.
  Flags live in `lib/features.ts`, exposed at `GET /api/config`, consumed by
  the frontend `FeaturesProvider`.
- **Phase 16 (execution order) — Collaborative Study, Study Buddy Rooms
  MVP: done.** One room per buddy pair (canonical, revivable with its
  transcript), buddies-only — outsiders and guests get 404s. Chat
  (screened + rate-limited), a shared focus topic by NAME (derived
  metadata, never a link into private files), and the PATHWISE
  facilitator: it speaks ONLY when both participants have a fresh help
  request (pure rule in `lib/roomModel.ts`, 10-minute window,
  unit-tested), both requests are consumed by one intervention, and every
  facilitator reply passes the same anti-answer-leak guard as the 1:1
  tutor — it gets the pair explaining to each other, never does the
  reasoning for them. Voice/whiteboard/group rooms stay future work.
  Frontend: room page with polling chat + help button, opened from the
  Buddies page. E2e: `scripts/smoke-rooms.mjs` (20 checks).
- **Learning layer (the missing "teach me" surface — PDF Phase 8 "Ask
  PATHWISE" + old-roadmap quiz variety): done.** Tap any mapped topic →
  `/topics/:id` renders a lecturer-grade breakdown generated from the
  course's OWN uploaded material (overview, full sections with worked
  examples, myth/truth misconceptions, an exam-recite summary), cached on
  the Topic row — one AI call per topic ever, owner-only. The page carries
  **Ask PATHWISE**: explanatory mode is ALLOWED here by design (the
  no-answers contract protects the Socratic tutor, not the whole app),
  grounded in the concept + cached breakdown. Quizzes are now **two-phase**:
  MCQs, then `QUIZ_WRITTEN_COUNT` written-answer questions graded by AI as
  correct / close / incorrect — "close" still moves mastery, the verdict
  and a teaching explanation plus the model answer come back honestly, and
  a failed written generation never sinks the quiz. After completion,
  **flashcards**: the quiz's own Q&A as a flip deck (free — no AI call),
  gated to finished sessions so answers never leak mid-quiz. Flow the
  product was missing: map → READ the breakdown → ask what's unclear →
  quiz with confidence → flashcards lock it in. Four new provider methods
  across mock/OpenAI/Gemini behind the same abstraction + metering. E2e:
  `scripts/smoke-learning.mjs` (25 checks).
- **Beta-hardening pass (post-roadmap):** three launch-list items closed.
  (1) *Storage purge is complete*: `lib/storageSweep.ts` is the one place
  that knows every file a user owns (course uploads + creator videos), and
  BOTH purge paths — expired guests and the 30-day account purge — sweep it
  before deleting rows. The GDPR "delete means the files too" item is done;
  verified end-to-end by checking the disk in `smoke-hardening.mjs`.
  (2) *Built-in error tracking*: server 5xx and frontend crashes are
  fingerprinted (ids/lines normalized so one bug = one bucket), deduped per
  day with counts, capped and pruned at 30 days, and read via
  `GET /api/ops/errors`; 500 responses carry a requestId a tester can
  screenshot. No new dependencies — a Sentry can replace the transport
  later without moving the capture points. (3) *Constant-time ops auth*:
  every `x-cron-secret` check goes through one `timingSafeEqual` helper.
  Also: the smoke runner warms the Prisma engine before suite #1 (AV locks
  the fresh DLL after a regenerate) and retries a failed suite once on a
  fresh server; `ONLY=<name>` runs a subset.
- **Phase 14 (execution order) — Reliability pass: `npm run smoke`.**
  `scripts/run-smokes.mjs` runs all 13 end-to-end suites (218 checks),
  booting a FRESH server per suite so in-memory rate limits can't bleed
  between them, including the creator suite in both flag modes. This is
  the ROADMAP's "CI end-to-end job" item — point CI at
  `npm run build && npm test && npm run smoke`.
- **Still deferred, by the roadmap's own rules:** enabling
  `FEATURE_USER_VIDEO_POSTING` (needs proven moderation with real users)
  and Wise Path (gamification returns only after the learning + community
  product is validated in beta).
- **Phase 13 (execution order) — Hidden creator video infrastructure:
  done, and DARK.** The full user-video pipeline exists behind
  `FEATURE_USER_VIDEO_POSTING=false`: upload (MP4/WebM, magic-byte
  validated, 25MB) → AI analysis through the existing provider abstraction
  (screening → moderation lane; topic/subject extraction) → creator review
  → publish. State machine in `lib/creatorModel.ts` (unit-tested): clean →
  approved; thin/off-topic → flagged, publish refused (409) until a human
  approves via `POST /api/ops/creator-videos/:id/moderate`; inappropriate →
  rejected outright. While the flag is false every creator endpoint returns
  404 to ordinary clients — even PUBLISHED content reaches nobody — and
  internal testing runs via the CRON_SECRET header, exactly per the
  roadmap. Prepared interaction infra: views with watch-time/completion,
  like/save toggles, shares, comments, follows, and reports that land in
  the shared ops queue (removal takes the video down). Frontend: Creator
  Studio behind the same server-driven FeatureGate — invisible until the
  server flips. Transcoding/thumbnails/transcription deferred to the
  async-worker phase; schema carries their fields. E2e:
  `scripts/smoke-creator.mjs` runs BOTH modes (flag off: 15 checks of
  darkness + the internal pipeline; flag on: 16 checks of the public loop).
- **Phase 12 (execution order) — Personalized Educational FYP: done.**
  `GET /api/fyp` ranks the curated catalog against the learner's full
  derived context: mastery gaps first (35% — this is a learning product,
  not an attention product), then course topics (25%), taste learned from
  likes/saves (20%), declared interests and subject (10% each). Watched
  videos are demoted (×0.4), never hidden. Every item carries a
  plain-language reason, and — the roadmap's core requirement — the feed
  routes BACK into learning: wherever a video maps onto one of the
  learner's own topics, the item carries a "quiz yourself" action naming
  the weakest matching topic, and starting it is one tap (watch → quiz →
  mastery moves → feed re-ranks). Pure ranking + bridge in
  `lib/fypModel.ts` (unit-tested); signal assembly in `lib/fyp.ts` reads
  derived data only. The Videos page's "For you" tab is now the FYP. E2e:
  `scripts/smoke-fyp.mjs`.
- **Phase 11 (execution order) — Curated Educational Videos: done.**
  Editorial catalog only — user uploads stay off until the flagged creator
  phase. `CuratedVideo` carries the roadmap's metadata (title, creator,
  source link, subject, topic names, difficulty, duration, transcript slot,
  thumbnail); a conservative seed of famous stable sources (3Blue1Brown,
  MIT OCW, Kurzgesagt, CrashCourse, Khan Academy) loads idempotently at
  boot, and editors manage the catalog through CRON_SECRET ops endpoints
  (add/list/hide). The student shelf ranks by derived signals (topic-name
  overlap 70%, subject affinity 30% — pure, unit-tested) and every matched
  card says WHY it's shown; unmatched videos still surface so the shelf is
  never empty. Likes/saves/views land in `VideoEngagement` — the exact
  inputs Phase 15's FYP ranks on. Guests browse but can't engage
  (persistent history is account-gated). Links open at the source with
  attribution. Frontend: /videos with subject chips + For-you ranking.
  E2e: `scripts/smoke-videos.mjs`.
- **Phase 10 (execution order) — Direct Messaging: done.** One conversation
  per user pair (canonical order, unit-tested). Buddies talk immediately;
  anyone else's first message is a message request the recipient accepts or
  declines — a pending thread accepts nothing from the recipient until then,
  and a declined one accepts nothing ever. Abuse controls ship with the
  surface: block silences BOTH directions (existing threads and new
  conversation attempts), per-conversation mute, report-a-message into the
  same ops queue as community content (moderation blanks the body, keeping
  thread shape), spam screening, and rate limits (starts 5/10min, messages
  60/10min). Unread counts from per-user read state; reading marks read.
  Guests 403 everywhere. Frontend: /messages with list + thread, request
  banner, mute/block/report. E2e: `scripts/smoke-dms.mjs`.
- **Phase 9 (execution order) — Study Buddy Matching: done.** Matching is
  computed from DERIVED signals only — the self-declared learner profile,
  topic NAMES from knowledge maps, and community membership — never files
  (the privacy rule is structural: `lib/matchModel.ts` can't see anything
  else). Strictly opt-in in both directions via a `discoverable` flag in
  buddy prefs (default OFF): hidden users see no matches, appear in none,
  and can't be requested. Weighted scoring (topics 35%, subjects 20%,
  communities 15%, level/style/availability 10% each) with human-readable
  reasons; a violated similar-level preference penalizes. Request → accept
  handshake creates the buddy pair later phases (rooms, DMs) build on, with
  in-app notifications both ways. Frontend: /buddies page with the privacy
  toggle, incoming requests, suggested matches. E2e:
  `scripts/smoke-buddies.mjs`.
- **Phase 8 (execution order) — Communities: done.** Subject-tree
  communities (roadmap's CS/Biology/Business tree plus obvious neighbours,
  seeded idempotently at boot), join/leave, question/discussion/resource
  posts, replies, "helpful" reactions, author takedown — all account-gated
  server-side (guests get 403 + a claim-account nudge; the UI shows the
  friendly version). Safety shipped with the surface, not after: per-route
  rate limits, cheap spam screening (`lib/communityModel.ts`, unit-tested),
  content reporting, and an ops moderation queue (`GET /api/ops/reports`,
  resolve with remove/dismiss — removal soft-deletes, keeping the audit
  trail). Frontend: Communities browse/join, community feed + composer,
  thread view. E2e: `scripts/smoke-communities.mjs`.
- **Phase 7 (execution order) — Socratic 3.0: done.** The tutor is grounded
  in the Knowledge Layer: each turn feeds the session topic's concept block
  (objectives, documented misconceptions, prerequisites, the student's
  mastery %) into the system prompt, marked as data-not-instructions. A pure
  stuck-detector (`lib/socraticAdaptModel.ts`) drives an escalation ladder —
  one stuck turn earns a concrete hint, two earn decomposition into the
  smallest first step — while the anti-answer-leak guard still inspects
  every reply at every level (the contract text survives all escalation
  levels, unit-tested). Mock provider mirrors the ladder deterministically
  so it's e2e-testable free: `scripts/smoke-socratic3.mjs`.
- **Phase 6 (execution order) — Knowledge Layer 2.0: done.** Topic grew into
  a concept: difficulty, parent/child (schema-ready), learning objectives,
  documented misconceptions, prerequisites (by name, merge-safe) and a source
  reference ("file — section"), all extracted from the material itself and
  enriched — never clobbered — as more uploads arrive. Quiz generation now
  builds distractors from the course's own misconceptions and pitches to
  difficulty. `lib/knowledgeLayer.ts` is the retrieval seam downstream
  features use (`getConceptContext` feeds Socratic 3.0 next); pure shaping in
  `lib/knowledgeLayerModel.ts` (unit-tested). Course view shows the concept
  detail. E2e in `scripts/smoke-knowledge.mjs`.
- **Phase 5 (execution order) — Multimodal ingestion, image slice: done.**
  PNG/JPG/WebP uploads are accepted next to documents, validated by magic
  bytes, capped at `MAX_IMAGE_MB` (8), and transcribed to structured text by
  the provider's new `transcribeImage` capability (vision on OpenAI/Gemini,
  deterministic pseudo-notes on mock; metered as `transcribe_image`). The
  transcription feeds the SAME screening → topics → map pipeline as
  documents. Video is deliberately deferred until async processing exists —
  see decision 0003. E2e in `scripts/smoke-image.mjs`. While building this,
  a pre-existing exposure surfaced: a malformed PDF could pin the upload
  request in pdfjs indefinitely — document parsing is now bounded by a 60s
  timeout (clean failure; the full cure remains the async upload worker).
- **Phase 3 — Gemini provider: done.** `AI_PROVIDER=gemini` +
  `GEMINI_API_KEY` selects a new REST-based provider (no SDK dependency).
  Prompts and response validators were extracted to `src/ai/prompts.ts`,
  shared by OpenAI and Gemini so both answer to the same hardened
  instructions (untrusted-input rule, anti-placeholder topic rule, distractor
  quality bar, Socratic no-answer contract) — providers differ only in
  transport, per the "do not hardwire Gemini" rule. Validators unit-tested;
  `scripts/check-real-ai.mjs` works with either real provider. The real-AI
  quality check (DEPLOYMENT.md step 0) still needs a human with a key.
- **Phase 2 — Personalized onboarding: done.** `LearnerProfile` (1:1 User)
  stores field, academic level, subjects, topics, content preferences,
  community interests, study style and buddy preferences — the signals later
  recommendation/matching phases read (never private files). `GET/PUT
  /api/onboarding` back a 4-step, fully skippable wizard shown after privacy
  acceptance; the same screen is the "Learning profile" editor linked from
  Profile. Normalization rules (`lib/onboardingModel.ts`) are unit-tested;
  e2e in `scripts/smoke-onboarding.mjs`.
- **Phase 1 — Guest mode: done.** `POST /api/auth/guest` creates a real user
  row with a synthetic identity (`guest-<hex>@guest.pathwise.internal`, random
  password, `isGuest`, `guestExpiresAt`), so every ownership check and feature
  works unchanged. Server-enforced caps: 1 course, 3 uploads (10MB each),
  tighter AI budget, 15 Socratic turns/session, 5 quizzes/day; billing and
  email changes refused. `POST /api/auth/claim` converts the guest in place —
  all courses, mastery and streaks survive. The cron sweep purges expired
  guests including their stored files. Pure rules in `lib/guestPolicy.ts`
  (unit-tested); lifecycle e2e in `scripts/smoke-guest.mjs`.

## Beta-prep pass (2026-07-29)

Launch-readiness work on top of the 16 steps, closing the gaps called out in
the previous review:

- **Durable file storage** — `STORAGE_PROVIDER=s3` speaks to any S3-compatible
  store (Cloudflare R2 free tier) via a hand-rolled SigV4 signer verified
  against AWS's published test vectors. Local disk remains the dev default.
- **Email notifications** — streak/review reminders now also go by email
  (Resend), the channel that can actually bring a tester back. Per-user
  `notifyEmail` toggle; unlocks stay in-app only.
- **Security hardening** — JWTs now expire (30d, configurable); baseline
  security headers on every response; multi-origin CORS; magic-byte validation
  so a renamed executable can't enter the upload pipeline; boot-time warnings
  for weak secrets.
- **Cost controls** — per-session Socratic turn cap; written cost model
  (docs/product/cost-model.md) tying the caps to actual per-operation math;
  server-side answer-position shuffling so quiz correctness can't be
  pattern-matched.
- **AI prompt hardening** — topic extraction now excludes admin boilerplate,
  dedupes, and bounds topic count; quiz generation has an explicit distractor
  quality bar. `scripts/check-real-ai.mjs` runs a real syllabus through the
  real provider for human judgement — **DEPLOYMENT.md step 0, still the gating
  task before inviting testers.**
- **Beta feedback channel** — in-app feedback box → `Feedback` table →
  `GET /api/ops/feedback`.
- **DEPLOYMENT.md** — the full beta deployment checklist (Render + Turso + R2 +
  Resend + cron), including known accepted limitations.

---

## Summary

Steps 1–15 are implemented. Step 16 is partly done (analytics, dark mode,
loading/error/empty states and an accessibility pass are in; a full QA sweep and
a security review are not). The frontend no longer contains demo data — every
screen reads from the API.

| Step | Status | Notes |
|---|---|---|
| 1 — Foundation | ✅ | CI now runs tests + a migration check. AI cost metering added. |
| 2 — Course Intelligence | ✅ | Now reachable end-to-end from the UI; moderation runs before mapping. |
| 3 — Courses Home | ✅ | Real data; cap enforced server-side and surfaced on the card. |
| 4 — Mastery & spaced repetition | ✅ | `masteryModel.ts`, 20 tests. |
| 5 — Quiz engine | ✅ | Server-side grading; answers not exposed pre-answer. |
| 6 — Study Plan | ✅ | Quests derived per request; confidence score with 3 components. |
| 7 — Socratic Tutor | ✅ | Leak guard + adversarial suite; guard-trip rate is monitored. |
| 8 — Dashboard | ✅ | Heatmap + guessing-vs-understanding from real signals. |
| 9 — Gamification | ✅ | XP, streaks, ranks, badges, streak freeze. |
| 10 — Profile | ✅ | Editing, notification prefs, rank-gated frames, soft delete + restore. |
| 11 — Companion + mini-game | ✅ | Leaf Match is playable; shop transacts. |
| 12 — Notifications | ✅ | In-app inbox + timezone-aware cron sweep. Push/email is a transport swap. |
| 13 — Monetization | ✅ | Mock + Stripe providers; webhook signature-verified. |
| 14 — Referrals | ✅ | Prompt gated behind a first good moment. |
| 15 — Moderation & compliance | ✅ | Upload screening, ToS versioning, data export. |
| 16 — Polish & launch prep | 🟡 | See "Still open" below. |

---

## Bugs found and fixed during verification

An end-to-end run against a live server (50 checks, signup through account
deletion) surfaced three real defects that typechecking and unit tests had not:

**1. PDF extraction destroyed all line structure — Step 2, high impact.**
pdfjs returns positioned fragments; joining them with spaces collapsed each
page into one line. With no headings or numbered items left, topic extraction
fell back to generic placeholders, so uploading a real syllabus produced a
knowledge map reading "Core Concepts / Key Definitions / Applications" —
populated-looking, and containing nothing from the student's material. Since
quizzes, the study plan and mastery all derive from that map, the entire
downstream product was being built on placeholder topics. Fixed in
`lib/pdfLines.ts`; the same fix was applied to PPTX slide paragraphs. After the
fix the same syllabus yields 10 real topics, and adding a second file expands
the map 10 → 18 with 8 genuinely new topics.

**2. The dashboard hid topics a student was mid-way through — Step 8.**
"Understanding vs guessing" bucketed only topics past 50% mastery. Anything
attempted but below that belonged to neither bucket, and the section gated its
own visibility on `understood + guessing > 0` — so a student who had taken
quizzes but hadn't crossed 50% anywhere saw the panel vanish entirely. Added a
third "still learning" bucket and an explicit `assessed` count to gate on.

**3. The libsql adapter was imported unconditionally — Step 1.**
`lib/prisma.ts` statically imported `@prisma/adapter-libsql`, loading its
platform-specific native binary on every boot even though the adapter is only
used when Turso is configured. A missing or mismatched binary took down local
development, which is exactly the environment that doesn't need it. Now
imported dynamically, only when `TURSO_DATABASE_URL` is set — and it throws
loudly rather than silently falling back to an ephemeral local file.

A fourth issue was a flaw in the test rather than the product: the smoke test
compared mastery "before" on one topic against "after" on a different one,
since consecutive quiz questions target different topics.

---

## Notable decisions made while building

**Pure logic is separated from persistence.** `masteryModel.ts`,
`progression.ts`, `planning.ts`, `gardenModel.ts`, `pdfLines.ts` and
`stripeSignature.ts` import no database or config, so the rules that decide a
student's mastery, streak and study plan are unit-tested directly — 121 tests,
no fixtures, no API keys. The `*.ts` files next to them (`mastery.ts`,
`gamification.ts`, …) are the thin read/write layers.

**Tests compile with `tsc` rather than running through `tsx`.** `tsx` shells
out to esbuild's service worker, which fails to spawn on some machines — and
when it does, a healthy test file reports as a failure with an opaque
`spawn UNKNOWN`. `npm test` compiles to `dist-test/` and runs Node's built-in
runner, so a green run never depends on esbuild being able to fork.

**The Socratic guard is not the prompt.** The build plan warned against "add a
system prompt and hope". The prompt is hardened, *and* every reply is inspected
before the student sees it. A blocked reply is regenerated once with a nudge
naming the specific failure; if it still leaks, a safe probe is substituted.
Session `guardTrips` is exposed in `/api/ops/metrics`, so a degrading prompt
shows up as a rising rate rather than a support ticket.

**Mastery distinguishes knowing from guessing.** A correct answer that arrives
in under 2.5 seconds with no Socratic engagement on the topic earns a fraction
of the credit and raises a guessing signal. That signal discounts the confidence
score, re-prioritises the topic for re-testing, and drives the dashboard's
"understanding vs guessing" view. It's the difference between a mastery number
that's true and one that's flattering.

**Spaced repetition never sees exam dates.** Per the blueprint. Scheduling is
last-reviewed plus performance only.

**Two currencies, deliberately separated.** Study XP grows the companion
passively; only mini-game Garden XP buys cosmetics. Studying can't be turned
into a shopping grind, and playing can't be mistaken for progress.

**Cancelling never deletes coursework.** Dropping to free re-imposes the course
cap on *new* courses; existing ones stay readable. Deleting a student's uploaded
material because a card expired would be indefensible.

**Billing has a mock provider.** `BILLING_PROVIDER=mock` runs the full
upgrade → premium → cancel → revert loop with no Stripe account, so Step 13's
definition of done is testable now. `/api/billing/mock/complete` refuses to run
when a live provider is configured.

---

## Still open

### Step 16 remainder
- **Full QA pass.** Loading, error and empty states exist on every screen and
  share components (`components/states.tsx`), but nobody has walked the whole
  app looking for gaps.
- **Security review.** Not done. The obvious things are in place — bcrypt,
  hashed reset tokens, per-route rate limits, server-side quiz grading, webhook
  signature verification, ownership checks on every resource — but that is not
  the same as having been reviewed.
- **Accessibility.** A pass was made: skip link, visible focus rings, real
  `<button>`s for quiz options and tiles, labelled inputs, `aria-live` on
  async regions, `prefers-reduced-motion` honoured. Not audited with a screen
  reader.

### Known operational gaps
- ~~Uploads on ephemeral local disk~~ — **addressed**: set `STORAGE_PROVIDER=s3`
  (R2/S3/B2). Local remains the dev default. Remaining sub-gap: the 30-day
  account purge doesn't yet sweep the user's files out of the bucket.
- **The AI pipeline runs synchronously inside the upload request.** Fine at
  current volume, per the blueprint's "no message queue yet" call. A large PDF
  plus a slow model can approach a request timeout.
- ~~Notifications in-app only~~ — **addressed**: streak/review reminders also
  send by email when `EMAIL_PROVIDER=resend`. Push still needs a mobile
  wrapper.
- ~~Single CORS origin~~ — **addressed**: `CORS_ORIGIN` is comma-separated.
- **The real-AI quality check has not been run.** `scripts/check-real-ai.mjs`
  exists precisely for this; it needs a human with an OpenAI key and ~10 real
  syllabi. This is the gating task before inviting testers (DEPLOYMENT.md
  step 0).

### Not started (correctly)
Everything in the plan's "Explicitly NOT in this build" list: lecturer-facing
features, multi-language, adaptive quiz difficulty, behavioural notification
timing, social/leaderboard features, and message-queue infrastructure.

---

## How to verify the definitions of done

```bash
# Step 4: mastery moves after a simulated attempt; scheduler flags due topics
# Step 7: the adversarial leak suite
# Step 2: PDF/PPTX line structure survives extraction
cd backend && npm test    # 121 tests

# Steps 2/3/5/6/8: end-to-end, free, no API keys (AI_PROVIDER=mock)
cd backend && npm run dev
cd frontend && npm run dev
# sign up → accept privacy → add a course → upload a real syllabus →
# open the study plan → take the quiz → watch mastery move on the dashboard

# Step 13: a "real test payment" unlocks premium and reverts on cancel
# with BILLING_PROVIDER=mock, use the upgrade screen's test-mode flow
```
