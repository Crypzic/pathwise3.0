# Database docs

**Purpose**: what the data actually looks like, and why — a human-readable companion to the Prisma schema (not a replacement for reading it).

**Ownership**: whoever's touching `backend/prisma/schema.prisma`.

**Expected contents** (add these as the schema grows):
- An overview of each model and what it's for (in plain English, not just the schema comments).
- Notes on any non-obvious modeling decisions (e.g. why SQLite instead of Postgres at MVP, why enums are Strings, why gamification fields live directly on User instead of a separate table).

**Convention**: the schema file (`backend/prisma/schema.prisma`) is the actual source of truth — this folder explains *why*, the schema says *what*. If you add a migration, consider whether it needs a note here too.
