'use client';

/** One AI sourcing campaign. Auth guard/shell come from app/employer/layout.tsx. */
import { useParams } from 'next/navigation';
import EmployerOutreachCampaign from '@/components/EmployerOutreachCampaign';

export default function EmployerOutreachCampaignPage() {
  const params = useParams<{ id: string }>();
  return (
    <main className="employer-content-narrow">
      <EmployerOutreachCampaign campaignId={params.id} />
    </main>
  );
}
