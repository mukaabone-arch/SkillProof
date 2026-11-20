import type { Metadata } from 'next';
import Link from 'next/link';
import PublicNav from '@/components/PublicNav';

export const metadata: Metadata = {
  alternates: { canonical: '/developers' },
  title: 'MyAmbii API and webhooks',
  description: 'Connect MyAmbii to your applicant tracking system: signed webhooks for applications, pipeline changes and submissions, and a REST API for jobs, applicants and candidates.',
};

const EVENTS: [string, string, string][] = [
  ['candidate.applied', 'A candidate applies to one of your jobs.', 'Employers, recruiters'],
  ['pipeline.stage_changed', 'A candidate is added to the shortlist or moves stage (invited, interviewing, offer, hired, rejected…).', 'Employers'],
  ['outreach.interested', 'A candidate says Interested to your AI sourcing message.', 'Employers, recruiters'],
  ['submission.status_changed', 'A submission to a client is created, approved or declined by the candidate, or moves on.', 'Recruiters'],
  ['job.status_changed', 'A job is posted, closed or reopened.', 'Employers, recruiters'],
];

const ENDPOINTS: [string, string, string][] = [
  ['GET', '/v1/jobs', 'Your jobs with skills and levels. Filters: status, updatedSince, limit.'],
  ['GET', '/v1/applicants', 'Applications with the candidate package. Filters: jobId, updatedSince, limit.'],
  ['GET', '/v1/pipeline', 'Employers: shortlist entries and stage. Recruiters: submissions and status. Filters: jobId (employers), updatedSince, limit.'],
  ['GET', '/v1/candidates/:id', 'One candidate package, for candidates you already work with.'],
  ['GET', '/v1/candidates/:id/resume', 'Resume PDF, only for candidates who applied to one of your jobs.'],
  ['POST', '/v1/pipeline/:id/actions', 'Employers: { "action": "invite" | "offer" | "hire" | "close" | "reject", "message"?, "reason"? }'],
  ['POST', '/v1/submissions/:id/status', 'Recruiters: { "status": "INTERVIEWING" | "OFFER" | "PLACED" | "NOT_SELECTED" | "WITHDRAWN" }'],
];

const PAYLOAD = `{
  "id": "3f1c…",                       // delivery id — the same on retries
  "event": "candidate.applied",
  "createdAt": "2026-11-20T09:15:02.114Z",
  "data": {
    "applicationId": "9a2e…",
    "appliedAt": "2026-11-20T09:15:01.870Z",
    "job": { "id": "51b0…", "code": "AI-101", "title": "Senior ML Engineer" },
    "candidate": {
      "id": "c7d4…",
      "ref": "C-C7D4A1",
      "name": "Priya Sharma",
      "headline": "Machine learning engineer",
      "location": "Pune, Maharashtra, IN",
      "openToRemote": true,
      "yearsOfExperience": 5,
      "aiYearsOfExperience": 2,
      "contact": { "email": "priya@example.com", "phone": "+91…" },
      "verifiedSkills": [
        {
          "skill": "RAG Systems", "level": "L3", "levelName": "Advanced",
          "verifiedBy": "DISCUSSION", "issuedAt": "…", "expiresAt": "…",
          "verifyUrl": "https://www.myambii.com/badges/…"
        }
      ],
      "certifications": [],
      "resumeApiPath": "/v1/candidates/c7d4…/resume"
    }
  }
}`;

const VERIFY = `// Node.js (Express): verify before trusting the body
const crypto = require('crypto');

app.post('/myambii', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('X-MyAmbii-Signature') || '';      // "t=1763630102,v1=ab12…"
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const body = req.body.toString('utf8');
  const expected = crypto
    .createHmac('sha256', process.env.MYAMBII_WEBHOOK_SECRET)
    .update(\`\${parts.t}.\${body}\`)
    .digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  const ok = fresh && parts.v1 && expected.length === parts.v1.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  if (!ok) return res.status(400).send('bad signature');

  const event = JSON.parse(body);
  // de-duplicate on event.id, then handle event.event …
  res.sendStatus(204);
});`;

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'https://<your MyAmbii API address>').replace(/\/+$/, '');
const CURL = `curl "${API_BASE}/v1/applicants?updatedSince=2026-11-01T00:00:00Z" \\
  -H "Authorization: Bearer mya_…"`;

export default function DevelopersPage() {
  return (
    <>
      <PublicNav />
      <main className="container-standard dev-doc">
        <p className="lp-section-eyebrow">For developers</p>
        <h1>MyAmbii API and webhooks</h1>
        <p>
          Connect MyAmbii to your applicant tracking system (ATS) or other tools. <strong>Webhooks</strong> tell your system the moment
          something happens; the <strong>API</strong> lets it read jobs, applicants and your pipeline, and move candidates on. Both carry the
          same <em>candidate package</em>: verified AI skills with links anyone can check, and contact details only where the candidate has
          agreed to share them with you.
        </p>
        <p>
          Set both up in the portal under <strong>Settings → Integrations</strong> (organisation admins, verified organisations). Members can also
          use <strong>Download for ATS</strong> on the shortlist, submissions and AI sourcing pages to get the same package as a JSON file.
        </p>

        <h2 id="webhooks">Webhooks</h2>
        <p>
          Add an HTTPS endpoint, choose the events, and MyAmbii POSTs a JSON body to it. Up to 5 endpoints per organisation. Respond with any
          2xx status within 10 seconds; redirects are not followed and private network addresses are refused.
        </p>
        <table>
          <thead>
            <tr><th>Event</th><th>When</th><th>For</th></tr>
          </thead>
          <tbody>
            {EVENTS.map(([e, when, who]) => (
              <tr key={e}><td><code>{e}</code></td><td>{when}</td><td>{who}</td></tr>
            ))}
          </tbody>
        </table>
        <p>Every request has these headers:</p>
        <ul>
          <li><code>X-MyAmbii-Event</code>: the event name (also <code>webhook.test</code> from the Send test event button).</li>
          <li><code>X-MyAmbii-Delivery</code>: the delivery id, the same on every retry. Use it to ignore duplicates.</li>
          <li><code>X-MyAmbii-Signature</code>: <code>t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256&gt;</code> of <code>&lt;t&gt;.&lt;raw body&gt;</code>, keyed with your signing secret.</li>
        </ul>
        <h3>Example: candidate.applied</h3>
        <pre>{PAYLOAD}</pre>
        <h3>Verifying the signature</h3>
        <pre>{VERIFY}</pre>
        <h3>Retries</h3>
        <p>
          A failed delivery is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then marked failed. You can send any delivery again
          from <strong>Recent deliveries</strong>. An endpoint that fails 20 times in a row is switched off; fix it and turn it back on in Settings.
          The delivery log keeps 30 days.
        </p>

        <h2 id="api">API</h2>
        <p>
          Create a key in Settings → Integrations and send it as <code>Authorization: Bearer mya_…</code> (or <code>X-API-Key</code>). Keys are shown
          once; MyAmbii stores only a hash. Up to 10 active keys per organisation, 120 requests a minute per key. Writes go through the same rules
          as the portal, including the emails candidates receive.
        </p>
        <pre>{CURL}</pre>
        <table>
          <thead>
            <tr><th>Method</th><th>Path</th><th>What it does</th></tr>
          </thead>
          <tbody>
            {ENDPOINTS.map(([m, p, d]) => (
              <tr key={p + m}><td><code>{m}</code></td><td><code>{p}</code></td><td>{d}</td></tr>
            ))}
          </tbody>
        </table>
        <h3>Paging and syncing</h3>
        <p>
          Lists are ordered by <code>updatedAt</code>, oldest first, 50 per page by default (<code>limit</code> up to 100). A full page returns
          <code> next.updatedSince</code>; pass it back as <code>?updatedSince=</code> to get the next page. The first item can repeat the last one
          you saw, so de-duplicate by <code>id</code>. Store the last <code>updatedSince</code> to fetch only what changed on your next sync.
        </p>
        <h3>The interview stage</h3>
        <p>
          Employers can invite, offer, hire, close or reject through the API. <em>Interviewing</em> can&apos;t be set directly: it&apos;s the candidate
          accepting your invite in MyAmbii, and you&apos;ll get a <code>pipeline.stage_changed</code> event when they do.
        </p>

        <h2 id="privacy">What&apos;s shared</h2>
        <ul>
          <li>Verified skills, levels and badge links are included for any candidate you work with.</li>
          <li>Contact details are included once the candidate applied to your job, said Interested to your AI sourcing, or (recruiters) approved a submission or said yes to an availability check.</li>
          <li>Recruiters see no name until then, matching the anonymous search in the portal.</li>
          <li>The resume is available only for candidates who applied to one of your jobs.</li>
        </ul>
        <p>
          You&apos;re responsible for how candidate data is used in your own systems, in line with our <Link href="/terms">Terms</Link> and{' '}
          <Link href="/privacy">Privacy Policy</Link>. Questions: <Link href="/contact">contact us</Link>.
        </p>
      </main>
    </>
  );
}
