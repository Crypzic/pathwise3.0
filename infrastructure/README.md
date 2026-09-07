# Infrastructure

**Purpose**: deployment, hosting, and CI/CD configuration — the "how does this run in production" folder.

**Ownership**: whoever owns deployment (rotate this explicitly once the team grows past "whoever set it up originally").

## Current deployment: Render (backend) + Vercel (frontend) + Turso (database)

### 1. Create the Turso database (do this first)

**Easiest path, works on any OS including Windows without extra installs**: use the web dashboard.

1. Sign up free at [turso.tech/app](https://turso.tech/app) (GitHub login)
2. Create a database named `pathwise`
3. Copy its URL (`libsql://...`) → `TURSO_DATABASE_URL`
4. Create a token on that database's page → `TURSO_AUTH_TOKEN`

(The Turso CLI is an alternative but requires WSL on native Windows — the dashboard avoids that entirely for this simple setup.)

**Apply the schema.** Prisma Migrate doesn't talk to Turso's `libsql://` protocol directly, so:
- Develop migrations normally, locally: `npm run prisma:migrate` (writes files under `backend/prisma/migrations/`)
- Apply each migration's SQL to Turso using the included script (works on Windows, Mac, Linux — no CLI needed):
  ```bash
  # from backend/, with TURSO_DATABASE_URL and TURSO_AUTH_TOKEN set as env vars
  node scripts/apply-migration.mjs prisma/migrations/<folder>/migration.sql
  ```
- Do this once per new migration going forward.

### 2. Deploy the backend to Render

Either use the `render.yaml` blueprint at the repo root (Render → New → Blueprint, point at this repo), or set up manually:

- **Root directory**: `backend`
- **Build command**: `npm install && npx prisma generate && npm run build`
- **Start command**: `npm run start`
- **Environment variables** (set in the Render dashboard, not committed):
  - `JWT_SECRET` — any long random string
  - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — from step 1
  - `CORS_ORIGIN` — your Vercel URL (update this after step 3)
  - `APP_URL` — same as `CORS_ORIGIN` (used to build password-reset links)
  - `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` — from resend.com
  - `AI_PROVIDER=mock` (or `openai` + `OPENAI_API_KEY` once ready)

Render's free tier spins the service down after inactivity — the first request after idle takes ~30-50s to wake up. Normal, not a bug.

### 3. Deploy the frontend to Vercel

- Import the repo, set **root directory** to `frontend`
- Vercel auto-detects Vite — no build command changes needed
- Environment variable: `VITE_API_URL` = your Render backend's URL (e.g. `https://pathwise-backend.onrender.com`)

### 4. Wire them together

Once both are live, go back and update on Render: `CORS_ORIGIN` and `APP_URL` to your actual Vercel URL, then redeploy the backend so the change takes effect.

### Known limitation

Password-reset emails link to `APP_URL` — make sure it's the Vercel URL in production, not `localhost`, or reset links sent to real users will be dead links.
