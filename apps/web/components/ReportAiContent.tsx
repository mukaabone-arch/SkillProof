'use client';

/**
 * "Report" control for one piece of AI-generated content — Google Play's
 * AI-Generated Content policy requires that users can flag offensive AI
 * output without leaving the app (assessment pages open in the app's
 * in-app browser, so this counts). Posts to POST /ai-content-reports; the
 * API checks the item belongs to the candidate's own session and snapshots
 * the text for the admin queue (/admin/ai-reports).
 */
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';

export type AiContentTarget = 'ASSESSOR_TURN' | 'LIVE_FEEDBACK' | 'RESULT_REASON' | 'MOCK_INTERVIEW_FEEDBACK';

const REASONS: [string, string][] = [
  ['OFFENSIVE', 'Offensive or harmful'],
  ['HATEFUL', 'Hateful or discriminatory'],
  ['SEXUAL', 'Sexual or inappropriate'],
  ['DANGEROUS', 'Dangerous or illegal'],
  ['MISLEADING', 'Misleading or wrong'],
  ['OTHER', 'Something else'],
];

function FlagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}

interface Props {
  sessionId: string;
  targetType: AiContentTarget;
  targetId: string;
}

export default function ReportAiContent({ sessionId, targetType, targetId }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason) {
      setError('Choose what’s wrong with this response.');
      return;
    }
    setSending(true);
    setError('');
    try {
      await api('/ai-content-reports', {
        method: 'POST',
        body: JSON.stringify({ sessionId, targetType, targetId, reason, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <p className="ai-report-done" role="status">
        Thanks — reported. Our team will review it.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="ai-report-link" onClick={() => setOpen(true)} aria-label="Report this AI-generated response">
        <FlagIcon /> Report
      </button>
    );
  }

  return (
    <form className="ai-report-form" onSubmit={submit}>
      <fieldset>
        <legend>What’s wrong with this AI response?</legend>
        {REASONS.map(([value, label]) => (
          <label key={value} className="ai-report-option">
            <input type="radio" name={`ai-report-${targetId}`} value={value} checked={reason === value} onChange={() => setReason(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <textarea
        rows={2}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything else we should know? (optional)"
      />
      {error && <p className="error">{error}</p>}
      <div className="ai-report-actions">
        <button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          className="ai-report-cancel"
          onClick={() => {
            setOpen(false);
            setError('');
          }}
          disabled={sending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
