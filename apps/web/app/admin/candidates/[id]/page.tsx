'use client';

/**
 * Candidate detail — stub (2026-09). Every row on /admin/candidates already
 * links here so the three announced next slices (payment details split by
 * candidate-side vs. employer-side money, access control, assessment
 * issues) have somewhere to land without retrofitting navigation later.
 * No data fetched yet — nothing to show until one of those slices exists.
 */
import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function AdminCandidateDetailPage() {
  const params = useParams<{ id: string }>();

  return (
    <main className="hub">
      <p><Link href="/admin/candidates">← Back to Candidate Management</Link></p>
      <h1>Candidate</h1>
      <p className="hub-subhead">
        Detail view coming with the next Candidate Management slices — payment details, access control, and
        assessment issues. Candidate ID: <code>{params.id}</code>
      </p>
    </main>
  );
}
