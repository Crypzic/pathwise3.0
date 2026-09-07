# Pathwise — Founder & Team Ops Checklist

*Non-code fundamentals the team should know before and while building. Ordered by urgency — top section matters before real users arrive.*

---

## 1. Before you have real users

### Legal structure
- [ ] Register a business entity (LLC or local equivalent) before accepting real payments — separates personal and business liability.
- [ ] Get real Terms of Service and Privacy Policy drafted — a template reviewed by a lawyer (even one cheap consult) beats a fully copy-pasted one once money and student data are involved.

### Data privacy
- [ ] Understand what applies to you: FERPA-adjacent concerns (US, if you ever integrate directly with institutions) and GDPR-level practice generally (already the target architecture — good).
- [ ] Encrypt data at rest and in transit.
- [ ] Don't log more than necessary — audit what's actually being stored.
- [ ] Know exactly where uploaded files live and who/what can access them.

### Intellectual property
- [ ] ToS must make clear the *student* is responsible for what they upload (lecture slides/syllabi often technically belong to the professor/institution, not the student).
- [ ] Never claim ownership of uploaded content; never reuse it beyond the student's own study tools (already committed to this — just needs to be in writing).

---

## 2. Before scaling beyond a few testers

### AI cost economics
- [ ] Model unit economics: cost per active user per month (uploads processed, quizzes generated, Socratic messages) vs. subscription revenue. AI products commonly lose money per user without realizing it until the bill arrives — check this before it's a surprise.
- [ ] Build usage monitoring and rate-limiting in from day one — protects against accidental or malicious runaway costs.

### Payments
- [ ] Use Stripe or equivalent — don't build custom card handling (PCI compliance is handled for you).
- [ ] If going mobile-native later: Apple/Google take a cut of in-app subscriptions (historically up to 30%, sometimes less) — factor this into margins before assuming web-pricing translates directly.

---

## 3. Team process fundamentals

- [ ] **Decision log** — a shared doc recording every non-trivial product/technical decision and the reasoning behind it. Prevents re-litigating settled arguments months later.
- [ ] **Structured user feedback loop** — a simple form or channel once testers exist; separate "one loud user's opinion" from "multiple users independently hitting the same issue."
- [ ] **Support channel from day one** — even just an email address in the app. Silence erodes trust fast, especially for a product whose pitch is built on a privacy promise.
- [ ] **Git workflow agreed up front** — branch naming, PR review expectations — before multiple people are pushing code, not after the first merge conflict disaster.

---

## 4. Lower urgency, but don't skip entirely

- [ ] **Accessibility** — cheaper to build in now than retrofit later; dark mode is already planned, which helps.
- [ ] **Backup / disaster recovery** — automated daily database backups at minimum.
- [ ] **Academic integrity optics** — Socratic Mode is designed to be integrity-safe, but some professors will assume "AI study app" = cheating tool regardless of actual design. Have privacy/integrity messaging ready to show skeptics before you need it, not after a bad first impression.

---

## Quick reference: what to do right now vs. later

**Do now (Step 1 territory in the build plan)**: business entity, ToS/Privacy Policy draft, basic encryption practices, Git workflow, support email.

**Do before opening to more testers**: AI cost modeling, usage monitoring, Stripe integration groundwork, feedback collection method.

**Do before any public/institutional push**: full legal review, accessibility pass, backup strategy, integrity messaging materials.
