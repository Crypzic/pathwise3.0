# API docs

**Purpose**: what the frontend can actually call.

**Ownership**: backend, kept in sync with `backend/src/routes/`.

**Current source of truth**: `backend/README.md` has the live endpoint table (method, path, auth requirement, purpose) — that's maintained alongside the actual route code, so it's less likely to go stale than a duplicate table here.

**Convention**: as the API grows past a simple table, split it out properly here (one file per resource, e.g. `courses.md`, `auth.md`) — until then, don't duplicate the table in two places.
