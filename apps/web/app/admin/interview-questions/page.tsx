'use client';

/**
 * PLATFORM_ADMIN curation of the interview-prep question bank — list and
 * edit only (see InterviewQuestionsService's own doc comment; there's no
 * create/delete route, only what already exists via seed data). Access is
 * gated by the backend (RolesGuard) — this page just probes GET
 * /admin/interview-questions and shows an "admins only" message if that
 * call is rejected, same pattern as every other page in this console.
 * Sidebar/topbar come from app/admin/layout.tsx.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, getToken } from '@/lib/api';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

type Category =
  | 'PROBLEM_SOLVING'
  | 'CONFLICT'
  | 'TEAMWORK'
  | 'INITIATIVE'
  | 'MOTIVATION'
  | 'SELF_AWARENESS'
  | 'AMBITION'
  | 'INDUSTRY_AWARENESS'
  | 'CULTURE_FIT'
  | 'COMMUNICATION';

const CATEGORIES: Category[] = [
  'PROBLEM_SOLVING',
  'CONFLICT',
  'TEAMWORK',
  'INITIATIVE',
  'MOTIVATION',
  'SELF_AWARENESS',
  'AMBITION',
  'INDUSTRY_AWARENESS',
  'CULTURE_FIT',
  'COMMUNICATION',
];

interface StarReference {
  situation: string;
  task: string;
  action: string;
  result: string;
}

interface InterviewQuestion {
  id: string;
  text: string;
  category: Category;
  whatToLookFor: string;
  expectedElements: StarReference;
  followUpProbes: string[];
  isCompanyGrounded: boolean;
  active: boolean;
}

interface EditForm {
  text: string;
  category: Category;
  whatToLookFor: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  followUpProbes: string;
  isCompanyGrounded: boolean;
  active: boolean;
}

function toEditForm(q: InterviewQuestion): EditForm {
  return {
    text: q.text,
    category: q.category,
    whatToLookFor: q.whatToLookFor,
    situation: q.expectedElements.situation,
    task: q.expectedElements.task,
    action: q.expectedElements.action,
    result: q.expectedElements.result,
    followUpProbes: q.followUpProbes.join('\n'),
    isCompanyGrounded: q.isCompanyGrounded,
    active: q.active,
  };
}

export default function AdminInterviewQuestionsPage() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [error, setError] = useState('');

  const [categoryFilter, setCategoryFilter] = useState<Category | ''>('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (categoryFilter) params.set('category', categoryFilter);
    if (activeFilter) params.set('active', activeFilter);
    const qs = params.toString();
    api<InterviewQuestion[]>(`/admin/interview-questions${qs ? `?${qs}` : ''}`)
      .then((q) => {
        setQuestions(q);
        setStatus('ok');
        setError('');
      })
      .catch((e) => {
        if (status === 'loading') setStatus('forbidden');
        else setError(e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, activeFilter]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, activeFilter]);

  function openEdit(q: InterviewQuestion) {
    setEditingId(q.id);
    setEditForm(toEditForm(q));
    setError('');
  }

  async function saveEdit() {
    if (!editingId || !editForm) return;
    setSaving(true);
    setError('');
    try {
      await api(`/admin/interview-questions/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          text: editForm.text,
          category: editForm.category,
          whatToLookFor: editForm.whatToLookFor,
          expectedElements: {
            situation: editForm.situation,
            task: editForm.task,
            action: editForm.action,
            result: editForm.result,
          },
          followUpProbes: editForm.followUpProbes.split('\n').map((s) => s.trim()).filter(Boolean),
          isCompanyGrounded: editForm.isCompanyGrounded,
          active: editForm.active,
        }),
      });
      setEditingId(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Interview Questions</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Interview Questions</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to curate the question bank.</p>
      </main>
    );
  }

  return (
    <main className="hub">
      <h1>Interview Questions</h1>
      <p className="hub-subhead">
        The behavioral question bank interview prep and the AI interviewer draw from. List and edit only — no
        create/delete here.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="field" style={{ minWidth: 200, margin: 0 }}>
          <label htmlFor="categoryFilter">Category</label>
          <select id="categoryFilter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category | '')}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ minWidth: 160, margin: 0 }}>
          <label htmlFor="activeFilter">Status</label>
          <select id="activeFilter" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as '' | 'true' | 'false')}>
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </div>

      {questions.length === 0 ? (
        <EmptyState message="No questions match these filters." />
      ) : (
        questions.map((q) => (
          <div key={q.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
              <strong>{q.text}</strong>
              <div className="row" style={{ margin: 0 }}>
                <Badge variant={q.active ? 'verified' : 'neutral'}>{q.active ? 'Active' : 'Inactive'}</Badge>
                {q.isCompanyGrounded && <Badge variant="default">Company-grounded</Badge>}
              </div>
            </div>
            <div className="meta">{q.category.replace(/_/g, ' ')} · looks for: {q.whatToLookFor}</div>

            <button
              className="btn-secondary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => (editingId === q.id ? setEditingId(null) : openEdit(q))}
            >
              {editingId === q.id ? 'Cancel' : 'Edit'}
            </button>

            {editingId === q.id && editForm && (
              <div style={{ marginTop: 8 }}>
                <div className="field">
                  <label htmlFor="editText">Question text</label>
                  <textarea
                    id="editText"
                    rows={2}
                    value={editForm.text}
                    onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
                    maxLength={1000}
                  />
                </div>
                <div className="field">
                  <label htmlFor="editCategory">Category</label>
                  <select
                    id="editCategory"
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value as Category })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="editWhatToLookFor">What to look for</label>
                  <input
                    id="editWhatToLookFor"
                    value={editForm.whatToLookFor}
                    onChange={(e) => setEditForm({ ...editForm, whatToLookFor: e.target.value })}
                    maxLength={500}
                  />
                </div>

                <p className="meta" style={{ marginBottom: 4 }}>STAR reference (an illustrative strong-answer shape, not a checklist)</p>
                <div className="field">
                  <label htmlFor="editSituation">Situation</label>
                  <input id="editSituation" value={editForm.situation} onChange={(e) => setEditForm({ ...editForm, situation: e.target.value })} maxLength={300} />
                </div>
                <div className="field">
                  <label htmlFor="editTask">Task</label>
                  <input id="editTask" value={editForm.task} onChange={(e) => setEditForm({ ...editForm, task: e.target.value })} maxLength={300} />
                </div>
                <div className="field">
                  <label htmlFor="editAction">Action</label>
                  <input id="editAction" value={editForm.action} onChange={(e) => setEditForm({ ...editForm, action: e.target.value })} maxLength={300} />
                </div>
                <div className="field">
                  <label htmlFor="editResult">Result</label>
                  <input id="editResult" value={editForm.result} onChange={(e) => setEditForm({ ...editForm, result: e.target.value })} maxLength={300} />
                </div>

                <div className="field">
                  <label htmlFor="editProbes">Follow-up probes (one per line)</label>
                  <textarea
                    id="editProbes"
                    rows={3}
                    value={editForm.followUpProbes}
                    onChange={(e) => setEditForm({ ...editForm, followUpProbes: e.target.value })}
                  />
                </div>

                <label className="row" style={{ alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={editForm.isCompanyGrounded}
                    onChange={(e) => setEditForm({ ...editForm, isCompanyGrounded: e.target.checked })}
                  />
                  Company-grounded
                </label>
                <label className="row" style={{ alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={editForm.active}
                    onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                  />
                  Active
                </label>

                <button onClick={saveEdit} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </main>
  );
}
