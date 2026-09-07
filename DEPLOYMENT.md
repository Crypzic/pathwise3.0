# Deploying Pathwise for the closed beta

*The full stack runs on free tiers: Render (API) + Turso (database) +
Cloudflare R2 (files) + Resend (email) + Vercel (frontend). Work through this
top to bottom; every step lists the env vars it sets.*

## 0. Before anything else — the real-AI check

Everything in this repo was verified against the free mock provider. Before
inviting a single tester, run ~10 **real** syllabi/slide decks from different
subjects through the real provider and read the output yourself:

```bash
cd backend && npm run build
AI_PROVIDER=openai OPENAI_API_KEY=sk-... node scripts/check-real-ai.mjs path/to/real-syllabus.pdf
```

For each file, judge: Are the topics the actual course content (not "Grading
Policy")? Are the weights sane? Would you respect the quiz questions? Does the
tutor stay Socratic under "just tell me the answer"? Fix prompts before beta —
this is the difference between testers evaluating your product and testers
evaluating placeholder output. Cost: ~$0.01–0.03 per file.

## 1. Database — Turso (hosted SQLite, free tier)

Render's disk is wiped on every deploy; a local SQLite file there loses
everything. Turso is the same SQL with durability.

1. Create a database at [turso.tech](https://turso.tech) → copy the URL and an
   auth token.
2. Env: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
3. Apply migrations once from your machine:
   `DATABASE_URL=<local file> npx prisma migrate deploy` won't reach Turso —
   instead run the SQL in `prisma/migrations/*/migration.sql` against Turso via
   `turso db shell`, in folder order. (CI's `migrations` job proves the SQL
   applies cleanly.)

## 2. Files — Cloudflare R2 (S3-compatible, free tier, no egress fees)

Without this, uploaded syllabi vanish on redeploy (extracted text survives in
the DB, the original file does not).

1. Create a bucket in the R2 dashboard, then an API token with object
   read/write for that bucket.
2. Env: `STORAGE_PROVIDER=s3`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
   `S3_BUCKET=<name>`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
3. Verify: upload a file through the app, confirm it appears in the bucket
   under `<userId>/<uuid>-<name>`.

## 3. Email — Resend (free tier: 3,000/month)

Powers password resets **and** the daily streak/review reminder emails — the
channel that brings testers back.

1. Create an API key at [resend.com](https://resend.com); verify a sending
   domain if you have one (`onboarding@resend.dev` works before that).
2. Env: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`.

## 4. API — Render (see render.yaml)

Env checklist for the service:

| Var | Value |
|---|---|
| `JWT_SECRET` | 32+ random characters — generate fresh, never reuse dev's |
| `JWT_TTL_DAYS` | `30` (default) |
| `CORS_ORIGIN` | Your Vercel URL, comma-separated with localhost if you want both: `https://pathwise.vercel.app,http://localhost:5173` |
| `APP_URL` | Your Vercel URL (used in reset links, reminder emails, referral links) |
| `AI_PROVIDER` / `OPENAI_API_KEY` | `openai` + your key |
| `AI_DAILY_USER_BUDGET_CENTS` | `50` (see docs/product/cost-model.md) |
| `MODERATION_ENABLED` | `true` |
| `CRON_SECRET` | Long random string — guards the sweep + ops endpoints |
| Turso / R2 / Resend vars | From steps 1–3 |
| `BILLING_PROVIDER` | `mock` for beta (real payments are a launch decision, not a beta one) |

## 5. Frontend — Vercel

- Project root: `frontend/`. Set `VITE_API_URL` to the Render URL.
- SPA rewrites are already in `frontend/vercel.json`.

## 6. Cron — the reminder sweep

Point any scheduler (Render cron job, cron-job.org, GitHub Actions) at:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<api>/api/cron/sweep
```

every 15–30 minutes. Each user gets at most one reminder of each kind per
local day regardless of how often it fires. This also purges accounts whose
30-day deletion window has expired.

## 7. During the beta — what to watch

- `GET /api/ops/metrics` (header `x-cron-secret`): AI spend by operation, the
  activation funnel, and the **Socratic guard-trip rate** — if that rate
  climbs, the prompt is degrading before your users tell you.
- `GET /api/ops/feedback`: everything testers submit from their profile.
- Resend's dashboard: bounce rate on reminder emails.

## Known limitations going into beta (accepted, documented)

- Uploads are processed synchronously in the request — a very large PDF plus a
  slow model can feel long. Acceptable at beta volume; queue it if p95 upload
  time exceeds ~20s.
- In-app + email notifications only; no push (needs a mobile wrapper anyway).
- Deleting an account hard-deletes DB rows after 30 days, but does not yet
  sweep the user's files out of R2 — add a storage sweep to the purge job
  before public launch.
- `BILLING_PROVIDER=stripe` exists and is webhook-verified, but has not
  processed a real charge; run one $0-trial or live-mode test before turning
  it on.
