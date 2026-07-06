# Technical Specification: AI-Skills Recruitment Platform
**Version 1.0 — Inception to Launch**
**Market: India-first, global expansion in Phase 4**
**Build context: Solo founder, outsourced development**

---

## 1. Product Vision & Positioning

A recruitment platform focused exclusively on AI/ML talent, where candidates are ranked by **verified AI skills** (not resume keywords) and employers hire based on **assessment-proven capability**.

**Differentiators:**
- Deep AI-skills taxonomy (LLM engineering, prompt engineering, RAG systems, MLOps, fine-tuning, agents, classical ML, data engineering) instead of generic "Python/ML" tags.
- Skill verification through practical, auto-graded assessments — not self-declared proficiency.
- AI-powered matching that scores candidate ↔ job fit with explainable reasoning.
- India-first pricing and integrations (Razorpay, UPI, DPDP compliance), architected from day one for global expansion.

**Users:**
1. **Candidates** — AI engineers, data scientists, prompt engineers, ML researchers, freshers upskilling into AI.
2. **Employers** — startups, GCCs, IT services firms, and global companies hiring remote Indian AI talent.
3. **Admin/Ops** — your internal team managing content, moderation, and assessments.

---

## 2. Phased Rollout Strategy

Since you selected "all of the above, phased," this is the recommended sequence. Each phase is a shippable product that generates revenue and data for the next.

| Phase | Product | Duration | Core Value | Revenue Model |
|-------|---------|----------|------------|---------------|
| **0** | Validation & foundation | 4–6 weeks | Landing page, waitlist, skills taxonomy design | None |
| **1** | Assessment-first candidate platform (MVP) | 12–14 weeks | Candidates take AI-skill assessments, earn verified badges, build ranked profiles | Free for candidates; paid premium assessments |
| **2** | Two-sided marketplace | 10–12 weeks | Employers post jobs, AI matching engine, applications, messaging | Employer job-post credits + subscriptions |
| **3** | Employer SaaS (screening/ranking) | 10–12 weeks | Standalone screening tool: employers upload their own applicant pools, ATS integrations, API access | SaaS seats + API usage pricing |
| **4** | Global expansion | 8–10 weeks | Multi-currency, GDPR, i18n, global payment rails, SOC 2 track | Global pricing tiers |

**Why assessment-first for Phase 1:** A marketplace has a cold-start problem (no employers without candidates, no candidates without jobs). Assessments give candidates a reason to join *before* jobs exist, and your verified-talent pool becomes the sales pitch to employers in Phase 2.

---

## 3. System Architecture

### 3.1 Architectural Principles (chosen for a solo founder + outsourced dev)

1. **Modular monolith, not microservices.** One deployable backend with clean internal module boundaries. Microservices multiply DevOps cost and are unmanageable when you don't control the dev team day-to-day. Modules can be extracted into services later if scale demands it.
2. **Managed services everywhere.** No self-hosted databases, queues, or search clusters. Every self-hosted component is a 2 a.m. outage you personally own.
3. **One language across backend.** Reduces the skill surface you need from your vendor.
4. **Buy, don't build, for non-core.** Auth, payments, email, video-proctoring, code execution — all third-party. Your only proprietary IP is the skills taxonomy, assessment content, and matching engine.
5. **API-first.** Web and mobile consume the same REST API. Phase 3's employer API is the same API with a partner-auth layer — no rework.

### 3.2 Recommended Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Web frontend | **Next.js 14+ (React, TypeScript)** | Largest talent pool among Indian dev agencies; SSR for SEO (job pages must rank on Google) |
| Mobile | **Flutter** (single codebase, iOS + Android) | One codebase = half the vendor cost; excellent in India's agency market. Alternative: React Native if your vendor is JS-centric |
| Backend API | **NestJS (Node.js, TypeScript)** | Enforces modular structure (critical for outsourced code quality); same language as frontend. Alternative: Django (Python) if you want backend + ML in one language |
| Primary DB | **PostgreSQL 16 (managed — AWS RDS / Neon / Supabase)** | Relational integrity for users/jobs/payments; `pgvector` extension covers vector search without a separate vector DB |
| Cache / queues | **Redis (managed — Upstash / ElastiCache)** + **BullMQ** | Session cache, rate limiting, async job queue (assessment grading, matching runs, emails) |
| Object storage | **AWS S3 (ap-south-1, Mumbai)** | Resumes, profile photos, assessment artifacts |
| Search | **PostgreSQL full-text initially → Typesense/Meilisearch in Phase 2** | Don't run Elasticsearch as a solo founder |
| AI/LLM | **Anthropic / OpenAI APIs** for resume parsing, JD parsing, match explanations; **pgvector** for embedding search | No GPU infra of your own in Phases 1–3 |
| Code execution (assessments) | **Judge0 (hosted) or Sphere Engine** | Sandboxed code grading is a solved problem — never build this |
| Auth | **Auth0 / Supabase Auth / AWS Cognito** | OTP (phone-first for India), Google/LinkedIn OAuth, MFA |
| Payments (India) | **Razorpay** | UPI, cards, netbanking, subscriptions, GST invoicing |
| Payments (global, Phase 4) | **Stripe** | Multi-currency, global cards |
| Email / SMS / WhatsApp | **SendGrid or AWS SES** (email), **MSG91** (SMS OTP, India), **WhatsApp Business API via Gupshup/Interakt** | WhatsApp is the #1 engagement channel for Indian candidates |
| Hosting | **AWS ap-south-1** (or Railway/Render for Phase 1 simplicity) | Data residency in India; low latency |
| CI/CD | **GitHub Actions** | Free tier sufficient; standard for agencies |
| Monitoring | **Sentry** (errors) + **Better Stack / CloudWatch** (uptime, logs) | Managed, cheap |
| Analytics | **PostHog** (product) + **Metabase** (business dashboards on read replica) | Self-serve, affordable |

### 3.3 High-Level Architecture Diagram (textual)

```
[Next.js Web]      [Flutter iOS/Android]
       \                 /
        \               /
      [API Gateway / Load Balancer]
                |
        [NestJS Modular Monolith]
   ┌────────────────────────────────────┐
   │ auth | profiles | taxonomy         │
   │ assessments | jobs | matching      │
   │ applications | messaging | billing │
   │ notifications | admin | analytics  │
   └────────────────────────────────────┘
     |          |           |         |
[PostgreSQL] [Redis+    [S3]    [3rd-party APIs:
 + pgvector]  BullMQ]           LLM, Judge0, Razorpay,
                                 MSG91, SendGrid, WhatsApp]
```

---
## 4. Module Specifications

Each module below lists purpose, key features by phase, main data entities, and core API endpoints. Modules map 1:1 to NestJS modules — hand this section directly to your dev vendor as the work-breakdown structure.

### 4.1 Auth & Identity Module

**Purpose:** Registration, login, sessions, roles.

**Features:**
- Phone-OTP signup (primary for India) + email/password + Google & LinkedIn OAuth.
- Roles: `candidate`, `employer_admin`, `employer_member`, `platform_admin`.
- Employer organizations: one org → many member accounts (Phase 2).
- JWT access tokens (15 min) + refresh tokens (30 days, rotating); device/session management.
- Rate limiting on OTP endpoints (critical — OTP SMS abuse is a real cost attack in India).

**Entities:** `users`, `organizations`, `org_members`, `sessions`, `oauth_accounts`.

**Key endpoints:**
```
POST /auth/otp/request        POST /auth/otp/verify
POST /auth/register           POST /auth/login
POST /auth/refresh            POST /auth/logout
GET  /auth/me
```

### 4.2 Candidate Profile Module

**Purpose:** The candidate's structured, skill-verified identity.

**Features (Phase 1):**
- Profile: headline, experience, education, projects, links (GitHub, HuggingFace, Kaggle, portfolio).
- **AI resume parsing:** upload PDF → LLM extracts structured data → candidate confirms/edits. (Prompted extraction to a strict JSON schema; human confirmation step is mandatory to fix hallucinations.)
- Skill claims: candidate self-declares skills from the taxonomy; each claim shows `unverified` until an assessment verifies it.
- Profile completeness score (drives engagement).
- Profile embedding: on every significant profile update, generate a text embedding (queued job) and store in `pgvector` for matching.

**Features (Phase 2+):** visibility controls (public / recruiters-only / hidden), salary expectations, notice period, remote/relocation preferences, verified badge sharing (public URL + LinkedIn share).

**Entities:** `candidate_profiles`, `experiences`, `educations`, `projects`, `skill_claims`, `profile_embeddings`.

### 4.3 AI Skills Taxonomy Module

**Purpose:** Your core IP — the structured map of AI skills. Everything (assessments, matching, search) hangs off this.

**Structure:** 3-level hierarchy:
- **Domain** (e.g., "LLM Engineering", "MLOps", "Classical ML", "Data Engineering", "AI Product")
- **Skill** (e.g., "RAG Systems", "Fine-tuning", "Prompt Engineering", "Model Deployment")
- **Competency** (e.g., "Chunking strategies", "Hybrid search", "Reranking") with proficiency levels L1–L4 (Aware → Practitioner → Advanced → Expert).

**Features:**
- Versioned taxonomy (skills in AI change quarterly — you will edit this constantly; every assessment and match must reference a taxonomy version).
- Admin CRUD with draft → published workflow.
- Skill aliases/synonyms table for parsing resumes and JDs ("LangChain" → RAG Systems, "SFT" → Fine-tuning).

**Entities:** `taxonomy_versions`, `domains`, `skills`, `competencies`, `skill_aliases`.

### 4.4 Assessment Engine Module (Phase 1 core)

**Purpose:** Verify skill claims through auto-graded tests.

**Assessment types:**
1. **MCQ / scenario quizzes** — auto-graded, question banks per competency, randomized selection, difficulty-weighted scoring (IRT-lite: track per-question difficulty from response data).
2. **Coding challenges** — executed via Judge0/Sphere Engine sandbox; test-case based scoring; AI-specific problems (implement attention, build a retriever, debug a training loop).
3. **Prompt/LLM tasks** — candidate writes prompts or builds a small RAG/agent config; graded by LLM-as-judge against a rubric with a secondary consistency check (two judge runs; flag for human review if they disagree by >1 band).
4. **Project submissions (Phase 2)** — GitHub repo link + written explanation; hybrid LLM + human review.

**Anti-cheat (proportionate, phased):**
- Phase 1: question randomization, time limits, tab-switch detection, copy-paste flags, plagiarism check on code (MOSS-style similarity).
- Phase 2: webcam snapshot proctoring via third-party SDK (e.g., a hosted proctoring API) for premium/certification-tier assessments only.

**Scoring & badges:**
- Each assessment maps to skills + competencies at a target level.
- Pass thresholds per level; results produce **verified badges** with expiry (12–18 months — AI skills go stale) and a shareable public certificate URL with verification hash.

**Flow:**
```
Candidate picks skill → eligibility check → attempt created (state machine:
created → in_progress → submitted → grading → graded → badge_issued/failed)
→ async grading via BullMQ → results + explanations → badge issued
→ profile skill_claim updated to verified → profile re-embedded
```

**Entities:** `assessments`, `question_banks`, `questions`, `attempts`, `attempt_answers`, `grades`, `badges`, `proctoring_events`.

**Key endpoints:**
```
GET  /assessments?skill=            POST /attempts (start)
GET  /attempts/:id/next-question    POST /attempts/:id/answers
POST /attempts/:id/submit           GET  /attempts/:id/result
GET  /badges/verify/:hash (public)
```

### 4.5 Jobs Module (Phase 2)

**Purpose:** Employer job postings, structured around the taxonomy.

**Features:**
- **AI JD parsing:** employer pastes a job description → LLM maps it to taxonomy skills + required levels → employer confirms. This structured mapping is what makes matching precise.
- Job fields: title, description, skills (required/preferred + min level), experience band, salary range (mandatory internally, optional to display), location/remote, employment type.
- States: `draft → pending_review → live → paused → closed → expired`. Manual admin review for the first N posts per employer (fraud control — fake job postings are endemic in Indian job boards).
- Job credits/entitlement checks against the Billing module.
- SEO: server-rendered public job pages, Google for Jobs structured data (JobPosting schema.org markup).

**Entities:** `jobs`, `job_skills`, `job_reviews`.

### 4.6 Matching Engine Module (Phase 2 core)

**Purpose:** Score candidate ↔ job fit; power recommendations both ways.

**Architecture — hybrid, three-stage:**
1. **Hard filters (SQL):** location/remote, experience band, notice period, salary overlap, visa (Phase 4).
2. **Retrieval (pgvector):** cosine similarity between job embedding and candidate profile embeddings → top ~200 candidates.
3. **Scoring (deterministic + LLM):**
   - Deterministic score (0–100): weighted skill overlap where **verified skills weigh 2–3× self-declared**, level match, recency of skill verification, experience relevance.
   - LLM re-rank on top ~30: generates a short **explainable fit summary** ("Strong on RAG (verified L3) and MLOps; gap: no fine-tuning experience") shown to employers.
4. Nightly batch recomputation for live jobs + on-demand for new jobs/profiles (BullMQ jobs).

**Feedback loop:** log employer actions (viewed, shortlisted, rejected, hired) as labeled data — this is your future training set for a learned ranking model (Phase 4+, optional).

**Entities:** `match_scores`, `match_explanations`, `match_feedback_events`.

### 4.7 Applications & Pipeline Module (Phase 2)

- Candidate applies (or employer invites) → pipeline states: `applied → screened → shortlisted → interviewing → offered → hired / rejected / withdrawn`.
- Kanban pipeline view for employers; bulk actions; rejection reasons (feeds matching feedback).
- Interview scheduling: Phase 2 = share Calendly/Google Calendar links; Phase 3 = native scheduling with Google/Microsoft Calendar OAuth integration.

**Entities:** `applications`, `application_events`, `notes`.

### 4.8 Messaging & Notifications Module

- In-app employer ↔ candidate messaging, gated: employers can message only candidates who applied or opted into outreach (anti-spam, and a DPDP consent requirement).
- Notification fan-out service with per-user channel preferences: in-app, email (SendGrid/SES), SMS (MSG91), **WhatsApp (Gupshup/Interakt)** — WhatsApp for high-value events only (assessment result, shortlist, interview) to control per-message cost.
- All sends async via BullMQ with retry + dead-letter queue.

**Entities:** `conversations`, `messages`, `notifications`, `notification_preferences`.

### 4.9 Billing & Payments Module

**India (Phases 1–3): Razorpay.**
- Candidate side: freemium; paid premium assessment/certification attempts (one-time payments).
- Employer side: job-post credit packs (one-time) + subscription plans (Razorpay Subscriptions) for marketplace access; Phase 3 SaaS seats + metered API usage.
- **GST-compliant invoicing** (18% GST, GSTIN capture for B2B, e-invoice readiness), TDS handling notes for enterprise clients.
- Webhook handler for payment events with signature verification + idempotency keys (Razorpay retries webhooks — you must dedupe).

**Global (Phase 4): Stripe** behind the same internal `PaymentProvider` interface — design this abstraction in Phase 1 so Stripe is a plug-in, not a rewrite.

**Entities:** `plans`, `subscriptions`, `credit_wallets`, `payments`, `invoices`, `webhook_events`.

### 4.10 Admin & Ops Module

- Dashboards: user growth, assessment funnel, job approval queue, revenue.
- Content management: taxonomy editor, question bank editor with review workflow (draft → reviewed → live), badge/certificate templates.
- Moderation: job review queue, reported users/messages, fraud flags (duplicate accounts, assessment anomaly reports).
- Impersonation ("login as user") with full audit logging — essential for support.
- Feature flags (simple DB-backed or Unleash) so you can ship dark and enable gradually.

### 4.11 Analytics & Data Module

- Event tracking (PostHog): activation funnel, assessment completion rates, match→application→hire conversion.
- Read replica + Metabase for business reporting.
- Data warehouse deferred to Phase 3+ (Postgres replica is enough until then).

---

## 5. Data Model — Core Entity Relationships

```
users ──1:1── candidate_profiles ──1:N── skill_claims ──N:1── skills
  │                    │                      │
  │                    └──1:N── experiences,  └── verified_by ──> badges
  │                              projects,
  │                              educations
  ├──N:M── organizations (via org_members)
organizations ──1:N── jobs ──1:N── job_skills ──N:1── skills
jobs ──1:N── applications ──N:1── candidate_profiles
jobs ──1:N── match_scores ──N:1── candidate_profiles
assessments ──N:M── skills;  attempts ──N:1── assessments, users
plans ──1:N── subscriptions ──N:1── organizations
```

**Conventions for your vendor:** UUID primary keys; `created_at/updated_at` on all tables; soft deletes (`deleted_at`) on user-facing entities; append-only event tables for pipeline/payment state changes; all money stored as integer paise/cents with currency code; all timestamps UTC.

---
## 6. Integration Specifications

Step-by-step actions for every third-party integration. Order within each phase = build order.

### 6.1 Phase 1 Integrations

**A. Auth provider (Auth0 / Supabase Auth)**
1. Create tenant; configure phone-OTP, email/password, Google OAuth, LinkedIn OAuth apps.
2. Map provider user → internal `users` row on first login (webhook or post-login sync).
3. Configure JWT audience/issuer validation middleware in NestJS.
4. Test: signup, login, token refresh, account linking (same email via Google + password).

**B. MSG91 (SMS OTP)**
1. Register, complete **DLT registration** (mandatory in India: register entity, headers/sender IDs, and message templates with a telecom DLT portal — allow 1–2 weeks).
2. Create OTP template; integrate send/verify API behind an `SmsProvider` interface.
3. Add rate limits: max 3 OTPs / 10 min / number; max 10 / day; IP throttling.

**C. SendGrid or AWS SES (email)**
1. Verify domain (SPF, DKIM, DMARC records).
2. Create transactional templates: welcome, OTP fallback, assessment result, badge issued, receipts.
3. Route all sends through the notification queue; handle bounce/complaint webhooks (suppression list).

**D. LLM API (Anthropic/OpenAI)**
1. Create org account, set hard monthly spend cap, store keys in secrets manager.
2. Build one internal `LlmService` with: model routing, JSON-schema-validated outputs, retries with backoff, per-feature token budgets, full request/response logging (redact PII).
3. Implement resume-parse and question-generation-assist prompts; version prompts in the repo.
4. **Prompt-injection guard:** resumes and JDs are untrusted input — instruct extraction prompts to ignore instructions inside documents, and validate outputs against schema strictly.

**E. Judge0 / Sphere Engine (code execution)**
1. Subscribe to hosted tier; never self-host sandboxing at this stage.
2. Wrap behind `CodeRunner` interface: submit → poll → normalized verdict (pass/fail per test case, runtime, memory).
3. Set execution limits (time/memory) per problem; queue submissions via BullMQ.

**F. Razorpay**
1. KYC + activate live mode (needs company registration, PAN, bank account — start this paperwork in Phase 0; approval takes days–weeks).
2. Integrate Checkout (web) + native SDKs (Flutter) for one-time payments.
3. Webhooks: `payment.captured`, `payment.failed`, `refund.processed` — verify signatures, store raw event in `webhook_events`, process idempotently.
4. Generate GST invoices on successful payment (invoice number sequence per financial year).

**G. S3**
1. Buckets: `uploads` (private), `public-assets`; presigned-URL upload flow (client → S3 direct, never through your API).
2. Virus scan on upload (e.g., ClamAV Lambda or a scanning service) before files become downloadable.

### 6.2 Phase 2 Integrations

**H. WhatsApp Business API (Gupshup / Interakt)**
1. Facebook Business verification (start early — takes weeks); register WABA number.
2. Create pre-approved message templates (shortlist alert, interview reminder, assessment result).
3. Integrate behind `WhatsAppProvider`; strict per-event-type gating to control cost; opt-in consent captured at signup (DPDP requirement).

**I. Search (Typesense/Meilisearch)**
1. Managed cluster; index `candidates` (recruiter search) and `jobs` (candidate search).
2. Sync via outbox pattern: DB change → outbox row → BullMQ worker → index update. Never dual-write synchronously.
3. Faceted filters: skills, level, verified-only, experience, location, salary.

**J. Google for Jobs**
1. Add schema.org `JobPosting` JSON-LD to public job pages; submit sitemap; validate in Search Console. (This is free, high-quality inbound candidate traffic — prioritize it.)

### 6.3 Phase 3 Integrations

**K. ATS integrations (Greenhouse, Lever, Zoho Recruit, Keka)**
1. Build via a **unified ATS API provider** (e.g., Merge.dev/Kombo) instead of native one-by-one integrations — one integration, many ATSs; India-focused ATSs (Zoho, Keka) may need native work.
2. Flows: import applicants → run through your assessment/ranking → push scores + badge links back as ATS notes/tags.

**L. Public Employer API**
1. Same REST API, new auth layer: API keys + OAuth client-credentials per organization, scoped permissions, rate limits per plan, usage metering into Billing.
2. Publish OpenAPI spec + docs portal (Stoplight/Redocly); sandbox environment with test keys.

**M. Calendar (Google / Microsoft OAuth)** for native interview scheduling.

### 6.4 Phase 4 Integrations
- **Stripe** (global payments) behind existing `PaymentProvider` interface; multi-currency price books.
- **i18n pipeline** (start with UI string externalization from Phase 1 — enforce this in vendor code reviews so Phase 4 isn't a rewrite).
- Optional: EU data residency (separate DB region) depending on GDPR posture and enterprise demand.

---

## 7. Security & Compliance

### 7.1 India — DPDP Act 2023 (applies from day one)
1. **Consent:** explicit, purpose-specific consent at signup (profile visibility to employers, WhatsApp/SMS communications, assessment proctoring data). Store consent records with timestamp + version of the consent text.
2. **Data-principal rights:** build account export (JSON of all user data) and account deletion (soft delete → hard purge job after retention window) in Phase 1 — retrofitting is painful.
3. **Notice:** privacy policy in clear language; breach-notification runbook.
4. Appoint a grievance officer contact (required); publish on site.

### 7.2 Security Baseline (put this in the vendor contract as acceptance criteria)
- OWASP ASVS Level 1 minimum; input validation via DTO schemas on every endpoint.
- All secrets in a secrets manager (AWS Secrets Manager / Doppler) — never in code or `.env` committed to git.
- TLS everywhere; HSTS; encrypted DB storage; S3 buckets private by default.
- RBAC enforced server-side on every endpoint (test: candidate token cannot read another candidate's attempts — IDOR is the #1 outsourced-code vulnerability).
- Audit log for admin actions and payment mutations.
- Rate limiting global + per-endpoint (OTP, login, LLM-backed endpoints).
- Dependency scanning (GitHub Dependabot) + one external penetration test before Phase 2 employer launch.
- Assessment integrity: signed attempt tokens, server-side timing, answer submission idempotency.

### 7.3 Phase 4 (global)
- GDPR: lawful-basis mapping, DPA templates for employer customers, cookie consent, right-to-erasure automation (reuse DPDP deletion machinery).
- SOC 2 Type I track if selling to US enterprises (start evidence collection with a compliance platform like Vanta/Drata when revenue justifies it).

---
## 8. Environments, CI/CD & Deployment — Step by Step

### 8.1 Environments
| Env | Purpose | Infra |
|-----|---------|-------|
| `dev` | Vendor development | Local + shared dev DB |
| `staging` | Your acceptance testing (UAT) | Mirror of prod, test-mode payment keys |
| `production` | Live | AWS ap-south-1 (Mumbai) |

### 8.2 Infrastructure Setup (one-time, Phase 1) — do these in order
1. **Accounts & access:** create AWS account (root MFA), GitHub org, domain + Cloudflare DNS. **You own every account; vendor gets invited access only. Never let the vendor create accounts you don't control — this is the single most common solo-founder disaster.**
2. Register domain, set up Cloudflare (DNS, WAF, DDoS protection, bot rules on OTP endpoints).
3. Provision managed Postgres (RDS/Neon) with automated daily backups + point-in-time recovery; enable `pgvector`.
4. Provision Redis (Upstash/ElastiCache).
5. Create S3 buckets + IAM roles (least privilege per service).
6. Secrets manager: create per-environment secret sets.
7. Backend hosting — two valid options:
   - **Simple (recommended for Phase 1):** Railway/Render — git-push deploys, zero DevOps.
   - **AWS-native:** ECS Fargate + ALB, via Terraform (require infrastructure-as-code in the vendor contract either way).
8. Web hosting: Vercel for Next.js (trivial, fast, handles SSR).
9. Sentry projects (api, web, mobile); uptime monitors on `/health` endpoints.

### 8.3 CI/CD Pipeline (GitHub Actions)
```
On pull request:
  lint → typecheck → unit tests → build → preview deploy (Vercel) 
On merge to main:
  all of the above → integration tests → deploy to STAGING → run smoke tests
On release tag (you create it — deliberate gate):
  deploy to PRODUCTION → run DB migrations → smoke tests → notify
Rollback: redeploy previous tag (keep migrations backward-compatible:
  additive first, destructive changes only after code no longer references old schema)
```
**Branch protection:** vendor cannot push to `main` directly; PRs require passing CI; you (or a fractional CTO/reviewer you hire) approve releases.

### 8.4 Mobile Release Pipeline
1. Apple Developer ($99/yr) and Google Play ($25) accounts — **created under your identity**, started in Phase 0 (Apple verification can take weeks; Google Play now requires closed testing with 12+ testers for ~14 days for new personal accounts — plan for this).
2. Fastlane + GitHub Actions: build → sign → upload to TestFlight / Play Internal Testing.
3. Staged rollout on Play (10% → 50% → 100%); phased release on App Store.
4. Adopt a code-push/OTA update mechanism for Flutter (e.g., Shorebird) to hotfix without store review.

### 8.5 Database Migration Discipline
- Migrations in code (TypeORM/Prisma migrations), reviewed in PRs, run automatically on deploy, never edited after merge; every migration tested against a staging copy of prod data before release.

---

## 9. Step-by-Step Execution Plan: Inception → Launch

### Phase 0 — Foundation (Weeks 1–6, before development starts)
1. Incorporate (Pvt Ltd recommended for future funding), PAN/GSTIN, bank account.
2. Start long-lead registrations **now**: Razorpay KYC, DLT (SMS), Apple/Google developer accounts, Facebook Business verification (WhatsApp).
3. Draft the AI skills taxonomy v1 (this is founder work, not vendor work — it's your IP). Validate with 15–20 AI engineers and 5–10 hiring managers.
4. Author/curate the first assessment content: 2 domains deep (e.g., LLM Engineering + Classical ML), ~150 MCQs + 10 coding problems + 5 prompt tasks. Use LLM assistance to draft, human experts to review — never ship unreviewed generated questions.
5. Landing page + waitlist (Next.js on Vercel) — start collecting candidates immediately.
6. Vendor selection (see §10). Sign contract with milestone payments tied to acceptance criteria.
7. Write product requirement documents per module (this spec is your base).

### Phase 1 — Assessment Platform MVP (Weeks 7–20)
**Sprint plan (2-week sprints):**
- **S1:** Repo setup, CI/CD, infra, auth module, design system.
- **S2:** Candidate profile + resume parsing; taxonomy module + admin editor.
- **S3–S4:** Assessment engine: MCQ flow end-to-end (attempt state machine, grading, badges).
- **S5:** Coding assessments (Judge0), prompt-task grading (LLM-judge + review queue).
- **S6:** Payments (premium assessments), notifications (email/SMS), profile embeddings.
- **S7:** Mobile app (Flutter) for candidate flows; admin dashboards; hardening, pen-test fixes, load test (target: 500 concurrent assessment takers).
- **Launch gate checklist:** DPDP consent + export/delete working; payment reconciliation verified against Razorpay dashboard; Sentry clean on staging for 1 week; backups restore-tested; store listings approved.
- **Go live:** invite waitlist in cohorts (100 → 500 → open). Target: 2,000–5,000 registered candidates and 500+ verified badges before starting Phase 2 employer sales.

### Phase 2 — Marketplace (Weeks 21–32)
- **S8:** Organizations, employer onboarding, job posting + JD parsing, admin review queue.
- **S9:** Matching engine (filters + vector retrieval + scoring); candidate job feed.
- **S10:** Applications pipeline (kanban), messaging, WhatsApp notifications.
- **S11:** Employer billing (credits + subscriptions), recruiter candidate search (Typesense), Google for Jobs SEO.
- **S12:** Employer mobile views, analytics dashboards, hardening + second pen test.
- **Go-to-market step:** founder-led sales — personally onboard first 20–30 employers (AI startups, GCC teams); concierge-match manually where the engine is weak and feed learnings back.

### Phase 3 — Employer SaaS (Weeks 33–44)
- Bulk applicant import (CSV + ATS via unified API), invite-to-assess flows, ranking dashboards for employer-owned pools, public API + docs, seat-based + metered billing, SSO (Google Workspace/SAML for enterprise).

### Phase 4 — Global (Weeks 45–54)
- Stripe + multi-currency price books, i18n activation, GDPR workstream, global SEO/landing pages, time-zone-aware scheduling, region-based data handling review, SOC 2 evidence collection start.

---

## 10. Managing the Outsourced Vendor (critical for you)

1. **Contract must include:** IP assignment (all code, all accounts, all content is yours), source code in *your* GitHub org from day 1, infrastructure-as-code, documentation deliverables per milestone, warranty period (60–90 days post-milestone bug fixes), exit clause with handover obligations.
2. **Milestone payments** mapped to the sprint plan above, each with written acceptance criteria (use the module specs in §4).
3. **Hire a part-time independent tech reviewer** (fractional CTO, ~4–8 hrs/week) who is *not* from the vendor to review PRs and architecture decisions. This is the highest-ROI money you will spend.
4. **Weekly rituals:** demo every Friday on staging (working software, not slides); written status with burn-down; you test every feature on staging yourself.
5. **Non-negotiable engineering standards in the contract:** TypeScript strict mode, ≥60% unit-test coverage on business logic, API documented via OpenAPI, no secrets in code, migrations-as-code, Sentry integrated, seed scripts for local setup.
6. **Red flags to act on immediately:** vendor resists giving you repo/infra ownership; demos only on their machines; "it works locally"; pressure to skip staging.

---

## 11. Indicative Costs (monthly, INR, at MVP scale)

| Item | Phase 1 | Phase 2–3 |
|------|---------|-----------|
| Hosting (API, web, DB, Redis, S3) | ₹15–35k | ₹50k–1.2L |
| LLM APIs | ₹10–40k (cap it) | ₹40k–1.5L |
| Judge0/code execution | ₹5–15k | ₹15–40k |
| SMS/WhatsApp/email | ₹5–15k | ₹25–75k |
| Auth, Sentry, PostHog, misc SaaS | ₹10–20k | ₹20–50k |
| **Total infra/tools** | **~₹45k–1.25L/mo** | **~₹1.5–4L/mo** |

Development (India agency rates, indicative): Phase 1 build ₹25–60L depending on agency tier; Phases 2–3 similar each. A senior-freelancer team (2–3 devs + designer) can reduce this substantially with more management effort from you. Fractional CTO reviewer: ₹50k–1.5L/mo part-time.

---

## 12. Success Metrics & Launch Gates

| Phase | Gate to proceed |
|-------|-----------------|
| 1 → 2 | ≥2,000 candidates, ≥500 verified badges, assessment completion rate ≥55%, NPS ≥ 40 |
| 2 → 3 | ≥25 paying employers, ≥10 confirmed hires through platform, match→shortlist rate ≥15% |
| 3 → 4 | ≥₹8–10L MRR, ≥3 employers requesting global talent or global employers inbound |

---

## Appendix A — Build vs. Buy Summary
**Build (your IP):** taxonomy, assessment content, matching logic, employer/candidate UX.
**Buy:** auth, payments, code sandboxing, proctoring, SMS/WhatsApp/email delivery, search engine, ATS connectivity, monitoring.

## Appendix B — Phase 1 Definition of Done (hand to vendor)
A candidate can: sign up via phone OTP → build a profile (with resume parsing) → claim skills → take an MCQ, coding, and prompt assessment → pay for a premium attempt → receive a graded result with explanation → earn a shareable verified badge → export or delete their data. Admin can: edit taxonomy, manage question banks, review flagged attempts, view funnel dashboards. All of this works on web and Android/iOS, monitored in Sentry, deployed via CI/CD to production infrastructure owned by the founder.
