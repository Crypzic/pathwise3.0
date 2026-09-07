# Pathwise — The Road to Perfect

*Everything that still stands between the current build and a genuinely
polished product. Ordered by when it matters, not by how fun it is. The
16-step build plan (docs/roadmap/build-plan.md) is implemented and verified —
136 unit tests, 58-check end-to-end suite — so everything below is about
making it excellent, not making it exist.*

---

## 🚦 Gate 0 — before the FIRST beta tester (hours, not days)

**1. Run the real-AI quality check.** The single most important item in this
file. Every automated test ran against the free mock provider; no human has
judged real output on real coursework.

```bash
cd backend && npm run build
AI_PROVIDER=openai OPENAI_API_KEY=sk-... node scripts/check-real-ai.mjs path/to/syllabus.pdf
```

Run ~10 real syllabi/slide decks across subjects (~$0.02 each). For each:
are the topics the actual course content? Weights sane? Quiz distractors
plausible? Tutor still Socratic under "just tell me the answer"? Tune the
prompts in `backend/src/ai/openai.ts` until you'd show the output to a
lecturer without flinching.

**2. Deploy per DEPLOYMENT.md** — Turso (DB) + R2 (files) + Resend (email) +
Render (API) + Vercel (frontend), all free tiers. Set a real `JWT_SECRET` and
`CRON_SECRET`, schedule the sweep.

**3. Recruit 15–25 students** across at least 3 different subjects. STEM-only
testing will hide failures in essay-heavy courses (history syllabi produce
very different topic structures).

---

## 📈 During the beta (weeks 1–4)

**Watch these numbers weekly** (`GET /api/ops/metrics` + `/api/ops/feedback`):

| Signal | Healthy | Action if not |
|---|---|---|
| Upload → processed rate | >90% | Read the failed files; fix parsing |
| Socratic guard-trip rate | <5% of turns | Prompt is degrading — tighten it |
| Measured AI cost/user/month | ≲$0.15 | Re-check docs/product/cost-model.md math |
| D7 retention of activated users | >30% | Talk to the testers who left |
| Confidence score vs. self-report | Roughly matches | Recalibrate the constants below |

**Calibrate the invented constants with real data.** These were chosen by
reasoning, not measurement, and beta data should correct them:
- Mastery learn rates (`masteryModel.ts`: 0.28/0.34), the 2.5s "fast answer"
  guess threshold, Socratic per-session mastery cap (0.12)
- Confidence weighting (60% mastery / 25% consistency / 15% depth) and the
  coverage penalty — if students say "it reads low/high," this is where
- XP values and rank thresholds (`progression.ts`) — watch where testers
  plateau

**Close the feedback loop visibly.** Reply to every piece of feedback from
`/api/ops/feedback`, even with one sentence. Beta testers who feel heard
recruit the next wave.

---

## 🔒 Before PUBLIC launch (the must-do list)

1. **Independent security review.** The obvious controls exist (bcrypt, hashed
   reset tokens, expiring JWTs, per-route rate limits, ownership checks,
   webhook signature verification, magic-byte upload validation, security
   headers) — but self-review is not review. One external pass, or at minimum
   a structured OWASP ASVS L1 walkthrough.
2. **One real Stripe charge.** `BILLING_PROVIDER=stripe` is written and
   webhook-verified but has never processed a live payment. Run one real
   monthly + one annual + one cancellation before enabling it publicly.
3. **Storage purge on account deletion.** The 30-day purge deletes DB rows but
   doesn't yet sweep the user's files out of R2. Add an object-listing pass to
   the purge job (`lib/notifications.ts` → `purgeExpiredAccounts`). This is a
   GDPR requirement, not a nice-to-have.
4. **Accessibility audit with a screen reader.** The mechanics exist (skip
   link, focus rings, aria-live regions, reduced-motion). An hour with NVDA
   on the quiz and Socratic flows will find what mechanics can't.
5. **Full manual QA walkthrough** on a phone. Every screen was built
   responsive; nobody has tapped through all of them on a 375px screen.
6. **Legal pass**: Terms of Service and privacy policy reviewed by an actual
   human who knows the launch market's rules. `TOS_VERSION` re-prompting is
   already wired.
7. **Error tracking** (Sentry or similar, free tier) on both frontend and
   backend — beta testers report crashes; the public doesn't.
8. **Database backups.** Turso has point-in-time restore on paid tiers;
   at minimum schedule a nightly `turso db shell .dump` artifact.

---

## ✨ Product polish (high value, not blocking)

- **Streaming Socratic replies.** The tutor currently answers in one block;
  token-streaming (SSE) would make it feel alive. The guard complicates this —
  you can't inspect a reply you haven't fully received — so stream to a buffer
  server-side, guard, then release. Worth the work: this is the flagship
  feature's feel.
- **Async upload processing.** Parsing + AI runs inside the upload request.
  At beta volume it's fine; at public volume move it to a background worker
  with a "building your map…" progress state. The blueprint deliberately
  deferred the queue — revisit when p95 upload time exceeds ~20s.
- **Quiz variety**: short-answer with AI grading, "explain why" follow-ups,
  flashcard mode for the spaced-repetition reviews. The `QuizItem` model
  already carries everything needed.
- **Study plan memory**: "you studied 40 minutes yesterday, here's today's
  15-minute plan" — session-length awareness makes quests feel personal.
- **Topic merging UI.** The AI occasionally produces near-duplicate topics
  ("Cell Structure" / "Cell Structure overview"). Server-side dedupe catches
  exact-ish matches; give students a "merge these" affordance for the rest.
- **Companion actually rendered.** The pet is a gradient circle with an icon;
  the growth stages deserve real art (5 stages × a few cosmetics). This is
  the most visible "unfinished" surface in the app.
- **Onboarding moment.** After the first upload finishes, a 10-second
  "here's what we found — this is your weakest-looking topic, want to start
  there?" walkthrough. First-session activation is the metric everything else
  depends on.
- **Email digest** (weekly): mastery gained, streak status, what's due next
  week. Retention channel beyond the daily nudge.

---

## 🏗️ Engineering hardening (as usage grows)

- **Load test** the AI-bound routes (k6 or autocannon): 100 concurrent
  students taking quizzes should not starve the event loop. The synchronous
  PDF parse is the known hot spot.
- **Postgres migration path.** SQLite/Turso is right for now; the Prisma
  schema is already portable. Trigger: write contention or >10GB.
- **Structured logging + request IDs** end to end (Fastify has req-id built
  in; propagate it into AIUsage and error responses).
- **CI end-to-end job**: the 58-check smoke suite currently runs manually;
  wire it into CI against a booted server with the mock provider.
- **Dependabot/renovate** + a monthly dependency review.
- **Dev-machine note**: this repo was built on a machine whose antivirus
  quarantines esbuild and Prisma's schema engine. `npm test` avoids esbuild
  deliberately, and `backend/scripts/apply-migration-manually.mjs` replaces
  `prisma migrate deploy` locally. On a healthy machine, both standard paths
  work — exclude the repo folder in the AV settings and the workarounds
  become unnecessary.

---

## 🧭 Explicitly still deferred (per the build plan — don't start yet)

- Lecturer-facing features (all of them) — until the student side is validated
- Multi-language support
- Adaptive quiz difficulty
- Smart/behavioural notification timing
- Social/competitive features (leaderboards, friend comparisons)
- Message-queue infrastructure — until volume demands it

---

## Definition of "perfect enough to charge money"

All of **Gate 0** done → beta ran ≥4 weeks with ≥15 active students → all
eight **public-launch** items checked → measured AI cost per user confirmed
against the cost model → at least one full month of a tester using the app
for a real exam, and saying it helped. Then turn on Stripe.
