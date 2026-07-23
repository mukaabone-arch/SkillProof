'use client';

/**
 * Free vs Premium comparison — every row is generated from live data (GET
 * /plans, both tiers' PlanLimits verbatim) rather than hand-written copy,
 * so this page can never drift from what's actually enforced server-side.
 * Pricing is a placeholder only (no payment provider integration in this
 * pass) — the CTA is a no-op "notify me" flag stored locally, not a real
 * signup.
 */
import { useEffect, useState } from 'react';
import { api, getToken as getStoredToken } from '@/lib/api';
import { useEntitlements, PlanLimits, SubscriptionTier } from '@/lib/entitlements';
import CandidateNav from '@/components/CandidateNav';

interface PlansResponse {
  tiers: {
    FREE: PlanLimits;
    PREMIUM: PlanLimits;
  };
}

const TIERS: SubscriptionTier[] = ['FREE', 'PREMIUM'];

const TIER_LABEL: Record<SubscriptionTier, string> = { FREE: 'Free', PREMIUM: 'Premium' };

/** Describes a PlanLimits field for display — the VALUE always comes from the live fetch below; only the label/formatting is hand-written. */
const FEATURE_ROWS: { label: string; format: (l: PlanLimits) => string }[] = [
  {
    label: 'Assessment starts',
    format: (l) => (l.assessmentsPerMonth === null ? 'Unlimited' : `${l.assessmentsPerMonth} per month`),
  },
  {
    label: 'Retake cooldown',
    format: (l) => (l.retakeCooldownDays === 0 ? 'None — retake right away' : `${l.retakeCooldownDays}-day wait between retakes`),
  },
  {
    label: 'Retakes per skill',
    format: (l) => `${l.retakesPerSkillLifetime} retake${l.retakesPerSkillLifetime === 1 ? '' : 's'}, lifetime`,
  },
  {
    label: 'Job applications',
    format: (l) => (l.applicationsPerMonth === null ? 'Unlimited' : `${l.applicationsPerMonth} per month`),
  },
  {
    label: 'Who viewed your profile',
    format: (l) => (l.profileViewers === 'full' ? 'Full viewer details' : 'Count only'),
  },
  {
    label: 'Application status detail',
    format: (l) => (l.applicationStatusDetail ? 'Full detail' : 'Basic status only'),
  },
  {
    label: 'Search ranking',
    format: (l) => (l.searchRankBoost > 0 ? 'Tiebreaker boost among equally-matched candidates' : 'Standard'),
  },
  {
    label: 'Skill-gap analysis',
    format: (l) => (l.gapAnalysis === 'detailed' ? 'Detailed, ranked by role impact' : 'Basic'),
  },
  {
    label: 'Resume branding',
    format: (l) => (l.resumeBranding ? '"Verified by SkillProof" mark included' : 'No SkillProof branding'),
  },
  {
    label: 'Resume templates',
    format: (l) => `${l.resumeTemplates.length} template${l.resumeTemplates.length === 1 ? '' : 's'}`,
  },
  {
    label: 'Interview prep',
    format: (l) => (l.interviewPrep ? 'Included' : 'Not included'),
  },
];

export default function UpgradePage() {
  const { tier: currentTier } = useEntitlements();
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [error, setError] = useState('');
  const [interested, setInterested] = useState(false);
  // Placeholder pricing only — no geo/billing service exists. A soft locale
  // guess, computed post-mount to avoid an SSR/client hydration mismatch
  // (navigator isn't available during server rendering).
  const [currency, setCurrency] = useState<'INR' | 'USD'>('USD');
  // Read post-mount, not during render — getStoredToken() touches
  // localStorage, which doesn't exist during server rendering, so calling
  // it directly in JSX would make the server and client's first render
  // disagree (a real hydration-mismatch bug, not a style preference).
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    api<PlansResponse>('/plans')
      .then(setPlans)
      .catch((e) => setError((e as Error).message));
    if (typeof navigator !== 'undefined' && /-IN$/i.test(navigator.language)) setCurrency('INR');
    setInterested(localStorage.getItem('sp_premium_interest') === 'true');
    setLoggedIn(!!getStoredToken());
  }, []);

  function registerInterest() {
    localStorage.setItem('sp_premium_interest', 'true');
    setInterested(true);
  }

  function priceFor(tier: SubscriptionTier): string {
    if (tier === 'FREE') return '₹0';
    return currency === 'INR' ? '₹999' : '$15';
  }

  return (
    <>
      {loggedIn && <CandidateNav />}
      <main>
        <h1>Free vs Premium</h1>
        <p>
          Every row below is read straight from the same limits the API enforces — this page can&apos;t
          say something that isn&apos;t actually true of your account.
        </p>
        {error && <p className="error">{error}</p>}

        {plans && (
          <div className="plan-columns">
            {TIERS.map((tier) => {
              const isCurrent = currentTier === tier;
              return (
                <div key={tier} className={`plan-column${isCurrent ? ' plan-column-current' : ''}`}>
                  {isCurrent && <span className="eyebrow">Your current plan</span>}
                  <h2 style={{ marginTop: isCurrent ? 8 : 0, marginBottom: 0 }}>{TIER_LABEL[tier]}</h2>
                  <div className="plan-column-price">
                    {priceFor(tier)}
                    {tier === 'PREMIUM' && <span style={{ fontSize: '1rem', color: 'var(--ink-60)' }}> /month</span>}
                  </div>
                  <div className="plan-column-price-sub">
                    {tier === 'PREMIUM'
                      ? `Placeholder pricing (${currency === 'INR' ? 'India' : 'international'}) — no billing is wired up yet.`
                      : 'No card required.'}
                  </div>
                  <ul className="plan-feature-list">
                    {FEATURE_ROWS.map((row) => (
                      <li key={row.label}>
                        <span className="plan-feature-icon">·</span>
                        <span>
                          <strong>{row.label}:</strong> {row.format(plans.tiers[tier])}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {tier === 'PREMIUM' && currentTier !== 'PREMIUM' && (
                    <div style={{ marginTop: 20 }}>
                      <button onClick={registerInterest} disabled={interested}>
                        {interested ? "You're on the list ✓" : 'Notify me when Premium launches'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
