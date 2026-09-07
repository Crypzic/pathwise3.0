# Architecture docs

**Purpose**: how the system is put together — the engines, data flow, and core logic patterns, independent of any specific screen.

**Ownership**: backend/tech lead, but frontend should read this too since screens map directly to these engines.

**Contents**:
- `pseudocode.md` — language-agnostic logic for every core engine (Course Intelligence, Mastery, Spaced Repetition, Study Plan, Quiz, Socratic Mode guardrails, Gamification, Notifications, Monetization gate). Read this before implementing any new engine — it's the design reference the real code should match.

**Convention**: when real code diverges from the pseudocode (it will, over time), update the pseudocode doc too, or delete the stale section — don't let it silently rot into something misleading.
