'use client';

/**
 * Assessment-taking flow:
 * start attempt → fetch questions → answer (saved per-question, idempotent)
 * → submit → grade → result + badge.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken, type ApiError } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { UsageMeter } from '@/components/UsageMeter';
import { Badge } from '@/components/ui';

type IntegrityEventType =
  | 'TAB_BLUR'
  | 'TAB_FOCUS'
  | 'PASTE_ATTEMPT'
  | 'COPY_ATTEMPT'
  | 'FULLSCREEN_EXIT'
  | 'RIGHT_CLICK'
  | 'PRINT_SCREEN';

interface Question {
  id: string;
  type: string;
  body: { text: string; options: string[] };
}
interface QuestionsResponse {
  questions: Question[];
  /** Server-computed remaining time — the server is authoritative; this only drives the display. */
  remainingSeconds: number | null;
  deadlineAt: string | null;
}
/** Machine-readable code the backend returns when assessment-start preconditions aren't met. */
interface StartIssueBody {
  code?: 'PROFILE_INCOMPLETE_FOR_ASSESSMENT';
  message?: string;
}
/**
 * The 402 body for a blocked attempt-start — same LIMIT_REACHED shape as
 * lib/limitReachedBus.ts, distinguished by `metric`. Four cases reach this
 * page (EntitlementsService throws the same exception shape for all four —
 * see that service's checkRetakeEligibility/checkSkillLockEligibility/
 * checkAndIncrement):
 *  - retakeCooldownDays: real resetsAt (when the wait is over — Premium
 *    removes it outright).
 *  - retakesPerSkillLifetime: resetsAt is always null — that cap is
 *    permanent regardless of tier, only its size changes (1 on Free, 3 on
 *    Premium), so "upgrade" only ever helps if there's still headroom
 *    under the higher cap. Despite the metric's name, the cap itself is
 *    scoped per skill+LEVEL, not the whole skill — each level is its own
 *    assessment with its own budget (see apps/api's
 *    EntitlementsService.checkRetakeEligibility), so this only ever blocks
 *    a retry of the level this page is currently on; other levels of the
 *    same skill are unaffected.
 *  - singleSkillRestriction: resetsAt is always null — a FREE candidate
 *    tried to start a skill other than the one they're locked to (see
 *    freeSkillLock in lib/entitlements.tsx). The "before you begin" gate
 *    below already discloses the lock up front on a candidate's very first
 *    self-serve attempt, so reaching this branch means either a direct
 *    link/bookmark to a second skill, or a stale UI somewhere else that
 *    didn't yet know about the lock.
 *  - assessments: the monthly quota shared across every skill (not
 *    per-skill like the others) — also reaches the global
 *    LimitReachedModal (lib/api.ts publishes to limitReachedBus for every
 *    LIMIT_REACHED response, not just this one), but this page renders its
 *    own inline version too rather than leaving nothing behind it once
 *    that modal is dismissed — see limitIssue's render branch below.
 */
interface LimitIssueBody {
  code?: 'LIMIT_REACHED';
  metric?: 'retakeCooldownDays' | 'retakesPerSkillLifetime' | 'assessments' | 'singleSkillRestriction';
  limit?: number | null;
  resetsAt?: string | null;
}
/** GET /assessments/:id — just enough to know this attempt's skill+level before starting it. */
interface AssessmentInfo {
  id: string;
  title: string;
  skillId: string;
  targetLevel: string;
  skillName: string;
}
/** One topic's aggregate performance — never per-question detail; see AssessmentsService.getResult's own doc comment on the leak boundary this is built against. */
interface TopicStat {
  topic: string;
  correct: number;
  asked: number;
}
interface TopicBreakdown {
  topics: TopicStat[];
  /** Questions with no topic tag (excluded, not bucketed as "Other") — non-zero means the breakdown below isn't the full question count. */
  excludedCount: number;
}
interface Result {
  status: string;
  scorePercent: number | null;
  passed: boolean | null;
  passThreshold: number;
  assessmentTitle: string;
  skillName: string;
  badge: { verifyHash: string; level: string; expiresAt: string; attemptNumber: number | null } | null;
  topicBreakdown: TopicBreakdown;
}

function topicPercent(t: TopicStat): number {
  return t.asked === 0 ? 0 : Math.round((t.correct / t.asked) * 100);
}

export default function TakeAssessmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tier, limits, usage, freeSkillLock, refetch } = useEntitlements();
  const [assessmentInfo, setAssessmentInfo] = useState<AssessmentInfo>();
  const [attemptId, setAttemptId] = useState<string>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState('');
  const [startIssue, setStartIssue] = useState<StartIssueBody | null>(null);
  const [limitIssue, setLimitIssue] = useState<LimitIssueBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // The absolute instant the countdown ticks against — see the countdown
  // effect below. Kept separate from remainingSeconds (a derived display
  // value) so drift never accumulates: every tick recomputes fresh from
  // this anchor and Date.now(), rather than decrementing remainingSeconds
  // itself, which drifts under tab throttling/backgrounding.
  const [deadlineAt, setDeadlineAt] = useState<string | null>(null);
  // Gates start(): the attempt is never created until the candidate has
  // explicitly acknowledged the monitoring notice below.
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  // Separate checkbox, required only when this attempt would set the
  // FREE-tier single-skill lock (see willLockFreeSkill below) — kept apart
  // from ackChecked (the integrity-monitoring notice) since the two are
  // unrelated facts and a candidate should explicitly confirm each.
  const [lockAckChecked, setLockAckChecked] = useState(false);

  useEffect(() => {
    api<AssessmentInfo>(`/assessments/${id}`).then(setAssessmentInfo).catch(() => undefined);
  }, [id]);

  /**
   * True only for the one moment this actually matters: FREE tier, the
   * restriction is in force, the candidate has never locked a skill yet,
   * and this attempt is for a *different* skill than any existing lock
   * would be moot to restate — mirrors exactly what
   * EntitlementsService.checkSkillLockEligibility itself would do
   * server-side (see that method), so this notice only ever appears when
   * starting really would set the lock, never after it's already set to
   * this same skill.
   */
  const willLockFreeSkill =
    tier === 'FREE' && !!limits?.singleSkillRestriction && !freeSkillLock && !!assessmentInfo;

  // Ref (not state) so in-flight event listeners always see the latest
  // value without needing to be torn down/rebuilt on every render.
  const finishedRef = useRef(false);

  const start = useCallback(async () => {
    if (!getToken()) { router.push('/candidate'); return; }
    try {
      const attempt = await api<{ id: string }>(`/assessments/${id}/attempts`, { method: 'POST' });
      setAttemptId(attempt.id);
      const res = await api<QuestionsResponse>(`/attempts/${attempt.id}/questions`);
      setQuestions(res.questions);
      setRemainingSeconds(res.remainingSeconds);
      setDeadlineAt(res.deadlineAt);
      // A genuinely new attempt consumes a unit of the 'assessments' quota
      // (an idempotent re-open of an already-active attempt is refunded
      // server-side) — refetch so the meter reflects the real count either way.
      void refetch();
    } catch (e) {
      // The catalog page disables Start when the profile isn't ready — this
      // is the defense-in-depth path for reaching this page directly (a
      // stale tab, a bookmarked URL, a race with a profile edit elsewhere).
      const body = (e as ApiError).body as (StartIssueBody & LimitIssueBody) | undefined;
      if (body?.code === 'PROFILE_INCOMPLETE_FOR_ASSESSMENT') {
        setStartIssue(body);
      } else if (
        body?.code === 'LIMIT_REACHED' &&
        (body.metric === 'retakeCooldownDays' ||
          body.metric === 'retakesPerSkillLifetime' ||
          body.metric === 'assessments' ||
          body.metric === 'singleSkillRestriction')
      ) {
        // retakeCooldownDays/retakesPerSkillLifetime are handled inline
        // here rather than by the global LimitReachedModal — see that
        // component's own doc comment on why it ignores those two metrics
        // specifically (cooldown-until-date vs. permanent cap read very
        // differently, and only one is solvable by upgrading).
        //
        // assessments (the monthly quota) DOES also reach that modal — but
        // this page renders its own copy too, not just to avoid depending
        // on the modal for a page that has nothing else to show once
        // dismissed: EntitlementLimitException's response body carries no
        // `message` field at all (see EntitlementLimitException in
        // apps/api), so without this branch the generic `else` below would
        // set error to the bare fallback in lib/api.ts's buildApiError —
        // "Request failed: 402" — which is exactly the raw status code a
        // candidate should never see.
        setLimitIssue(body);
      } else {
        setError((e as Error).message);
      }
      // Any 4xx here (including the limit ones above) is refunded
      // server-side — refetch rather than assume the meter is unaffected.
      void refetch();
    }
    finally { setLoaded(true); }
  }, [id, router, refetch]);

  useEffect(() => {
    if (acknowledged) start();
  }, [acknowledged, start]);

  /**
   * Best-effort, fire-and-forget: a failed report must never interrupt the
   * candidate mid-test. Counting/thresholding happens entirely server-side
   * (see AssessmentsService.addIntegrityEvent) — this call only surfaces
   * what was observed in the browser.
   */
  const reportIntegrityEvent = useCallback(
    (type: IntegrityEventType, metadata?: Record<string, unknown>) => {
      if (!attemptId || finishedRef.current) return;
      api(`/attempts/${attemptId}/integrity-event`, {
        method: 'POST',
        body: JSON.stringify({ type, metadata }),
      }).catch(() => undefined);
    },
    [attemptId],
  );

  // Tab/window blur + fullscreen-exit detection. Silent — a single blur is
  // never punished or interrupted (people get notifications); it's just recorded.
  useEffect(() => {
    if (!attemptId) return;

    let away = false;
    const handleBlur = () => {
      if (away) return;
      away = true;
      reportIntegrityEvent('TAB_BLUR');
    };
    const handleFocus = () => {
      if (!away) return;
      away = false;
      reportIntegrityEvent('TAB_FOCUS');
    };
    const handleVisibility = () => (document.hidden ? handleBlur() : handleFocus());
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) reportIntegrityEvent('FULLSCREEN_EXIT');
    };
    /**
     * Catches the PrintScreen key specifically (via keyup — PrintScreen
     * doesn't reliably fire keydown/keypress across browsers and can't be
     * preventDefault-ed). This is a partial signal only: OS-level capture
     * tools that don't involve that key — the Windows Snipping Tool
     * (Win+Shift+S), a phone photographing the screen, etc. — never touch
     * the browser and are not detectable here. Do not treat this as
     * screenshot prevention, only as one more review signal.
     */
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') reportIntegrityEvent('PRINT_SCREEN');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keyup', handleKeyUp);

    // Optional and best-effort — browsers may silently refuse this without a
    // direct user gesture; that's fine, we just won't see FULLSCREEN_EXIT then.
    document.documentElement.requestFullscreen?.().catch(() => undefined);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [attemptId, reportIntegrityEvent]);

  async function selectAnswer(questionId: string, optionIndex: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
    try {
      // Saved server-side immediately; safe to change (idempotent upsert)
      await api(`/attempts/${attemptId}/answers`, {
        method: 'POST',
        body: JSON.stringify({ questionId, answer: optionIndex }),
      });
    } catch (e) { setError((e as Error).message); }
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      await api(`/attempts/${attemptId}/submit`, { method: 'POST' });
      finishedRef.current = true; // stop reporting integrity events — the attempt is done
      setResult(await api<Result>(`/attempts/${attemptId}/result`));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  /**
   * There's no cooldown on this system — startAttempt() happily opens a new
   * attempt the moment the previous one is GRADED — so retrying just resets
   * local state back to the pre-attempt notice gate; re-acknowledging it is
   * required again for the new attempt, same as the first one.
   */
  function retry() {
    finishedRef.current = false;
    setResult(undefined);
    setQuestions([]);
    setAnswers({});
    setAttemptId(undefined);
    setRemainingSeconds(null);
    setDeadlineAt(null);
    setLoaded(false);
    setError('');
    setAckChecked(false);
    setLockAckChecked(false);
    setAcknowledged(false);
  }

  /**
   * Client-side countdown display only — the server is authoritative
   * (AssessmentsService.enforceDeadline runs on every getQuestions/
   * submitAnswer call regardless of this timer). Recomputed from the
   * absolute deadlineAt instant and Date.now() on every tick, never by
   * decrementing remainingSeconds itself — a chained setTimeout doing that
   * drifts behind real elapsed time whenever the tab is backgrounded or
   * throttled, since a suspended tab's timers fire late but wall-clock
   * time keeps moving. At zero we still call submit() (once — see
   * `stopped`) so the UI moves on immediately instead of waiting for the
   * candidate to notice; if the server already auto-graded it in the
   * background, this just fetches that result.
   */
  useEffect(() => {
    if (deadlineAt === null || result || finishedRef.current) return;
    const deadlineMs = new Date(deadlineAt).getTime();
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const secondsLeft = Math.max(0, Math.round((deadlineMs - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);
      if (secondsLeft <= 0) {
        stopped = true;
        clearInterval(timer);
        submit();
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, result]);

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  if (result) {
    return (
      <main>
        <h1>{result.passed ? '🎉 Passed!' : 'Not this time'}</h1>
        {/*
          Performance summary only — score, pass/fail against the threshold,
          and a per-topic breakdown (topicBreakdown below — aggregate counts
          only, see AssessmentsService.getResult's own doc comment on the
          leak boundary). Never the questions themselves or which specific
          answers were right/wrong — that would leak the question bank to
          every candidate who takes it.
        */}
        <p>
          {result.assessmentTitle} — score: <strong>{result.scorePercent}%</strong>{' '}
          <span className="meta">(pass threshold: {result.passThreshold}%)</span>
        </p>
        {result.passed && result.badge ? (
          <>
            <div className="card badge-card">
              <div>
                <strong>✓ Verified: {result.skillName} ({result.badge.level})</strong>
                <div className="meta">
                  Valid until {new Date(result.badge.expiresAt).toLocaleDateString()}
                  {result.badge.attemptNumber !== null && (
                    <> · Earned on attempt #{result.badge.attemptNumber}</>
                  )}
                </div>
                {result.badge.attemptNumber !== null && result.badge.attemptNumber > 1 && (
                  <div className="meta">
                    Employers see this attempt number on your public certificate too — it&apos;s part
                    of what makes a verified badge credible.
                  </div>
                )}
              </div>
              <Link href={`/badges/${result.badge.verifyHash}`}>
                <button>View your verified certificate</button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p>Didn&apos;t clear the bar this time.</p>
            {/*
              Contextual, not certain: this page only knows the tier's
              cooldown/cap policy (limits.retakeCooldownDays/
              retakesPerSkillLifetime, already fetched app-wide by
              EntitlementsProvider — no new call), not how many prior
              attempts this candidate has burned on this specific skill, so
              it can't honestly claim "you're out of retakes" as a fact.
              "Try again" below still calls the real start endpoint and
              surfaces the authoritative limitIssue (see the acknowledgment
              screen above) if this really was the last one.
            */}
            {limits && limits.retakeCooldownDays === 0 ? (
              <p className="meta">
                No cooldown on your plan — you can retake {result.skillName} whenever you&apos;re ready.
              </p>
            ) : limits ? (
              <p className="meta">
                Retakes on your plan have a cooldown — you&apos;ll likely be eligible for {result.skillName}{' '}
                again around{' '}
                {new Date(Date.now() + limits.retakeCooldownDays * 24 * 60 * 60 * 1000).toLocaleDateString()}.
                Retakes are also capped at {limits.retakesPerSkillLifetime} per level, lifetime, so if this
                was your last one for this level of {result.skillName},{' '}
                <Link href="/assessments">another skill</Link> is the better use of the wait.{' '}
                <Link href="/upgrade">Premium removes the cooldown →</Link>
              </p>
            ) : null}
            <div className="row" style={{ margin: 0 }}>
              <button onClick={retry}>Try again</button>
              {limits && limits.retakeCooldownDays > 0 && (
                <Link href="/assessments">
                  <button className="btn-secondary">Explore other skills</button>
                </Link>
              )}
            </div>
          </>
        )}

        {result.topicBreakdown.topics.length > 0 && (
          <div className="hub-section">
            <h2>Performance by topic</h2>
            {/*
              "by topic", not "every question" — excludedCount (25 of 1,125
              questions today have no topic tag) means this deliberately
              doesn't sum to the attempt's full question count. Bucketing
              those under an "Other" topic was considered and rejected —
              it's not actionable study guidance, just noise.
            */}
            {result.topicBreakdown.excludedCount > 0 && (
              <p className="meta" style={{ marginTop: -8 }}>
                {result.topicBreakdown.excludedCount} question{result.topicBreakdown.excludedCount === 1 ? '' : 's'}{' '}
                weren&apos;t part of a tracked topic and aren&apos;t included below.
              </p>
            )}
            {/*
              On a pass this is just informational, so it stays in whatever
              order the server returned. On a fail, sorted weakest-first —
              that's the whole point of showing it here, so "what should I
              study" is the first thing the candidate sees, not something
              they have to hunt for in a flat list. "Weak" reuses
              passThreshold (the bar this assessment already needed to
              clear) rather than a made-up cutoff — a topic below it is
              exactly as under-the-bar as the attempt as a whole was.
            */}
            {(result.passed
              ? result.topicBreakdown.topics
              : [...result.topicBreakdown.topics].sort((a, b) => topicPercent(a) - topicPercent(b))
            ).map((t) => {
              const pct = topicPercent(t);
              const weak = !result.passed && pct < result.passThreshold;
              return (
                <div key={t.topic} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div className="assessment-row">
                    <strong>{t.topic}</strong>
                    {weak && <Badge variant="warning">Study this</Badge>}
                  </div>
                  <p className="meta">
                    {t.correct}/{t.asked} correct ({pct}%)
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <Link href="/assessments">← Back to assessments</Link>
      </main>
    );
  }

  if (!acknowledged) {
    return (
      <main>
        <h1>Before you begin</h1>
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <p style={{ margin: 0 }}>This assessment is monitored for integrity. While it&apos;s in progress:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Stay in this browser tab and window — don&apos;t switch tabs or apps.</li>
            <li>Don&apos;t copy or paste.</li>
            <li>Don&apos;t exit fullscreen.</li>
            <li>Complete it in one sitting, within the time limit.</li>
          </ul>
          <p className="meta" style={{ margin: 0 }}>
            These are recorded as review signals, not automatic failures — an isolated distraction
            won&apos;t penalize you. Repeated or serious deviations are flagged for a human to review
            before any badge is issued.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={ackChecked}
              onChange={(e) => setAckChecked(e.target.checked)}
            />
            I understand and agree to these conditions.
          </label>
          {willLockFreeSkill && assessmentInfo && (
            <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, borderColor: 'var(--warning, #b45309)' }}>
              <strong>This locks in your free skill</strong>
              <p style={{ margin: 0 }}>
                Your plan allows self-serve assessments in one skill only. Starting this attempt fixes{' '}
                <strong>{assessmentInfo.skillName}</strong> as that skill — every level of it stays available to
                you, but attempting any other skill will require Premium.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={lockAckChecked}
                  onChange={(e) => setLockAckChecked(e.target.checked)}
                />
                I understand this locks {assessmentInfo.skillName} in as my free skill.
              </label>
            </div>
          )}
          {usage && (
            <UsageMeter
              label="assessment starts"
              used={usage.assessments.used}
              limit={usage.assessments.limit}
              resetsAt={usage.assessments.resetsAt}
            />
          )}
          <button
            onClick={() => setAcknowledged(true)}
            disabled={!ackChecked || (willLockFreeSkill && !lockAckChecked)}
            style={{ alignSelf: 'flex-start' }}
          >
            I understand, begin
          </button>
        </div>
        <Link href="/assessments">← Back to assessments</Link>
      </main>
    );
  }

  const answered = Object.keys(answers).length;

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', margin: 0 }}>
        <h1 style={{ marginBottom: 0 }}>Assessment</h1>
        {remainingSeconds !== null && questions.length > 0 && (
          <span className={remainingSeconds <= 60 ? 'error' : 'meta'} style={{ margin: 0 }}>
            Time remaining: {formatTime(remainingSeconds)}
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {startIssue && (
        <p className="meta">
          {startIssue.message}{' '}
          <Link href={`/profile?returnTo=/assessments/${id}`}>Complete your profile →</Link>
        </p>
      )}
      {limitIssue && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          {limitIssue.metric === 'retakeCooldownDays' ? (
            <>
              <strong>Retake not available yet</strong>
              <p style={{ margin: 0 }}>
                You&apos;re in the cooldown period after your last attempt at this skill
                {limitIssue.resetsAt && (
                  <> — available again on {new Date(limitIssue.resetsAt).toLocaleDateString()}</>
                )}
                .
              </p>
              {tier !== 'PREMIUM' && (
                <p className="meta" style={{ margin: 0 }}>
                  <Link href="/upgrade">Premium removes retake cooldowns entirely →</Link>
                </p>
              )}
            </>
          ) : limitIssue.metric === 'singleSkillRestriction' ? (
            <>
              <strong>This skill isn&apos;t included on your plan</strong>
              <p style={{ margin: 0 }}>
                Your free plan&apos;s self-serve assessments are locked to{' '}
                {freeSkillLock ? <strong>{freeSkillLock.skillName}</strong> : 'a different skill'} — Premium
                unlocks every skill.
              </p>
              <p className="meta" style={{ margin: 0 }}>
                <Link href="/upgrade">Upgrade to Premium →</Link>
              </p>
              <p style={{ margin: 0 }}>
                <Link href="/assessments">← Back to assessments</Link>
              </p>
            </>
          ) : limitIssue.metric === 'retakesPerSkillLifetime' ? (
            <>
              <strong>Retake limit reached for this level</strong>
              <p style={{ margin: 0 }}>
                You&apos;ve used all {limitIssue.limit} retake{limitIssue.limit === 1 ? '' : 's'} allowed for{' '}
                {assessmentInfo ? `${assessmentInfo.skillName} (${assessmentInfo.targetLevel})` : 'this level'} —
                this cap doesn&apos;t reset. Other levels of {assessmentInfo?.skillName ?? 'this skill'} aren&apos;t
                affected.
              </p>
              {tier !== 'PREMIUM' && (
                <p className="meta" style={{ margin: 0 }}>
                  <Link href="/upgrade">Premium allows more retakes per level →</Link>
                </p>
              )}
            </>
          ) : (
            <>
              {/* metric === 'assessments' — the shared monthly quota, not per-skill like the two branches above. */}
              <strong>Monthly assessment limit reached</strong>
              <p style={{ margin: 0 }}>
                You&apos;ve used all {limitIssue.limit} assessment start{limitIssue.limit === 1 ? '' : 's'}{' '}
                included on your plan this month
                {limitIssue.resetsAt && <> — more open up on {new Date(limitIssue.resetsAt).toLocaleDateString()}</>}.
              </p>
              {tier !== 'PREMIUM' && (
                <p className="meta" style={{ margin: 0 }}>
                  <Link href="/upgrade">Premium removes the monthly cap entirely →</Link>
                </p>
              )}
              <p style={{ margin: 0 }}>
                <Link href="/assessments">← Back to assessments</Link>
              </p>
            </>
          )}
        </div>
      )}
      {loaded && !error && !startIssue && !limitIssue && questions.length === 0 && (
        <p>This assessment has no questions yet — check back soon.</p>
      )}

      <div
        onPaste={(e) => {
          e.preventDefault();
          reportIntegrityEvent('PASTE_ATTEMPT');
        }}
        onCopy={() => reportIntegrityEvent('COPY_ATTEMPT')}
        onContextMenu={() => reportIntegrityEvent('RIGHT_CLICK')}
      >
        {questions.map((q, i) => (
          <div key={q.id} className="question">
            <p><strong>Q{i + 1}.</strong> {q.body.text}</p>
            {q.body.options.map((opt, idx) => (
              <label key={idx} className="option">
                <input
                  type="radio"
                  name={q.id}
                  checked={answers[q.id] === idx}
                  onChange={() => selectAnswer(q.id, idx)}
                />{' '}
                {opt}
              </label>
            ))}
          </div>
        ))}
      </div>
      {questions.length > 0 && (
        <button onClick={submit} disabled={busy || answered < questions.length}>
          {busy ? 'Grading…' : `Submit (${answered}/${questions.length} answered)`}
        </button>
      )}
    </main>
  );
}
