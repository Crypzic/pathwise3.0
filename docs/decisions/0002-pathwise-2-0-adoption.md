# 0002 — Adopt the PATHWISE 2.0 roadmap; freeze Leaf Match behind a feature flag

Date: 2026-09-02
Status: accepted

## Context

The original 16-step build plan is implemented and verified (136 unit tests).
The "PATHWISE 2.0 Master Product & Engineering Roadmap" now defines the next
direction: evolve the study companion into a connected learning ecosystem
(guest mode, personalized onboarding, Gemini as a testing-phase provider,
multimodal ingestion, Knowledge Layer 2.0, Socratic 3.0, then community and
content layers). Its ground rules: inspect first, extend working systems
rather than rebuild, enforce flags and limits server-side, keep the AI
provider abstraction intact.

## Decision

1. **PATHWISE 2.0 phases are executed in the roadmap's recommended order**,
   each phase verified against the full test suite + typechecks + a server
   boot before it is committed.
2. **Phase 0: Leaf Match is frozen, not deleted.** A server-enforced feature
   flag (`FEATURE_LEAF_MATCH`, default off) disables the Garden XP economy —
   `POST /api/garden/minigame/finish` and `POST /api/garden/shop/purchase`
   return 403 while frozen — and the frontend hides every entry point (nav
   link, profile buttons, `/game` and `/shop` routes). Reads stay open so the
   companion and existing balances remain visible. The code stays in place so
   Wise Path can replace it cleanly later (roadmap Phase 20).
3. **Feature flags get one registry** (`backend/src/lib/features.ts`) exposed
   read-only at `GET /api/config`; the frontend consumes it through a
   `FeaturesProvider` whose defaults match the server defaults, so a failed
   config fetch can never re-enable a frozen surface. Future flags (e.g.
   `FEATURE_USER_VIDEO_POSTING`, roadmap Phase 16) join the same registry.

## Consequences

- No data model changes; Garden XP balances, inventories and companions are
  untouched and become spendable again the moment the flag is turned on.
- `envBool()` was introduced in `lib/env.ts` because `z.coerce.boolean()`
  treats the string "false" as true; `MODERATION_ENABLED` now uses it too
  (same default, but `MODERATION_ENABLED=false` actually works now).
