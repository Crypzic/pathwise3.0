# AI Cost Model

*The AI pipeline is the only part of Pathwise that costs money per use. This is
the math behind the caps. Every figure below is an **estimate at list prices**
(gpt-4o-mini: $0.15 / 1M input tokens, $0.60 / 1M output) — the point of the
`AIUsage` table is to replace these estimates with measured reality during the
beta. Re-run these numbers if the model changes.*

## Per-operation estimates

| Operation | Input | Output | Est. cost | Notes |
|---|---|---|---|---|
| `extract_topics` | ~3,200 tok (12k-char cap + prompt) | ~600 tok | ~$0.0009 | Once per uploaded file |
| `moderate` | ~1,100 tok (4k-char excerpt) | ~50 tok | ~$0.0002 | Once per uploaded file |
| `generate_quiz` (8 q) | ~400 tok | ~1,200 tok | ~$0.0008 | Once per quiz session |
| `socratic_reply` | ~900 tok (10-msg window) | ~70 tok | ~$0.0002 | **Per turn** — and the leak guard's retry can double a turn |

## Monthly scenarios (per active student)

| Profile | Uploads | Quizzes | Socratic turns | Est. AI cost/month |
|---|---|---|---|---|
| Light | 2 | 8 | 30 | ~$0.02 |
| Typical | 4 | 30 | 200 | ~$0.09 |
| Heavy | 10 | 100 | 1,000 | ~$0.40 |

Even the heavy profile sits far below the $5.99/mo Pro price, and free users
are bounded by the course cap plus the daily budget. **The margin risk is not
the typical user — it's the unbounded tail**, which is why three separate
ceilings exist:

1. **`AI_DAILY_USER_BUDGET_CENTS`** (default 50¢/day) — hard per-user ceiling;
   requests past it get a 429. Worst-case abuse is bounded at ~$15/user/month,
   and a student hitting this cap daily is a support conversation, not a
   pricing problem.
2. **`SOCRATIC_MAX_TURNS`** (default 60/session) — Socratic mode is the only
   surface a user can hold open indefinitely.
3. **Per-route rate limits** — uploads 20/10min, Socratic messages 30/5min.

## What to actually do during beta

- Watch `GET /api/ops/metrics` weekly: total spend, spend by operation, and the
  guard-trip rate (each trip is a doubled turn).
- After ~2 weeks of real usage, replace this table's estimates with the
  measured per-operation averages from `AIUsage`.
- If measured "typical" stays under ~$0.15/month, current pricing has an order
  of magnitude of headroom and the daily cap could even be lowered.
- The moderation call is ~20% of upload cost; if measured spend matters, it's
  the first candidate for a cheaper model.
