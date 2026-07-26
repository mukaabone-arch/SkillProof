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

interface CreateOrderResponse {
  orderId: string;
  keyId: string;
  amount: number;
  currency: string;
}

interface VerifyResponse {
  verified: boolean;
}

/** The subset of Razorpay Checkout's success-handler payload this flow needs — see payments.dto.ts's VerifyPaymentDto for the matching backend shape. */
interface RazorpayCheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  handler: (response: RazorpayCheckoutResponse) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

interface RazorpayCheckoutInstance {
  open: () => void;
}

/** Loaded by the <Script> tag below onto window — no npm package for the client SDK, Razorpay only ships the hosted checkout.js. */
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

type Status = 'idle' | 'creating-order' | 'awaiting-payment' | 'verifying' | 'verified' | 'failed' | 'error';

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
      </main>
    </>
  );
}
