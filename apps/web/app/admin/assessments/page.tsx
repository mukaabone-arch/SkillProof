'use client';

/**
 * PLATFORM_ADMIN-only assessment builder. Access is gated by the backend
 * (RolesGuard) — this page just probes GET /admin/assessments and shows an
 * "admins only" message if that call is rejected, rather than duplicating
 * role logic on the client.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, type ApiError } from '@/lib/api';
import AdminNav from '@/components/AdminNav';
import { Badge } from '@/components/ui';

interface Skill {
  id: string;
  name: string;
}

interface Domain {
  id: string;
  name: string;
  skills: Skill[];
}

interface AdminAssessment {
  id: string;
  title: string;
  targetLevel: string;
  durationMins: number;
  passThreshold: number;
  questionsPerAttempt: number;
  isPremium: boolean;
  isLive: boolean;
  skill: { name: string; domain: { name: string } };
  _count: { questions: number };
}

const LEVELS = ['L1', 'L2', 'L3', 'L4'];

interface AssessmentForm {
  skillId: string;
  title: string;
  targetLevel: string;
  durationMins: string;
  passThreshold: string;
  questionsPerAttempt: string;
  isPremium: boolean;
  isLive: boolean;
}

const emptyAssessmentForm: AssessmentForm = {
  skillId: '',
  title: '',
  targetLevel: 'L1',
  durationMins: '30',
  passThreshold: '70',
  questionsPerAttempt: '20',
  isPremium: false,
  isLive: false,
};

/** Just the three tunables this page lets an admin edit post-creation. */
interface ConfigForm {
  durationMins: string;
  passThreshold: string;
  questionsPerAttempt: string;
}

/**
 * Shared by the create form and the per-assessment edit panel.
 * `poolSize` is the live question count — null on create (an assessment
 * always starts with zero questions, so "not more than the pool" can't be
 * checked yet there) and a number when editing an existing one.
 */
function configError(form: ConfigForm, poolSize: number | null): string | null {
  const durationMins = Number(form.durationMins);
  const passThreshold = Number(form.passThreshold);
  const questionsPerAttempt = Number(form.questionsPerAttempt);

  if (!Number.isFinite(durationMins) || durationMins <= 0) {
    return 'Duration must be greater than 0 minutes.';
  }
  // Matches the API's own @Min(0)/@Max(100) — passThreshold is a percentage
  // of scorePercent (0-100), compared directly against it at grading time,
  // not a 0-1 fraction.
  if (!Number.isFinite(passThreshold) || passThreshold < 0 || passThreshold > 100) {
    return 'Pass threshold must be between 0 and 100%.';
  }
  if (!Number.isInteger(questionsPerAttempt) || questionsPerAttempt < 1) {
    return 'Questions per attempt must be at least 1.';
  }
  if (poolSize !== null && poolSize > 0 && questionsPerAttempt > poolSize) {
    return `Questions per attempt (${questionsPerAttempt}) can't exceed the live question pool (${poolSize}).`;
  }
  return null;
}

/**
 * Non-blocking: warns when an attempt would draw most or all of the live
 * pool, so repeat-takers (or candidates who compare notes) are likely to see
 * the same questions — weak randomization, not a hard limit.
 */
function lowIntegrityWarning(questionsPerAttempt: number, poolSize: number): string | null {
  if (poolSize <= 0 || !Number.isInteger(questionsPerAttempt) || questionsPerAttempt < 1) return null;
  const ratio = questionsPerAttempt / poolSize;
  if (ratio < 0.7) return null;
  return `${questionsPerAttempt} of ${poolSize} live questions (${Math.round(ratio * 100)}%) get served per attempt — most candidates will see nearly the same set. Consider adding more questions or lowering this number.`;
}

interface QuestionForm {
  text: string;
  options: string[];
  correctIndex: number;
  difficulty: string;
}

const emptyQuestionForm: QuestionForm = {
  text: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  difficulty: '2',
};

interface BulkItemError {
  index: number;
  errors: string[];
}

interface BulkImportErrorBody {
  message?: string;
  errors?: BulkItemError[];
}

export default function AdminAssessmentsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [assessments, setAssessments] = useState<AdminAssessment[]>([]);
  const [error, setError] = useState('');

  const [form, setForm] = useState<AssessmentForm>(emptyAssessmentForm);
  const [creating, setCreating] = useState(false);

  const [editOpenFor, setEditOpenFor] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ConfigForm>({ durationMins: '', passThreshold: '', questionsPerAttempt: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [openFor, setOpenFor] = useState<string | null>(null);
  const [qForm, setQForm] = useState<QuestionForm>(emptyQuestionForm);
  const [addingQuestion, setAddingQuestion] = useState(false);

  const [bulkOpenFor, setBulkOpenFor] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState('');
  const [bulkErrors, setBulkErrors] = useState<BulkItemError[]>([]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    Promise.all([api<AdminAssessment[]>('/admin/assessments'), api<Domain[]>('/taxonomy')])
      .then(([a, d]) => {
        setAssessments(a);
        setDomains(d);
        setStatus('ok');
      })
      .catch(() => setStatus('forbidden'));
  }, []);

  async function refresh() {
    setAssessments(await api<AdminAssessment[]>('/admin/assessments'));
  }

  async function createAssessment() {
    const configErr = configError(form, null);
    if (configErr) {
      setError(configErr);
      return;
    }
    setError('');
    setCreating(true);
    try {
      await api('/admin/assessments', {
        method: 'POST',
        body: JSON.stringify({
          skillId: form.skillId,
          title: form.title,
          targetLevel: form.targetLevel,
          durationMins: Number(form.durationMins),
          passThreshold: Number(form.passThreshold),
          questionsPerAttempt: Number(form.questionsPerAttempt),
          isPremium: form.isPremium,
          isLive: form.isLive,
        }),
      });
      setForm(emptyAssessmentForm);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(a: AdminAssessment) {
    setEditOpenFor(a.id);
    setEditForm({
      durationMins: String(a.durationMins),
      passThreshold: String(a.passThreshold),
      questionsPerAttempt: String(a.questionsPerAttempt),
    });
    setEditError('');
  }

  async function submitEdit(a: AdminAssessment) {
    const configErr = configError(editForm, a._count.questions);
    if (configErr) {
      setEditError(configErr);
      return;
    }
    setEditError('');
    setEditSaving(true);
    try {
      await api(`/admin/assessments/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          durationMins: Number(editForm.durationMins),
          passThreshold: Number(editForm.passThreshold),
          questionsPerAttempt: Number(editForm.questionsPerAttempt),
        }),
      });
      setEditOpenFor(null);
      await refresh();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  function openQuestionForm(assessmentId: string) {
    setOpenFor(assessmentId);
    setQForm(emptyQuestionForm);
    setError('');
  }

  async function submitQuestion(assessmentId: string) {
    if (qForm.options.some((o) => !o.trim())) {
      setError('All 4 options are required.');
      return;
    }
    setError('');
    setAddingQuestion(true);
    try {
      await api(`/admin/assessments/${assessmentId}/questions`, {
        method: 'POST',
        body: JSON.stringify({
          text: qForm.text,
          options: qForm.options,
          correctIndex: qForm.correctIndex,
          difficulty: Number(qForm.difficulty),
        }),
      });
      setOpenFor(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingQuestion(false);
    }
  }

  function openBulkImport(assessmentId: string) {
    setBulkOpenFor(assessmentId);
    setBulkText('');
    setBulkResult('');
    setBulkErrors([]);
  }

  async function submitBulkImport(assessmentId: string) {
    setBulkResult('');
    setBulkErrors([]);

    let items: unknown;
    try {
      items = JSON.parse(bulkText);
    } catch {
      setBulkErrors([{ index: -1, errors: ['Not valid JSON — check for a trailing comma or unmatched bracket.'] }]);
      return;
    }

    setBulkImporting(true);
    try {
      const res = await api<{ created: number }>(`/admin/assessments/${assessmentId}/questions/bulk`, {
        method: 'POST',
        body: JSON.stringify(items),
      });
      setBulkResult(`${res.created} question${res.created === 1 ? '' : 's'} imported.`);
      await refresh();
    } catch (e) {
      const body = (e as ApiError).body as BulkImportErrorBody | undefined;
      if (body?.errors) {
        setBulkErrors(body.errors);
      } else {
        setBulkErrors([{ index: -1, errors: [(e as Error).message] }]);
      }
    } finally {
      setBulkImporting(false);
    }
  }

  if (status === 'loading') {
    return (
      <main>
        <h1>Admin: Assessments</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main>
        <h1>Admin: Assessments</h1>
        <p className="error">
          Admins only — log in with a PLATFORM_ADMIN account to manage assessments.
        </p>
      </main>
    );
  }

  return (
    <>
      <AdminNav onLoggedOut={() => router.push('/')} />
      <main>
      <h1>Admin: Assessments</h1>
      <p>Create assessments and MCQ questions without touching seed scripts.</p>
      {error && <p className="error">{error}</p>}

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <strong>New assessment</strong>

        <div className="field">
          <label htmlFor="skillId">Skill</label>
          <select
            id="skillId"
            value={form.skillId}
            onChange={(e) => setForm({ ...form, skillId: e.target.value })}
          >
            <option value="">Select a skill…</option>
            {domains.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {d.skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={160}
          />
        </div>

        <div className="field">
          <label htmlFor="targetLevel">Target level</label>
          <select
            id="targetLevel"
            value={form.targetLevel}
            onChange={(e) => setForm({ ...form, targetLevel: e.target.value })}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="durationMins">Duration (mins)</label>
          <input
            id="durationMins"
            type="number"
            min={5}
            max={240}
            value={form.durationMins}
            onChange={(e) => setForm({ ...form, durationMins: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="passThreshold">Pass threshold (%)</label>
          <input
            id="passThreshold"
            type="number"
            min={0}
            max={100}
            value={form.passThreshold}
            onChange={(e) => setForm({ ...form, passThreshold: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="questionsPerAttempt">Questions per attempt</label>
          <input
            id="questionsPerAttempt"
            type="number"
            min={1}
            value={form.questionsPerAttempt}
            onChange={(e) => setForm({ ...form, questionsPerAttempt: e.target.value })}
          />
          <p className="meta" style={{ margin: 0 }}>
            Drawn randomly from the live question pool once one exists — a new assessment starts
            with no questions, so this can&apos;t be checked against pool size until you&apos;ve added some.
          </p>
        </div>

        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={form.isPremium}
            onChange={(e) => setForm({ ...form, isPremium: e.target.checked })}
          />
          Premium
        </label>

        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={form.isLive}
            onChange={(e) => setForm({ ...form, isLive: e.target.checked })}
          />
          Live (visible to candidates)
        </label>

        {configError(form, null) && <p className="error" style={{ margin: 0 }}>{configError(form, null)}</p>}

        <button
          onClick={createAssessment}
          disabled={creating || !form.skillId || !form.title || !!configError(form, null)}
        >
          {creating ? 'Creating…' : 'Create assessment'}
        </button>
      </div>

      <h2 style={{ marginTop: 32, marginBottom: 16 }}>Existing assessments</h2>
      {assessments.length === 0 && <p>No assessments yet.</p>}

      {assessments.map((a) => (
        <div key={a.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <div>
              <strong>{a.title}</strong>
              <div className="meta">
                {a.skill.domain.name} → {a.skill.name} · {a.targetLevel} · {a.durationMins} min · pass
                ≥ {a.passThreshold}% · {a.questionsPerAttempt}/attempt · {a._count.questions} question
                {a._count.questions === 1 ? '' : 's'}
                {a.isPremium ? ' · premium' : ''} ·{' '}
                {a.isLive ? <span className="ok">live</span> : 'draft'}
              </div>
              {lowIntegrityWarning(a.questionsPerAttempt, a._count.questions) && (
                <div style={{ marginTop: 6 }}>
                  <Badge variant="warning">Low integrity ratio</Badge>{' '}
                  <span className="meta" style={{ margin: 0 }}>
                    {lowIntegrityWarning(a.questionsPerAttempt, a._count.questions)}
                  </span>
                </div>
              )}
            </div>
            <div className="row" style={{ margin: 0 }}>
              <button onClick={() => (editOpenFor === a.id ? setEditOpenFor(null) : openEdit(a))}>
                {editOpenFor === a.id ? 'Cancel' : 'Edit config'}
              </button>
              <button onClick={() => (openFor === a.id ? setOpenFor(null) : openQuestionForm(a.id))}>
                {openFor === a.id ? 'Cancel' : 'Add question'}
              </button>
              <button onClick={() => (bulkOpenFor === a.id ? setBulkOpenFor(null) : openBulkImport(a.id))}>
                {bulkOpenFor === a.id ? 'Cancel' : 'Bulk import questions'}
              </button>
            </div>
          </div>

          {editOpenFor === a.id && (
            <div style={{ marginTop: 8 }}>
              <div className="field">
                <label htmlFor="editDurationMins">Duration (mins)</label>
                <input
                  id="editDurationMins"
                  type="number"
                  min={5}
                  max={240}
                  value={editForm.durationMins}
                  onChange={(e) => setEditForm({ ...editForm, durationMins: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="editPassThreshold">Pass threshold (%)</label>
                <input
                  id="editPassThreshold"
                  type="number"
                  min={0}
                  max={100}
                  value={editForm.passThreshold}
                  onChange={(e) => setEditForm({ ...editForm, passThreshold: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="editQuestionsPerAttempt">Questions per attempt</label>
                <input
                  id="editQuestionsPerAttempt"
                  type="number"
                  min={1}
                  max={a._count.questions || undefined}
                  value={editForm.questionsPerAttempt}
                  onChange={(e) => setEditForm({ ...editForm, questionsPerAttempt: e.target.value })}
                />
                <p className="meta" style={{ margin: 0 }}>
                  {a._count.questions} live question{a._count.questions === 1 ? '' : 's'} in the pool.
                </p>
              </div>

              {configError(editForm, a._count.questions) && (
                <p className="error">{configError(editForm, a._count.questions)}</p>
              )}
              {!configError(editForm, a._count.questions) &&
                lowIntegrityWarning(Number(editForm.questionsPerAttempt), a._count.questions) && (
                  <p className="meta">
                    ⚠ {lowIntegrityWarning(Number(editForm.questionsPerAttempt), a._count.questions)}
                  </p>
                )}

              <button
                onClick={() => submitEdit(a)}
                disabled={editSaving || !!configError(editForm, a._count.questions)}
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
              {editError && <p className="error">{editError}</p>}
            </div>
          )}

          {openFor === a.id && (
            <div style={{ marginTop: 8 }}>
              <div className="field">
                <label htmlFor="qtext">Question text</label>
                <input
                  id="qtext"
                  value={qForm.text}
                  onChange={(e) => setQForm({ ...qForm, text: e.target.value })}
                  maxLength={2000}
                />
              </div>

              {qForm.options.map((opt, i) => (
                <div key={i} className="row" style={{ alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="correctIndex"
                    checked={qForm.correctIndex === i}
                    onChange={() => setQForm({ ...qForm, correctIndex: i })}
                  />
                  <input
                    value={opt}
                    placeholder={`Option ${i + 1}`}
                    maxLength={300}
                    style={{ flex: 1 }}
                    onChange={(e) => {
                      const options = [...qForm.options];
                      options[i] = e.target.value;
                      setQForm({ ...qForm, options });
                    }}
                  />
                </div>
              ))}

              <div className="field">
                <label htmlFor="difficulty">Difficulty (1–5)</label>
                <input
                  id="difficulty"
                  type="number"
                  min={1}
                  max={5}
                  value={qForm.difficulty}
                  onChange={(e) => setQForm({ ...qForm, difficulty: e.target.value })}
                />
              </div>

              <button onClick={() => submitQuestion(a.id)} disabled={addingQuestion || !qForm.text.trim()}>
                {addingQuestion ? 'Adding…' : 'Save question'}
              </button>
            </div>
          )}

          {bulkOpenFor === a.id && (
            <div style={{ marginTop: 8 }}>
              <div className="field">
                <label htmlFor="bulkJson">Paste a JSON array of questions</label>
                <textarea
                  id="bulkJson"
                  rows={8}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={
                    '[\n' +
                    '  {\n' +
                    '    "question": "What does HTTP 404 mean?",\n' +
                    '    "options": ["Not found", "Server error", "Forbidden", "Redirect"],\n' +
                    '    "correctIndex": 0,\n' +
                    '    "difficulty": 2\n' +
                    '  }\n' +
                    ']'
                  }
                />
                <p className="meta" style={{ margin: 0 }}>
                  Extra fields per item (e.g. from a generation pipeline) are ignored — only question,
                  options, correctIndex, and difficulty are used.
                </p>
              </div>

              <button onClick={() => submitBulkImport(a.id)} disabled={bulkImporting || !bulkText.trim()}>
                {bulkImporting ? 'Importing…' : 'Import'}
              </button>

              {bulkResult && <p className="ok">✓ {bulkResult}</p>}
              {bulkErrors.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {bulkErrors.map((be, i) => (
                    <p key={i} className="error" style={{ margin: 0 }}>
                      {be.index >= 0 ? `Item ${be.index}: ` : ''}
                      {be.errors.join('; ')}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      </main>
    </>
  );
}
