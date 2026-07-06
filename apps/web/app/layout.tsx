import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SkillProof — Verified AI talent',
  description: 'Take rigorous AI-skill assessments, earn verified badges, get matched.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
