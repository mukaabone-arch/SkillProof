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
