import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EmployerProjectReport, { type ProjectReport } from './EmployerProjectReport';

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return { ...actual, downloadBlob: jest.fn() };
});
import { downloadBlob } from '../lib/api';

const report = (recruiter: boolean): ProjectReport => ({
  generatedAt: '2026-11-17T06:30:00.000Z',
  project: { id: 'p1', name: 'Support AI rollout', description: null, status: 'ACTIVE', startDate: null, endDate: null, client: recruiter ? { id: 'c1', name: 'Globex' } : null, recruiter },
  totals: { roles: 1, headcount: 3, hired: 1, inProgress: 2, openRoles: 1, lateRoles: 1, applicants: 21, fillRate: 33, meetsVerifiedSkills: recruiter ? null : 2, sources: recruiter ? null : { applied: 3, sourced: 1 } },
  stageKeys: recruiter
    ? ['PENDING_CONSENT', 'SUBMITTED', 'INTERVIEWING', 'OFFER', 'PLACED', 'EXPIRED', 'DECLINED', 'NOT_SELECTED', 'WITHDRAWN']
    : ['SHORTLISTED', 'INVITED', 'INTERVIEWING', 'OFFER', 'HIRED', 'DECLINED', 'REJECTED', 'CLOSED', 'CANDIDATE_UNAVAILABLE'],
  stageTotals: recruiter ? { SUBMITTED: 1, PLACED: 1, EXPIRED: 1 } : { SHORTLISTED: 2, HIRED: 1, REJECTED: 1 },
  roles: [
    {
      id: 'r1', jobId: 'j1', code: 'AI-1', title: 'ML Engineer', jobStatus: 'LIVE', location: 'Pune', headcount: 3, targetStartDate: '2026-11-01T00:00:00.000Z',
      hired: 1, inProgress: 2, filled: false, applicants: 21,
      stages: recruiter ? { SUBMITTED: 1, PLACED: 1, EXPIRED: 1 } : { SHORTLISTED: 2, HIRED: 1, REJECTED: 1 },
      meetsVerifiedSkills: recruiter ? null : 2, sources: null, attention: ['LATE'],
    },
  ],
});

const calls: string[] = [];
function mockFetch(recruiter: boolean) {
  calls.length = 0;
  localStorage.setItem('sp_emp_token', 'emp');
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/report.csv')) return { ok: true, status: 200, blob: async () => new Blob(['a,b']) } as Response;
    return { ok: true, status: 200, json: async () => report(recruiter) } as Response;
  }) as unknown as typeof fetch;
}

describe('EmployerProjectReport', () => {
  it('shows the summary, one Hired column, exit stages only when they occur, and what needs attention', async () => {
    mockFetch(false);
    render(<EmployerProjectReport projectId="p1" />);
    await screen.findByRole('heading', { name: 'Support AI rollout' });
    expect(screen.getByText('33%')).toBeInTheDocument();
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.filter((h) => h === 'Hired')).toHaveLength(1);
    expect(headers).toContain('Rejected');
    expect(headers).not.toContain('Declined');
    expect(screen.getByText('Start date passed')).toBeInTheDocument();
    expect(screen.getByText('Applied: 3 (75%)')).toBeInTheDocument();
  });

  it('uses placements and the client for recruiter projects', async () => {
    mockFetch(true);
    render(<EmployerProjectReport projectId="p1" />);
    await screen.findByText(/For Globex/);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.filter((h) => h === 'Placed')).toHaveLength(1);
    expect(headers).toContain('Consent expired');
    expect(screen.queryByText('Meet verified skills')).not.toBeInTheDocument();
  });

  it('downloads the CSV', async () => {
    mockFetch(false);
    render(<EmployerProjectReport projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(calls.some((u) => u.endsWith('/projects/p1/report.csv'))).toBe(true);
    expect((downloadBlob as jest.Mock).mock.calls[0][1]).toBe('support-ai-rollout-report-2026-11-17.csv');
  });
});
