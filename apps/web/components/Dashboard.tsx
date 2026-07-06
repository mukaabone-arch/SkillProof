'use client';

/** Candidate home base: greeting, profile completeness, verified skills, recommended assessments. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, logout } from '@/lib/api';

interface SkillClaim {
  id: string;
  skillId: string;
  level: string;
  status: string;
  skill: { id: string; name: string };
  badge: { verifyHash: string } | null;
}

interface Me {
  id: string;
  phone: string | null;
  email: string | null;
  profile: { skillClaims: SkillClaim[] } | null;
}

interface Profile {
  fullName: string | null;
  completeness: number;
}

interface Assessment {
  id: string;
  title: string;
  targetLevel: string;
  durationMins: number;
  passThreshold: number;
  skillId: string;
  skill: { name: string; domain: { name: string } };
  _count: { questions: number };
}

interface Props {
  onLoggedOut: () => void;
}

export default function Dashboard({ onLoggedOut }: Props) {
  const [me, setMe] = useState<Me>();
  const [profile, setProfile] = useState<Profile>();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<Me>('/users/me'), api<Profile>('/profiles/me'), api<Assessment[]>('/assessments')])
      .then(([m, p, a]) => {
        setMe(m);
        setProfile(p);
        setAssessments(a);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function handleLogout() {
    await logout();
    onLoggedOut();
  }

  if (error) return <main><p className="error">{error}</p></main>;
  if (!me || !profile) return <main><p>Loading your dashboard…</p></main>;

  const claims = me.profile?.skillClaims ?? [];
  const verifiedSkillIds = new Set(claims.filter((c) => c.status === 'VERIFIED').map((c) => c.skillId));
  const recommended = assessments.filter(
    (a) => a._count.questions > 0 && !verifiedSkillIds.has(a.skillId),
  );
  const displayName = profile.fullName || me.phone || me.email || 'there';

  return (
    <main>
      <nav className="row" style={{ justifyContent: 'space-between', margin: 0, marginBottom: 32 }}>
        <div className="row" style={{ gap: 20, margin: 0, alignItems: 'center' }}>
          <Link href="/profile">Profile</Link>
          <Link href="/assessments">Assessments</Link>
          <span className="meta" style={{ margin: 0 }}>More, coming soon</span>
        </div>
        <button onClick={handleLogout}>Log out</button>
      </nav>

      <h1>Welcome back, {displayName}</h1>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${profile.completeness}%` }} />
      </div>
      <p className="meta">
        Your profile is {profile.completeness}% complete — <Link href="/profile">finish it →</Link>
      </p>

      <h2 style={{ marginTop: 32, marginBottom: 16 }}>Your verified skills</h2>
      {claims.length === 0 && (
        <p>
          You haven&apos;t verified any skills yet. <Link href="/assessments">Take an assessment</Link> to
          earn your first badge.
        </p>
      )}
      {claims.map((c) => (
        <div key={c.id} className="card badge-card">
          <div>
            <strong>{c.skill.name}</strong>
            <div className="meta">Level {c.level}</div>
          </div>
          {c.badge && (
            <Link href={`/badges/${c.badge.verifyHash}`}>
              <button>View certificate</button>
            </Link>
          )}
        </div>
      ))}

      <h2 style={{ marginTop: 32, marginBottom: 16 }}>Recommended assessments</h2>
      {recommended.length === 0 && <p>You&apos;re verified across every live assessment — nice work.</p>}
      {recommended.map((a) => (
        <div key={a.id} className="card">
          <div>
            <strong>{a.title}</strong>
            <div className="meta">
              {a.skill.domain.name} → {a.skill.name} · Level {a.targetLevel} · {a.durationMins} min · pass
              ≥ {a.passThreshold}%
            </div>
          </div>
          <Link href={`/assessments/${a.id}`}>
            <button>Start</button>
          </Link>
        </div>
      ))}
    </main>
  );
}
