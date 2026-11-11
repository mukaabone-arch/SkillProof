/**
 * Hiring project page and list. Real React rendering (jsdom + RTL); only
 * next/navigation and fetch are stubbed.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EmployerProjectDetail from './EmployerProjectDetail';
import EmployerProjects from './EmployerProjects';
import HeadcountBar from './HeadcountBar';
import StaffingSubmitToClient from './StaffingSubmitToClient';
import { OrgTypeProvider } from '@/lib/orgTypeContext';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: jest.fn() }) }));

const PROJECT = {
  id: 'p1',
  name: 'Support AI rollout',
  description: 'Chat assistant for support',
  startDate: '2027-01-01T00:00:00.000Z',
  endDate: '2027-06-30T00:00:00.000Z',
  status: 'ACTIVE',
  headcount: 6,
  hired: 3,
  inProgress: 2,
  openRoles: 2,
  roles: [
    { id: 'r1', jobId: 'j1', code: 'AI-1', title: 'ML Engineer', jobStatus: 'LIVE', location: 'Pune, MH, IN', headcount: 3, targetStartDate: '2020-01-01T00:00:00.000Z', hired: 1, inProgress: 2, filled: false, late: true, blockers: [] },
    { id: 'r2', jobId: 'j2', code: 'AI-2', title: 'Data Lead', jobStatus: 'LIVE', location: 'Remote', headcount: 2, targetStartDate: null, hired: 2, inProgress: 0, filled: true, late: false, blockers: [] },
    { id: 'r3', jobId: 'j3', code: 'AI-3', title: 'Prompt Engineer', jobStatus: 'DRAFT', location: null, headcount: 1, targetStartDate: null, hired: 0, inProgress: 0, filled: false, late: false, blockers: [] },
  ],
};

const JOBS = [
  { id: 'j1', code: 'AI-1', title: 'ML Engineer', status: 'LIVE', projectRole: { projectId: 'p1' } },
  { id: 'j7', code: 'AI-7', title: 'MLOps Engineer', status: 'LIVE', projectRole: null },
  { id: 'j8', code: 'AI-8', title: 'Old role', status: 'CLOSED', projectRole: null },
];

const RECRUITER_PROJECT = {
  ...PROJECT,
  id: 'p2',
  name: 'Globex data team',
  recruiter: true,
  client: { id: 'c1', name: 'Globex' },
  roles: [PROJECT.roles[0]],
};

const calls: { url: string; init?: RequestInit }[] = [];
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response;

beforeEach(() => {
  calls.length = 0;
  push.mockClear();
  localStorage.setItem('sp_emp_token', 'emp');
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/projects/p2') && !init?.method) return json(200, RECRUITER_PROJECT);
    if (url.endsWith('/staffing/clients')) return json(200, [{ id: 'c1', name: 'Globex' }, { id: 'c2', name: 'Initech' }]);
    if (url.endsWith('/staffing/submissions')) return json(201, { id: 's1' });
    if (url.endsWith('/projects/p1/publish')) return json(200, { published: ['j3'], skipped: [] });
    if (url.endsWith('/projects/p1') && !init?.method) return json(200, PROJECT);
    if (url.includes('/projects/p1')) return json(200, {});
    if (url.endsWith('/jobs')) return json(200, JOBS);
    if (url.endsWith('/projects') && init?.method === 'POST') return json(201, { id: 'p9' });
    if (url.includes('/projects')) return json(200, [{ ...PROJECT, roleCount: 3, lateRoles: 1 }]);
    return json(404, {});
  }) as unknown as typeof fetch;
});

describe('EmployerProjectDetail', () => {
  it('shows totals and each role with its progress, late start and filled state', async () => {
    render(<EmployerProjectDetail projectId="p1" />);
    await screen.findByRole('heading', { name: 'Support AI rollout' });

    expect(screen.getByText('3 of 6 hired')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Start date passed')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: 'View pipeline' })).toHaveAttribute('href', '/employer/shortlist?jobId=j1');
    expect(within(rows[1]).getByText('Filled')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'Close job' })).toBeInTheDocument();
    expect(within(rows[2]).getByRole('link', { name: 'Open draft' })).toHaveAttribute('href', '/employer/jobs?edit=j3');
    expect(screen.getByRole('link', { name: '+ New role' })).toHaveAttribute('href', '/employer/jobs?new=1&project=p1');
  });

  it('saves a changed headcount on blur', async () => {
    render(<EmployerProjectDetail projectId="p1" />);
    const input = await screen.findByLabelText('People needed for ML Engineer');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/projects/p1/roles/r1') && c.init?.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.url.endsWith('/projects/p1/roles/r1'))!;
    expect(JSON.parse(String(patch.init?.body))).toEqual({ headcount: 4 });
  });

  it('adds an existing job, offering only jobs outside any project that are not closed', async () => {
    render(<EmployerProjectDetail projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add an existing job' }));
    const select = screen.getByLabelText('Job');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a job…', 'MLOps Engineer (AI-7) · Posted']);

    fireEvent.change(select, { target: { value: 'j7' } });
    fireEvent.change(screen.getByLabelText('People needed'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
    await screen.findByText('Role added.');
    const post = calls.find((c) => c.url.endsWith('/projects/p1/roles') && c.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init?.body))).toEqual({ jobId: 'j7', headcount: 2 });
  });

  it('posts ready draft roles', async () => {
    render(<EmployerProjectDetail projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Post ready roles (1)' }));
    await screen.findByText('Posted 1 role.');
  });
});

describe('EmployerProjects', () => {
  it('lists projects with progress and creates a new one', async () => {
    render(<EmployerProjects />);
    await screen.findByText('Support AI rollout');
    expect(screen.getByText('1 past start date')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Data platform' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/employer/projects/p9'));
  });
});

describe('Recruiter projects', () => {
  it('shows the client, links roles to applicants and submissions, and only offers jobs for that client', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/projects/p2')) return json(200, RECRUITER_PROJECT);
      if (url.endsWith('/jobs'))
        return json(200, [
          { id: 'j7', code: 'G-7', title: 'Data Engineer', status: 'LIVE', projectRole: null, postedForClient: { id: 'c1' } },
          { id: 'j8', code: 'I-8', title: 'Initech role', status: 'LIVE', projectRole: null, postedForClient: { id: 'c2' } },
        ]);
      return json(404, {});
    });
    render(
      <OrgTypeProvider value="STAFFING">
        <EmployerProjectDetail projectId="p2" />
      </OrgTypeProvider>,
    );
    await screen.findByRole('heading', { name: 'Globex data team' });
    expect(screen.getByText(/For Globex ·/)).toBeInTheDocument();
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByRole('link', { name: 'Applicants' })).toHaveAttribute('href', '/employer/jobs?openApplicants=j1');
    expect(within(row).getByRole('link', { name: 'Submissions' })).toHaveAttribute('href', '/employer/submissions');
    expect(within(row).queryByRole('link', { name: 'View pipeline' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add an existing job' }));
    const options = within(screen.getByLabelText('Job')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a job…', 'Data Engineer (G-7) · Posted']);
  });

  it('creates a project for a chosen client', async () => {
    render(
      <OrgTypeProvider value="STAFFING">
        <EmployerProjects />
      </OrgTypeProvider>,
    );
    await screen.findByText('Support AI rollout');
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Globex data team' } });
    const create = screen.getByRole('button', { name: 'Create project' });
    expect(create).toBeDisabled();
    fireEvent.change(await screen.findByLabelText('Client'), { target: { value: 'c1' } });
    fireEvent.click(create);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/employer/projects/p9'));
    const post = calls.find((c) => c.url.endsWith('/projects') && c.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init?.body))).toMatchObject({ name: 'Globex data team', clientId: 'c1' });
  });
});

describe('StaffingSubmitToClient on an agency posting', () => {
  it('submits to the job’s client and links the project role', async () => {
    render(<StaffingSubmitToClient candidateId="cand1" defaultRole="Data Engineer" fixedClient={{ id: 'c1', name: 'Globex' }} projectRoleId="r1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit to Globex' }));
    expect(screen.queryByLabelText('Client')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask candidate to approve' }));
    await screen.findByText(/Sent for the candidate/);
    const post = calls.find((c) => c.url.endsWith('/staffing/submissions'))!;
    expect(JSON.parse(String(post.init?.body))).toEqual({ candidateId: 'cand1', clientId: 'c1', roleTitle: 'Data Engineer', projectRoleId: 'r1' });
  });
});

describe('HeadcountBar', () => {
  it('caps the bar at the headcount but shows real numbers', () => {
    render(<HeadcountBar headcount={2} hired={3} inProgress={1} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '3 of 2 hired, 1 in progress');
    expect(screen.getByText('3 of 2 hired')).toBeInTheDocument();
  });
});
