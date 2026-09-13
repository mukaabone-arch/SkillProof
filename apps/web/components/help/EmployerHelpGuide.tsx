/**
 * Transcribed verbatim from docs/employer-guide.md — see
 * CandidateHelpGuide.tsx's own doc comment for the transcription discipline
 * this follows and the two corrections already applied to the source file
 * (not made here): the "up to four levels" line elsewhere and — the load-
 * bearing one for this guide — the Verification section, Settings'
 * Verification line, and the "why can't I access anything" FAQ answer, all
 * rewritten in the source to describe the verification gate as it actually
 * works today (everything but Settings locked until VERIFIED, automatic
 * submission/resubmission, no manual button) rather than the pre-gate
 * behavior the source previously described.
 *
 * EMPLOYER_HELP_SECTIONS mirrors every h2's own {#id} anchor — see
 * CandidateHelpGuide.tsx's own comment on how HelpTabs.tsx uses this.
 */
export const EMPLOYER_HELP_SECTIONS = [
  { id: 'quick-start', label: 'Quick start' },
  { id: 'org-setup', label: 'Setting up your organisation' },
  { id: 'jobs', label: 'Job postings' },
  { id: 'finding-candidates', label: 'Finding candidates' },
  { id: 'applicants', label: 'Applicants' },
  { id: 'shortlist', label: 'Shortlist and hiring pipeline' },
  { id: 'assessment-requests', label: 'Asking a candidate to verify a skill' },
  { id: 'billing', label: 'Billing' },
  { id: 'settings', label: 'Settings' },
  { id: 'faq', label: 'Common questions' },
];

export default function EmployerHelpGuide() {
  return (
    <>
      <h2 id="quick-start">Quick start</h2>
      <p>Five steps from signing up to your first shortlisted candidate.</p>
      <ol>
        <li><strong>Complete your organisation setup.</strong> Add your logo, industry, and website. The rest of the portal stays locked until this is done.</li>
        <li>
          <strong>Post a job.</strong> Go to Job Postings and create one. You&apos;ll need a title, an internal job
          code, and a description. Paste in an existing job description and use &quot;Parse with AI&quot; to fill
          most of it in. Save it as a draft first if you want.
        </li>
        <li><strong>Publish it.</strong> Draft jobs don&apos;t match or receive applications. Publishing makes the job live.</li>
        <li>
          <strong>Find candidates.</strong> Open your live job and choose &quot;View matches&quot; to see candidates
          scored against what the role actually asks for. Or use Find Candidates to browse by skill regardless of
          any job.
        </li>
        <li><strong>Shortlist and invite.</strong> Add candidates to your shortlist, then invite the promising ones to interview.</li>
      </ol>

      <h2 id="org-setup">Setting up your organisation</h2>
      <p>
        Three things are required before you can use the portal: a logo, an industry, and a website. You&apos;ll be
        sent to a setup screen until all three are filled in.
      </p>

      <h3 id="verification">Verification</h3>
      <p>
        Completing organisation setup submits you for verification automatically — there&apos;s no separate step to
        trigger it. Your organisation moves from Pending to Verified, or to Rejected with a reason you can see and
        act on.
      </p>
      <p>
        <strong>Until you&apos;re Verified, Settings is the only part of the portal you can use.</strong> Job
        Postings, Find Candidates, Applicants, Shortlist, and Billing all stay locked — for every teammate, not just
        admins — until a platform admin approves your organisation.
      </p>
      <p>
        If you&apos;re rejected, fix what the reason points to and save your organisation details. That resubmits
        you automatically — there&apos;s no separate resubmit button to look for.
      </p>
      <p>
        Once you&apos;re Verified, everything unlocks and stays unlocked. Verification is also shown to candidates
        as a trust signal on your job postings.
      </p>

      <h3 id="team">Team and roles</h3>
      <p>There are two roles.</p>
      <p><strong>Admins</strong> can edit organisation details, upload the logo, invite and manage teammates, and deactivate the organisation.</p>
      <p>
        <strong>Members</strong> can do everything related to hiring — jobs, candidate search, applicants, and the
        shortlist — with exactly the same access as admins. They see organisation and team information but
        can&apos;t change it.
      </p>
      <p><strong>Every organisation gets 5 seats.</strong> Your usage is shown on Settings.</p>
      <p>You can&apos;t remove or demote the last admin. The option is disabled with an explanation.</p>
      <p><strong>Invitations expire.</strong> There&apos;s no resend button. To re-invite someone whose invitation lapsed, revoke the old one and send a fresh invitation to the same address.</p>

      <h2 id="jobs">Job postings</h2>
      <p>
        Jobs move between three states: <strong>Draft</strong>, <strong>Live</strong>, and <strong>Closed</strong>.
        You can move between them freely — unpublish a live job, reopen a closed one.
      </p>
      <p>
        <strong>To save a job</strong> you need a title, a job code unique within your organisation, and a
        description. The job code is internal and never shown to candidates. Location, salary, and experience range
        are optional.
      </p>
      <p>
        <strong>Parse with AI:</strong> paste an existing job description and MyAmbii suggests a title, an
        experience range, and skills mapped to our taxonomy. You can edit every suggestion, including each
        skill&apos;s level and whether it&apos;s required. Nothing saves until you do.
      </p>
      <p>
        <strong>Draft jobs</strong> can be edited and deleted. Once a job has gone live it can&apos;t be deleted,
        only closed — a live job&apos;s history is kept rather than erased. Draft jobs don&apos;t show applicants,
        and their candidate view is a preview of the pool rather than live matching.
      </p>

      <h3 id="unpublish">Unpublishing a live job</h3>
      <p>
        When you unpublish, everyone who applied and everyone active on your shortlist for that job is told the
        role is no longer accepting applications. Candidates you&apos;ve hired, or who&apos;ve accepted an offer,
        aren&apos;t notified.
      </p>
      <p><strong>This can&apos;t be undone.</strong> Reopening the job later doesn&apos;t retract those notifications or restore anything.</p>

      <h2 id="finding-candidates">Finding candidates</h2>
      <p>There are two separate tools. They work differently and return different results.</p>

      <h3 id="candidate-search">Find Candidates</h3>
      <p>A filtered browse of verified candidates across the whole platform, not tied to any job. Filter by skill, minimum level, role title, and verified-only.</p>
      <p><strong>This is a filter, not a ranking.</strong> Results come back ordered by how recently the candidate updated their profile. There&apos;s no match score, because there&apos;s no job to score against.</p>
      <p>Use it for exploratory searching — seeing who&apos;s out there with a given skill.</p>
      <p>Only candidates with at least one verified skill appear. Self-claimed skills alone never surface a candidate.</p>

      <h3 id="job-matches">Job matches</h3>
      <p>Open a live job and choose &quot;View matches.&quot; This scores every eligible candidate from 0 to 100 against that specific job&apos;s requirements.</p>
      <p>Use it when you&apos;re filling a particular role.</p>

      <h3 id="scoring">How the score works</h3>
      <p>
        The score is calculated <strong>only from verified information</strong>: verified skill claims and their
        levels, and verified, unexpired certifications tagged to the skills your job asks for.
      </p>
      <ul>
        <li>A verified skill at or above the level you asked for counts in full.</li>
        <li>A verified skill below your level counts partially, scaled by how close it is.</li>
        <li>A skill the candidate has claimed but not verified counts for very little.</li>
        <li>A verified certification covering a required skill counts as full credit.</li>
        <li>Skills you marked required count double compared to nice-to-have skills.</li>
        <li>The candidate&apos;s years of experience nudges the score slightly either way, never decisively.</li>
      </ul>
      <p><strong>Nothing a candidate writes about themselves affects their score.</strong> Headlines, role titles, and locations are for display and filtering only.</p>
      <p>Your top 10 matches also get a written explanation of why they scored as they did. It&apos;s generated after scoring and describes the result rather than influencing it.</p>

      <h2 id="applicants">Applicants</h2>
      <p>The Applicants page lists everyone who has applied to any of your jobs, across the whole organisation. Individual jobs have their own applicant views.</p>
      <p>Applying and being shortlisted are independent. A candidate can be on your shortlist without ever having applied, and applicants aren&apos;t shortlisted automatically.</p>

      <h2 id="shortlist">Shortlist and hiring pipeline</h2>
      <p>
        Your shortlist is the pool of candidates you&apos;re actively considering, plus the pipeline you move them
        through. You can add candidates from Find Candidates, from a job&apos;s matches, or from your applicants.
      </p>

      <h3 id="stages">The stages</h3>
      <div className="lp-legal-table-wrap">
        <table className="lp-legal-table">
          <thead>
            <tr><th>Stage</th><th>What you can do</th></tr>
          </thead>
          <tbody>
            <tr><td>Shortlisted</td><td>Invite to interview, with an optional message. Or reject.</td></tr>
            <tr><td>Invited</td><td>Nothing yet. The candidate has to accept or decline.</td></tr>
            <tr><td>Interviewing</td><td>Add and edit interview rounds. Extend an offer when you&apos;re ready.</td></tr>
            <tr><td>Offer</td><td>See the candidate&apos;s response, then mark them hired or close the role for them.</td></tr>
            <tr><td>Hired / Closed / Rejected</td><td>The pipeline has ended.</td></tr>
          </tbody>
        </table>
      </div>
      <p><strong>Rejecting</strong> is available at any stage. You can record a reason, which stays internal.</p>
      <p><strong>Removing</strong> a candidate deletes the entry entirely and is always available.</p>

      <h3 id="rounds">Interview rounds</h3>
      <p>Once a candidate accepts, you can add as many rounds as you need. Each has a channel, a scheduled time, and an internal note. Round numbers are assigned automatically.</p>
      <p>Candidates see the round they&apos;re currently on. <strong>They never see your internal notes, your earlier rounds, or how many rounds you&apos;re planning.</strong></p>

      <h3 id="offers">Offers</h3>
      <p>When you extend an offer, the candidate can accept, decline, or tell you they&apos;re still deciding. Their response appears on their card.</p>
      <p>Marking someone hired, or closing without a hire, is final and asks you to confirm.</p>

      <h2 id="assessment-requests">Asking a candidate to verify a skill</h2>
      <p>
        On any shortlist card, &quot;Assess candidate&quot; asks that candidate to verify a whole skill — all three
        levels (Foundational, Practitioner, Advanced), attempted in any order. It&apos;s how you confirm a skill
        they haven&apos;t verified yet.
      </p>
      <p><strong>Cost depends on how far they get:</strong></p>
      <div className="lp-legal-table-wrap">
        <table className="lp-legal-table">
          <thead>
            <tr><th>Outcome</th><th>Charge</th></tr>
          </thead>
          <tbody>
            <tr><td>Doesn&apos;t start within 5 days</td><td>₹0 — nothing added</td></tr>
            <tr><td>Starts but doesn&apos;t attempt all three levels within 14 days of starting</td><td>₹177 (₹150 + GST)</td></tr>
            <tr><td>Attempts all three levels</td><td>₹590 (₹500 + GST)</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        &quot;Attempted&quot; means a level produced a result — pass or fail — not that they passed it. There&apos;s
        no payment at the time either way: the eventual charge is added to your organisation&apos;s next monthly
        invoice once it&apos;s known. You&apos;ll confirm you understand this before the request goes out.
      </p>
      <p>
        <strong>If they already hold a badge for a level,</strong> that level is free — it still counts toward
        &quot;all three attempted.&quot;
      </p>
      <p><strong>What you see per level, as each one finishes:</strong></p>
      <ul>
        <li><strong>Test:</strong> whether they passed, their score, and a topic-level breakdown.</li>
        <li><strong>Discussion:</strong> whether they passed. Nothing else.</li>
      </ul>
      <p>You&apos;ll never see the questions, their individual answers, or the conversation.</p>
      <p><strong>Statuses:</strong></p>
      <div className="lp-legal-table-wrap">
        <table className="lp-legal-table">
          <thead>
            <tr><th>Status</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td>Awaiting start</td><td>Sent. Five days to start any level.</td></tr>
            <tr><td>In progress</td><td>At least one level started.</td></tr>
            <tr><td>Result ready</td><td>Settled — every level attempted, or the 14-day window closed. Results are on the card.</td></tr>
            <tr><td>Expired — not billed</td><td>Didn&apos;t start any level in time. No charge.</td></tr>
            <tr><td>Already verified</td><td>Held badges at every level already. No charge.</td></tr>
          </tbody>
        </table>
      </div>
      <p>Requests currently cover multiple-choice levels. Discussion-format verification isn&apos;t available to request yet.</p>

      <h2 id="billing">Billing</h2>
      <p>Assessment requests accrue to your account as you make them. On the 1st of each month, everything uninvoiced is combined into a single GST tax invoice for your organisation.</p>
      <p>The Billing page lists your invoices and receipts, with a download once each is generated. Documents still being prepared show as such.</p>
      <p>
        <strong>To correct your GST or legal entity details, contact MyAmbii support.</strong> There&apos;s no
        self-service form for this yet, and these details are what your tax invoices are built from, so it&apos;s
        worth getting right early.
      </p>
      <p>Team seats aren&apos;t billed. Every organisation gets 5, shown on Settings.</p>

      <h2 id="settings">Settings</h2>
      <p><strong>Organisation details</strong> — industry, website, and logo. Admins edit; everyone can view.</p>
      <p>
        <strong>Verification</strong> — shows your current status: Pending, Verified, or Rejected with the reason.
        Submission happens automatically when setup is complete, and resubmission happens automatically the next
        time an admin saves organisation details after a rejection. There&apos;s nothing to click. Status is visible
        to everyone; only admins can act on a rejection by editing organisation details.
      </p>
      <p><strong>Team</strong> — invite by email, promote, demote, remove, and revoke pending invitations. Admin only.</p>
      <p><strong>Deactivate organisation</strong> — admin only, and effectively permanent.</p>

      <h3 id="deactivate">Deactivating your organisation</h3>
      <p>Before you confirm, you&apos;ll see exactly how many live jobs will be closed and how many candidates will be notified. You&apos;ll be asked to type your organisation&apos;s name.</p>
      <p><strong>There&apos;s no way to undo this yourself.</strong> Reactivation is only possible through MyAmbii support, and even then your jobs won&apos;t be republished automatically.</p>

      <h2 id="faq">Common questions</h2>
      <p>
        <strong>Why can&apos;t I access anything except Settings?</strong><br />
        Two different reasons, with different fixes:
      </p>
      <ul>
        <li><strong>Sent to the setup screen?</strong> Your organisation is still missing its logo, industry, or website. Add whatever&apos;s missing and you&apos;ll move on automatically.</li>
        <li>
          <strong>Settings shows &quot;Pending&quot; or &quot;Rejected&quot;?</strong> Setup is already done —
          you&apos;re waiting on a platform admin to verify your organisation, or you need to fix something after a
          rejection. Nothing to do while Pending; if Rejected, address the stated reason and save your organisation
          details to resubmit.
        </li>
      </ul>
      <p><strong>What&apos;s the difference between Find Candidates and job matches?</strong><br />Find Candidates filters everyone on the platform by skill and level, with no ranking. Job matches scores candidates against one specific job. Use the first to explore, the second to fill a role.</p>
      <p><strong>Why does this candidate have no match score?</strong><br />Scores only exist against a specific job. Find Candidates has no job to score against.</p>
      <p><strong>Why can&apos;t I find a candidate I know is on MyAmbii?</strong><br />Candidates need at least one verified skill to appear. Candidates who&apos;ve deactivated their account also won&apos;t show.</p>
      <p><strong>Can I delete a job I&apos;ve published?</strong><br />No. Live and closed jobs can be closed or reopened but not deleted, so the hiring history stays intact. Drafts can be deleted.</p>
      <p><strong>I unpublished a job by mistake.</strong><br />Reopen it from Job Postings. Applicants and shortlisted candidates were already told it stopped accepting applications, and reopening doesn&apos;t retract that.</p>
      <p><strong>A teammate&apos;s invitation expired.</strong><br />Revoke it and send a new one to the same address.</p>
      <p><strong>How do I change my GST details?</strong><br />Contact MyAmbii support.</p>
      <p><strong>When am I charged for an assessment request?</strong><br />When the candidate starts it. Requests that expire unstarted are never charged.</p>
    </>
  );
}
