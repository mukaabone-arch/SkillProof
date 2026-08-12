import type { Metadata } from 'next';
import LegalStub from '@/components/landing/LegalStub';

export const metadata: Metadata = { title: 'Terms of Service · Myambii' };

export default function TermsPage() {
  return <LegalStub title="Terms of Service" />;
}
