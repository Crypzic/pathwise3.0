# 0001 — Backend stack: Node + Fastify + Prisma (not Python/FastAPI, not Supabase)

## Context

The original blueprint specified Python + FastAPI + SQLite. A later brief proposed
switching to React Native/Expo + Supabase + OpenAI. By the time both were being
considered, a teammate had already built a working backend on a third stack:
Node + Fastify + Prisma + SQLite, with a Vite + React web frontend — including
real auth, the Course Intelligence pipeline (Step 2), and a mock/real AI provider
abstraction for cost-free development.

## Decision

Keep the Node + Fastify + Prisma + SQLite backend and Vite + React frontend.
Do not migrate to Python/FastAPI or to Expo/Supabase.

Reasoning:
- Real, working code already existed and closely matched the product blueprint
  and build plan — throwing it away to match an earlier doc would have been
  pure rework for no functional gain.
- TypeScript across both frontend and backend means the team shares one
  language and toolchain, rather than context-switching between Python and TS.
- The AI-provider abstraction (mock vs. OpenAI) was already a strong pattern
  worth keeping regardless of which backend language was chosen.

## Consequences

- Any doc, pseudocode, or planning material written against "FastAPI" or
  "Supabase" should be read as describing *behavior*, not literal
  implementation — the real backend is Fastify/Prisma.
- Database is SQLite for MVP (per the original blueprint's reasoning); revisit
  only once real concurrent-write load justifies Postgres.
- Auth is hand-rolled (JWT via `@fastify/jwt`), not Supabase Auth — protected
  routes use the `authenticate` plugin in `backend/src/plugins/`.
