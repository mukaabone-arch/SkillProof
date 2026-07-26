'use client';

/**
 * Throwaway Razorpay test-mode plumbing check (feat/razorpay-test) — proves
 * the round trip (create order -> Checkout -> server-verified signature)
 * works end-to-end before the real subscription/billing system is built on
 * top of it. Deliberately bare: no nav, no styling beyond what's needed to
 * read the result. NOT the real payment flow — see apps/api's
 * payments.controller.ts for the matching backend note.
 */
import { useState } from 'react';
import Script from 'next/script';
import { api } from '@/lib/api';
import { type RazorpayCheckoutResponse } from '@/lib/razorpay';

interface CreateOrderResponse {
  orderId: string;
  keyId: string;
  amount: number;
  currency: string;
}

interface VerifyResponse {
  verified: boolean;
}

type Status = 'idle' | 'creating-order' | 'awaiting-payment' | 'verifying' | 'verified' | 'failed' | 'error';

interface PaymentStatusResponse {
  status: string;
  amount: number;
  method: string;
  captured: boolean;
}

export default function PaymentTestPage() {
  const [scriptReady, setScriptReady] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function startTestPayment() {
    setMessage('');
    setStatus('creating-order');
    try {
      const order = await api<CreateOrderResponse>('/payments/test/create-order', { method: 'POST' });

      if (!scriptReady || !window.Razorpay) {
        setStatus('error');
        setMessage('Razorpay Checkout script has not loaded yet — wait a moment and try again.');
        return;
      }

      setStatus('awaiting-payment');
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'SkillProof (test)',
        description: `Razorpay plumbing test — ${(order.amount / 100).toFixed(2)} ${order.currency}`,
        theme: { color: '#5B4FE0' },
        modal: {
          // Functional update, not a closure read of `status` — this
          // callback is bound once when Checkout opens, so reading the
          // outer `status` variable directly would always see whatever it
          // was at that moment (stale), never the later 'verified'/'failed'
          // it should defer to if the handler already ran.
          ondismiss: () => {
            setStatus((s) => (s === 'awaiting-payment' ? 'idle' : s));
            setMessage('Checkout closed before completing payment.');
          },
        },
        handler: (response) => {
          void verifyTestPayment(response);
        },
      });
      checkout.open();
    } catch (e) {
      setStatus('error');
      setMessage((e as Error).message);
    }
  }

  async function verifyTestPayment(response: RazorpayCheckoutResponse) {
    setStatus('verifying');
    try {
      const result = await api<VerifyResponse>('/payments/test/verify', {
        method: 'POST',
        body: JSON.stringify(response),
      });
      if (result.verified) {
        setStatus('verified');
        setMessage(`Signature verified server-side. Payment id: ${response.razorpay_payment_id}`);
      } else {
        setStatus('failed');
        setMessage('Server rejected the payment signature — this was NOT accepted as a real payment.');
      }
    } catch (e) {
      setStatus('error');
      setMessage((e as Error).message);
    }
  }

  // ---------- STEP 0: manual-capture (authorize now, capture later) proof ----------
  // Separate from the flow above — that one auto-captures on Checkout
  // success like a normal payment. This one authorizes only (Checkout
  // succeeds, funds are held, nothing is charged yet) and leaves capture as
  // a distinct, manual step, so the authorized -> captured transition can
  // actually be observed via a real test-mode payment before
  // employer-triggered-assessment's authorize/candidate-start-capture/
  // expiry-void design is built on top of it.
  const [authOrder, setAuthOrder] = useState<CreateOrderResponse | null>(null);
  const [authPaymentId, setAuthPaymentId] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusResponse | null>(null);

  async function startAuthOnlyPayment() {
    setAuthMessage('');
    setPaymentStatus(null);
    setAuthPaymentId('');
    setAuthBusy(true);
    try {
      const order = await api<CreateOrderResponse>('/payments/test/create-auth-order', { method: 'POST' });
      setAuthOrder(order);

      if (!scriptReady || !window.Razorpay) {
        setAuthMessage('Razorpay Checkout script has not loaded yet — wait a moment and try again.');
        setAuthBusy(false);
        return;
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'SkillProof (test — auth only)',
        description: 'Authorize-only test — funds are held, NOT captured, until you click Capture below.',
        theme: { color: '#5B4FE0' },
        modal: {
          ondismiss: () => {
            setAuthBusy(false);
            setAuthMessage((m) => m || 'Checkout closed before authorizing.');
          },
        },
        handler: (response) => {
          setAuthPaymentId(response.razorpay_payment_id);
          setAuthMessage('Authorized. Funds are held, not charged. Check status, then capture (or leave it — it auto-releases after 5 days).');
          setAuthBusy(false);
        },
      });
      checkout.open();
    } catch (e) {
      setAuthBusy(false);
      setAuthMessage((e as Error).message);
    }
  }

  async function checkPaymentStatus() {
    if (!authPaymentId) return;
    setAuthBusy(true);
    try {
      const result = await api<PaymentStatusResponse>(`/payments/test/status/${authPaymentId}`);
      setPaymentStatus(result);
    } catch (e) {
      setAuthMessage((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function captureAuthorizedPayment() {
    if (!authPaymentId) return;
    setAuthBusy(true);
    try {
      await api('/payments/test/capture', { method: 'POST', body: JSON.stringify({ paymentId: authPaymentId }) });
      await checkPaymentStatus();
      setAuthMessage('Captured — funds actually charged now.');
    } catch (e) {
      setAuthMessage((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        onLoad={() => setScriptReady(true)}
        strategy="afterInteractive"
      />
      <main>
        <h1>Razorpay test-mode plumbing check</h1>
        <p>
          Throwaway dummy flow — not the real subscription system. Pays a fixed ₹100 test order and proves the
          create-order → Checkout → server-side signature verification round trip works.
        </p>

        <button onClick={startTestPayment} disabled={status === 'creating-order' || status === 'awaiting-payment' || status === 'verifying'}>
          {status === 'creating-order'
            ? 'Creating order…'
            : status === 'awaiting-payment'
              ? 'Waiting for Checkout…'
              : status === 'verifying'
                ? 'Verifying…'
                : 'Pay ₹100 (test card)'}
        </button>

        {status === 'verified' && <p className="ok">✓ {message}</p>}
        {status === 'failed' && <p className="error">✗ {message}</p>}
        {status === 'error' && <p className="error">Error: {message}</p>}
        {status === 'idle' && message && <p className="meta">{message}</p>}

        <hr style={{ margin: '32px 0' }} />

        <h2>STEP 0: authorize-then-capture-later check</h2>
        <p>
          For employer-triggered-assessment: proves a payment can be authorized (held, not charged) at Checkout,
          then captured separately later via a server-side API call — the mechanism the real feature&apos;s
          candidate-start capture and 5-day expiry-void depend on. Try this with different test payment methods
          (card vs. UPI) to see whether both actually hold rather than auto-capturing.
        </p>

        <button onClick={startAuthOnlyPayment} disabled={authBusy}>
          {authBusy && !authPaymentId ? 'Working…' : 'Authorize ₹100 (do not capture)'}
        </button>

        {authPaymentId && (
          <div style={{ marginTop: 16 }}>
            <p className="meta">Payment id: {authPaymentId}</p>
            <div className="row">
              <button onClick={checkPaymentStatus} disabled={authBusy}>
                Check status
              </button>
              <button onClick={captureAuthorizedPayment} disabled={authBusy}>
                Capture now
              </button>
            </div>
          </div>
        )}

        {paymentStatus && (
          <p className={paymentStatus.status === 'authorized' ? 'meta' : 'ok'}>
            status: <strong>{paymentStatus.status}</strong> · captured: <strong>{String(paymentStatus.captured)}</strong> ·
            method: {paymentStatus.method} · amount: {(paymentStatus.amount / 100).toFixed(2)} {authOrder?.currency}
          </p>
        )}

        {authMessage && <p className="meta">{authMessage}</p>}
      </main>
    </>
  );
}
