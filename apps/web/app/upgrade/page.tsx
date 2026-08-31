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

/** One interval's fully-computed pricing — mirrors gst.config.ts's GstSplit exactly. Always the DEFAULT place of supply (Maharashtra); the actual charge uses the candidate's own on-file state at charge time, see GET /plans's own doc comment (API side) for why this endpoint can't know that. */
interface PricingBreakdown {
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  placeOfSupplyStateCode: string;
}

interface PlansResponse {
  tiers: {
    FREE: PlanLimits;
    PREMIUM: PlanLimits;
  };
  pricing: {
    gstRate: number;
    MONTHLY: PricingBreakdown;
    ANNUAL: PricingBreakdown;
  };
}

/** ₹3,538.82-style formatting from an integer paise amount — en-IN locale for the thousands grouping (2,999.00, not 2999.00), matching the pricing table's own formatting exactly. */
function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const { tier: currentTier, refetch } = useEntitlements();
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
      // The precise, GST-inclusive total — not the bare ₹299/₹2,999 base
      // this used to show, which is no longer what's actually charged.
      // Falls back to the base-only label only if /plans somehow hasn't
      // loaded by the time checkout starts (shouldn't happen — the button
      // that calls this only renders once `plans` is set).
      const totalLabel = plans
        ? plan === 'MONTHLY'
          ? `${formatPaise(plans.pricing.MONTHLY.totalPaise)}/month (incl. GST)`
          : `${formatPaise(plans.pricing.ANNUAL.totalPaise)}/year (incl. GST)`
        : plan === 'MONTHLY'
          ? '₹299/month + GST'
          : '₹2,999/year + GST';
      const checkout = new window.Razorpay({
        key: result.keyId,
        subscription_id: result.subscriptionId,
        name: 'MyAmbii Premium',
        description: totalLabel,
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
        // The nav (and every other gated surface) reads tier from the
        // entitlements context, which is fetched once per session — without
        // this it keeps showing "Upgrade" until something remounts the
        // provider.
        await refetch();
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
                    {tier === 'PREMIUM' && (
                      <span style={{ fontSize: '1rem', color: 'var(--ink-60)' }}> /month + GST as applicable</span>
                    )}
                  </div>
                  <div className="plan-column-price-sub">
                    {tier === 'PREMIUM'
                      ? // Deliberately not a computed total here ("as applicable" —
                        // covers the CGST/SGST-vs-IGST variation by place of
                        // supply, resolved per-candidate at charge time, not
                        // knowable on this unauthenticated comparison view). The
                        // precise, exact-paise breakdown for whichever interval a
                        // candidate is about to actually pay lives just above the
                        // Subscribe buttons below instead.
                        `Billed monthly. Cancel anytime. Or ${formatPaise(plans.pricing.ANNUAL.basePaise)}/year + GST as applicable, billed annually.`
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
                    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/*
                        Explicit, exact-paise breakdown right before each
                        Subscribe button — not a rounded/approximate figure,
                        since this is the number actually charged. Computed
                        server-side (GET /plans's pricing field, gst.config.ts's
                        splitGst) and only ever displayed here, never
                        recomputed client-side.
                      */}
                      <div>
                        <p className="meta" style={{ margin: '0 0 6px' }}>
                          Base {formatPaise(plans.pricing.MONTHLY.basePaise)} + GST 18%{' '}
                          {formatPaise(plans.pricing.MONTHLY.gstPaise)} = {formatPaise(plans.pricing.MONTHLY.totalPaise)}
                        </p>
                        <button onClick={() => startCheckout('MONTHLY')} disabled={checkoutBusy !== null || confirming}>
                          {checkoutBusy === 'MONTHLY' ? 'Starting…' : `Subscribe — ${formatPaise(plans.pricing.MONTHLY.totalPaise)}/month`}
                        </button>
                      </div>
                      <div>
                        <p className="meta" style={{ margin: '0 0 6px' }}>
                          Base {formatPaise(plans.pricing.ANNUAL.basePaise)} + GST 18%{' '}
                          {formatPaise(plans.pricing.ANNUAL.gstPaise)} = {formatPaise(plans.pricing.ANNUAL.totalPaise)}
                        </p>
                        <button
                          className="btn-secondary"
                          onClick={() => startCheckout('ANNUAL')}
                          disabled={checkoutBusy !== null || confirming}
                        >
                          {checkoutBusy === 'ANNUAL' ? 'Starting…' : `Subscribe — ${formatPaise(plans.pricing.ANNUAL.totalPaise)}/year`}
                        </button>
                      </div>
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
