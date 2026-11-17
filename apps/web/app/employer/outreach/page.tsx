'use client';

/** AI sourcing — sidebar section. Auth guard/shell come from app/employer/layout.tsx. */
import EmployerOutreachCampaigns from '@/components/EmployerOutreachCampaigns';

export default function EmployerOutreachPage() {
  return (
    <main className="employer-content-narrow">
      <h1>AI sourcing</h1>
      <EmployerOutreachCampaigns />
    </main>
  );
}
