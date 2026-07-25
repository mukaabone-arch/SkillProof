import { Suspense } from 'react';
import OAuthCallback from '@/components/OAuthCallback';

export default function GoogleOAuthCallbackPage() {
  return (
    <Suspense fallback={<main className="auth auth-gradient"><p>Loading…</p></main>}>
      <OAuthCallback provider="google" />
    </Suspense>
  );
}
