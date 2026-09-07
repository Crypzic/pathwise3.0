# Frontend — Pathwise (React + TypeScript + Vite + Tailwind)

The Pathwise design system from `../mockup/styles.css` is ported into
`src/index.css`, so screens match the mockups directly.

## Setup

```bash
npm install
npm run dev     # http://localhost:5173
```

Make sure the backend is running on port 4000 first — Vite proxies `/api/*`
to it (see `vite.config.ts`), so no CORS juggling in development.

## Layout

```
src/lib/api.ts        → fetch wrapper (attaches JWT, throws readable errors)
src/lib/auth.tsx      → auth context (signup / signin / accept-privacy / logout)
src/components/        → AppShell (sidebar layout) + icon set
src/pages/             → SignUp, SignIn, Privacy, Courses, NewCourse
src/App.tsx            → routes + auth guards
src/index.css          → Tailwind + Pathwise design system
```

## Routing / guards

- `/signup`, `/signin` — redirect to `/courses` if already signed in
- `/privacy` — shown once after signup, before the app is usable
- `/courses`, `/courses/new` — require sign-in **and** accepted privacy

## Build

```bash
npm run build     # type-checks then bundles to dist/
npm run preview   # serve the production build
```
