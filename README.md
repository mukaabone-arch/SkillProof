# SkillProof — AI-Skills Recruitment Platform

Monorepo: NestJS API + Next.js web + Flutter mobile.

## Prerequisites
- Node.js 20+, npm 10+
- Docker Desktop (for local Postgres + Redis)
- Flutter SDK 3.22+ (for mobile)

## First-time setup (in order)

```bash
# 1. Start local infrastructure
docker compose up -d          # Postgres (with pgvector) on :5432, Redis on :6379

# 2. Backend API
cd apps/api
cp .env.example .env
npm install
npx prisma migrate dev --name init   # creates DB schema
npm run start:dev                    # API on http://localhost:4000
# Test: curl http://localhost:4000/health

# 3. Web app (new terminal)
cd apps/web
cp .env.example .env.local
npm install
npm run dev                          # Web on http://localhost:3000

# 4. Mobile (new terminal, after installing Flutter)
cd apps/mobile
flutter create . --platforms=android,ios   # generates android/ and ios/ folders
flutter pub get
flutter run                          # needs an emulator or connected device
```

## Dev-mode auth
OTP sending is stubbed until MSG91 is integrated: any phone number works and
the OTP is printed in the API console (and is always `123456` in dev).

## Repo map
```
apps/api      NestJS backend (modules mirror the tech spec §4)
apps/web      Next.js web app (landing page in public/landing.html)
apps/mobile   Flutter app (candidate flows)
docs/         Tech spec and decisions
```

## Suggested build order (maps to spec Phase 1 sprints)
1. Auth end-to-end (OTP → JWT → /users/me) — mostly done, wire MSG91 later
2. Taxonomy module + seed data (see prisma/seed.ts)
3. Candidate profile CRUD
4. Assessment engine: MCQ flow (attempt state machine already sketched)
5. Payments (Razorpay), then coding assessments (Judge0)
