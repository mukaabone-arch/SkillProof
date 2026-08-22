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
import Script from 'next/script';
import { api, getToken as getStoredToken } from '@/lib/api';
import { useEntitlements, PlanLimits, SubscriptionTier } from '@/lib/entitlements';
import CandidateNav from '@/components/CandidateNav';
import { ErrorState } from '@/components/ui';

type BillingInterval = 'MONTHLY' | 'ANNUAL';

interface MySubscription {
  tier: SubscriptionTier;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  interval: BillingInterval | null;
}

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
    label: 'AI discussion sessions',
    format: (l) =>
      l.discussionSessionsPerMonth === null
        ? 'Unlimited'
        : l.discussionSessionsPerMonth === 0
          ? 'Not included'
          : `${l.discussionSessionsPerMonth} per month`,
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
    format: (l) => (l.resumeBranding ? '"Verified by MyAmbii" mark included' : 'No MyAmbii branding'),
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
  // Read post-mount, not during render — getStoredToken() touches
  // localStorage, which doesn't exist during server rendering, so calling
  // it directly in JSX would make the server and client's first render
  // disagree (a real hydration-mismatch bug, not a style preference).
  const [loggedIn, setLoggedIn] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [mySubscription, setMySubscription] = useState<MySubscription | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<BillingInterval | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  useEffect(() => {
    api<PlansResponse>('/plans')
      .then(setPlans)
      .catch((e) => setError((e as Error).message));
    setInterested(localStorage.getItem('sp_premium_interest') === 'true');
    const hasToken = !!getStoredToken();
    setLoggedIn(hasToken);
    if (hasToken) refreshMySubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshMySubscription() {
    return api<MySubscription>('/subscriptions/me')
      .then(setMySubscription)
      .catch(() => undefined);
  }

  function registerInterest() {
    localStorage.setItem('sp_premium_interest', 'true');
    setInterested(true);
  }

  function priceFor(tier: SubscriptionTier): string {
    if (tier === 'FREE') return '₹0';
    return '₹299';
  }

  /**
   * Step 1: create the Razorpay subscription server-side, launch Checkout
   * with subscription_id (not order_id — see lib/razorpay.ts). Step 2 is
   * deliberately NOT a client-side verify call the way
   * AssessCandidateAction's order flow has one — subscription state only
   * ever changes from a verified webhook (see the subscriptions module's
   * own design notes), so the checkout success handler here just starts
   * polling GET /subscriptions/me for a few seconds until the webhook has
   * landed and tier actually flips, rather than trusting the Checkout
   * response itself to mean anything happened yet.
   */
  async function startCheckout(plan: BillingInterval) {
    setActionError('');
    setActionMessage('');
    setCheckoutBusy(plan);
    try {
      const result = await api<{ subscriptionId: string; keyId: string }>('/subscriptions/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      if (!scriptReady || !window.Razorpay) {
        setActionError('Payment could not start — Razorpay is not ready. Please try again.');
        return;
      }
      const checkout = new window.Razorpay({
        key: result.keyId,
        subscription_id: result.subscriptionId,
        name: 'MyAmbii Premium',
        description: plan === 'MONTHLY' ? '₹299/month' : '₹2,999/year',
        theme: { color: '#5B4FE0' },
        handler: () => {
          void confirmAfterCheckout();
        },
      });
      checkout.open();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setCheckoutBusy(null);
    }
  }

  async function confirmAfterCheckout() {
    setConfirming(true);
    setActionMessage('Confirming your subscription…');
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const sub = await api<MySubscription>('/subscriptions/me').catch(() => null);
      if (sub?.tier === 'PREMIUM') {
        setMySubscription(sub);
        setActionMessage('You’re on Premium — thanks for subscribing!');
        setConfirming(false);
        return;
      }
    }
    setConfirming(false);
    setActionMessage('Payment received — it can take a minute to reflect here. Refresh shortly if it doesn’t update.');
  }

  async function cancelSubscription() {
    if (!confirm('Cancel your Premium subscription? You’ll keep Premium until your current paid period ends.')) return;
    setActionError('');
    setActionMessage('');
    try {
      await api('/subscriptions/cancel', { method: 'POST' });
      await refreshMySubscription();
      setActionMessage('Cancelled — you’ll keep Premium until your current period ends, then move to Free.');
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function switchPlan(plan: BillingInterval) {
    setActionError('');
    setActionMessage('');
    try {
      await api('/subscriptions/switch-plan', { method: 'POST', body: JSON.stringify({ plan }) });
      setActionMessage(`Scheduled — you’ll switch to ${plan === 'MONTHLY' ? 'Monthly' : 'Annual'} billing at your next renewal.`);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" onLoad={() => setScriptReady(true)} strategy="afterInteractive" />
      {loggedIn && <CandidateNav />}
      <main className="container-wide">
        <h1>Free vs Premium</h1>
        <p>Everything below reflects your actual account — no fine print.</p>
        {error && <ErrorState message={error} />}
        {actionMessage && <p className="ok">{actionMessage}</p>}
        {actionError && <p className="error">{actionError}</p>}

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
                      ? 'Placeholder pricing — no billing is wired up yet.'
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
                  {tier === 'PREMIUM' && currentTier !== 'PREMIUM' && loggedIn && (
                    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button onClick={() => startCheckout('MONTHLY')} disabled={checkoutBusy !== null || confirming}>
                        {checkoutBusy === 'MONTHLY' ? 'Starting…' : 'Subscribe — ₹299/month'}
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => startCheckout('ANNUAL')}
                        disabled={checkoutBusy !== null || confirming}
                      >
                        {checkoutBusy === 'ANNUAL' ? 'Starting…' : 'Subscribe — ₹2,999/year'}
                      </button>
                    </div>
                  )}
                  {tier === 'PREMIUM' && currentTier !== 'PREMIUM' && !loggedIn && (
                    <div style={{ marginTop: 20 }}>
                      <button onClick={registerInterest} disabled={interested}>
                        {interested ? "You're on the list ✓" : 'Notify me when Premium launches'}
                      </button>
                    </div>
                  )}
                  {tier === 'PREMIUM' && currentTier === 'PREMIUM' && mySubscription?.tier === 'PREMIUM' && (
                    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <p className="meta" style={{ margin: 0 }}>
                        {mySubscription.interval === 'MONTHLY' ? 'Billed monthly' : mySubscription.interval === 'ANNUAL' ? 'Billed annually' : 'Active'}
                        {mySubscription.currentPeriodEnd &&
                          (mySubscription.cancelAtPeriodEnd
                            ? ` — ends ${new Date(mySubscription.currentPeriodEnd).toLocaleDateString()}`
                            : ` — renews ${new Date(mySubscription.currentPeriodEnd).toLocaleDateString()}`)}
                      </p>
                      {mySubscription.interval && (
                        <button
                          className="btn-secondary"
                          onClick={() => switchPlan(mySubscription.interval === 'MONTHLY' ? 'ANNUAL' : 'MONTHLY')}
                        >
                          Switch to {mySubscription.interval === 'MONTHLY' ? 'Annual' : 'Monthly'}
                        </button>
                      )}
                      {!mySubscription.cancelAtPeriodEnd && (
                        <button className="btn-secondary" onClick={cancelSubscription}>
                          Cancel subscription
                        </button>
                      )}
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
