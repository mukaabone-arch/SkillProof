'use client';

/** Team-invite acceptance landing page — see EmployerInviteAccept for the flow. */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import EmployerInviteAccept from '@/components/EmployerInviteAccept';

function EmployerInvitePageInner() {
  const email = useSearchParams().get('email') ?? '';
  return <EmployerInviteAccept initialEmail={email} />;
}

export default function EmployerInvitePage() {
  return (
    <Suspense fallback={<main className="auth auth-gradient" />}>
      <EmployerInvitePageInner />
    </Suspense>
  );
}
