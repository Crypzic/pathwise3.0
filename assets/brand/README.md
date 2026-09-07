# Brand assets

**Purpose**: source logo files, app icons, and brand marks — distinct from `frontend/assets/`, which holds only what's actually bundled into the app.

**Ownership**: whoever owns brand/visual identity.

**Files**:
- `logo-mark.svg` — the icon alone (winding path glyph on a green square). Use this whenever you need a square icon: app icon, favicon, social avatars.
- `logo-full.svg` / `logo-full.png` / `logo-full.jpg` — icon + "Pathwise" wordmark, for headers, docs, decks, anywhere the full name should appear.
- `logo-full-white.svg` / `logo-full-white.png` — same lockup with a white wordmark, for dark backgrounds.
- `logo-mark-512.png` / `logo-mark-512.jpg` / `logo-mark-192.png` — raster exports of the mark at common sizes.
- `favicon-32.png` / `favicon-16.png` — small raster exports for browser favicons.

**In actual use**: the mark is already wired into `mockup/` (auth screens + sidebar) and `frontend/src/components/Logo.tsx` (`LogoMark`, `LogoFull` — import these rather than hardcoding the SVG elsewhere).

**Convention**: this glyph is the *brand* mark, not the companion pet (Sprout) — Sprout belongs on the Profile/game screens, this belongs on auth screens, the sidebar, and anywhere else you need brand identity rather than the in-app character. If you update the mark, regenerate the PNG/JPG exports and update both `mockup/styles.css`-adjacent HTML and `Logo.tsx` together so they never drift apart.
