import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModuleId, MissionResult, Session } from '../app/contracts';
import { LEVEL_LABEL } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { MISSIONS } from '../missions';
import { LEVEL_GRADE, MODULE_LABEL, fmtElapsed, fmtTime } from '../reports/labels';
import { ConfirmDialog, Panel, asset, hhmm } from './common';

/** Derived per-module seed so each module of one incident gets a distinct deterministic puzzle. */
export function moduleSeed(sessionSeed: number, index: number): number {
  return ((sessionSeed >>> 0) + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

type Confirm = 'emergency' | 'cancel' | null;

export function IncidentScreen({ sessionId }: { sessionId: string }) {
  const rem = useRem();
  const { activeSession, getSession, navigate, reducedMotion } = rem;
  const [fetched, setFetched] = useState<Session | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [realertAt, setRealertAt] = useState<number | null>(null);
  const [actionReportId, setActionReportId] = useState<string | null>(null);

  const live = activeSession && activeSession.id === sessionId ? activeSession : null;
  const session = live ?? fetched ?? null;

  const refresh = useCallback(async () => {
    try {
      setFetched(await getSession(sessionId));
    } catch {
      setFetched(null);
    }
  }, [getSession, sessionId]);

  useEffect(() => {
    if (!live) void refresh();
  }, [live, refresh]);

  // Leaving the incident screen after it ended clears the ended session from the provider.
  const endedRef = useRef(false);
  endedRef.current = !!session && session.status !== 'alerting' && session.status !== 'recovering';
  const dismissRef = useRef(rem.dismissSession);
  dismissRef.current = rem.dismissSession;
  useEffect(
    () => () => {
      if (endedRef.current) dismissRef.current();
    },
    [],
  );

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '처리하지 못했습니다. 다시 시도하십시오.');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  if (session === null && fetched === undefined) {
    return (
      <main className="ui-screen" aria-busy="true">
        <p className="mono dim">INCIDENT LINK … 사건 기록을 불러오는 중</p>
      </main>
    );
  }
  if (!session) {
    return (
      <main className="ui-screen">
        <Panel title="사건을 찾을 수 없음" en="NO INCIDENT">
          <div className="ui-stack">
            <p>이미 종료되어 정리되었거나 이 기기에 없는 사건입니다.</p>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => navigate('/')}>메인으로</button>
          </div>
        </Panel>
      </main>
    );
  }

  const isOpen = session.status === 'alerting' || session.status === 'recovering';
  const state = session.status === 'alerting' ? 'alerting' : session.status === 'recovering' ? 'recovering' : session.status === 'recovered' ? 'recovered' : 'ended';
  const total = session.modules.length;
  const done = session.modules.filter((m) => session.completed.includes(m)).length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  const isSim = session.mode === 'simulation';

  const doEmergency = () =>
    act(async () => {
      setConfirm(null);
      const r = await rem.emergencyStop(session.id);
      setRealertAt(r.realertAt);
      setActionReportId(r.reportId);
    });
  const doCancel = () =>
    act(async () => {
      setConfirm(null);
      const r = await rem.cancelSession(session.id);
      setActionReportId(r.reportId);
    });

  return (
    <div className="ui-incident" data-state={state} data-mode={session.mode}>
      {state === 'alerting' ? <div className="ui-alert-frame" aria-hidden="true" /> : null}
      <div className="ui-incident-body">
        <header className="ui-spread">
          <span className="ui-incident-code">{isSim ? 'SIMULATION · 훈련' : 'R.E.M. INCIDENT'}</span>
          <span className="mono dim" style={{ fontSize: 12 }}>{session.id}</span>
        </header>
        {err ? <p className="ui-banner ui-banner-alert" role="alert">{err}</p> : null}

        {state === 'alerting' ? <AlertingView session={session} rate={rate} busy={busy} act={act} /> : null}
        {state === 'recovering' ? <RecoveringView session={session} done={done} total={total} rate={rate} /> : null}
        {state === 'recovered' ? <RecoveredView session={session} reducedMotion={reducedMotion} /> : null}
        {state === 'ended' ? <EndedView session={session} realertAt={realertAt} reportId={actionReportId} /> : null}
      </div>

      {isOpen ? (
        <div className="ui-emergency-bar">
          <div className="ui-emergency-bar-inner">
            <button type="button" className="ui-btn ui-btn-warn" disabled={busy} onClick={() => setConfirm('emergency')}>
              긴급 종료
            </button>
            <button type="button" className="ui-btn ui-btn-danger" disabled={busy} onClick={() => setConfirm('cancel')}>
              완전 취소
            </button>
          </div>
        </div>
      ) : null}

      {confirm === 'emergency' ? (
        <ConfirmDialog
          title="긴급 종료"
          body={
            isSim
              ? '훈련을 중단하고 경보를 멈춥니다. 훈련에서는 재경보가 예약되지 않습니다.'
              : session.snapshot
                ? `경보를 멈추고 ${session.snapshot.emergencyMinutes}분 뒤 재경보를 예약합니다. 사용 ${session.emergencyCount}/${session.snapshot.emergencyLimit}회. 허용 횟수를 모두 쓰면 복구 실패로 종료됩니다.`
                : '경보를 멈추고 재경보를 예약합니다.'
          }
          confirmLabel="긴급 종료"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void doEmergency()}
        />
      ) : null}
      {confirm === 'cancel' ? (
        <ConfirmDialog
          title="완전 취소"
          body="경보음을 즉시 멈추고 이 사건의 모든 재경보를 삭제합니다. 사건은 ‘안전 취소’로 기록됩니다."
          confirmLabel="완전 취소"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => void doCancel()}
        />
      ) : null}
    </div>
  );
}

function AlertingView({ session, rate, busy, act }: { session: Session; rate: number; busy: boolean; act: (fn: () => Promise<void>) => Promise<void> }) {
  const { audio, beginRecovery } = useRem();
  return (
    <>
      <div role="alert">
        <h1 className="ui-incident-title">
          <span className="ui-incident-title-en">REALITY LINK FAILURE</span>
          현실 연결 장애 발생
        </h1>
        <p className="ui-note" style={{ marginTop: 6 }}>복구 모듈을 모두 완료해야 경보가 해제됩니다.</p>
      </div>
      <Panel title="사건 정보" en="INCIDENT">
        <dl className="ui-kv">
          <dt>사건 ID</dt><dd className="mono">{session.lineageId}</dd>
          <dt>등급</dt><dd>{LEVEL_GRADE[session.level]}</dd>
          <dt>발생 시각</dt><dd className="mono">{fmtTime(session.startedAt)}</dd>
          <dt>연결률</dt><dd className="mono st-alert">{rate}%</dd>
          <dt>복구 모듈</dt><dd><span className="mono">{session.modules.length}</span>개 · <span className="mono">{session.modules.join(' / ')}</span></dd>
          {session.origin !== 'scheduled' && session.origin !== 'simulation' ? (
            <><dt>재경보</dt><dd>{session.origin === 'emergency' ? `긴급 종료 후 재경보 (${session.emergencyCount}회차)` : `다시 울리기 (${session.snoozeCount}회차)`}</dd></>
          ) : null}
        </dl>
      </Panel>
      {!audio.unlocked ? (
        <div className="ui-banner" role="status">
          <strong>경보음 꺼짐</strong> — 브라우저 정책상 화면을 한 번 눌러야 소리가 납니다.
          <button type="button" className="ui-btn ui-btn-block" style={{ marginTop: 8 }} onClick={() => void audio.unlock()}>
            경보음 켜기
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="ui-btn ui-btn-primary ui-btn-block ui-recover-btn"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            await audio.unlock().catch(() => false);
            await beginRecovery(session.id);
          })
        }
      >
        복구 실행 <span className="ui-label-en">BEGIN RECOVERY</span>
      </button>
    </>
  );
}

function RecoveringView({ session, done, total, rate }: { session: Session; done: number; total: number; rate: number }) {
  const rem = useRem();
  const index = session.modules.findIndex((m) => !session.completed.includes(m));
  const current: ModuleId | undefined = index >= 0 ? session.modules[index] : undefined;
  const started = useRef<string | null>(null);
  const completing = useRef<string | null>(null);

  useEffect(() => {
    if (!current) return;
    const key = `${session.id}:${current}`;
    if (started.current === key) return;
    started.current = key;
    const open = session.attempts.some((a) => a.module === current && !a.completed && a.endedAt === undefined);
    if (!open) void rem.startModule(session.id, current).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, current]);

  const def = current ? MISSIONS?.[current] : undefined;
  const Comp = def?.Component;

  const onSuccess = (r: MissionResult) => {
    if (!current) return;
    const key = `${session.id}:${current}`;
    if (completing.current === key) return;
    completing.current = key;
    void rem.completeModule(session.id, current, r).catch(() => {
      completing.current = null;
    });
  };
  const onFailure = (msg: string) => {
    if (current) void rem.recordFailure(session.id, current, msg).catch(() => undefined);
  };
  const onLog = (msg: string) => {
    if (current) void rem.logEvent(session.id, current, msg).catch(() => undefined);
  };
  const failures = current ? session.attempts.filter((a) => a.module === current).reduce((n, a) => n + a.failures, 0) : 0;

  return (
    <>
      <div className="ui-progress" aria-label="복구 진행률">
        <div className="ui-spread">
          <span className="ui-label-en">RECOVERY PROGRESS</span>
          <span className="mono">
            연결률 {rate}% · {done}/{total} 모듈
          </span>
        </div>
        <div className="ui-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate} aria-valuetext={`${done}/${total} 모듈 완료, 연결률 ${rate}%`}>
          <div className="ui-progress-fill" style={{ width: `${rate}%` }} />
        </div>
        <div className="ui-progress-ticks" aria-hidden="true">
          {session.modules.map((m) => (
            <span key={m} className={session.completed.includes(m) ? 'st-ok' : m === current ? 'st-warn' : ''}>{m}</span>
          ))}
        </div>
      </div>

      {current ? (
        <>
          <Panel title={`${index + 1}/${total} · ${def?.nameKo ?? MODULE_LABEL[current].ko}`} en={current}>
            <div className="ui-stack">
              <div className="ui-spread">
                <span className="dim" style={{ fontSize: 13 }}>{def?.instrument ?? MODULE_LABEL[current].instrument} · 난이도 {LEVEL_LABEL[session.level].ko}</span>
                <span className="mono dim" style={{ fontSize: 13 }}>오류 {failures}회</span>
              </div>
              {def ? <p style={{ fontSize: 14 }}>{def.briefing[session.level]}</p> : null}
            </div>
          </Panel>
          {Comp ? (
            <section aria-label={`${current} 복구 모듈`} key={`${session.id}:${current}`}>
              <Comp
                level={session.level}
                seed={moduleSeed(session.seed, index)}
                onSuccess={onSuccess}
                onFailure={onFailure}
                onLog={onLog}
                reducedMotion={rem.reducedMotion}
              />
            </section>
          ) : (
            <p className="ui-banner ui-banner-alert" role="alert">복구 모듈을 불러오지 못했습니다. 앱을 다시 실행하거나 긴급 종료·완전 취소를 사용하십시오.</p>
          )}
        </>
      ) : (
        <p className="mono dim" role="status">모든 모듈 완료 — 경보 해제 처리 중…</p>
      )}
    </>
  );
}

function RecoveredView({ session, reducedMotion }: { session: Session; reducedMotion: boolean }) {
  const { reportIdForSession, navigate, dismissSession, requestSnooze } = useRem();
  const [step, setStep] = useState(reducedMotion ? 3 : 0);
  const [snoozeMsg, setSnoozeMsg] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const reportId = reportIdForSession(session.id);
  const elapsed = (session.endedAt ?? Date.now()) - session.startedAt;
  const snap = session.snapshot;
  const canSnooze = session.mode === 'real' && !!snap?.allowSnooze && session.snoozeCount < (snap?.snoozeLimit ?? 0);

  useEffect(() => {
    if (reducedMotion) {
      setStep(3);
      return;
    }
    const ts = [700, 1500, 2900].map((ms, i) => window.setTimeout(() => setStep(i + 1), ms));
    return () => ts.forEach((t) => window.clearTimeout(t));
  }, [reducedMotion]);

  const snooze = async () => {
    setSnoozing(true);
    try {
      const at = await requestSnooze(session.id);
      setSnoozeMsg(at ? `${hhmm(at)}에 다시 울립니다.` : '다시 울리기를 사용할 수 없습니다(허용 안 함 또는 횟수 소진).');
    } catch (e) {
      setSnoozeMsg(e instanceof Error ? e.message : '예약하지 못했습니다.');
    } finally {
      setSnoozing(false);
    }
  };

  return (
    <>
      <div role="status">
        <h1 className="ui-incident-title">
          <span className="ui-incident-title-en st-ok">RETURN TO CONSCIOUSNESS.</span>
          현실로 복귀하십시오.
        </h1>
        <p className="st-ok" style={{ marginTop: 6, fontWeight: 700 }}>
          <span className="ui-chip st-ok">정상 복구</span> 현실 연결이 안정되었습니다. 경보가 해제되었습니다.
        </p>
      </div>
      <Panel title="복구 결과" en="RESULT">
        <dl className="ui-kv">
          <dt>소요 시간</dt><dd className="mono">{fmtElapsed(elapsed)}</dd>
          <dt>복구 모듈</dt><dd className="mono">{session.completed.length}/{session.modules.length} · {session.modules.join(' / ')}</dd>
          <dt>연결률</dt><dd className="mono st-ok">100%</dd>
          <dt>누적 오류</dt><dd className="mono">{session.attempts.reduce((n, a) => n + a.failures, 0)}회</dd>
        </dl>
      </Panel>

      <section className="ui-panel ui-print" aria-label="보고서 발행">
        <ol className="ui-print-log" aria-live="polite">
          <li>&gt; 사건 기록 정리 … 완료</li>
          {step >= 1 ? <li>&gt; 공식 보고서 발행 … {reportId ? <span className="st-ok">완료</span> : '대기'}</li> : null}
          {step >= 2 ? <li>&gt; 종이 출력 … 완료</li> : null}
        </ol>
        {step >= 2 ? (
          <div className={reducedMotion ? '' : 'ui-print-paper'} style={{ background: 'var(--c-paper)', color: 'var(--c-ink)', padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div className="mono" style={{ fontSize: 11 }}>REALITY EMERGENCY MANAGEMENT</div>
              <strong>현실 연결 장애 복구 보고서</strong>
              {session.mode === 'simulation' ? <div style={{ fontSize: 12 }}>훈련 기록</div> : null}
            </div>
            {step >= 3 ? <img className={reducedMotion ? '' : 'ui-stamp-drop'} src={asset('stamps/recovered.svg')} alt="정상 복구 직인" style={{ width: 96, transform: 'rotate(-8deg)' }} /> : null}
          </div>
        ) : null}
      </section>

      {snoozeMsg ? <p className="ui-banner" role="status">{snoozeMsg}</p> : null}
      <div className="ui-stack">
        <button type="button" className="ui-btn ui-btn-primary ui-btn-block" disabled={!reportId} onClick={() => reportId && navigate(`/archive/${reportId}`)}>
          보고서 보기
        </button>
        {canSnooze && !snoozeMsg ? (
          <button type="button" className="ui-btn ui-btn-block" disabled={snoozing} onClick={() => void snooze()}>
            {snap!.snoozeMinutes}분 뒤 다시 울리기 ({session.snoozeCount}/{snap!.snoozeLimit})
          </button>
        ) : null}
        <button
          type="button"
          className="ui-btn ui-btn-block"
          onClick={() => {
            dismissSession();
            navigate('/');
          }}
        >
          메인으로
        </button>
      </div>
    </>
  );
}

const ENDED_TEXT = {
  deferred: { en: 'RECOVERY DEFERRED', ko: '복구 유예', cls: 'st-warn' },
  failed: { en: 'RECOVERY FAILED', ko: '복구 실패', cls: 'st-alert' },
  cancelled: { en: 'SAFE CANCEL', ko: '안전 취소', cls: 'st-alert' },
} as const;
const SIM_ENDED_TEXT = { en: 'TRAINING ENDED', ko: '훈련 종료', cls: 'st-dim' } as const;

function EndedView({ session, realertAt, reportId }: { session: Session; realertAt: number | null; reportId: string | null }) {
  const { reportIdForSession, navigate, dismissSession, pending } = useRem();
  const status = session.status as 'deferred' | 'failed' | 'cancelled';
  const isSim = session.mode === 'simulation';
  const t = isSim && status !== 'cancelled' ? SIM_ENDED_TEXT : ENDED_TEXT[status] ?? ENDED_TEXT.failed;
  const rid = reportId ?? reportIdForSession(session.id);
  // Re-alert is shown only when one really exists: the emergencyStop result or a pending entry of this lineage.
  const nextAt = isSim ? null : realertAt ?? pending.filter((p) => p.lineageId === session.lineageId).sort((a, b) => a.at - b.at)[0]?.at ?? null;
  const timedOut = session.events.some((e) => e.type === 'timeout');

  let resultText: ReactNode;
  if (status === 'cancelled') {
    resultText = isSim ? '훈련을 취소했습니다. 재경보 없음.' : '경보와 이 사건의 모든 재경보를 중단했습니다. 재경보 없음.';
  } else if (isSim) {
    resultText = timedOut ? '훈련 종료 — 최대 지속 시간(30분) 초과. 재경보 없음.' : '훈련 종료 — 재경보 없음. 훈련은 재경보를 예약하지 않습니다.';
  } else if (nextAt) {
    resultText = (
      <>
        경보를 멈췄습니다. 재경보 예약됨: <strong className="mono st-warn">{hhmm(nextAt)}</strong>. 화면을 켠 채 대기 모드로 두십시오.
      </>
    );
  } else if (status === 'deferred') {
    resultText = '경보를 멈췄습니다. 예약된 재경보를 찾을 수 없습니다. 일정 화면의 ‘대기 중인 재경보’를 확인하십시오.';
  } else if (timedOut) {
    resultText = '경보가 최대 지속 시간(30분)을 넘어 자동 종료되었습니다. 재경보 없음.';
  } else {
    resultText = '긴급 종료 허용 횟수를 모두 사용해 사건이 종료되었습니다. 재경보 없음.';
  }

  return (
    <>
      <div role="status">
        <h1 className="ui-incident-title">
          <span className={`ui-incident-title-en ${t.cls}`}>{t.en}</span>
          {t.ko}
        </h1>
      </div>
      <Panel title="처리 결과" en="RESULT">
        <div className="ui-stack">
          <p data-testid="ended-result">{resultText}</p>
          <dl className="ui-kv">
            <dt>연결률</dt><dd className="mono">{session.modules.length ? Math.round((session.completed.length / session.modules.length) * 100) : 0}%</dd>
            <dt>긴급 종료</dt><dd className="mono">{session.emergencyCount}회</dd>
          </dl>
        </div>
      </Panel>
      <div className="ui-stack">
        {rid ? (
          <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={() => navigate(`/archive/${rid}`)}>
            보고서 보기
          </button>
        ) : null}
        <button
          type="button"
          className="ui-btn ui-btn-block"
          onClick={() => {
            dismissSession();
            navigate('/');
          }}
        >
          메인으로
        </button>
      </div>
    </>
  );
}
