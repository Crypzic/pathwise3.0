# Pathwise — Master Blueprint & Development Roadmap (v2)

*An AI study companion that helps university students actually understand their coursework — not just get through it.*

---

## 1. Purpose

Master blueprint for building Pathwise — combining the founder-level architecture/phasing with every product decision made through direct brainstorming. This is the single reference document going forward.

## 2. Vision

An AI study companion focused on **mastery, privacy, and calm learning** — not grades, not deadlines, not comparison.

## 3. Product Principles

- **Learning before grades** — the product optimizes for actual understanding, not just faster task completion.
- **Privacy first** — student data and materials are never used beyond their own study tools; stated clearly at signup, not buried in settings.
- **AI guides, it doesn't solve** — Socratic Mode never gives direct answers; it asks guiding questions.
- **No pay-to-learn** — nothing that affects academic trust or core learning is ever paywalled. Premium = capacity, depth, and cosmetics only.
- **Calm UX** — no exam countdowns, no leaderboards, no anxiety-driven design. Confidence-building over pressure.

---

## 4. Core Concept

Students upload their own course materials (syllabus + slides) **per course** — the app is **multi-course** from day one. Each course upload builds a **course knowledge map** (topics extracted and weighted by emphasis), which powers everything else: study plans, quizzes, guided tutoring, and progress tracking.

Materials can be **added to a course anytime** — the map updates and expands as new files come in.

**No exam dates, no countdowns.** This was a deliberate pivot: the app tracks *ongoing mastery* instead of deadline pressure, which also happens to make the product curriculum/calendar-agnostic — it works the same regardless of semester system, term structure, or country.

---

## 5. Core Engines

(Framed as distinct backend systems — each maps to specific student-facing features below.)

| Engine | Purpose |
|---|---|
| **Knowledge Engine** | Parses uploaded materials, extracts and weights topics into the course knowledge map |
| **Mastery Engine** | Tracks per-topic understanding from quiz + Socratic session performance |
| **Confidence Engine** | Rolls mastery, consistency, and Socratic depth into the standing Course Confidence Score |
| **Study Engine** | Generates the daily/weekly Study Plan from mastery gaps |
| **Quiz Engine** | Generates and serves spaced-repetition practice questions, weighted by topic emphasis |
| **Spaced Repetition Engine** | Schedules review timing based on forgetting-curve logic (independent of exam dates) |
| **Gamification Engine** | XP, streaks, streak freezes, rank, companion pet growth |
| **Notification Engine** | Streak reminders, review-due alerts, rank/badge unlocks |

---

## 6. Feature Breakdown

### 6.1 App Structure
- **Courses home screen** — visual grid of course cards (name, mastery %, streak flame — no countdown).
- Tapping a course opens its own Study Plan, Quiz Mode, Socratic Mode, and Dashboard.

### 6.2 Study Plan
- Auto-generated from mastery gaps + spaced-repetition due dates.
- Presented as XP-valued "quests."

### 6.3 Quiz Mode
- Spaced-repetition practice questions, weighted toward emphasized topics.
- **Fixed difficulty per question**, resurfaced via spaced repetition (adaptive difficulty deferred to phase 2+).
- Framed as original practice questions — never "predicted exam questions" (keeps it professor-safe).

### 6.4 Socratic Mode
- Never gives direct answers — only guiding questions.
- Can be triggered from anywhere, including mid-assignment.
- **Fixed dark, calm visual theme** — stays this way even if the rest of the app is in light mode, preserving the "different kind of effort" signal.
- **First-time explainer** shown once, on first use, so it doesn't feel broken or unhelpful.

### 6.5 Course Confidence Score
- Replaces the old exam-countdown concept entirely.
- Always-on indicator combining mastery %, quiz consistency, and Socratic depth.
- Displayed as a **combination**: gauge/dial + percentage + word tier (e.g. "78% — Solid").
- **Proactive banner** if confidence drops on a topic — worded supportively, never alarmist (e.g. "Cell Division's slipping a bit — want a quick review?").

### 6.6 Dashboard
- Mastery heatmap per topic (color-coded).
- "Guessing vs. understanding" view — separates lucky quiz-correct answers from reasoned-through understanding (via Socratic session quality on the same topic).

---

## 7. Gamification

- **XP** — earned from quizzes, reviews, and Socratic sessions.
- **Streaks** — daily streak tracking with a flame indicator.
- **Streak Freeze** — protects a streak if a day is missed; earned through consistency **and** buyable with mini-game XP.
- **Rank/Level** — unlocks profile customization (photos, frames, usernames).
- **Quest Path** — topics as beads on a winding path (mastered / in-progress / weak / locked) — ties directly to the Pathwise name and green brand direction.
- **Companion Pet** (mini-game):
  - Grows from **studying XP** (passive — rewards consistency).
  - Decorated using **mini-game XP** (active — accessories, habitat items, streak-freeze purchases).
  - Purpose: calming "brain break," not competitive.
  - **No leaderboards or social comparison** — fully private and personal.

---

## 8. Monetization

**Model**: Free app + monthly subscription (ChatGPT/Claude-style), optional discounted annual plan. Semester-based billing rejected — school calendars vary too much to sync reliably.

**MVP Premium features**:
- Course cap removed (beyond free limit)
- Full analytics history (vs. free = recent view only)
- Cosmetic pet items

**Course cap UX**: hitting the limit shows an upsell screen.

**Hard rule**: nothing academically core (Socratic Mode, quizzes, study plan) is ever paywalled.

---

## 9. Notifications

Triggers: streak reminders (fixed daily time — smart/adaptive timing is phase 2), review-due reminders (spaced repetition), rank/badge unlocks.

---

## 10. Growth

**Referral system** — invite a friend, both get a reward (cosmetic pet item or streak freeze). Triggered after the inviter's first good experience (e.g. first completed quiz/streak), not immediately at signup.

---

## 11. Privacy, Trust & Moderation

- Core promise stated clearly **at signup**: progress data is the student's own; uploaded materials are never used beyond their own study tools.
- Architecture built privacy-first (GDPR-level care) from day one, even though launch is single-market/English-only.
- **Content moderation (MVP baseline)**: restrict processing to expected file types (PDF, DOCX, PPTX); basic automated scan for off-topic/inappropriate content; ToS requiring uploads be the student's own coursework.

---

## 12. Account Management

- **Deletion**: soft delete with a 30-day recovery window.
- **Dark mode**: included in MVP (Socratic Mode keeps its fixed dark theme regardless of this setting).

---

## 13. Onboarding Flow

1. Sign up (name, email, password)
2. Privacy statement shown once, clearly
3. Add first course (name + upload syllabus/slides — no exam date field)
4. Land on that course's Study Plan
5. First time opening Socratic Mode → short explainer

No pre-loaded sample/demo course — straight into the student's own upload.

---

## 14. Branding

- **Name**: Pathwise
- **Color direction**: green core palette (fits "path" + growth/companion themes)
- Signature visual elements: Quest Path (bead path), Quest Cards (notched ticket edges), Companion Pet
- Socratic Mode intentionally breaks from the green brand — stays in its own dark, calm palette

---

## 15. International Approach

- **Launch**: English only, single market/region.
- **Architecture**: privacy-first, currency-flexible, timezone-aware from day one (avoids painful retrofitting).
- Notification timing respects each student's local timezone.
- Exam-date removal already makes the app calendar/curriculum-agnostic — a hidden win for international readiness.

---

## 16. Lecturer Side — Shelved for Now

Deliberately out of scope until the student product is validated. Suggested build order when revisited:

1. **Socratic Mode integrity verification** — confirms the AI isn't giving direct answers; useful even at small scale, builds institutional trust fastest.
2. **Anonymized class-wide struggle topics** — aggregate view of class-wide weak spots; needs real usage scale to be meaningful.
3. **AI exam-question overlap checker** — compares a lecturer's draft exam against Pathwise's generated questions; most complex and highest liability — build last.

---

## 17. Technical Architecture

**Flow**: Frontend → API → Auth → Database → Storage → AI Pipeline → Engines → Notifications

> **Note on scope**: the original blueprint included a message **queue** between Storage and the AI Pipeline. That's the right instinct for scale, but premature at MVP — worth adding only once real upload/processing volume justifies it. Building it now would be solving a problem you don't have yet.

**Database entities**: Users, Courses, Uploads, Topics, Knowledge Maps, Quiz Attempts, Study Sessions, Mastery, Confidence, XP, Pets, Notifications, Subscriptions.

---

## 18. Build Phases

| Phase | Focus |
|---|---|
| 0 | Foundation (auth, DB, base infrastructure) |
| 1 | Course Intelligence (upload → knowledge map) |
| 2 | Study Engine (Study Plan generation) |
| 3 | Quiz Engine (spaced repetition + practice questions) |
| 4 | Socratic Tutor (guided-question mode) |
| 5 | Gamification (XP, streaks, pet, rank) |
| 6 | Premium (subscriptions, course cap, cosmetics) |
| 7 | Polish & Launch |

---

## 19. Success Metrics

Activation rate, upload completion, quiz completion rate, retention (streak survival), mastery growth over time, premium conversion rate.

## 20. Definition of Done (per feature)

UI complete, backend wired, database schema in place, loading/error states handled, analytics events firing, tests passing, basic security review done, accessibility pass complete.

---

## 21. Explicitly Deferred to Phase 2+

- Lecturer-side features (all three)
- Multi-language support
- Adaptive quiz difficulty
- Smart/behavior-based notification timing
- Broader premium feature set beyond the MVP three
- Message queue infrastructure
- Any social/competitive features (rejected outright for now, not just deferred — revisit only if evidence suggests it fits the wellbeing-first tone)

---

## 22. Immediate Next Steps

1. Finish rebuilding the responsive site (Pathwise rebrand, green palette, Courses grid home, Confidence Score component, exam countdown removed) — in progress.
2. Design the Companion Pet screen/profile integration.
3. Design the premium upsell screen (triggered at course cap).
4. Design the Socratic Mode first-time explainer.
5. Once design is settled, begin the actual React + Tailwind + shadcn build, starting with the Quest Card component.
