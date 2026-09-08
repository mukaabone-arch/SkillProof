# SkillProof Feature Inventory — Candidate & Employer Portals

**Purpose:** research artifact for help-guide planning. Not user-facing copy. Compiled from a direct read of the route/component tree (`apps/web/app/**`) and backend services (`apps/api/src/modules/**`, `apps/api/prisma/schema.prisma`) as of 2026-09-08. Admin console and candidate Premium *feature content* are out of scope by request — Premium is feature-flagged off (`plans.premiumEnabled` in `apps/api/src/config/feature-flags.config.ts`), target launch **14 November 2026** (public copy says "November," never the exact date).

Confidence notes are inline. Where a researcher could not confirm something from code, it's marked **[unconfirmed]** rather than guessed.

---

## Part 1 — Candidate Portal

Nav (`CandidateNav`): **Dashboard** (`/candidate`) · **Profile** (`/profile`) · **Assessments** (`/assessments`) · **Jobs** (`/jobs`) · **Interviews** (`/interviews`) · conditional **Upgrade** (`/upgrade`, shown only when `tier === 'FREE'`) · Log out.

Hard gate ahead of everything: any candidate missing a verified phone **or** email is redirected to `/verify` before reaching any other candidate route. OAuth signups (Google/GitHub) routinely land here since those providers don't always supply a phone.

### 1.1 Dashboard — `/candidate`

**File:** `apps/web/app/candidate/page.tsx` + `components/Dashboard.tsx`

**Purpose:** Landing page — login for anonymous visitors, otherwise a personalized "what to do next" hub ("co-pilot").

**Actions:**
- Log in via OTP or OAuth (`OtpLogin`); reactivate a deactivated account (`ReactivatePrompt`); log out.
- **Co-pilot CTA** — one dynamically-computed, most-urgent action (priority ladder below). For an employer assessment invite this is an inline action (`POST /assessment-requests/mine/:id/start`) that routes straight into the correct take-flow; otherwise a plain nav link.
- Dismiss/act on a login-method nudge ("add a phone" / "add an email") — dismissal is per-user, stored in `localStorage`, purely cosmetic.
- Three status cards linking to Profile / Assessments / Jobs.
- Link to `/resume` (build a resume PDF).

**Gates:** None to view the page itself. `PLATFORM_ADMIN` accounts are redirected to `/admin/assessments` instead.

**Co-pilot priority ladder** (mutually exclusive, most urgent first):
1. Interview pipeline alerts — HIRED → OFFER awaiting your response → INVITED → INTERVIEWING (with round detail if scheduled).
2. A discussion assessment awaiting review (`AWAITING_SCORING`/`AWAITING_REVIEW`).
3. An employer-triggered assessment invite (soonest-expiring active one; falls back to the most recently expired if none active).
4. No profile yet → "build your profile."
5. No badge yet → "take an assessment" (or "wait for one to open" if the catalog is empty).
6. Best unapplied job match ≥65% → "worth a look."
7. A recurring skill gap (missing skill blocking ≥2 of top-5 matches) → "close the gap."
8. Best unapplied match <65% → "keep going."
9. Has applied to something → "I'll keep watching."
10. Fallback → "earn another verified skill."

**Non-obvious states:**
- "Jobs explored" is **not tracked** — a job-page view isn't persisted, so the co-pilot never reasons from "you looked at this," only from applications/badges/matches.
- Three real (not hypothetical) account-linking gap variants: has-phone-no-email, has-email-no-phone, and has-neither (an OAuth signup whose provider didn't report a verified email — access is only via the Identity row).
- A terminal `EXPIRED_UNBILLED` employer invite still surfaces once in the co-pilot banner, purely to inform the candidate what happened, even though it's unactionable.

### 1.2 Profile — `/profile`

**File:** `apps/web/app/profile/page.tsx`

**Purpose:** Edit the profile employers see alongside verified badges.

**Actions:**
- Edit/save: full name, email, headline, role title (structured dropdown + "Other" free text), location (autocomplete → structured; free text alone is a legacy fallback that does **not** unlock location-aware features), open-to-remote checkbox, years of experience, AI-specific years of experience, GitHub/LinkedIn URLs. `PATCH /profiles/me`.
- Upload/remove profile photo (JPEG/PNG/WebP ≤5MB) — served only via an authenticated proxy, never a public URL.
- Upload resume PDF (≤5MB).
- **"Parse with AI"** → suggests name/headline/location/years-of-exp/role from the resume; candidate must explicitly click "Looks good — apply to my profile" before anything writes. Detected skills are shown but never auto-saved.
- `CertificationsPanel` — add/edit/delete non-MyAmbii certifications (Credly, Coursera, LinkedIn Learning, PMI, PeopleCert, AWS, Microsoft, Google, Scrum Alliance, Udemy, edX, NPTEL, or free-text Other) with a URL or uploaded file as proof, plus optional skill tags.
- `ProfileViewersPanel` — read-only "who viewed you" (Premium gate, see §4).

**Gates:**
- Role title is display/filter only — explicitly never wired into scoring.
- A certification's skill tags only affect match score once `verificationStatus === VERIFIED` (Credly auto-verifies; everything else is `LINK_PROVIDED` or `SELF_REPORTED` and never boosts matching).

**Non-obvious states:** three visually distinct certification trust tiers (VERIFIED indigo pill / LINK_PROVIDED gray / SELF_REPORTED bare outline) deliberately never rendered like a real MyAmbii badge (green); EXPIRED certs get their own warning badge plus an `isExpiringSoon` countdown.

### 1.3 Profile → Account — `/profile/account`

**File:** `apps/web/app/profile/account/page.tsx`

**Purpose:** Login-method management + the two serious self-service account actions.

**Actions:**
- Add a missing phone/email, or change an existing one, via OTP onto the same account — prevents accidental account splitting.
- **Deactivate account** (reversible): optional reason (category + free text, skippable); hides the profile from search/matching/new results, stops shortlisting/invites/notification emails; profile, badges, applications, and history are untouched. Reactivate simply by signing back in.
- **Delete account** (permanent): type `DELETE` to confirm; removes name/email/phone/photo/resume/profile details. Verified badges remain independently verifiable but anonymized. Employer-side hiring records (applied/shortlisted/interviewed) are kept, anonymized.
- **"Download my data" (DPDP/GDPR export):** fully built (request → poll → presigned download link, 7-day expiry) but **currently hidden** behind `SHOW_DATA_EXPORT_UI = false`, flagged in-code as temporary and required before public launch. **Do not document as live.**

**Non-obvious state:** a deactivated account sees only a "sign back in to reactivate" card in place of the deactivate/delete cards.

### 1.4 Profile → Billing — `/profile/billing`

**File:** `apps/web/app/profile/billing/page.tsx`

**Purpose:** Read-only list of the candidate's own GST tax invoices/receipts for Premium subscription charges.

**Actions:** Download a generated document.

**Non-obvious state:** a `PENDING`/`FAILED_NEEDS_ATTENTION` document shows "Preparing…" with no download button (no visual distinction between the two — see employer-side billing note, same pattern). Empty state explicitly reads as irrelevant pre-Premium: "these appear here after your first Premium charge."

### 1.5 Assessments — `/assessments`

**File:** `apps/web/app/assessments/page.tsx`

**Purpose:** Catalog of every skill/level a candidate can attempt, plus employer-triggered invitations.

**Structure:** one card per skill (grouped by domain, collapsible), one row per level L1–L4.

> ⚠️ **Confirmed copy bug:** the page's own intro text says *"Each skill has three levels — Foundational, Practitioner, and Advanced,"* but the code's `LEVEL_INFO` map and `SkillLevelName` type define a fourth level, **L4 "Expert."** This is a live inconsistency in the product, not just a gap in the brief — see Part 3.1.

**Per-level state machine (server-enforced, UI is a courtesy):**
| State | Meaning | Action shown |
|---|---|---|
| `LOCKED` | Above the level immediately after your highest earned level | None — shows what unlocks it |
| `SUBSUMED` | A gap below your highest earned level, with no badge of its own | None — "Covered by your X badge" |
| `AVAILABLE` | The one attemptable level right now | Start (TEST) / Start discussion (if offered) |
| `EARNED` | Already have a valid badge | Terminal for TEST-earned unless a DISCUSSION format also exists (offered as a strictly-stronger "upgrade" retake); DISCUSSION-earned is unconditionally terminal |
| Earned-but-expired | Badge lapsed after 1 year | Same actions as AVAILABLE, framed honestly as "expired — retake to renew" |

Sequential leveling is strict and scoped to what a skill actually offers, not the abstract ladder — a skill offering only L2 makes L2 available from the start, not "locked behind a nonexistent L1."

**Gates:**
- **Profile readiness** (`isProfileReadyForAssessment`): full name **and** (headline **or** years-of-experience). Missing this disables Start buttons with a tooltip + inline banner. Server-enforced too (`PROFILE_INCOMPLETE_FOR_ASSESSMENT`).
- **FREE single-skill lock** (`singleSkillRestriction`): a FREE candidate's first self-serve MCQ attempt permanently locks all future self-serve MCQ activity to that one skill (`CandidateProfile.freeSkillLockId`). Other levels of the *same* skill stay open; a different skill shows a lock banner + Upgrade link. Already-badged skills stay visible regardless. Does not apply to employer-paid attempts.
- **Retake cooldown** (`retakeCooldownDays` = 0 both tiers today) and **lifetime retake cap** (`retakesPerSkillLifetime`: 1 FREE / 3 PREMIUM), both scoped per skill+**level**. Cap effectively resets once a badge lapses — only attempts after the most recent expired badge count toward it.
- **Monthly assessment-start quota** (`assessmentsPerMonth`) — `null` (unlimited) on both tiers today, so this meter never actually renders in practice.

**Employer Invitations block** (top of page): shows only `ACCRUED_PENDING_START` requests. Explicitly discloses, before the candidate clicks Start, exactly what the employer will and won't see afterward (pass/fail + score/topic breakdown for TEST; pass/fail only for DISCUSSION — never the conversation or individual answers).

**Non-obvious states:**
- A `DISPUTED` discussion session shows "Available after your dispute is resolved" — a genuine dead end with no visible timeline until an admin acts.
- `INSUFFICIENT_PROBING` on a rejected discussion session bypasses cooldown entirely, worded distinctly ("This session didn't give you a fair shot — retake now").

### 1.6 Assessment take-flow (TEST/MCQ) — `/assessments/[id]`

**File:** `apps/web/app/assessments/[id]/page.tsx`

**Flow:** "Before you begin" integrity notice (mandatory checkbox; a second mandatory checkbox if this is the FREE tier's skill-locking first attempt) → start → answer MCQs (auto-saved, idempotent) → server-authoritative countdown (auto-submits at zero) → Submit → synchronous grading → result.

**Integrity monitoring while in progress** (silent, non-blocking, review signals only — never automatic failures): tab/window blur+focus, fullscreen-exit, paste attempt (blocked and logged), copy attempt (logged), right-click (logged), PrintScreen keyup (logged — explicitly a *partial* signal; OS-level tools like Snipping Tool are undetectable). Best-effort `requestFullscreen()` on start.

**Result screen:** score %, pass/fail vs. threshold, per-topic breakdown (aggregate correct/asked counts only — never which specific questions). On pass: badge card with verify-hash link to the public certificate, expiry date, attempt number. On fail: contextual retake copy ("Try again" or "Explore other skills") depending on cooldown/cap state.

**Gate errors** share one exception shape, differentiated by `metric`: `retakeCooldownDays`, `retakesPerSkillLifetime`, `singleSkillRestriction`, `assessments` (shared monthly quota — currently unreachable since it's unlimited).

### 1.7 Discussion (AI conversational) assessment flow

Only **one** skill/level exists today: **RAG Systems L2** — every "discussion assessment" reference in the product is this single offering.

- **Setup** — `/assessments/discussion/[slug]`: sets expectations (~20 min, work alone, session recorded and reviewed by a person, results within a day). "Start" (or "Resume" if `IN_PROGRESS`/`EXPIRED`) → idempotent `POST /assessment-sessions` (returns the existing session rather than forking a second one).
- **Live session** — `/assessments/discussion/session/[id]`: chrome-free; topbar shows a question counter (current/total claims — never *which* claim, to protect the rubric), a cosmetic countdown (the real timeout is idle-based, not this timer), and a pinned collapsible brief. Free-text answers (Cmd/Ctrl+Enter or button). After each topic concludes, an inline **"Reviewer notes"** card shows live, informal AI coaching (tone + strengths/gaps) — explicitly **not** the official verdict, which stays hidden until a human reviews. Thumbs-up/down feedback on each note.
  - **Idle handling:** session flips to `EXPIRED` after 15 minutes idle — but reloading auto-resumes it server-side and re-asks the last probe. The candidate never sees a dead-ended "expired" screen.
  - **Exiting mid-session** is non-destructive — confirm dialog explains the session stays open for later.
  - Composition telemetry (paste count/size, blur count/duration, time-to-first-keystroke, WPM) is captured per answer as reviewer-facing signal — never shown to the candidate.
- **Waiting state** once all claims are done: "A person on our team reviews it... you'll hear back within a day" — no further interaction until a decision lands. **No SLA is enforced in code** — "within a day" is a stated expectation, not a guarantee the system tracks or escalates.
- **Result** — `/assessments/discussion/session/[id]/result`: shown once `ISSUED`/`REJECTED`/`DISPUTED`/`INSUFFICIENT_PROBING`. Per-claim verdict (✓/✗/◐), reviewer's written reason, whether the claim gates the badge. Candidate can dispute any un-disputed claim (free text) → "Under review" → "Dispute resolved." Full transcript available via a `<details>` toggle.
  - `INSUFFICIENT_PROBING`: framed as the assessor's failure, not the candidate's — no per-claim verdicts, immediate no-fault uncapped retake.
  - `REJECTED`: immediate retake offered, or a cooldown date.
  - `DISPUTED`: dead end until admin resolution, no visible timeline.

### 1.8 Jobs — `/jobs`

**File:** `apps/web/components/CandidateJobs.tsx` — three tabs (`?tab=matched|browse|applications`)

- **Matched to you** — jobs ranked by score against live openings, with a score bar, matched/missing skills, "✓ Applied" flag. Empty state differs by cause: no verified skills yet → CTA to take an assessment; verified but zero live matches → CTA to browse instead.
- **Browse jobs** — search-first (no auto-load): skill (from taxonomy), free-text location, remote-only checkbox.
- **My applications** — status shown depends on `applicationStatusDetail`: PREMIUM sees the raw `ApplicationStatus` value; **FREE sees a coarsened 3-bucket version** (Submitted / In review / Decided) with an inline Upgrade link. **This folds `SHORTLISTED` into "In review"** alongside plain `REVIEWED` — a FREE candidate gets no visible signal that they've actually been shortlisted, a meaningfully positive event. Flagged in Part 5.

### 1.9 Job detail & apply — `/jobs/[id]`

**File:** `apps/web/app/jobs/[id]/page.tsx`

**Apply gates** (pre-flighted client-side, always enforced server-side):
1. `PROFILE_INCOMPLETE` — name + experience.
2. `RESUME_REQUIRED` — a resume must be on file.
3. `AI_EXPERIENCE_REQUIRED` — `aiYearsOfExp` must be explicitly set (0 is a valid, real answer — a strict null check, not falsy).
4. `BADGE_REQUIRED` — at least one verified credential of *any* kind (MyAmbii badge, verified legacy `ExternalCredential`, or a VERIFIED `Certification`) — any one satisfies it.

**Application-limit surfacing:** `UsageMeter` shows "N of 10 applications left this month" (renders nothing on PREMIUM). Apply → `POST /jobs/:id/apply` → refetches entitlements (never optimistic-decrements; a downstream 4xx is refunded server-side, so the meter must re-fetch to stay accurate).

**[unconfirmed]** the researcher could not confirm the job-detail page has a friendly, specific "you've hit your 10/month cap" message analogous to the one on the assessment take-flow — worth verifying with engineering before writing help copy that promises a specific on-cap experience.

**Gap analysis:** basic (FREE) = missing-skill list + Upgrade nudge; detailed (PREMIUM) = same list ranked by "needed by N of your matched roles" — deliberately never salary-mapped (too little salary data on postings to make that honest).

**Salary display:** ₹, Indian digit grouping, INR-only; `salaryNotDisclosed` overrides everything else.

### 1.10 Interviews — `/interviews`

**File:** `apps/web/components/CandidateInterviews.tsx` + `InterviewPrepPanel`

**What an "interview" is here:** one row per `ShortlistEntry` the candidate is on, across every employer — not one row per interview event.

**Stage labels:** SHORTLISTED ("On their shortlist") → INVITED ("Invited to interview") → INTERVIEWING → OFFER ("Offer extended") → HIRED / DECLINED / REJECTED / CLOSED.

**Actions:**
- At `INVITED`: Accept (→ INTERVIEWING) or Decline (→ DECLINED, confirm dialog warns it ends the pipeline).
- At `INTERVIEWING` with no round yet: no candidate action — "you're in — the employer will schedule your first round soon" (**explicitly waiting on the employer**). Once a round exists: round number/status/channel (free text, not URL-validated)/scheduled time, display only.
- At `OFFER` with no response yet: Accept / Still deciding (NEGOTIATING) / Decline. After responding: "Your response: X" — waits for the employer to record HIRED/CLOSED.
- Empty state: "No active interview pipelines yet. When an employer invites you after shortlisting you, it'll show up here."

**Deliberately withheld from candidate view:** round history beyond the current round, employer's internal notes, and total round count (no fixed count is ever promised upfront).

**InterviewPrepPanel:** static bundled content (3 guides — behavioral questions, deep-dive prompts for verified skills, questions to ask). Gated by `interviewPrep` entitlement (false FREE / true PREMIUM) — FREE sees real titles with blurred body content + Upgrade CTA.

### 1.11 Other candidate-reachable pages

- **`/resume`** — AI resume builder. Two entry paths: "Improve my existing resume" (upload → AI extraction/rewrite → editable review) or "Build from my profile" (empty editable form). Nothing writes back to the profile — the PDF is a one-off download from the review form's current state. Cosmetically gated: FREE gets a "Verified by MyAmbii" watermark (`resumeBranding`); `resumeTemplates` currently resolves to `['default']` on both tiers (not yet a real differentiator, called out in `plans.config.ts` itself).
- **`/badges/[hash]`** — public, unauthenticated certificate page (the shareable LinkedIn link). Shows name, skill+level, verification method, issue/expiry dates, a positive-only "Verified clean" integrity signal (never a negative "flagged" label), valid/expired state, and a deliberately vague "inactive" account line that never distinguishes deactivation from deletion.
- **`/verify`** — hard gate for any candidate missing verified phone or email.
- **`/upgrade`** — see Part 4.
- **`/employer-invite`** — accepting an *employer* org team invitation; not part of the candidate flow proper.
- **`/auth/google/callback`, `/auth/github/callback`** — OAuth callback handlers, not independently navigable.

---

## Part 2 — Employer Portal

Nav: **Dashboard** · **Job Postings** · **Find Candidates** · **Applicants** · **Shortlist** · **Billing** · **Settings**.

Roles: `EMPLOYER_ADMIN` and `EMPLOYER_MEMBER` have **identical** access to Jobs, Shortlist, Applicants, Candidate Search, and Applications (same `@Roles` decorator on all three controllers). The only admin/member split is inside **Settings**: org-info edits, logo upload/remove, team invite/promote/demote/remove, and org deactivation are admin-only (enforced both client- and server-side). A member sees org info and the team list read-only.

**Gate order encountered on every load:**
1. Auth — no token → `/employer` (OTP login).
2. `organization.deactivatedAt` set → redirect to `/employer/deactivated`, no exempt paths beyond that screen.
3. Org setup incomplete (missing logo, industry, or website) → redirect to `/employer/setup`; exempt only for `/employer/setup` and `/employer/settings`. Server-enforced via `OrgSetupCompleteGuard` on Jobs/Shortlist/Applications controllers — the client check is UX convenience only.
4. Seat limit — `maxOrgMembers = 5` for every org (explicitly not a real "tier," shared with the candidate FREE-tier constant for convenience). Invite disabled at 0 remaining seats.
5. Last-admin protection — demote/remove disabled with a tooltip if it would leave the org with zero `EMPLOYER_ADMIN`s.

### 2.1 Route map

| Route | Component | Purpose |
|---|---|---|
| `/employer` | `EmployerOtpLogin` | Anonymous entry: phone-OTP login/registration. Only route with no sidebar. |
| `/employer/setup` | inline | Mandatory checklist (logo, industry, website) before anything else is usable. |
| `/employer/deactivated` | inline | Terminal explanation screen; only self-service action is logout/contact support. |
| `/employer/dashboard` | `EmployerDashboard` | KPI overview + pipeline funnel; portal landing page. |
| `/employer/jobs` | `EmployerJobs` | Create/edit/publish postings; per-job matches and applicants. |
| `/employer/candidates` | `CandidateSearch` | "Find Candidates" — filtered browse of verified candidates, not tied to a job. |
| `/employer/applicants` | `EmployerApplicants` | Org-wide applicant list across every job. |
| `/employer/shortlist` | `EmployerShortlist` | Collected candidate pool + full hiring pipeline. |
| `/employer/billing` | `EmployerBillingDocuments` | Read-only list of generated GST tax invoices/receipts. |
| `/employer/settings` | `EmployerSettings` | Org profile, verification, logo, team, deactivation. |
| `/employer-invite` | `EmployerInviteAccept` | Team-invite acceptance (reached via email link, not the nav). |

### 2.2 Dashboard

**Non-obvious states:** "Invite your team" nudge — dismissible per-org via `localStorage`, purely optional; disappears once ≥1 teammate has ever been invited (server-derived, not a stored flag). Avg-time-to-hire shows "Not enough data yet" until ≥1 candidate reaches HIRED. KPI cards and "Recent job postings" deep-link into Shortlist/Jobs with the relevant filter/panel pre-opened. A shortlist highlight deep-link (`?candidateId=`, used from assessment-result notification emails) scrolls to and briefly highlights one card, silently no-ops if the candidate is no longer on the shortlist.

### 2.3 Job Postings — `/employer/jobs`

**Lifecycle:** `DRAFT → LIVE → CLOSED`, both directions freely reversible ("Unpublish" / "Reopen") via one generic `PATCH /jobs/:id { status }` — no dedicated publish endpoint, no transition restrictions in code.

- Required to save: title, org-unique job code (internal-only, never shown to candidates), description. Location/salary/experience optional; `salaryNotDisclosed` is tri-state and requires explicit `null` (not omission) to clear existing amounts.
- **Draft-only actions:** Edit, Delete (hard delete; backend rejects delete on LIVE/CLOSED — "a live job's history is closed, not deleted"). A DRAFT job hides "View applicants" entirely (nothing to show); its "View matches" is relabeled "Preview candidate pool" since it isn't live matching yet.
- **"Parse with AI":** paste a JD → suggested title/experience range + taxonomy-mapped skill suggestions (editable level/required before saving); nothing auto-commits.
- **Unpublishing (or org deactivation, which force-closes every live job)** triggers a notification to existing applicants and active (non-HIRED, non-accepted-OFFER) shortlist entries that the role is no longer accepting applications. **This is one-way** — reopening later does not un-notify anyone or restore any pipeline state.

### 2.4 Find Candidates — `/employer/candidates`

`GET /candidates/search` — filters only (skill, minimum level, role title, verified-only toggle). **No scoring or ranking** — results ordered by `updatedAt desc`.

**Gate:** a candidate is only searchable at all with ≥1 VERIFIED skill claim — self-claimed-only profiles never appear.

`roleTitle` is purely display/filter — confirmed never to influence any score.

**This is a different feature from job Matches** (below) — worth being deliberate about the distinction in help copy, since both surface "candidates" but rank/filter completely differently.

### 2.5 Job Matches (inside `EmployerJobs` → "View matches")

`GET /jobs/:id/matches` — a real weighted 0–100 score against that specific job's required/optional skills, computed **only** from verified `SkillClaim`s and verified, non-expired `Certification`s (never unverified claims, never roleTitle/headline/location).

**Scoring, in plain terms:**
- Verified claim at/above required level → full credit. Verified but below → partial credit scaled by proximity. Unverified claim (any level) → 20–40% credit only. Verified non-expired certification for that skill → automatic full credit regardless of claimed level.
- Required skills carry double the weight of optional ("nice to have") skills.
- A small ±5-point experience-range adjustment is layered on top, never dominant.
- **`searchRankBoost`** (Premium tiebreaker) applies **only within a ±10-point score band** — never added to the raw score, so a lower-scoring candidate can never outrank a meaningfully better one purely by paying. Only relevant once candidate Premium ships; not currently visible.
- Only the top 10 scored candidates get an AI-generated plain-language match explanation, generated *after* scoring — narration only, never feeds back into the score.

### 2.6 Applicants — `/employer/applicants`

Org-wide applicant list across every job (distinct from per-job matches).

### 2.7 Shortlist — `/employer/shortlist`

`ShortlistButton` (used identically on Find Candidates, job matches, and applicants) adds a candidate to the org's shortlist — job-scoped or general, **completely independent of `ApplicationStatus`** on any application. A candidate can be shortlisted without ever applying.

**Stage machine and actions:**
| Stage | Employer action available |
|---|---|
| `SHORTLISTED` | Invite to interview (optional message) → `INVITED`, or Reject (optional internal-only reason) → `REJECTED` |
| `INVITED` | None — "Waiting for the candidate to accept or decline." Candidate must act first. |
| `INTERVIEWING` | Add round (channel/scheduled time/internal note, server-assigned `roundNumber`) and Edit round (status: SCHEDULED/COMPLETED/PASSED/FAILED + detail), repeatable with no fixed count → Extend offer → `OFFER` |
| `OFFER` | Shows candidate's own separate write, `candidateResponse` (ACCEPTED/DECLINED/NEGOTIATING, or "No response yet") → employer resolves with Mark hired or Close (no hire) → `HIRED`/`CLOSED` (both require a confirm dialog labeled "the final pipeline outcome") |
| Any of the above | Reject (from SHORTLISTED/INVITED/INTERVIEWING/OFFER); Remove (delete the entry entirely, always available) |

Notes are free-text, editable any time, org-internal. `InterviewRound.note` is employer-only, never returned to the candidate.

> ⚠️ **Confirmed gap, not just a docs question:** the frontend's `Stage` type and its label/badge/filter maps enumerate only 8 of the schema's 9 `ShortlistStage` values — **`CANDIDATE_UNAVAILABLE` is missing entirely.** This status is system-set (never a hiring decision) when a candidate with a live pipeline entry (INVITED/INTERVIEWING/OFFER) deactivates or deletes their account, with `preUnavailableStage` recorded for reversal on reactivation. If this state ever reaches an employer's shortlist view, the badge renders with no label/variant and the stage-action panel renders nothing (falls through every stage check). **Flagging for engineering**, since a help guide can't accurately describe a UI state that silently breaks.

### 2.8 Billing — `/employer/billing`

Read-only: lists `Document` rows (TAX_INVOICE/RECEIPT, amount, issued date) with Download once `status === GENERATED`; "Preparing…" for `PENDING`.

> ⚠️ `FAILED_NEEDS_ATTENTION` has **no distinct UI treatment** from `PENDING` — both show "Preparing…," which would misrepresent a stuck/failed document as still-in-progress indefinitely.

> ⚠️ **No employer self-service billing-profile form** (legal entity name, GSTIN, billing address, GST place-of-supply) exists anywhere in the employer portal — that form (`BillingProfileForm.tsx`) exists only under the admin console. An employer cannot correct their own GST/legal details without going through platform support, yet correct GST details are exactly what the tax invoices on this page depend on.

> ⚠️ **No running "accrued but not yet invoiced" balance is shown anywhere.** Assessment-request charges accrue immediately (postpaid) but the only billing view shows already-`GENERATED` documents from the monthly invoicing run. An employer who fires off several assessment requests mid-month has no way to see what they currently owe until next month's invoice appears.

Team seat usage (`{used} of {limit} seats`) is shown on **Settings**, not Billing — unrelated to invoicing; seats are a fixed platform limit, not a paid add-on.

### 2.9 Settings — `/employer/settings`

- **Org info** (industry dropdown + "Other" free text, website URL, logo upload/remove — JPEG/PNG/WebP): admin-only edit, everyone can view.
- **Verification:** `UNVERIFIED → PENDING → VERIFIED`, or `→ REJECTED` (with reason, resubmittable). "Submit for verification" only appears for UNVERIFIED/REJECTED, admin-only. **No other gate in the portal was found to actually depend on this status being VERIFIED** — jobs/shortlist/search all work regardless. **[unconfirmed]** whether verification currently gates anything server-side that isn't visible client-side — worth confirming with backend before a help guide implies it "unlocks" something.
- **Team:** invite by email (seat-limited), promote/demote, remove, revoke pending invitation. Pending invitations show `PENDING` (with expiry) or `EXPIRED` — **no resend action for an expired invite, only revoke**; the fix (revoke, then send a fresh invite to the same email) isn't spelled out anywhere in the UI.
- **Deactivate organization:** admin-only, two-step (open → live preview of exactly how many live jobs and distinct applicants/shortlisted candidates will be notified → type the exact org name to confirm). Explicitly irreversible in the UI copy: "There is no self-service way to undo this. Reactivation is only available through MyAmbii support" — and even then, unpublished jobs are **not** reopened automatically on reactivation.

### 2.10 Employer-triggered assessment requests (cross-page: `AssessCandidateAction` on every Shortlist card)

- Skill+level picker draws from **live MCQ assessments only** — the one DISCUSSION-format skill (RAG Systems L2) is **not** offered here. Requesting a discussion-format verification for a candidate isn't possible from the UI today — called out in the source itself as a known limitation, not a bug.
- Cost shown before commit: ₹150 + 18% GST = ₹177 (display mirrors the server-decided default), gated by an explicit "I understand this will appear on my organization's next invoice" checkbox before Submit — a deliberate anti-surprise-billing step.
- `ALREADY_BADGED` short-circuits with a distinct "already verified, zero charge" message.
- Status shown per request: `ACCRUED_PENDING_START` ("Awaiting start"), `STARTED` ("In progress"), `COMPLETED` ("Result ready" — score%+topic breakdown for TEST only; DISCUSSION shows pass/fail only, `null` not `0`), `EXPIRED_UNBILLED` ("Expired — not billed"), `ALREADY_BADGED` ("Already verified").
- Expiry: hourly job sweeps `ACCRUED_PENDING_START` rows past the 5-day window → `EXPIRED_UNBILLED`, voiding the Transaction (nothing to refund under postpaid).
- Invoicing: monthly cron (1st of month, noon) aggregates each org's uninvoiced accrual transactions into one GST `TAX_INVOICE` per org.

---

## Part 3 — Cross-Cutting Concepts

### 3.1 Verified skills and levels (L1–L4)

**Plain-language:** A skill can be verified at one of four levels, L1 (lowest) through L4 (highest). A level is earned by passing a multiple-choice test or completing a live AI-led discussion for that specific skill+level, followed by human review. Levels must be earned in order within a skill — a candidate may only attempt the level right after the highest one they already hold for that skill (scoped to whatever levels that skill actually offers, not the abstract L1–L4 ladder). Once earned, a verified level appears on the profile, counts fully in job matching, and satisfies the "verified badge" requirement to apply to jobs. It expires one year after issuance.

> ⚠️ **Discrepancy vs. the task brief:** the brief and the `/assessments` page's own intro copy describe three levels (Foundational/Practitioner/Advanced). The schema (`SkillLevel` enum), the assessment catalog's `LEVEL_INFO` map, and the badge resolver's `LEVEL_ORDER` all define a fourth, **L4 "Expert"** ("deep mastery, can review others' work and set technical direction"). L4 is real and load-bearing in the matching/scoring code. **[unconfirmed]** whether any skill in the *live content catalog* currently offers an L3 or L4 assessment at all — that's a content question, not a code question, and should be checked against the live catalog before the guide claims "levels go up to L4" or scopes itself to three. Recommend resolving the `/assessments` page copy either way before it's used as a reference for help-guide language.

**How a level is earned:** pass TEST (MCQ, synchronous grading), or complete DISCUSSION (AI conversation + human review), or already hold an equivalent employer-verified badge.

**TEST vs. DISCUSSION precedence for the same skill+level:** DISCUSSION always outranks TEST as "the" current badge (tie-broken by most recent issuance if two of the same method somehow exist). Every passing attempt still permanently mints its own Badge row — nothing is overwritten; a later *weaker* proof never displaces a stronger one already held. Per the schema's own doc comment, this only matters "nine out of ten times never" since most skill+level pairs only ever have one format available.

**Expiry:** exactly one year from issuance, computed leap-year-safely, enforced at *read* time (expired/revoked badges are silently excluded from the "current" level map) — the Badge row itself is never mutated or deleted, it's a permanent log.

**Retake limits** (from `plans.config.ts`): `retakeCooldownDays = 0` both tiers (no forced wait between retakes); `retakesPerSkillLifetime = 1` FREE / `3` PREMIUM — on top of the always-allowed first attempt, so FREE = 2 total attempts per skill+level, PREMIUM = 4. Scoped **per skill+level**, not skill-wide — passing L1 then attempting L2 is a fresh budget. **Non-obvious:** once a badge expires, the retake counter effectively resets — only attempts after the most recent lapsed badge's expiry count toward the cap.

**FREE single-skill lock:** a FREE candidate's first self-serve MCQ attempt (any level) permanently locks their free self-serve MCQ activity to that one skill for life. Does not apply to employer-paid attempts.

### 3.2 Assessment formats: TEST vs. DISCUSSION

| | TEST (MCQ) | DISCUSSION (AI conversation) |
|---|---|---|
| What it is | Multiple-choice quiz | Live text conversation with an AI assessor |
| Duration | Set per-assessment | Fixed ~20 min (today: single offering, RAG Systems L2) |
| Skills covered | Whatever the MCQ catalog has live | Exactly one today: RAG Systems L2 |
| Scoring | Automatic, synchronous — `scorePercent >= assessment.passThreshold` (threshold is per-assessment, not global) | AI scores 6 rubric "claims"; a human admin then reviews and decides |
| What the candidate sees while waiting | Nothing — immediate result on submit | `AWAITING_SCORING` → `AWAITING_REVIEW` (arbitrary wait, no enforced SLA — stated as "within a day") → `ISSUED`/`REJECTED`/`DISPUTED` |
| Live feedback | None mid-quiz | Yes — informal, non-binding "Reviewer notes" coaching per claim, explicitly never the official verdict |
| Retake/dispute | Standard cooldown/cap rules | Same rules, **plus** a post-decision dispute (one shot per claim) that re-queues the session for admin review |

**Pass/fail mechanics:**
- **TEST:** `scorePercent >= assessment.passThreshold` — content-specific threshold.
- **DISCUSSION:** gates only on 5 of the 6 rubric claims (the 6th, "cost," is shown to the reviewer but never gates issuance). To issue: every gating claim must be `PARTIAL` or better, **and** at least 3 of those 5 must be `DEMONSTRATED`. A claim reviewer-flagged `INSUFFICIENT_PROBING` (the assessor's own failure to elicit evidence) triggers an offered retake rather than a rejection. A dispute upheld in the candidate's favor also exempts them from the retake cooldown.

**Idle/expiry (DISCUSSION only):** a session idle 15 minutes flips to `EXPIRED` — but this is **resumable**, not terminal; reloading re-asks the outstanding probe.

> ⚠️ **Terminology collision worth avoiding in the guide:** "expired" means two unrelated things in this system. A DISCUSSION session's idle-timeout `EXPIRED` state is fully recoverable (resume picks up where you left off). An `AssessmentRequestStatus.EXPIRED_UNBILLED` (employer-triggered request that lapsed unstarted) is permanent. Same word, opposite recoverability — use distinct language for each in any user-facing copy.

**Integrity monitoring (TEST attempts only — no equivalent exists yet for DISCUSSION sessions):** tab-blur, paste, printscreen, rapid-answer, etc. are recorded purely as an audit trail. Crossing a threshold flips `Attempt.integrityStatus` `CLEAN → FLAGGED`.

> ⚠️ **This never blocks or visibly changes anything for the candidate** — grading, badge issuance, and the results page proceed identically whether flagged or not. The only visible trace is on the *outward-facing* public certificate page: a flagged-and-not-yet-admin-approved badge simply omits the positive "Verified clean" mark (no negative "flagged" label is ever shown — presence/absence of the positive signal only). A candidate could be flagged, pass, and see nothing different at all in their own account; the only place the difference shows up is a certificate page they may never check themselves. Worth deciding deliberately whether/how to describe this in a help guide, since it's easy to imply integrity flags "do something" the candidate would notice, when today they mostly don't.

### 3.3 Assessment request lifecycle — self-serve vs. employer-triggered

**These are two different mechanisms, not one state machine reused two ways** — worth stating explicitly, since the shared vocabulary ("assessment," "request") invites the opposite assumption.

**Self-serve** (candidate starts on their own): **no `AssessmentRequest` row is created at all.** It's a plain `Attempt` (TEST) or `AssessmentSession` (DISCUSSION), subject to the full normal entitlement gates (monthly quota, retake cooldown/cap, single-skill lock). Its lifecycle is just `AttemptStatus` (CREATED → IN_PROGRESS → SUBMITTED → GRADING → GRADED, or FAILED_INTEGRITY) or `AssessmentSessionStatus` (§3.2).

**Employer-triggered** (from the shortlist): creates an `AssessmentRequest` row that wraps and drives an underlying Attempt/Session, but **bypasses the candidate's own entitlement gates entirely** since the employer is paying separately. Postpaid: no payment gateway at request time — server decides the amount, shows it to the employer for confirmation, and accrues it immediately to a monthly invoice. Base charge ₹150 + GST (env-overridable). 5-day window to start.

| Status | Plain meaning | What advances it | What the candidate sees |
|---|---|---|---|
| `ALREADY_BADGED` | Candidate already held the badge when requested — terminal from creation, zero charge | Nothing (terminal) | Not surfaced as an actionable invite; effectively invisible to the candidate |
| `ACCRUED_PENDING_START` | Charge recorded, candidate invited, 5 days to start | Candidate starts → `STARTED`; window lapses → `EXPIRED_UNBILLED` | Invite banner disclosing exactly what the employer will see on completion |
| `STARTED` | Started within the window — always billable from here, even if abandoned or later stalls | Terminal grade reached → `COMPLETED` | Normal TEST/DISCUSSION in-progress experience |
| `COMPLETED` | Underlying attempt/session reached a final decision | Terminal | Normal result screen; badge issued if passed |
| `EXPIRED_UNBILLED` | Never started in time — permanently excluded from invoicing; the accrual is *voided*, not refunded (nothing was ever charged to refund) | Terminal | Co-pilot notice: "the request expired before you started it" + a "request a new invite" CTA |

**Naming note:** these were renamed 2026-09 from a prior prepaid model (`PAID_PENDING_START` → `ACCRUED_PENDING_START`, `EXPIRED_REFUNDED` → `EXPIRED_UNBILLED`) — any copy should use current framing ("invoiced monthly," never "paid upfront" or "refunded").

**Reconciliation is pull-based:** `STARTED → COMPLETED` is only checked when the request is read (by either side) or swept by the periodic job — not pushed the instant grading finishes, to avoid a circular module dependency. There can be a short window where an attempt is objectively graded but the request row still shows `STARTED`. Functionally invisible in almost all cases since nearly every read path triggers reconciliation, but a plausible source of a "why does this still say in-progress" support question.

**Race safety:** starting and expiring are atomic conditional updates — a request can never end up both `STARTED` and excluded from billing, and a double-click/reload on start is idempotent.

### 3.4 Matching

**Plain-language:** A candidate's match score against a job is driven **only** by verified information — their verified skill claims and levels, verified certifications tagged to the job's required skills, and years of experience — compared against what the job asks for. Nothing self-reported (headline, role title, location, name) ever affects the score; those exist for display/filtering only. A small tiebreaking edge exists for Premium candidates, but only among candidates who would otherwise tie — it can never make a worse-matched candidate outrank a better one.

**Mechanism:**
- Per required skill: verified + meets/exceeds level → full credit; verified but below level → scaled by proximity; unverified (any level) → 20–40% credit; no claim → zero. A verified claim always outscores an unverified one at any level combination.
- A verified, non-expired certification tagged to a required skill is a floor of full credit regardless of level.
- Required skills count double an optional skill's weight.
- Years of experience is a minor secondary nudge (±5 points) only, never decisive.
- Final score = weighted skill percentage + experience adjustment, clamped 0–100.
- `searchRankBoost` (Premium tiebreaker) only reorders candidates within the same 10-point score band, and is never added to the visible score — by design, so "a paying candidate must never outrank a better-matched one." Only relevant once Premium ships; not currently live in effect (Premium unpurchasable), though the mechanism exists in code today.
- Eligibility to appear in results at all: ≥1 verified skill claim anywhere, and at least one claim (verified or not) on a skill the job actually requires. Zero-verified-skills candidates never appear regardless of unverified claims.
- Only the top 10 scored candidates get an AI-generated match explanation — narration generated after scoring, never fed back into the score.

### 3.5 Application limits (10/month)

**Plain-language:** FREE candidates can submit up to 10 job applications per calendar month; Premium is unlimited (not yet purchasable). The count resets at the start of each month, UTC.

**Mechanism:**
- `PLANS.FREE.applicationsPerMonth = 10`; `PLANS.PREMIUM.applicationsPerMonth = null`.
- **Period is a plain UTC calendar month, not a rolling 30 days.** Reset is always UTC midnight on the 1st — for an IST user (UTC+5:30) that's 5:30am local time, not local midnight. Worth stating precisely rather than just "resets monthly," since the exact clock time is a real (if minor) surprise for non-UTC users.
- Enforcement is atomic and race-safe (conditional DB update) — no double-submit can slip past the cap.
- **At the limit: a hard block, not a warning or partial degrade.** The 11th attempted application is rejected (HTTP 402) before any application record is created — there's no soft/partial state.
- **Where usage is shown:** a single entitlements endpoint returns `{ tier, limits, usage: { applications: { used, limit, resetsAt }, ... }, freeSkillLock, premiumEnabled }` — this is the one source of truth the frontend reads for both the running count and exact reset timestamp, deliberately sharing logic with the enforcement path so display and enforcement can't disagree. Rendered on the job-detail page as "N of 10 applications left this month."
- **Refund path:** if an application attempt fails for a reason unrelated to genuinely using up a slot (a downstream validation/conflict error after the guard already counted it), the count is decremented back, floored at 0, safe to call more than once — a failed *submission* shouldn't cost a slot. **[unconfirmed]** whether the job-detail page has a specific friendly message for hitting the cap itself (see §1.9) — the refund mechanism is confirmed at the API level, but the on-cap UI experience wasn't independently confirmed.

---

## Part 4 — Where Candidate Premium surfaces (content intentionally not described)

Premium is feature-flagged off (`isCandidatePremiumEnabled()`), target launch **14 November 2026** (public copy: "November" only). The flag gates the *checkout entry point* only — it's independent of a candidate's actual `tier`, so an internal test account can already resolve to PREMIUM through the normal subscription path regardless of the flag.

Surfaces to be aware of when writing help-guide copy (do not describe feature content behind these yet):
- **`/upgrade`** — primary marketing/checkout page. While the flag is off, shows a "Premium is coming in November" notice in place of the comparison table, plus a "Notify me" button that writes to `localStorage`. A live-Premium account (pre-launch, internal test only) bypasses this and sees the real comparison table + Razorpay checkout + plan management.
- **`CandidateNav`** — "Upgrade" link shown whenever `tier === 'FREE'`, independent of the launch flag.
- **Inline upsell hints**, all just pointing at `/upgrade`: Assessments catalog (skill lock, retake cooldown/cap, monthly quota), Job detail (application quota, coarse status, basic gap analysis), Profile (`ProfileViewersPanel`'s locked preview), Jobs "My applications" tab (coarsened status), `InterviewPrepPanel` (locked preview), Resume page (branding watermark).
- **`GET /plans`** and **`GET /me/entitlements`** both expose `premiumEnabled` — the single source of truth every surface above reads from.
- **Employer side:** `searchRankBoost` (the Premium candidate-search tiebreaker) exists in the matching code today but has no visible effect while no candidate can actually be Premium.

---

## Part 5 — Consolidated "Confusing / Needs Review" List

For engineering/product review, not documentation workarounds:

1. **`/assessments` intro copy says "three levels" while the data model defines four (L1–L4, including "Expert").** A live content bug — fix before it's used as a source for help-guide language. *(Candidate portal fork)*
2. **`CANDIDATE_UNAVAILABLE` shortlist stage is entirely unhandled in the employer Shortlist UI** — a candidate who deactivates/deletes their account while INVITED/INTERVIEWING/OFFER would render a shortlist card with no label, no badge variant, and no action panel. Real gap, not a docs question. *(Employer portal fork)*
3. **"Expired" means two unrelated things**: a DISCUSSION session idle-timeout (resumable, 15 min) vs. an `AssessmentRequest` that lapsed unstarted (terminal, 5 days). Recommend distinct terminology in any user-facing writing. *(Cross-cutting fork)*
4. **Integrity flags are invisible to the candidate** — a flagged-but-unreviewed TEST attempt passes/fails/displays identically; the only trace is an omitted "Verified clean" mark on the public certificate page, which the candidate may never check. *(Cross-cutting fork)*
5. **No running "accrued but uninvoiced" balance shown anywhere in employer Billing** — only already-generated documents. An employer has no way to see what they currently owe mid-month. *(Employer portal fork)*
6. **No employer self-service billing-profile (GST/legal-entity) form** — exists only in the admin console, yet the employer-facing tax invoice flow depends on it being correct. *(Employer portal fork)*
7. **Expired team invitations have no resend action**, only revoke — the fix (revoke, then re-invite the same email) isn't surfaced in the UI. *(Employer portal fork)*
8. **`FAILED_NEEDS_ATTENTION` billing document status has no distinct treatment from `PENDING`** — both show "Preparing…," misrepresenting a stuck document as still in progress. Same pattern on both candidate (`/profile/billing`) and employer (`/employer/billing`) billing pages. *(Both forks)*
9. **Org verification status doesn't visibly gate anything else in the employer portal** — jobs/shortlist/search all function regardless of UNVERIFIED/PENDING/VERIFIED/REJECTED. Confirm with backend whether this is purely informational today before implying it "unlocks" anything. *(Employer portal fork)*
10. **Assessing a candidate via the DISCUSSION format is not possible from the employer UI** — only live MCQ assessments are offered in the request picker. Flagged in the source itself as a known limitation. *(Employer portal fork)*
11. **DPDP/GDPR "Download my data" export is fully built but hidden** behind `SHOW_DATA_EXPORT_UI = false` on `/profile/account`, explicitly flagged in-code as required before public launch — don't document it as live now. *(Candidate portal fork)*
12. **Application-limit on-cap UX on the job-apply page is unconfirmed** to have the same friendly, specific messaging that the assessment take-flow has for its equivalent limit — verify before writing copy that promises a specific experience at 10/10. *(Both forks)*
13. **`ALREADY_BADGED` employer-invite status has no confirmed candidate-facing surface** — excluded from the "pending invitations" list and not found rendered elsewhere. Unclear whether a candidate invited for a skill they already hold sees anything at all. *(Candidate portal fork)*
14. **`DISPUTED` discussion-assessment outcome is a genuine dead end** for the candidate — no visible SLA or status detail beyond "resolved" vs. not. *(Both forks — noted independently)*
15. **FREE-tier coarsened application status folds `SHORTLISTED` into the same "In review" bucket as plain `REVIEWED`** — a FREE candidate who's actually been shortlisted sees no distinct positive signal. Confirm this collapsing is the intended FREE/Premium differentiator before describing application statuses in the guide. *(Candidate portal fork)*
16. **DISCUSSION-format human review has no enforced SLA** — "within a day" is stated copy, not a tracked/escalated guarantee. The admin console (out of scope here) is presumably where this is actually managed; the guide should set expectations carefully given there's no system-level backstop. *(Cross-cutting fork)*
17. **`SkillLevel.L4` and possibly `L3`'s actual live-catalog availability is unconfirmed** — code supports 4 levels; whether any skill currently has L3/L4 content live is a catalog question this research pass could not settle. Check before finalizing how many levels the guide describes. *(Both candidate and cross-cutting forks, independently)*
