/**
 * Transcribed verbatim from docs/candidate-guide.md — no clause reworded,
 * condensed, or reordered, same transcription discipline as TermsPage /
 * PrivacyPage. Two corrections were made to the source file itself before
 * this transcription (not silent fixes made here): the "up to four levels"
 * line was corrected to three (L4 is enum headroom with zero live content —
 * see SkillLevel's own schema doc comment), and the employer-verification
 * gate's automatic-submission behavior replaced stale "submit manually"
 * copy. Both were approved corrections to docs/candidate-guide.md, not
 * transcription judgment calls made here.
 *
 * CANDIDATE_HELP_SECTIONS mirrors every h2's own {#id} anchor from the
 * source — HelpTabs.tsx renders this list as the per-audience table of
 * contents; each id below must match the corresponding heading's `id`
 * attribute exactly.
 */
export const CANDIDATE_HELP_SECTIONS = [
  { id: 'quick-start', label: 'Quick start' },
  { id: 'profile', label: 'Your profile' },
  { id: 'skills-and-levels', label: 'Verified skills and levels' },
  { id: 'assessments', label: 'Taking an assessment' },
  { id: 'employer-requests', label: 'When an employer asks you to take an assessment' },
  { id: 'jobs', label: 'Finding and applying for jobs' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'badges', label: 'Your badges and certificates' },
  { id: 'account', label: 'Your account' },
  { id: 'free-limits', label: 'Free plan limits' },
  { id: 'faq', label: 'Common questions' },
];

export default function CandidateHelpGuide() {
  return (
    <>
      <h2 id="quick-start">Quick start</h2>
      <p>Five steps from signing up to applying for your first job.</p>
      <ol>
        <li>
          <strong>Verify your phone and email.</strong> You need both on file before you can reach anything else. If
          you signed up with Google or GitHub, you&apos;ll usually be asked to add a phone number.
        </li>
        <li>
          <strong>Fill in your profile.</strong> At minimum, add your full name and either a headline or your years
          of experience. That&apos;s the threshold for starting an assessment. Upload your resume too, since
          you&apos;ll need one on file to apply for jobs.
        </li>
        <li>
          <strong>Earn your first verified skill.</strong> Go to Assessments, pick a skill, and take the test.
          Passing earns you a verified badge at that level.
        </li>
        <li>
          <strong>Set your AI experience.</strong> On your profile, fill in your AI-specific years of experience.
          Zero is a valid answer, but it has to be answered rather than left blank.
        </li>
        <li>
          <strong>Apply.</strong> Head to Jobs. &quot;Matched to you&quot; ranks live openings against your verified
          skills. You get 10 applications a month.
        </li>
      </ol>
      <p>Your dashboard always shows one suggested next step, so if you&apos;re not sure what to do, start there.</p>

      <h2 id="profile">Your profile</h2>
      <p>Your profile is what employers see next to your verified badges.</p>
      <p>
        <strong>What you can add:</strong> full name, email, headline, role title, location, whether you&apos;re
        open to remote work, years of experience, AI-specific years of experience, GitHub and LinkedIn links, a
        photo, and a resume.
      </p>
      <p>
        <strong>Parse with AI.</strong> Upload your resume and MyAmbii will suggest a name, headline, location,
        years of experience, and role. Nothing is saved until you click &quot;Looks good — apply to my profile.&quot;
        Skills it detects are shown for information only and are never added automatically.
      </p>
      <p>
        <strong>Location.</strong> Pick from the autocomplete rather than typing free text. Only a selected location
        unlocks location-aware job matching.
      </p>
      <p><strong>Role title</strong> is used for display and filtering. It does not affect your match scores.</p>
      <p><strong>Your photo</strong> is only served to signed-in users through MyAmbii. There&apos;s no public URL for it.</p>

      <h3 id="certifications">Certifications</h3>
      <p>
        You can add certifications you&apos;ve earned elsewhere: Credly, Coursera, LinkedIn Learning, PMI,
        PeopleCert, AWS, Microsoft, Google, Scrum Alliance, Udemy, edX, NPTEL, or anything else as free text. Add a
        link or upload a file as proof, and tag the skills it covers.
      </p>
      <p>Certifications show one of three trust levels:</p>
      <div className="lp-legal-table-wrap">
        <table className="lp-legal-table">
          <thead>
            <tr><th>Level</th><th>What it means</th></tr>
          </thead>
          <tbody>
            <tr><td>Verified</td><td>Confirmed by the issuer. Credly certifications verify automatically.</td></tr>
            <tr><td>Link provided</td><td>You gave a URL, but it hasn&apos;t been confirmed.</td></tr>
            <tr><td>Self-reported</td><td>No proof attached.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>Only Verified certifications affect job matching.</strong> The other two are display only.
        Certifications are always shown differently from MyAmbii verified badges, which are green.
      </p>
      <p>If a certification expires, it gets a warning badge, and you&apos;ll see a countdown before it lapses.</p>

      <h2 id="skills-and-levels">Verified skills and levels</h2>
      <p>This is the core of MyAmbii, and most other features depend on it.</p>
      <p>
        A skill can be verified at up to three levels, L1 through L3, from foundational to advanced.{' '}
        <strong>Which levels exist depends on the skill</strong> — not every skill offers all three.
      </p>
      <p>
        <strong>You earn levels in order.</strong> You can attempt the level immediately above the highest one you
        hold for that skill. If a skill only offers L2, then L2 is where you start; you&apos;re not blocked behind a
        level that doesn&apos;t exist.
      </p>
      <p><strong>What a verified level gets you:</strong></p>
      <ul>
        <li>It appears on your profile and on a shareable public certificate page.</li>
        <li>It counts fully towards your match score on jobs asking for that skill.</li>
        <li>It satisfies the requirement to have at least one verified credential before applying to jobs.</li>
      </ul>
      <p>
        <strong>Levels expire one year after you earn them.</strong> An expired badge stops counting towards
        matching, but you can retake the assessment to renew it.
      </p>

      <h3 id="catalog-states">What the assessment catalog shows you</h3>
      <p>Each skill has a row per level, and each row is in one of these states:</p>
      <div className="lp-legal-table-wrap">
        <table className="lp-legal-table">
          <thead>
            <tr><th>State</th><th>What it means</th></tr>
          </thead>
          <tbody>
            <tr><td>Available</td><td>You can attempt this now.</td></tr>
            <tr><td>Earned</td><td>You hold a valid badge at this level.</td></tr>
            <tr><td>Locked</td><td>Above the next level you&apos;re eligible for. The page tells you what unlocks it.</td></tr>
            <tr><td>Covered</td><td>Below a level you already hold, so there&apos;s no separate badge to earn.</td></tr>
            <tr><td>Expired</td><td>You held this but it lapsed. Retake it to renew.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="assessments">Taking an assessment</h2>
      <p>There are two formats. Which one you get depends on the skill.</p>

      <h3 id="test-format">Multiple-choice test</h3>
      <p>
        The common format. You&apos;ll see an integrity notice to accept, then a set of multiple-choice questions
        with a countdown running on our server. Answers save as you go, so a refresh won&apos;t lose your work. When
        time runs out it submits automatically.
      </p>
      <p>
        <strong>You get your result immediately.</strong> You&apos;ll see your score, whether you passed, and a
        breakdown by topic showing how many you got right in each area. You won&apos;t see which specific questions
        you missed.
      </p>
      <p>Pass, and you get your badge, its expiry date, and a link to your public certificate.</p>
      <p>
        <strong>While you&apos;re taking a test,</strong> MyAmbii records some things for review: switching tabs,
        leaving fullscreen, attempting to paste (which is blocked), copying, and right-clicking. These are recorded
        as signals for a human to look at. They never fail you automatically and they don&apos;t change your score
        or your badge.
      </p>

      <h3 id="discussion-format">Live discussion</h3>
      <p>Currently offered for one skill and level: RAG Systems L2.</p>
      <p>
        Instead of multiple choice, you have a roughly 20-minute text conversation with an AI assessor. Plan to work
        alone and without help, since the session is recorded and reviewed by a person afterwards.
      </p>
      <p>
        <strong>During the session</strong> you&apos;ll see a question counter and a brief you can expand at any
        time. After each topic, you&apos;ll get informal &quot;Reviewer notes&quot; with feedback on how that part
        went. <strong>These notes are coaching, not your result.</strong> The official decision comes from a human
        reviewer afterwards.
      </p>
      <p>
        <strong>If you go quiet for 15 minutes,</strong> the session times out. This isn&apos;t the end of it.
        Reload the page and you&apos;ll pick up where you left off, with the last question asked again. You can also
        leave deliberately and come back later.
      </p>
      <p><strong>After you finish,</strong> a reviewer looks at your session. You&apos;ll usually hear back within a day.</p>
      <p>
        <strong>Your result</strong> shows a verdict on each part of the rubric, the reviewer&apos;s written
        reasoning, and whether that part affected your badge. You can read the full transcript.
      </p>
      <p>If you disagree with a verdict, you can dispute it once per claim, in your own words. It goes back for another review.</p>
      <p>
        Sometimes a session is marked as not having given you a fair chance to show what you know. That&apos;s
        counted as our assessor&apos;s shortcoming, not yours, and you can retake immediately with no penalty.
      </p>

      <h3 id="retakes">Retakes</h3>
      <p>There&apos;s no waiting period between attempts.</p>
      <p>
        On the free plan you get <strong>two attempts at each skill and level</strong> — your first, plus one
        retake. The count is per level, so passing L1 and moving to L2 starts fresh. If a badge expires, the counter
        effectively resets and only attempts after that expiry count.
      </p>

      <h3 id="free-skill-lock">Before you take your first test</h3>
      <p>
        <strong>On the free plan, your first self-started multiple-choice attempt locks your free self-started
        attempts to that one skill.</strong> You can keep taking other levels of the same skill, but not a different
        skill.
      </p>
      <p>Choose your first skill deliberately.</p>
      <p>This doesn&apos;t apply to assessments an employer asks you to take. Those are separate and don&apos;t use up anything of yours.</p>

      <h2 id="employer-requests">When an employer asks you to take an assessment</h2>
      <p>
        An employer who&apos;s shortlisted you can ask you to verify a specific skill. You&apos;ll see it on your
        dashboard and at the top of your Assessments page.
      </p>
      <p><strong>You have five days to start it.</strong> After that the request closes and you&apos;d need the employer to send a new one.</p>
      <p>Before you start, we show you exactly what the employer will see when you finish:</p>
      <ul>
        <li><strong>Test:</strong> whether you passed, your score, and the topic breakdown.</li>
        <li><strong>Discussion:</strong> whether you passed. Nothing else — not the conversation, not your individual answers.</li>
      </ul>
      <p>These requests don&apos;t count against your own limits, and they don&apos;t trigger the free-plan skill lock. The employer covers the cost.</p>
      <p>If you already hold the badge they asked for, there&apos;s nothing to do and no one is charged.</p>

      <h2 id="jobs">Finding and applying for jobs</h2>
      <p>The Jobs page has three tabs.</p>
      <p><strong>Matched to you</strong> ranks live openings against your verified skills, with a score and a list of which required skills you have and which you&apos;re missing.</p>
      <p><strong>Browse jobs</strong> is a manual search by skill, location, or remote-only.</p>
      <p><strong>My applications</strong> tracks what you&apos;ve applied to.</p>

      <h3 id="apply-requirements">What you need before you can apply</h3>
      <p>Four things:</p>
      <ol>
        <li>Your name and years of experience on your profile.</li>
        <li>A resume uploaded.</li>
        <li>Your AI years of experience answered. Zero counts, blank doesn&apos;t.</li>
        <li>At least one verified credential — a MyAmbii badge or a Verified certification.</li>
      </ol>

      <h3 id="matching">How matching works</h3>
      <p>
        Your score is based <strong>only on verified information</strong>: your verified skills and their levels,
        Verified certifications tagged to the skills a job asks for, and your years of experience.
      </p>
      <ul>
        <li>A verified skill at or above the level asked for gets full credit.</li>
        <li>A verified skill below the level asked for gets partial credit, scaled by how close you are.</li>
        <li>A skill you&apos;ve claimed but not verified gets limited credit.</li>
        <li>A Verified certification for a required skill counts as full credit for it.</li>
        <li>Skills marked required count double compared to nice-to-have skills.</li>
        <li>Years of experience is a small adjustment either way, never decisive.</li>
      </ul>
      <p><strong>Nothing you write about yourself affects the score.</strong> Your headline, role title, and location are for display and filtering only.</p>
      <p>To appear in an employer&apos;s results at all, you need at least one verified skill.</p>

      <h3 id="application-limit">Your application limit</h3>
      <p><strong>You can submit 10 applications a month.</strong> The job page shows how many you have left before you use them.</p>
      <p>The count resets at the start of each calendar month, UTC. If you&apos;re in India, that&apos;s 5:30am on the 1st rather than local midnight.</p>
      <p>At 10, applications are blocked until the reset. If an application fails for a technical reason, it doesn&apos;t cost you a slot.</p>

      <h2 id="interviews">Interviews</h2>
      <p>The Interviews page shows every employer shortlist you&apos;re on and where you are in their process.</p>
      <div className="lp-legal-table-wrap">
        <table className="lp-legal-table">
          <thead>
            <tr><th>Stage</th><th>What it means</th><th>What you can do</th></tr>
          </thead>
          <tbody>
            <tr><td>On their shortlist</td><td>An employer has saved your profile.</td><td>Nothing yet.</td></tr>
            <tr><td>Invited to interview</td><td>They want to talk.</td><td>Accept or decline.</td></tr>
            <tr><td>Interviewing</td><td>You accepted.</td><td>Nothing until they schedule. Round details appear as they&apos;re added.</td></tr>
            <tr><td>Offer extended</td><td>They&apos;ve made an offer.</td><td>Accept, decline, or say you&apos;re still deciding.</td></tr>
            <tr><td>Hired / Closed / Declined / Rejected</td><td>The process has ended.</td><td>Nothing.</td></tr>
          </tbody>
        </table>
      </div>
      <p><strong>Declining an invitation ends that pipeline.</strong> You&apos;ll be asked to confirm.</p>
      <p>Once you&apos;ve accepted an invitation, scheduling is up to the employer. There&apos;s no fixed number of rounds, and we don&apos;t promise one upfront.</p>
      <p>You&apos;ll see the round you&apos;re currently on, not the employer&apos;s internal notes or their full history on you.</p>

      <h2 id="badges">Your badges and certificates</h2>
      <p>Every badge you earn has a public certificate page you can share, for example on LinkedIn. Anyone can open it without signing in.</p>
      <p>It shows your name, the skill and level, how it was verified, when it was issued, when it expires, and whether it&apos;s still valid.</p>
      <p>If you deactivate or delete your account, the certificate stays verifiable but no longer shows your details.</p>

      <h2 id="account">Your account</h2>
      <h3 id="login-methods">Adding or changing a phone or email</h3>
      <p>
        Under Profile → Account, you can add a missing phone or email, or change one you already have. Both are
        confirmed by a one-time code onto your existing account, so you won&apos;t accidentally end up with two
        accounts.
      </p>

      <h3 id="deactivate">Deactivating</h3>
      <p>Deactivating hides you from search, matching, and new results. Employers can&apos;t shortlist you or send you invitations, and notification emails stop.</p>
      <p><strong>Nothing is deleted.</strong> Your profile, badges, applications, and history stay exactly as they are. Sign back in whenever you want and everything resumes.</p>
      <p>You can give a reason if you want. It&apos;s optional.</p>

      <h3 id="delete">Deleting</h3>
      <p>Deleting is permanent. Type DELETE to confirm.</p>
      <p>
        Your name, email, phone, photo, resume, and profile details are removed. Your verified badges remain
        independently verifiable but no longer carry your name. Employers keep anonymised records of candidates
        they&apos;ve interviewed, which is a legal requirement for them.
      </p>

      <h2 id="free-limits">Free plan limits</h2>
      <p>What the free plan includes:</p>
      <ul>
        <li>Verified skills and badges</li>
        <li>Job matching</li>
        <li><strong>10 job applications a month</strong></li>
        <li>
          <strong>Unlimited attempts per skill and level right now</strong> — a temporary allowance until skill
          purchases launch later this year; the standing limit is two attempts
        </li>
        <li><strong>Self-started multiple-choice assessments limited to one skill</strong>, set by your first attempt</li>
        <li><strong>One live discussion session a month</strong> — a limited-time launch allowance, not a permanent part of the free plan (see below)</li>
      </ul>
      <p>Assessments an employer requests are outside all of these.</p>
      <p>A paid plan is coming this year. We&apos;ll share what&apos;s in it and what it costs before anything goes live.</p>
      <p>
        The one-a-month discussion-session allowance above runs through November 2026 as a launch-window offer.
        After that, it may no longer be included on the free plan — nothing to do now, just don&apos;t assume
        it&apos;s permanent.
      </p>

      <h2 id="faq">Common questions</h2>
      <p><strong>Why can&apos;t I start an assessment?</strong><br />Check your profile has your full name and either a headline or years of experience. On the free plan, also check whether your first attempt locked you to a different skill.</p>
      <p>
        <strong>Why can&apos;t I apply for this job?</strong>
        <br />
        You need a complete profile, a resume, your AI years of experience answered, verified badges at all three
        levels of the same skill — Foundational, Practitioner and Advanced — and applications left this month.
      </p>
      <p><strong>My discussion session says it expired.</strong><br />Reload the page. Idle sessions time out but resume where you left off.</p>
      <p><strong>I&apos;ve finished my discussion assessment. When do I hear back?</strong><br />A person reviews it, usually within a day.</p>
      <p><strong>My badge expired.</strong><br />Badges last a year. Retake the assessment to renew it.</p>
      <p><strong>Why don&apos;t I appear in employer searches?</strong><br />You need at least one verified skill. Claimed-but-unverified skills aren&apos;t enough.</p>
      <p><strong>Do I lose an application if something goes wrong?</strong><br />No. Failed submissions are credited back automatically.</p>
    </>
  );
}
