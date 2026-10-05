import { Suspense } from 'react';
import WebHandoff from '@/components/WebHandoff';

export default function AuthHandoffPage() {
  return (
    <Suspense fallback={<main className="auth auth-gradient"><p>Loading…</p></main>}>
      <WebHandoff />
    </Suspense>
  );
}
