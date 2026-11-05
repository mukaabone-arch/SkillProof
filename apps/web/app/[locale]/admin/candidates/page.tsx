'use client';

/**
 * Candidate Management — list view only (2026-09, first slice). Payment
 * details, access-control and assessment-issue panels are deliberately out
 * of scope here and will land on /admin/candidates/[id] later — every row
 * already links there (a stub today) so that navigation doesn't need
 * retrofitting when those panels arrive. See AdminService.listCandidates'
 * own doc comment for the full design reasoning (why lastActivityAt is
 * derived not tracked, why authMethod reads Identity rows, why every
 * verification stage — including incomplete — is shown, never filtered by
 * default).
 *
 * Table, not stacked cards, unlike /admin/orgs and /admin/assessment-blocks
 * — this list has real columns worth scanning (signup, last activity,
 * counts) rather than a paragraph of context per row. Wrapped in
 * .admin-table-wrap so a narrow viewport scrolls the table horizontally
 * instead of the whole page — same shape as .lp-legal-table-wrap,
 * confirmed at 390px (see that class's own comment) — .admin-content
 * already carries the min-width: 0 a flex child needs for that to work.
 *
 * lastActivityAt renders "—" for null, never a fallback to signup date —
 * see the backend field's own doc comment on why conflating the two would
 * mislead an admin about which candidates are actually live. lastLoginAt
 * (added alongside it, not replacing it — the two answer different
 * questions, see AdminService.listCandidates) follows the exact same
 * null-rendering rule, for the same reason.
 *
 * accountState ('ACTIVE' | 'DEACTIVATED' | 'DELETED') exists because a
 * deleted candidate — AccountService.delete anonymises phone/email/Identity
 * in place, there is no deletedAt on User — is otherwise indistinguishable
 * from a broken signup: raw-ID name, "Missing phone, email", authMethod
 * "Unknown". Deleted accounts stay in the default listing, marked rather
 * than hidden (same reasoning as showing incomplete signups above); a
 * DELETED row therefore suppresses the verification and auth-method badges
 * entirely (rendered as "—") rather than showing what would otherwise read
 * as a data problem — see AdminService.listCandidates' own doc comment for
 * why this is a genuinely different state from "never verified."
 *
 * Known limitation: this table already exceeds .admin-content's width and
 * scrolls horizontally below roughly a 1410px viewport; lastLoginAt and now
 * accountState (ninth and tenth columns) make that slightly worse. Noted,
 * not fixed, here — the two changes that would actually claw back width
 * (relative time instead of full date/time on the two activity columns,
 * ~95px; or letting the Candidate cell wrap instead of truncating, ~140px)
 * are both bigger than either column addition warrants on their own. Do
 * not "fix" this by dropping a column instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

type SortField = 'createdAt' | 'lastActivityAt';
type SortOrder = 'asc' | 'desc';

interface CandidateRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  verified: boolean;
  missingVerification: string[];
  authMethod: string;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  attemptCount: number;
  badgeCount: number;
  blocked: boolean;
  accountState: 'ACTIVE' | 'DEACTIVATED' | 'DELETED';
}

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  candidates: CandidateRow[];
}

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
}

function fmtDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function SortHeader({
  label,
  field,
  activeSort,
  order,
  onSort,
}: {
  label: string;
  field: SortField;
  activeSort: SortField;
  order: SortOrder;
  onSort: (field: SortField) => void;
}) {
  const active = activeSort === field;
  return (
    <th>
      <button type="button" className="admin-table-sort-btn" onClick={() => onSort(field)}>
        {label}
        {active ? (order === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

export default function AdminCandidatesPage() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortField>('createdAt');
  const [order, setOrder] = useState<SortOrder>('desc');
  const everLoaded = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search — same setTimeout/clearTimeout-in-a-ref shape as
  // LocationAutocomplete's own debounce, this codebase's only existing
  // precedent for one. Resets to page 1 whenever the effective search
  // term actually changes, so a new search never lands on a stale page
  // number from a longer previous result set.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const load = useCallback(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
      order,
    });
    if (search) params.set('search', search);
    api<ListResponse>(`/admin/candidates?${params.toString()}`)
      .then((r) => {
        setData(r);
        setStatus('ok');
        setError('');
        everLoaded.current = true;
      })
      .catch((e) => {
        if (!everLoaded.current) setStatus('forbidden');
        else setError(e.message);
      });
  }, [page, search, sort, order]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, [load]);

  function handleSort(field: SortField) {
    if (field === sort) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setOrder('desc');
    }
    setPage(1);
  }

  if (status === 'loading') {
    return (
      <main className="hub hub-wide">
        <h1>Candidate Management</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub hub-wide">
        <h1>Candidate Management</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to view candidates.</p>
      </main>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <main className="hub hub-wide">
      <h1>Candidate Management</h1>
      <p className="hub-subhead">
        Every signed-up candidate, at every verification stage — someone who never verified a phone or email is
        exactly who this list exists to surface, not someone to hide by default. Last activity is the most recent
        attempt, answer, or badge — a candidate who signs in but never attempts anything shows &ldquo;—&rdquo;, not
        their signup date.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="field" style={{ minWidth: 260, margin: 0 }}>
          <label htmlFor="candidateSearch">Search</label>
          <input
            id="candidateSearch"
            type="text"
            placeholder="Name, email, or phone…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
      </div>

      {data && data.candidates.length === 0 ? (
        <EmptyState message={search ? 'No candidates match this search.' : 'No candidates have signed up yet.'} />
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <SortHeader label="Signed up" field="createdAt" activeSort={sort} order={order} onSort={handleSort} />
                  <th>Account state</th>
                  <th>Verification</th>
                  <th>Auth method</th>
                  <th>Last login</th>
                  <SortHeader label="Last activity" field="lastActivityAt" activeSort={sort} order={order} onSort={handleSort} />
                  <th>Attempts</th>
                  <th>Badges</th>
                  <th>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {data?.candidates.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/candidates/${c.id}`}>{c.name ?? c.email ?? c.phone ?? c.id.slice(0, 8)}</Link>
                      {c.name && (c.email || c.phone) && (
                        <div className="meta" style={{ margin: 0 }}>{c.email ?? c.phone}</div>
                      )}
                    </td>
                    <td>{fmtDate(c.createdAt)}</td>
                    <td>
                      {c.accountState === 'DELETED' && <Badge variant="danger">Deleted</Badge>}
                      {c.accountState === 'DEACTIVATED' && <Badge variant="warning">Deactivated</Badge>}
                    </td>
                    <td>
                      {c.accountState === 'DELETED' ? (
                        <span className="meta" style={{ margin: 0 }}>—</span>
                      ) : c.verified ? (
                        <Badge variant="verified">Verified</Badge>
                      ) : (
                        <Badge variant="warning">Missing {c.missingVerification.join(', ')}</Badge>
                      )}
                    </td>
                    <td>{c.accountState === 'DELETED' ? '—' : c.authMethod}</td>
                    <td>{fmtDateTime(c.lastLoginAt)}</td>
                    <td>{fmtDateTime(c.lastActivityAt)}</td>
                    <td>{c.attemptCount}</td>
                    <td>{c.badgeCount}</td>
                    <td>{c.blocked && <Badge variant="danger">Blocked</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <span className="meta" style={{ margin: 0 }}>
              {data?.total ?? 0} candidate{data?.total === 1 ? '' : 's'} · page {page} of {totalPages}
            </span>
            <div className="row" style={{ margin: 0 }}>
              <button className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Previous
              </button>
              <button className="btn-secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
