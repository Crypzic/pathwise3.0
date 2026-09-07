# Prompts

**Purpose**: home for real AI prompt templates once they move beyond the mock provider — system prompts for Socratic Mode, quiz generation, topic extraction, etc.

**Ownership**: whoever's tuning AI behavior — coordinate with backend since these get consumed by `backend/src/ai/`.

**Current state**: empty. `backend/src/ai/mock.ts` currently stands in for real AI behavior during development (see `docs/decisions/` if a note gets added on why). As real prompts get built and tested, they belong here — not hardcoded inline in route files — so they're versioned, reviewable, and reusable across providers.

**Convention**: one file per prompt purpose (e.g. `socratic-system-prompt.md`, `quiz-generation.md`). Include the guardrails, not just the happy path — e.g. Socratic Mode's prompt must document what it must never do (give direct answers), not just what it should do.
