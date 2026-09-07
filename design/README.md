# Design

**Purpose**: design system source material — separate from `mockup/`, which is the interactive HTML reference for what's already been decided.

**Ownership**: whoever's driving visual design.

**Relationship to `mockup/`**: `mockup/` is the working, clickable reference implementation of every screen (open `mockup/index.html`). This folder is for the *inputs* to design work — tokens, brand assets, Figma links — not a duplicate of the mockup itself.

**Expected contents**:
- Design tokens (colors, type scale, spacing) once formalized — should match `mockup/styles.css`, not diverge from it.
- Links to any Figma/design tool files if the team adopts one later.

**Convention**: if you update a color or type choice here, update `mockup/styles.css` in the same change — they should never disagree about what the current design system actually is.
