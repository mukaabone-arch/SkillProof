'use client';

/**
 * "Download for ATS": the candidate package (GET /integrations/candidates/:id/package)
 * as a JSON file — verified skills with links anyone can check, and contact
 * details only where the candidate has agreed. The same data webhooks and
 * the API send.
 */
import { useState } from 'react';
import { employerApi, downloadBlob } from '@/lib/api';

export default function AtsDownloadButton({ candidateId, name }: { candidateId: string; name?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    setBusy(true);
    setError('');
    try {
      const blob = await employerApi.apiBlob(`/integrations/candidates/${candidateId}/package`);
      const safe = (name ?? 'candidate').replace(/[^\w \-]+/g, '').trim().replace(/\s+/g, '-') || 'candidate';
      downloadBlob(blob, `myambii-${safe}.json`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary ats-download" onClick={download} disabled={busy} title="Candidate details and verified skills as JSON, for your applicant tracking system">
        {busy ? 'Preparing…' : 'Download for ATS'}
      </button>
      {error && <span className="error" role="alert">{error}</span>}
    </>
  );
}
