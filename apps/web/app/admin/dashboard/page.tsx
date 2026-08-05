'use client';

/**
 * Admin console landing page. Every number here is a plain count read
 * straight off an existing admin endpoint — nothing computed, averaged, or
 * rated. Deliberately no "average review time" / "resolution rate" /
 * similar derived metric: this app already has one dashboard that shows
 * "Avg. time to hire: 0d" against zero actual hires (apps/web/components/
 * EmployerDashboard.tsx), which reads as "we hire instantly" instead of
 * "we have no data" — the honest version of a metric with no real
 * denominator yet is to not show it at all, not to show a misleading
 * zero. If a section below has nothing countable, it's omitted, not
 * faked. Sidebar/topbar come from app/admin/layout.tsx.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { LoadingState } from '@/components/ui';

interface AdminAssessment {
  isLive: boolean;
}
interface ReviewQueueRow {
  sessionId: string;
}
interface AttemptRow {
  id: string;
}
interface InterviewQuestionRow {
  active: boolean;
}
interface AccountActionRow {
  id: string;
  type: 'DEACTIVATED' | 'REACTIVATED' | 'DELETED';
  candidateRef: string;
  createdAt: string;
  needsAttention: boolean;
}

const TYPE_LABEL: Record<AccountActionRow['type'], string> = {
  DEACTIVATED: 'Deactivation',
  REACTIVATED: 'Reactivation',
  DELETED: 'Deletion',
};

const RECENT_ACTIONS_SHOWN = 5;

export default function AdminDashboardPage() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [assessments, setAssessments] = useState<AdminAssessment[] | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueRow[] | null>(null);
  const [flaggedAttempts, setFlaggedAttempts] = useState<AttemptRow[] | null>(null);
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestionRow[] | null>(null);
  const [recentActions, setRecentActions] = useState<AccountActionRow[] | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    // Independent panels — one endpoint being unreachable (or this admin
    // somehow lacking access to one specific area) shouldn't blank the
    // whole page; each panel just stays empty and is omitted below.
    // Assessments doubles as the "is this actually an admin session"
    // probe every other page in this console already uses — its success/
    // failure is what decides `status` here, not a separate duplicate call.
    api<AdminAssessment[]>('/admin/assessments')
      .then((rows) => {
        setAssessments(rows);
        setStatus('ok');
      })
      .catch(() => setStatus('forbidden'));
    api<ReviewQueueRow[]>('/assessment-sessions/review-queue').then(setReviewQueue).catch(() => undefined);
    api<AttemptRow[]>('/admin/attempts?status=FLAGGED').then(setFlaggedAttempts).catch(() => undefined);
    api<InterviewQuestionRow[]>('/admin/interview-questions').then(setInterviewQuestions).catch(() => undefined);
    api<AccountActionRow[]>('/admin/account-actions')
      .then((rows) => setRecentActions(rows.slice(0, RECENT_ACTIONS_SHOWN)))
      .catch(() => undefined);
  }, []);

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Admin Console</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Admin Console</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account.</p>
      </main>
    );
  }

  const liveCount = assessments?.filter((a) => a.isLive).length ?? null;
  const draftCount = assessments ? assessments.length - (liveCount ?? 0) : null;
  const activeQuestions = interviewQuestions?.filter((q) => q.active).length ?? null;

  return (
    <main className="hub">
      <h1>Admin Console</h1>
      <p className="hub-subhead">What actually needs attention right now, and what's live.</p>

      <div className="dashboard-overview-grid">
        {assessments && (
          <Link href="/admin/assessments" className="status-card">
            <div className="status-card-label">Assessments</div>
            <div className="status-stat">{liveCount}</div>
            <p className="meta" style={{ margin: 0 }}>Live · {draftCount} draft</p>
          </Link>
        )}

        {reviewQueue && (
          <Link href="/admin/review" className="status-card">
            <div className="status-card-label">Session Reviews</div>
            <div className="status-stat">{reviewQueue.length}</div>
            <p className="meta" style={{ margin: 0 }}>Awaiting a decision</p>
          </Link>
        )}

        {flaggedAttempts && (
          <Link href="/admin/attempts" className="status-card">
            <div className="status-card-label">Attempt Reviews</div>
            <div className="status-stat">{flaggedAttempts.length}</div>
            <p className="meta" style={{ margin: 0 }}>Flagged, awaiting a decision</p>
          </Link>
        )}

        {interviewQuestions && (
          <Link href="/admin/interview-questions" className="status-card">
            <div className="status-card-label">Interview Questions</div>
            <div className="status-stat">{activeQuestions}</div>
            <p className="meta" style={{ margin: 0 }}>Active · {interviewQuestions.length - (activeQuestions ?? 0)} inactive</p>
          </Link>
        )}
      </div>

      {recentActions && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 12px' }}>
            <h2 style={{ margin: 0 }}>Recent privacy requests</h2>
            <Link href="/admin/compliance">View all →</Link>
          </div>
          {recentActions.length === 0 ? (
            <p className="meta">No account actions recorded yet.</p>
          ) : (
            recentActions.map((a) => (
              <div key={a.id} className="card" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{TYPE_LABEL[a.type]}</strong> — Candidate {a.candidateRef}
                  {a.needsAttention && <span className="error" style={{ marginLeft: 8 }}>needs attention</span>}
                </div>
                <span className="meta" style={{ margin: 0 }}>{new Date(a.createdAt).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </>
      )}
    </main>
  );
}
