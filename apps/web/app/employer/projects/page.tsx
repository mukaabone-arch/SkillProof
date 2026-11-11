'use client';

/** Projects — sidebar section. Auth guard/shell come from app/employer/layout.tsx. */
import EmployerProjects from '@/components/EmployerProjects';

export default function EmployerProjectsPage() {
  return (
    <main className="employer-content-narrow">
      <h1>Projects</h1>
      <EmployerProjects />
    </main>
  );
}
