import type { Metadata } from 'next';
import LegalStub from '@/components/landing/LegalStub';

export const metadata: Metadata = { title: 'Privacy Policy · Myambii' };

export default function PrivacyPage() {
  return <LegalStub title="Privacy Policy" />;
}
