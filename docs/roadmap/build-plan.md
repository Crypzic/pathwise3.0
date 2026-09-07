# Pathwise — Step-by-Step Build Plan

*Ordered from highest priority (blocks everything else) to lowest (post-MVP polish). Built for a team to execute against — each step lists what it depends on and why it's sequenced where it is.*

---

## How to read this

- **P0** = must exist before anything else works. Build first.
- **P1** = core product — MVP isn't real without these.
- **P2** = strengthens MVP but the app functions without it.
- **P3** = explicitly deferred — don't start until P0–P2 are live and validated with real users.

---

## STEP 1 — Foundation (P0)

Nothing else can be built until this exists.

1. Set up the repo, environments (dev/staging/prod), and CI basics.
2. Stand up the database (per the schema below) and auth system.
3. Build sign up / sign in / session handling.
4. Build the privacy statement screen — shown once, right after signup, before any upload happens.
5. Set up basic file storage for uploads (syllabus/slides).
6. Decide and configure hosting for the AI pipeline (this is the one piece that costs real money per use — get logging/usage tracking in from day one so you're not flying blind on cost).

**Database entities to stand up now**: Users, Courses, Uploads, Topics, Knowledge Maps, Subscriptions (schema only — billing logic comes later).

**Definition of done for this step**: a user can sign up, sign in, see the privacy screen, and land on an empty Courses page.

---

## STEP 2 — Course Intelligence Engine (P0)

The entire product depends on this working well. If this is weak, everything downstream (study plan, quiz, dashboard) is weak too.

1. Build the upload flow (matches the Onboarding mockup — course name + file upload, PDF/DOCX/PPTX only).
2. Build the parsing pipeline: extract text/structure from uploaded files.
3. Build topic extraction — identify distinct topics from the material.
4. Build topic weighting — emphasis score based on repetition across materials, learning-objective mentions, etc.
5. Store this as the **Knowledge Map** per course.
6. Support **adding materials to an existing course later** (map updates/expands) — don't build this as a one-time-only upload.

**Definition of done**: uploading a real syllabus + slide deck produces a sensible, weighted topic list, viewable (even just as raw data) for QA.

---

## STEP 3 — Courses Home Screen (P0)

1. Build the Courses grid screen (multi-course home) matching the mockup.
2. Wire it to real data: course name, mastery %, streak flame per card.
3. Build the "Add course" flow end-to-end, connected to Step 2's pipeline.
4. Enforce the free-tier course cap here (hook the upsell screen in, even if billing isn't live yet — can hard-block with a placeholder "Pro coming soon" state initially).

**Definition of done**: a student can add multiple real courses and see them as cards on login.

---

## STEP 4 — Mastery & Spaced Repetition Engine (P1)

This underpins Study Plan, Quiz, and the Confidence Score — build it before any of those three.

1. Design the mastery model: how a topic's mastery % is calculated from quiz performance + Socratic session signals.
2. Build the spaced-repetition scheduler (forgetting-curve logic — when is a topic "due" for review). This does **not** use exam dates — purely last-reviewed + performance.
3. Store per-topic mastery state per user, updated after every quiz/Socratic interaction.

**Definition of done**: a topic's mastery score changes correctly after a simulated quiz attempt, and the scheduler correctly flags it as "due" after enough time passes.

---

## STEP 5 — Quiz Engine (P1)

1. Build the practice-question generator from the Knowledge Map (weighted toward high-emphasis topics).
2. Fixed difficulty per question — no adaptive difficulty yet.
3. Build the Quiz Mode screen end-to-end (matches mockup): question, answer options, feedback, next-question flow.
4. Wire quiz results into the Mastery Engine (Step 4).
5. Wire XP rewards per question/quiz completion.

**Definition of done**: a student can take a real quiz on their own uploaded material and see their mastery score move afterward.

---

## STEP 6 — Study Plan (P1)

Depends on Steps 4 and 5 being live.

1. Build the recommendation logic: surface today's "quests" from mastery gaps + spaced-repetition due topics.
2. Build the Study Plan screen (matches mockup): quest cards, quest path visualization.
3. Wire the Course Confidence Score (gauge + % + tier) — combines mastery, quiz consistency, Socratic depth.
4. Build the confidence-drop banner — supportive tone, links directly into a relevant quiz/review.

**Definition of done**: opening a course's Study Plan shows real, personalized recommendations, not placeholder content.

---

## STEP 7 — Socratic Tutor Mode (P1)

This is your core differentiator — don't rush it.

1. Build the guided-question AI behavior: the model must never output a final answer, only guiding questions. This needs real prompt engineering and testing, not just "add a system prompt and hope."
2. Build the ability to trigger it from anywhere (Study Plan, mid-quiz, mid-assignment context).
3. Build the fixed dark-theme UI (matches mockup) — stays visually distinct regardless of the app's light/dark mode setting.
4. Build the first-time explainer screen.
5. Wire Socratic session quality into the Mastery Engine's "guessing vs. understanding" signal.

**Definition of done**: a real student conversation in Socratic Mode never leaks a direct answer, even under deliberate attempts to extract one — test this adversarially before calling it done.

---

## STEP 8 — Dashboard (P1)

Depends on Steps 4–7 all feeding real data.

1. Build the mastery heatmap (per-topic, color-coded).
2. Build the "guessing vs. understanding" view.
3. Wire in the streak, badges, and deep-dive session counts.

**Definition of done**: dashboard reflects real, per-course data — not the mockup's static numbers.

---

## STEP 9 — Gamification Core (P1)

1. XP system: award XP for quizzes, reviews, Socratic sessions.
2. Streaks: daily tracking, flame indicator.
3. Rank/Level system tied to XP.
4. Streak Freeze: earned through consistency + purchasable with mini-game XP (mini-game comes in Step 11, but the freeze mechanic/data model can be built now).

**Definition of done**: XP, streaks, and rank update correctly and persist across sessions.

---

## STEP 10 — Profile (P2)

1. Build the editable Profile screen (matches mockup): name, username, email, password, notification toggles.
2. Wire rank-based unlocks (profile frames, etc.).
3. Build account deletion — soft delete, 30-day recovery window.

**Definition of done**: a student can edit their real profile data and see rank-locked items correctly gated.

---

## STEP 11 — Companion Pet + Mini-Game (P2)

Genuinely nice-to-have for launch — sequence this after the study loop works, not before.

1. Build the companion's growth logic: passive growth from studying XP.
2. Build the mini-game (Leaf Match, per mockup) — simple, calm, no timer pressure.
3. Build the shop: spend Garden XP on cosmetics + streak freezes.
4. Wire the companion visual state (stage/decorations) into the Profile screen.

**Definition of done**: studying visibly grows the pet without touching the game; playing the game earns spendable Garden XP.

---

## STEP 12 — Notifications (P2)

1. Streak reminders — fixed daily time (respecting each user's timezone).
2. Review-due reminders (from the spaced-repetition scheduler).
3. Rank/badge unlock notifications.

**Definition of done**: a test user reliably receives all three notification types at the right trigger points.

---

## STEP 13 — Monetization (P2)

Don't build this until Steps 1–9 are solid — you need something worth paying for first.

1. Integrate a payment provider (Stripe or equivalent) for monthly subscriptions.
2. Build the discounted annual plan option.
3. Enforce premium gates: course cap removal, full analytics history, cosmetic pet items.
4. Build the upgrade screen flow (matches mockup), triggered at the course-cap wall.

**Definition of done**: a real test payment correctly unlocks premium features and correctly reverts on cancellation.

---

## STEP 14 — Growth: Referrals (P3)

1. Build the referral link/code system.
2. Trigger the invite prompt after a new user's first good moment (first completed quiz/streak), not at signup.
3. Reward both sides (cosmetic item or streak freeze) on successful referral.

---

## STEP 15 — Content Moderation & Compliance Hardening (P3)

Baseline exists from Step 1 (file-type restriction); this step deepens it.

1. Add automated scanning for off-topic/inappropriate uploaded content.
2. Finalize Terms of Service language on upload ownership.
3. Full privacy/GDPR-level review of data handling, even though launch is single-market.

---

## STEP 16 — Polish & Launch Prep (P3)

1. Full QA pass: loading states, error states, empty states across every screen.
2. Accessibility pass.
3. Security review.
4. Analytics events wired for the Success Metrics (activation, upload completion, quiz completion, retention, mastery growth, premium conversion).
5. Dark mode (Socratic Mode keeps its fixed theme regardless).

---

## Explicitly NOT in this build (do not start)

- Any lecturer-facing feature (all three — shelved until student side is validated)
- Multi-language support
- Adaptive quiz difficulty
- Smart/behavioral notification timing
- Social/competitive features (leaderboards, friend comparisons) — rejected outright for now
- Message queue infrastructure — add only once real usage volume demands it

---

## Suggested team split (adjust to your actual team size/skills)

- **Backend/AI**: Steps 1, 2, 4, 5 (quiz generation), 7 (Socratic prompt engineering)
- **Frontend**: Steps 3, 5 (UI), 6, 8, 9, 10, 11 — turning the existing mockup into real React + Tailwind + shadcn components
- **Full-stack/glue**: Step 12, 13 (payments), 14
- **Whoever owns product/QA**: Step 15, 16, and keeping this document updated as priorities shift
