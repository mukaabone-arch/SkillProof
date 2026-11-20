# Employer help guide

Everything you can do in the MyAmbii employer portal, and how it works.

---

## Quick start {#quick-start}

Five steps from signing up to your first shortlisted candidate.

**1. Complete your organisation setup.** Add your logo, industry, and website. The rest of the portal stays locked until this is done.

**2. Post a job.** Go to Job Postings and create one. You'll need a title, an internal job code, and a description. Paste in an existing job description and use "Parse with AI" to fill most of it in. Save it as a draft first if you want.

**3. Publish it.** Draft jobs don't match or receive applications. Publishing makes the job live.

**4. Find candidates.** Open your live job and choose "View matches" to see candidates scored against what the role actually asks for. Or use Find Candidates to browse by skill regardless of any job.

**5. Shortlist and invite.** Add candidates to your shortlist, then invite the promising ones to interview.

---

## Setting up your organisation {#org-setup}

Three things are required before you can use the portal: a logo, an industry, and a website. You'll be sent to a setup screen until all three are filled in.

### Verification {#verification}

Completing organisation setup submits you for verification automatically — there's no separate step to trigger it. Your organisation moves from Pending to Verified, or to Rejected with a reason you can see and act on.

**Until you're Verified, Settings is the only part of the portal you can use.** Job Postings, Find Candidates, Applicants, Shortlist, and Billing all stay locked — for every teammate, not just admins — until a platform admin approves your organisation.

If you're rejected, fix what the reason points to and save your organisation details. That resubmits you automatically — there's no separate resubmit button to look for.

Once you're Verified, everything unlocks and stays unlocked. Verification is also shown to candidates as a trust signal on your job postings.

### Team and roles {#team}

There are two roles.

**Admins** can edit organisation details, upload the logo, invite and manage teammates, and deactivate the organisation.

**Members** can do everything related to hiring — jobs, candidate search, applicants, and the shortlist — with exactly the same access as admins. They see organisation and team information but can't change it.

**Every organisation gets 5 seats.** Your usage is shown on Settings.

You can't remove or demote the last admin. The option is disabled with an explanation.

**Invitations expire.** There's no resend button. To re-invite someone whose invitation lapsed, revoke the old one and send a fresh invitation to the same address.

---

## Job postings {#jobs}

Jobs move between three states: **Draft**, **Live**, and **Closed**. You can move between them freely — unpublish a live job, reopen a closed one.

**To save a job** you need a title, a job code unique within your organisation, and a description. The job code is internal and never shown to candidates. Location, salary, and experience range are optional.

**Parse with AI:** paste an existing job description and MyAmbii suggests a title, an experience range, and skills mapped to our taxonomy. You can edit every suggestion, including each skill's level and whether it's required. Nothing saves until you do.

**Draft jobs** can be edited and deleted. Once a job has gone live it can't be deleted, only closed — a live job's history is kept rather than erased. Draft jobs don't show applicants, and their candidate view is a preview of the pool rather than live matching.

### Unpublishing a live job {#unpublish}

When you unpublish, everyone who applied and everyone active on your shortlist for that job is told the role is no longer accepting applications. Candidates you've hired, or who've accepted an offer, aren't notified.

**This can't be undone.** Reopening the job later doesn't retract those notifications or restore anything.

### Importing jobs from a file {#job-import}

To post many roles at once, choose **Import from file** on Job Postings and download the CSV template. Fill in one row per job and upload it. Up to 50 rows per file.

- **Required columns:** title, description (at least 20 characters) and employment type. Everything else is optional: code, location, remote, experience min and max, salary min and max in LPA, salary not disclosed, and skills.
- **Skills** go in one cell as "Skill name: level", separated by semicolons, for example `RAG Systems: L2; Prompt Engineering: L1 (optional)`. Levels can be written as L1, L2, L3 or as Foundational, Practitioner, Advanced. Leave the cell empty and AI suggests skills from the description.
- **Every row becomes a draft**, never a live job. Rows with a problem are skipped and listed with the reason, so you can fix the file and upload those again.

After the upload you review the drafts. Each one shows what still stops it being posted: at least one required skill, and a city or "remote". **Post ready jobs** publishes all the drafts that are ready together. Open any other draft in the normal job form to finish it.

---

## Projects {#projects}

A project groups the roles one piece of work needs, such as "Support AI rollout: 3 ML engineers and 2 analysts", and shows how many are hired against how many you need.

1. On **Projects**, choose **New project**. Give it a name, and optionally a description and start and end dates.
2. Add roles. **+ New role** opens the normal job form and links the job back to the project. **Add an existing job** uses a job you already have. Each role is one job, and a job can only be in one project.
3. For each role, set **People needed** (1–50) and, optionally, a **target start** date.

**Progress is counted from each job's shortlist.** Candidates at Hired count as hired; Invited, Interviewing and Offer count as in progress. Nothing is entered by hand. Hiring more people than a role needs doesn't make up for another role that's short.

On the project page:

- A role shows **Filled** when it has hired everyone it needs, with a **Close job** shortcut.
- **Start date passed** marks a role whose target start has gone by and that still isn't filled.
- Draft roles list what still blocks posting. **Post ready roles** posts every draft that's ready.
- **Remove from project** takes a role out; its job and candidates are untouched.
- **Mark complete** and **Archive** change only the project. Its jobs stay as they are. Archived projects are hidden from the list until you show them, and can be restored.

### Project reports {#project-reports}

**View report** on a project shows where hiring stands, ready to share with leadership.

- **Summary:** fill rate (people hired against people needed), candidates in progress, total applicants, and how many candidates in the pipeline hold every required skill verified at the required level.
- **Roles table:** people needed, hired, applicants, and how many candidates are at each pipeline stage, with a totals row. Rejected or declined columns appear only when it happens.
- **Needs attention:** roles past their start date, roles with nobody in progress, roles not yet posted, and roles closed before they were filled.
- **Where candidates came from:** applied, sourced by AI, or added from search or matches.

**Download CSV** opens in Excel or Google Sheets. **Save as PDF** prints just the report, in landscape. Reports never include candidate names or contact details.

---

## Finding candidates {#finding-candidates}

There are two separate tools. They work differently and return different results.

### Find Candidates {#candidate-search}

A filtered browse of verified candidates across the whole platform, not tied to any job. Filter by skill, minimum level, role title, and verified-only.

**This is a filter, not a ranking.** Results come back ordered by how recently the candidate updated their profile. There's no match score, because there's no job to score against.

Use it for exploratory searching — seeing who's out there with a given skill.

Only candidates with at least one verified skill appear. Self-claimed skills alone never surface a candidate.

### Job matches {#job-matches}

Open a live job and choose "View matches." This scores every eligible candidate from 0 to 100 against that specific job's requirements.

Use it when you're filling a particular role.

### How the score works {#scoring}

The score is calculated **only from verified information**: verified skill claims and their levels, and verified, unexpired certifications tagged to the skills your job asks for.

- A verified skill at or above the level you asked for counts in full.
- A verified skill below your level counts partially, scaled by how close it is.
- A skill the candidate has claimed but not verified counts for very little.
- A verified certification covering a required skill counts as full credit.
- Skills you marked required count double compared to nice-to-have skills.
- The candidate's years of experience nudges the score slightly either way, never decisively.

**Nothing a candidate writes about themselves affects their score.** Headlines, role titles, and locations are for display and filtering only.

Your top 10 matches also get a written explanation of why they scored as they did. It's generated after scoring and describes the result rather than influencing it.

## AI sourcing {#ai-sourcing}

AI sourcing finds candidates for a live job and writes each of them a personal message. Nothing is sent until you approve it.

1. Open **AI sourcing** in the sidebar and pick a live job, or choose **Reach out with AI** on a job's matches page.
2. MyAmbii ranks every candidate who allows employers to contact them, using the same verified-skill score as job matches. It leaves out people who already applied, are already on the job's shortlist, or told your organisation "Not for me" in the last 90 days.
3. Each candidate gets a drafted message that names your role and their verified skills, with a one-line reason they were picked. Edit any message, or choose **Leave out**.
4. Choose **Send**. Messages go by email and to the candidate's Opportunities page.
5. Candidates reply with one tap: **Interested**, **Not now**, or **Not for me**. Up to two reminders go out automatically, 3 and 7 days after the first message, and stop as soon as they reply.

When a candidate says **Interested**, you see their email and phone on the campaign page, and they're added to that job's shortlist. Continue from the shortlist as usual.

**Limits.** Each person in your team can send up to 50 new messages a day. Each candidate also sets how many messages they accept per week (3 by default). A message held by a limit stays a draft, so you can send it later.

**Find more candidates** adds the next best matches to the campaign. **Pause** stops sending and reminders. **Close** ends the campaign; candidates who haven't answered can no longer reply.

---

## Applicants {#applicants}

The Applicants page lists everyone who has applied to any of your jobs, across the whole organisation. Individual jobs have their own applicant views.

Applying and being shortlisted are independent. A candidate can be on your shortlist without ever having applied, and applicants aren't shortlisted automatically.

---

## Shortlist and hiring pipeline {#shortlist}

Your shortlist is the pool of candidates you're actively considering, plus the pipeline you move them through. You can add candidates from Find Candidates, from a job's matches, or from your applicants.

### The stages {#stages}

| Stage | What you can do |
|---|---|
| Shortlisted | Invite to interview, with an optional message. Or reject. |
| Invited | Nothing yet. The candidate has to accept or decline. |
| Interviewing | Add and edit interview rounds. Extend an offer when you're ready. |
| Offer | See the candidate's response, then mark them hired or close the role for them. |
| Hired / Closed / Rejected | The pipeline has ended. |

**Rejecting** is available at any stage. You can record a reason, which stays internal.

**Removing** a candidate deletes the entry entirely and is always available.

### Interview rounds {#rounds}

Once a candidate accepts, you can add as many rounds as you need. Each has a channel, a scheduled time, and an internal note. Round numbers are assigned automatically.

Candidates see the round they're currently on. **They never see your internal notes, your earlier rounds, or how many rounds you're planning.**

### Offers {#offers}

When you extend an offer, the candidate can accept, decline, or tell you they're still deciding. Their response appears on their card.

Marking someone hired, or closing without a hire, is final and asks you to confirm.

---

## Asking a candidate to verify a skill {#assessment-requests}

On any shortlist card, "Assess candidate" asks that candidate to verify a whole skill — all three levels (Foundational, Practitioner, Advanced), attempted in any order. It's how you confirm a skill they haven't verified yet.

**Cost depends on how far the candidate gets.** You'll see the exact amount and confirm it before the request goes out.

**What you see per level, as each one finishes:**

- **Test:** whether they passed, their score, and a topic-level breakdown.
- **Discussion:** whether they passed. Nothing else.

You'll never see the questions, their individual answers, or the conversation.

**Statuses:**

| Status | Meaning |
|---|---|
| Awaiting start | Sent. Five days to start any level. |
| In progress | At least one level started. |
| Result ready | Settled — every level has a result (pass or fail), or the 14-day window closed. Results are on the card. |
| Expired — not billed | Didn't start any level in time. No charge. |
| Already verified | Held badges at every level already. No charge. |

Requests currently cover multiple-choice levels. Discussion-format verification isn't available to request yet.

---

## Billing {#billing}

Assessment requests accrue to your account as you make them. On the 1st of each month, everything uninvoiced is combined into a single GST tax invoice for your organisation.

The Billing page lists your invoices and receipts, with a download once each is generated. Documents still being prepared show as such.

**To correct your GST or legal entity details, contact MyAmbii support.** There's no self-service form for this yet, and these details are what your tax invoices are built from, so it's worth getting right early.

Team seats aren't billed. Every organisation gets 5, shown on Settings.

---

## Settings {#settings}

**Organisation details** — industry, website, and logo. Admins edit; everyone can view.

**Verification** — shows your current status: Pending, Verified, or Rejected with the reason. Submission happens automatically when setup is complete, and resubmission happens automatically the next time an admin saves organisation details after a rejection. There's nothing to click. Status is visible to everyone; only admins can act on a rejection by editing organisation details.

**Team** — invite by email, promote, demote, remove, and revoke pending invitations. Admin only.

**Deactivate organisation** — admin only, and effectively permanent.

### Deactivating your organisation {#deactivate}

Before you confirm, you'll see exactly how many live jobs will be closed and how many candidates will be notified. You'll be asked to type your organisation's name.

**There's no way to undo this yourself.** Reactivation is only possible through MyAmbii support, and even then your jobs won't be republished automatically.

---

## Connecting your ATS {#integrations}

If you use an applicant tracking system (ATS), MyAmbii can send it candidates and keep stages in step. Admins set this up under **Settings → Integrations**.

- **Webhooks:** add an HTTPS address and choose events, such as a candidate applying, moving stage on the shortlist, or saying Interested to AI sourcing. MyAmbii sends each event as a signed JSON message. **Send test event** checks it works, and **Recent deliveries** shows what was sent, with failed ones retried automatically.
- **API keys:** let your own systems read your jobs, applicants and shortlist, and move candidates on (invite, offer, hire, close or reject). A key is shown once, so copy it when you create it.
- **Download for ATS:** on the shortlist and AI sourcing pages, any team member can download a candidate's details and verified skills as a JSON file.

Every message includes the candidate's verified skills with links anyone can check. Contact details are included only once the candidate applied to your job or said Interested. The full reference for your developers is at [myambii.com/developers](/developers).

## Common questions {#faq}

**Why can't I access anything except Settings?**
Two different reasons, with different fixes:

- **Sent to the setup screen?** Your organisation is still missing its logo, industry, or website. Add whatever's missing and you'll move on automatically.
- **Settings shows "Pending" or "Rejected"?** Setup is already done — you're waiting on a platform admin to verify your organisation, or you need to fix something after a rejection. Nothing to do while Pending; if Rejected, address the stated reason and save your organisation details to resubmit.

**What's the difference between Find Candidates and job matches?**
Find Candidates filters everyone on the platform by skill and level, with no ranking. Job matches scores candidates against one specific job. Use the first to explore, the second to fill a role.

**Why does this candidate have no match score?**
Scores only exist against a specific job. Find Candidates has no job to score against.

**Why can't I find a candidate I know is on MyAmbii?**
Candidates need at least one verified skill to appear. Candidates who've deactivated their account also won't show.

**Can I delete a job I've published?**
No. Live and closed jobs can be closed or reopened but not deleted, so the hiring history stays intact. Drafts can be deleted.

**I unpublished a job by mistake.**
Reopen it from Job Postings. Applicants and shortlisted candidates were already told it stopped accepting applications, and reopening doesn't retract that.

**A teammate's invitation expired.**
Revoke it and send a new one to the same address.

**How do I change my GST details?**
Contact MyAmbii support.

**When am I charged for an assessment request?**
When the candidate starts it. Requests that expire unstarted are never charged.
