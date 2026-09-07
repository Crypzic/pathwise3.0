# Pathwise

An AI study companion for university students — upload your course materials, get a personalized study plan, spaced-repetition quizzes, and a Socratic tutor that guides instead of answers.

## Tech stack

- **Frontend**: React + TypeScript, Vite, Tailwind CSS, react-router-dom
- **Backend**: Node + Fastify + Prisma (TypeScript)
- **Database**: SQLite (MVP — see `docs/decisions/0001-backend-stack-selection.md`)
- **AI**: swappable provider — mock (free, default for dev) or OpenAI

> The product docs originally described Python + FastAPI and, briefly, Expo/Supabase. Neither is what's actually built. See `docs/decisions/0001-backend-stack-selection.md` for why we kept the real, working stack instead.

## Repository structure

```
.github/          CI workflow, issue/PR templates, CODEOWNERS
docs/             Product spec, architecture, database, API, roadmap, decisions — see docs/README.md
frontend/         React + Vite web app
backend/          Fastify + Prisma API
infrastructure/   Deployment/CI notes (grows as we actually deploy)
design/           Design tokens & brand source material (see mockup/ for the working reference)
mockup/           Static HTML/CSS — the clickable visual reference for every screen
prompts/          Real AI prompt templates (currently: mock provider stands in, see prompts/README.md)
scripts/          Small shared dev utilities (e.g. scripts/dev.sh)
assets/           Brand assets (logos, icons) — source files, not bundled app assets
```

Every folder has its own `README.md` explaining its purpose, ownership, and conventions — read the local one before adding something to a folder you haven't touched before.

## Local setup

Two terminals (or run `./scripts/dev.sh` from the repo root to start both):

```bash
# Terminal 1 — backend
cd backend && npm install && npm run prisma:migrate && npm run dev

# Terminal 2 — frontend
cd frontend && npm install && npm run dev
```

Then open http://localhost:5173. The frontend proxies `/api` to the backend on port 4000. Everything runs against the free mock AI provider by default — no API key needed to develop. See `backend/README.md` for the full environment variable reference and endpoint table.

## Development workflow

1. Check `docs/roadmap/build-plan.md` for the current priority step.
2. Branch off `main`: `feature/step-N-short-name`.
3. Open a PR using the template — link the build-plan step it addresses.
4. At least one approval required before merging (branch protection on `main`).
5. Squash-merge; delete the branch.

See `CONTRIBUTING.md` for branch naming and commit conventions in full.

## Branch strategy

`main` is always deployable. No direct pushes — everything goes through a reviewed PR.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, `chore(scope): ...`. Full detail in `CONTRIBUTING.md`.

## Status

**Steps 1–15 are built. Step 16 (polish & launch prep) is partly done.**

The full study loop works end-to-end on real uploaded material: upload a
syllabus → weighted knowledge map → personalised study plan → quiz → mastery
moves → spaced-repetition schedules the next review → dashboard reflects it.
Everything runs on the free mock AI provider until an OpenAI key is configured.

| | |
|---|---|
| **Course intelligence** | PDF/DOCX/PPTX → text → content screening → weighted topics → Knowledge Map. Adding material expands the same map. |
| **Mastery & spaced repetition** | Forgetting-curve scheduler driven by last-reviewed + performance. Distinguishes knowing from guessing. |
| **Quiz** | Generated from your own material, weighted by emphasis and mastery gaps. Graded server-side. |
| **Socratic tutor** | Never outputs an answer — enforced by a guard on every reply, not just a prompt. Backed by an adversarial test suite. |
| **Study plan & dashboard** | Quests from real mastery gaps; confidence score from mastery, quiz consistency and Socratic depth. |
| **Gamification** | XP, streaks (with freezes), ranks, badges, a companion that grows from studying, and a calm mini-game. |
| **Monetization** | Monthly + discounted annual plans. `BILLING_PROVIDER=mock` exercises the whole loop without Stripe. |

A beta-prep pass added durable file storage (R2/S3), email reminders, JWT
expiry + security headers + magic-byte upload validation, per-session AI cost
caps, a written cost model, and an in-app feedback channel.

**Deploying for beta testers: follow `DEPLOYMENT.md` top to bottom.** Its
step 0 — running ~10 real syllabi through the real AI provider with
`backend/scripts/check-real-ai.mjs` and judging the output yourself — is the
one task that must happen before anyone is invited. Everything else is wired;
that check is the difference between testers evaluating the product and
testers evaluating placeholder output.

What's still open is listed honestly in **`docs/roadmap/status.md`**, and the
full path from here to a genuinely polished product — beta gates, launch
blockers, calibration work, and product polish — lives in **`ROADMAP.md`**.

## Tests

```bash
cd backend && npm test    # 121 tests: mastery, scheduler, streaks, quests,
                          # confidence, Socratic leak guard, PDF/PPTX line
                          # extraction, webhook signatures
```

No database, fixtures or API keys required — the rules that decide a student's
mastery and study plan are pure functions, tested directly.

## Roadmap

Full 16-step, priority-ranked build plan: `docs/roadmap/build-plan.md`.
Current status against it: `docs/roadmap/status.md`.
Full product spec: `docs/product/master-blueprint.md`.
