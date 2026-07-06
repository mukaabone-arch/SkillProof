'use client';

/**
 * Dev harness home page: proves the OTP → JWT → /users/me loop end-to-end.
 * The real candidate app replaces this; the marketing landing page lives at
 * /landing.html (static) until you port it into Next.
 */
import { useState } from 'react';
import Link from 'next/link';
import { api, setTokens } from '@/lib/api';

export default function Home() {
  const [phone, setPhone] = useState('+919999999999');
  const [otp, setOtp] = useState('123456');
  const [stage, setStage] = useState<'phone' | 'otp' | 'done'>('phone');
  const [me, setMe] = useState<unknown>(null);
  const [error, setError] = useState('');

  async function requestOtp() {
    setError('');
    try {
      await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });
      setStage('otp');
    } catch (e) { setError((e as Error).message); }
  }

  async function verify() {
    setError('');
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, otp }),
      });
      setTokens(res.accessToken, res.refreshToken);
      setMe(await api('/users/me'));
      setStage('done');
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <main>
      <h1>SkillProof dev harness</h1>
      <p>End-to-end auth check against the API. In dev, the OTP is always 123456.</p>

      {stage === 'phone' && (
        <div className="row">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91..." />
          <button onClick={requestOtp}>Send OTP</button>
        </div>
      )}

      {stage === 'otp' && (
        <div className="row">
          <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit OTP" />
          <button onClick={verify}>Verify</button>
        </div>
      )}

      {stage === 'done' && (
        <>
          <p className="ok">✓ Authenticated. GET /users/me:</p>
          <pre>{JSON.stringify(me, null, 2)}</pre>
          <Link href="/profile" className="profile-link">Edit your profile →</Link>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
