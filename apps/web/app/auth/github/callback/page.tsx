import { Suspense } from 'react';
import OAuthCallback from '@/components/OAuthCallback';

export default function GithubOAuthCallbackPage() {
  return (
    <Suspense fallback={<main className="auth"><p>Loading…</p></main>}>
      <OAuthCallback provider="github" />
    </Suspense>
  );
}
