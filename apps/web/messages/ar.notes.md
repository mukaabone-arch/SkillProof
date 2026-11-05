# Arabic copy: review notes

Prose notes for reviewers and for whoever translates the next screen. This file
is not read by check-i18n. ar.sources.json cannot hold prose: any key there
that is not in en.json fails the orphan check.

## Demo expedients, not house conventions

- **Pipeline summary uses label style** ("اعتذر: 1 · مرفوض: 1"). It sidesteps
  Arabic number-noun agreement, which has six CLDR plural categories. The product
  pattern is ICU plural rules, as in employerDashboard.jobMeta. Do not copy the
  label style into real screens.
- **Only localised sections are shown in the employer sidebar under Arabic.**
  This is a guard against a mid-walkthrough drop into English. It should
  disappear as each screen is translated.

## Terminology questions for the reviewer

1. **candidate**: المتقدم (used now) or مرشّح? The Gulf HR term is usually مرشّح.
   MyAmbii's candidate may never have applied, so المتقدم (applicant) may be the
   wrong word. Adopting مرشّح also removes the clash with "Advanced".
2. **Practitioner**: عملي (describes the level: practical) or ممارس (the
   agentive "practitioner")?
3. **Pipeline stage labels**: "اعتذر" is a verb in a label slot. It may want a
   participle or a noun for the declined stage.
4. **Advanced**: متمكّن is used because متقدم would clash with "applicant".
   Does it survive if مرشّح is adopted? Or does متقدم come back?

## Added 2026-11 (merge of main into the i18n work) — awaiting review

New keys, all on surfaces already localised (landing header/hero/footer,
the promo ribbon, the employer shell). Not yet fingerprinted: a reviewer
confirms them, then runs `npm run i18n:sync`.

5. **Recruiter** (staffing/recruitment company): **جهة توظيف** in labels
   (header.recruiter, landing.hero.recruiterLine). مسؤول التوظيف would mean
   an individual recruiter; the account is an organisation. Confirm.
6. **For Business** → **للشركات**. Alternative: للأعمال.
7. **Availability requests** (recruiter sidebar) → **طلبات التوفّر**;
   **Submissions** → **الترشيحات المقدَّمة**. Both are recruiter-portal terms
   that will recur when the recruiter screens are translated.
8. The promo ribbon now announces the mobile app (promo.app.*); the
   "free until" bar copy (promo.lead/until) was rewritten in English on
   main, so its Arabic was redone too.
9. Footer: company line and copyright changed on main (footer.company,
   footer.copy).

## Counts: plural forms and digits (house rule)

- Any message that takes a count uses ICU plural syntax with the Arabic
  categories (zero/one/two/few/many/other), as employerDashboard.jobMeta,
  employerDashboard.avgDays and employerMatches.experienceYears do. A bare
  "{days} يوم" cannot inflect. lib/arabicPlurals.spec.tsx pins the forms.
- Write numbers as `{n, number, latn}`, never `#`: Western digits on every
  browser, matching the DECISION in lib/formatLocale.ts (dates and future
  SAR/AED prices go through intlTag() for the same reason).
