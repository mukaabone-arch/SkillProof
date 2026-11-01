import type { Metadata } from 'next';

export const metadata: Metadata = {
  alternates: { canonical: '/staffing' },
  title: 'MyAmbii for recruiters — available, verified AI talent',
  description:
    'Find candidates who are actually available, with verified AI skills. Contact details are shared when they say yes, and every submission is protected from double-submission.',
};

export default function StaffingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
