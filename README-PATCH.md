# Assessment Slice — install instructions

Unzip this over your repo root (it only adds files + replaces two):

NEW  apps/api/prisma/seed-assessments.ts
EDIT apps/api/src/modules/assessments/assessments.service.ts  (result now includes badge + skill)
NEW  apps/web/app/assessments/page.tsx
NEW  apps/web/app/assessments/[id]/page.tsx
NEW  apps/web/app/badges/[hash]/page.tsx
EDIT apps/web/app/globals.css  (adds styles at the bottom)

## Steps
1. Copy the files into place (same paths).
2. Seed the sample assessment:
   cd apps/api && npx ts-node prisma/seed-assessments.ts
3. Both dev servers keep hot-reloading; no restart needed.
4. Open http://localhost:3000/assessments
   → log in first at / if needed → Start → answer 6 questions → Submit.
5. Score ≥ 70% ⇒ badge issued ⇒ "View certificate" opens the public
   verification page (the URL candidates will share on LinkedIn).
6. Verify the profile updated: log in again at / — skillClaims now shows
   RAG Systems as VERIFIED with your badge.

Try failing it once too (submit wrong answers) to see the retry path.
