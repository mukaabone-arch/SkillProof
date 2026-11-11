/**
 * Bulk job import page: upload, skipped rows, review table, posting the
 * ready drafts. Real React rendering (jsdom + RTL); only next/navigation and
 * fetch are stubbed. The batch id is fed through a mutable search param, the
 * way router.replace would change it.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmployerJobImport from './EmployerJobImport';

let batchParam: string | null = null;
const replace = jest.fn((url: string) => {
  batchParam = new URL(url, 'http://x').searchParams.get('batch');
});
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({ get: (k: string) => (k === 'batch' ? batchParam : null) }),
}));

const BATCH = '11111111-1111-4111-8111-111111111111';

const IMPORT_RESULT = {
  batchId: BATCH,
  created: 2,
  skipped: 1,
  rows: [
    { row: 1, title: 'ML Engineer', code: 'AI-1', status: 'created', jobId: 'j1', errors: [], warnings: [], blockers: [] },
    {
      row: 2,
      title: 'Data Lead',
      code: 'JOB-0001',
      status: 'created',
      jobId: 'j2',
      errors: [],
      warnings: ['Skills were suggested by AI from the description. Check them before posting.'],
      blockers: ['Pick a city, or mark the job remote.'],
    },
    { row: 3, title: '', code: null, status: 'skipped', errors: ['Title is missing.'], warnings: [], blockers: [] },
  ],
};

const BATCH_JOBS = [
  { id: 'j1', code: 'AI-1', title: 'ML Engineer', status: 'DRAFT', location: 'Bengaluru, Karnataka, IN', remote: false, skills: [{ name: 'RAG Systems', level: 'L2', isRequired: true }], blockers: [] },
  { id: 'j2', code: 'JOB-0001', title: 'Data Lead', status: 'DRAFT', location: null, remote: false, skills: [{ name: 'LLM Evaluation', level: 'L1', isRequired: true }], blockers: ['Pick a city, or mark the job remote.'] },
];

const calls: { url: string; init?: RequestInit }[] = [];

function json(status: number, body: unknown): Response {
  return { ok: status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  batchParam = null;
  calls.length = 0;
  replace.mockClear();
  localStorage.setItem('sp_emp_token', 'emp-token');
  let posted = false;
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/jobs/import') && init?.method === 'POST') return json(200, IMPORT_RESULT);
    if (url.endsWith('/jobs/import/publish')) {
      posted = true;
      return json(200, { published: ['j1'], skipped: [] });
    }
    if (url.endsWith(`/jobs/import/${BATCH}`)) {
      return json(200, posted ? [{ ...BATCH_JOBS[0], status: 'LIVE' }, BATCH_JOBS[1]] : BATCH_JOBS);
    }
    return json(404, {});
  }) as unknown as typeof fetch;
});

describe('EmployerJobImport', () => {
  it('uploads a file, lists skipped rows, and shows the drafts for review', async () => {
    const { rerender } = render(<EmployerJobImport />);
    const file = new File(['title,description,employment type\n'], 'jobs.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import jobs' }));

    await screen.findByText('2 drafts created, 1 row skipped.');
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect(screen.getByText('Title is missing.')).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith(`/employer/jobs/import?batch=${BATCH}`);

    rerender(<EmployerJobImport />);
    await screen.findByText('1 of 2 drafts are ready to post. Open a draft to check AI-suggested skills or fix what’s missing.');
    expect(screen.getByLabelText('Select ML Engineer')).toBeChecked();
    expect(screen.getByLabelText('Select Data Lead')).toBeDisabled();
    expect(screen.getByText('Pick a city, or mark the job remote.')).toBeInTheDocument();
    expect(screen.getByText(/suggested by AI/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open draft' })[1]).toHaveAttribute('href', '/employer/jobs?edit=j2');
  });

  it('posts the selected ready drafts and refreshes the list', async () => {
    batchParam = BATCH;
    render(<EmployerJobImport />);
    fireEvent.click(await screen.findByRole('button', { name: 'Post selected (1)' }));

    await screen.findByText('Posted 1 job.');
    const publish = calls.find((c) => c.url.endsWith('/jobs/import/publish'))!;
    expect(JSON.parse(String(publish.init?.body))).toEqual({ jobIds: ['j1'] });
    await waitFor(() => expect(screen.getByText('Posted')).toBeInTheDocument());
  });
});
