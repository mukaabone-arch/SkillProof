'use client';

/**
 * interviewPrep (Free: false, Premium: true) — static, bundled content
 * (no backend data involved, unlike the other gated surfaces), so the gate
 * here is purely `limits?.interviewPrep`. Free sees the real section
 * titles (a genuine, specific teaser — three named guides exist) with the
 * actual guidance blurred behind the usual upgrade CTA.
 */
import { useEntitlements } from '@/lib/entitlements';
import { LockedPreview } from './LockedPreview';

const GUIDES = [
  {
    title: 'Behavioral questions to expect',
    body:
      'Interviewers commonly ask how you handled a project where requirements changed mid-way, a time you disagreed with a technical decision, and how you explain a complex model choice to a non-technical stakeholder. Prepare one concrete story for each — specific, with a measurable outcome.',
  },
  {
    title: 'Deep-dive prompts for your verified skills',
    body:
      'For each skill badge on your profile, expect at least one question asking you to justify a trade-off (e.g. why you chose one chunking strategy, evaluation metric, or fine-tuning approach over another) rather than just define the term. Practice explaining the reasoning, not just the result.',
  },
  {
    title: 'Questions worth asking the interviewer',
    body:
      'Ask what "good" looks like in the role’s first 90 days, how the team currently evaluates model/product quality, and what the biggest technical debt or open problem is. These signal genuine interest and often reveal more about the role than the job description did.',
  },
];

export default function InterviewPrepPanel() {
  const { limits } = useEntitlements();
  if (!limits) return null;

  return (
    <section className="ui-card profile-panel" style={{ marginTop: 32 }}>
      <h2>Interview prep</h2>
      <p>Guidance for turning a verified badge into an interview that goes well.</p>

      {limits.interviewPrep ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {GUIDES.map((g) => (
            <div key={g.title} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <strong>{g.title}</strong>
              <p style={{ margin: 0 }}>{g.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <LockedPreview
          teaser={`${GUIDES.length} prep guides available, tailored to your verified skills.`}
          ctaLabel="Upgrade to read"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {GUIDES.map((g) => (
              <div key={g.title} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <strong>{g.title}</strong>
                <p style={{ margin: 0 }}>{g.body}</p>
              </div>
            ))}
          </div>
        </LockedPreview>
      )}
    </section>
  );
}
