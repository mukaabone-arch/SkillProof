# SkillProof — Candidate Journey Design Spec

**Design decisions (locked):**
- **Resume-first** profile creation: upload resume → AI extracts → candidate confirms → profile populated.
- **Dashboard hub** model: a central page shows progress and suggested next steps; not a forced wizard.
- **Free exploration**: candidates can move between profile, assessments, and jobs freely. The dashboard *suggests* the highest-value next action but never locks them into a linear path.

**The through-line:** at every point the candidate should see *where they are* (progress) and *what's most valuable to do next* (a suggested action), without being forced. Momentum through suggestion, not coercion.

---

## The dashboard hub — the heart of the experience

This replaces the current dev-harness JSON page as the candidate's home after login. It's the page they land on and return to. It has four zones:

### 1. Header / greeting
- Greets by name (from profile) or a friendly fallback for brand-new users.
- A **progress indicator** showing overall journey completeness — not just profile %, but journey stage: profile built → first badge earned → jobs explored. A simple visual (e.g. a 3-4 step progress bar or checklist) that fills as they progress.

### 2. "Your next step" — the suggested-action card (the most important element)
A single, prominent card that changes based on the candidate's state. This is how "free exploration" still has direction — it recommends without forcing. Logic:
- **No profile / empty profile** → "Start by uploading your resume — we'll build your profile for you." (CTA → resume upload)
- **Profile built, no badges** → "Prove your skills — take your first assessment and earn a verified badge." (CTA → assessments)
- **Has badge(s), hasn't browsed jobs** → "You're verified! See jobs that now match your skills." (CTA → matched jobs)
- **Established (badges + explored)** → "Earn more badges to unlock more matches" or "You have N new job matches." (rotating, contextual)

Only ONE suggested action shown at a time — the highest-value one for their current state.

### 3. Status zones (glanceable summary of what they have)
Three compact cards, always visible, showing current state and each linking to its full page:
- **Profile** — completeness %, quick "edit" link. Shows a nudge if incomplete.
- **Verified skills** — count of badges earned + the badges themselves (small). Empty state: encouraging prompt to take an assessment.
- **Applications** — count + statuses at a glance. Empty state: "Browse jobs."

### 4. Primary navigation
Persistent nav to the four main areas: **Dashboard, Profile, Assessments, Jobs**. Always accessible (free exploration). Clear active-state so they know where they are.

---

## The resume-first profile flow (reversed from current build)

Currently the profile page is a manual form with resume upload bolted on at the bottom. Reverse it so the AI-magic comes first:

**Step 1 — Upload (the entry point for a new candidate):**
- Prominent "Upload your resume (PDF) and we'll build your profile" — the hero action for a new user.
- On upload → "Parse with AI" (or auto-parse on upload).

**Step 2 — Review & confirm (the magic moment):**
- AI-extracted fields (name, headline, location, experience, detected skills) shown in an editable review card, pre-filled.
- Framing: "We pulled this from your resume — review and confirm." The candidate edits anything wrong, then confirms.
- This is the delight moment — they uploaded a PDF and their profile assembled itself. Make it feel good (a subtle success state on confirm).

**Step 3 — Manual fallback / completion:**
- For candidates without a resume, or to fill gaps the AI missed: the same profile fields available as a normal editable form.
- After confirming, the profile completeness updates and the dashboard's "next step" advances to "take your first assessment."

**Important:** keep the current safeguard — nothing auto-saves; the candidate always confirms AI-extracted data before it's written. (This is both a trust and accuracy requirement you already built.)

---

## The assessment → first badge flow (the pivotal moment)

This is where a candidate becomes *verified* — the core value event. It's currently functional but unguided/unceremonious. Improve:

**Discovery:** From the dashboard's suggested action or the Assessments page, the candidate sees available assessments grouped/filterable by skill domain (your taxonomy). Each shows: skill, level, duration, what earning it means. Recommended ones (matching their profile's detected skills) surfaced first.

**Taking it:** The existing flow (start → questions → submit) with the integrity monitoring already built. Design polish: clear progress ("Question 3 of 10"), a visible timer, a clean question layout, no distractions.

**The payoff — earning the badge:** This is the moment to make feel *great*. On passing:
- A genuine success/celebration state (not the current plain results screen) — "You earned a verified RAG Systems L2 badge."
- Immediately show what it unlocks: "This badge now appears on your profile and matches you to N jobs." — connecting the achievement to the next value (jobs).
- Clear next actions: view certificate, share it, see matched jobs, or take another assessment.

**On not passing:** encouraging, not punishing (you built this) — "Not this time. Review and try again — your best attempt counts." Point to relevant learning or just a retry.

---

## The verified → jobs connection (closing the loop)

The candidate's badge should visibly *do something*. After earning one:
- The dashboard/jobs surfaces "jobs that now match your verified skills" with scores (the matching engine you built).
- "Matched to you" becomes populated and meaningful (it's empty/zero without badges — the flow should make clear that badges drive matches, turning the empty state into motivation).
- Browse → job detail → apply, with clear application status tracking afterward (all built; needs to feel connected, not like separate tools).

---

## Cross-cutting design needs (apply everywhere)

These are the things that separate "functional prototype" from "product," and they're currently thin across all pages:

- **Empty states that prompt action.** Every list (no badges, no applications, no matches) should encourage the next step, not show a blank. Empty states are onboarding in disguise.
- **Loading states.** Assessments, parsing, matching all involve waits — show considered loading feedback, not frozen screens.
- **Success/error feedback.** Consistent, clear confirmation when something works, and graceful, actionable errors when it doesn't.
- **Consistent visual language.** Match the quality of the existing landing page (the "model card" hero aesthetic) across the app — typography, spacing, the reserved "verified green," card styles. Right now the landing page is polished and the app is bare; unify them.
- **Responsive/mobile.** India-first, mobile-heavy audience — the candidate flows especially must work well on a phone.
- **Progress and momentum cues.** The completeness bar, the journey checklist, the "next step" card — reinforce forward motion throughout.

---

## Suggested build sequence (design first, then build in this order)

1. **Design the dashboard hub** — it's the spine; everything hangs off it. Get this visual + interaction right first.
2. **Rework the profile flow to resume-first** with the confirm-magic-moment.
3. **Polish the assessment → badge payoff** (the core value event).
4. **Connect verified → jobs** (make badges visibly unlock matches).
5. **Sweep cross-cutting needs** (empty states, loading, visual consistency, mobile) across all of it.

Design each in a design tool or as a Claude Code UI task *before* wiring logic — the logic/endpoints already exist; this phase is about the experience layer on top of them.

---

## What already exists (so the build reuses, not rebuilds)

Every underlying capability is built and working — this is purely an experience layer over existing endpoints:
- Auth, profile CRUD + resume parse, assessments + badges + certificates, matching, jobs browse/apply, applications, notifications, integrity monitoring.
- The design work does NOT require new backend features (with minor exceptions like a "journey stage" computed field for the progress indicator, which is derivable from existing data).
- The polished landing page already establishes the visual target to match.
