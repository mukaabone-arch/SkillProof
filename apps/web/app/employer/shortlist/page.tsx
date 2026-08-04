'use client';

/** Shortlist — sidebar section. Auth guard/shell come from app/employer/layout.tsx. */
import { Suspense } from 'react';
import EmployerShortlist from '@/components/EmployerShortlist';

export default function EmployerShortlistPage() {
  return (
    <Suspense fallback={<main className="container-standard"><p className="meta">Loading…</p></main>}>
      <EmployerShortlist />
    </Suspense>
  );
}
