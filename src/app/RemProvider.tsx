/**
 * RemProvider: the single integration point wiring storage, scheduler,
 * session reducers, audio, vibration, PWA and reports into the RemApi used by the UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RemContext } from './RemContext';
import { createMemoryStorage } from './memoryStorage';
import type { RemStorage } from './services';
import {
  ALERT_MAX_MS,
  type Alarm,
  type Level,
  type MissionResult,
  type ModuleId,
  type PendingRealert,
  type Platform,
  type RemApi,
  type Report,
  type Session,
  type Settings,
} from './contracts';
import { openStorage } from '../storage';
import { alarm as A, createScheduler } from '../alarm';
import { createAudioEngine } from '../alarm/audio';
import { vibration } from '../alarm/vibration';
import { pwa } from '../pwa';
import { buildReport } from '../reports';

const ACTIVE: Session['status'][] = ['alerting', 'recovering'];
export const isLive = (s: Session | null | undefined): s is Session => !!s && ACTIVE.includes(s.status);

function makeTerminalId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  return 'RT-' + Array.from(buf, (n) => chars[n % chars.length]).join('');
}

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    terminalId: makeTerminalId(),
    introSeen: false,
    installPromptDismissedAt: null,
    display: { brightness: 100, scanlines: true, glow: true, reducedMotion: 'system' },
    diagnostics: {
      lastRunAt: null,
      notification: 'unknown',
      vibration: 'unknown',
      sensor: 'unknown',
      audio: 'unknown',
      network: 'unknown',
    },
  };
}

function errText(e: unknown): string {
  const kind = (e as { kind?: string })?.kind;
  if (kind === 'quota') return '저장 공간이 부족하여 기록을 저장하지 못했습니다. 오래된 보고서를 삭제해 주세요.';
  if (kind === 'unavailable') return '이 브라우저에서 로컬 저장소를 사용할 수 없습니다. 새로고침하면 기록이 사라집니다.';
  return '저장 중 오류가 발생했습니다: ' + ((e as Error)?.message ?? String(e));
}

function readRoute(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

export function RemProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [storageError, setStorageError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [pending, setPending] = useState<PendingRealert[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [route, setRoute] = useState(readRoute);
  const [audioState, setAudioState] = useState({ unlocked: false, sounding: false });
  const [canPrompt, setCanPrompt] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [wakeActive, setWakeActive] = useState(false);
  const [systemReduced, setSystemReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  const storageRef = useRef<RemStorage>(createMemoryStorage());
  const settingsRef = useRef(settings);
  const alarmsRef = useRef(alarms);
  const pendingRef = useRef(pending);
  const activeRef = useRef<Session | null>(null);
  const watermarkRef = useRef(0);
  const lastPersistRef = useRef(0);
  const audio = useMemo(() => createAudioEngine(), []);
  const wake = useMemo(() => pwa.createWakeLock(), []);
  const diagnostics = useMemo(() => pwa.createDiagnostics(audio), [audio]);
  const updateRef = useRef<() => void>(() => {});
  const schedulerRef = useRef<ReturnType<typeof createScheduler> | null>(null);

  settingsRef.current = settings;
  alarmsRef.current = alarms;
  pendingRef.current = pending;

  const navigate = useCallback((path: string) => {
    if (readRoute() !== path) window.location.hash = path;
    setRoute(path);
  }, []);

  const setActive = useCallback((s: Session | null) => {
    activeRef.current = s;
    setActiveSession(s);
  }, []);

  const safe = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const r = await fn();
      return r;
    } catch (e) {
      setStorageError(errText(e));
      return undefined;
    }
  }, []);

  /* ---------- alert side effects ---------- */
  /** True while an alert wants the siren. If the audio context is still locked/resuming when the alert is
   *  raised (e.g. a simulation started from a tap: unlock() resolves after the session is raised), the
   *  siren starts as soon as the engine reports it is unlocked. */
  const wantSirenRef = useRef(false);
  const startAlertEffects = useCallback(
    (s: Session) => {
      wantSirenRef.current = true;
      audio.startSiren();
      vibration.startAlarmVibration();
      if (s.mode === 'real') {
        void pwa.showAlertNotification(s.id, 'R.E.M. 비상 경보', '현실 연결 장애 발생. 복구 실행이 필요합니다.');
      }
    },
    [audio],
  );
  const stopAlertEffects = useCallback(() => {
    wantSirenRef.current = false;
    audio.stopSiren();
    vibration.stopAlarmVibration();
    void pwa.closeAlertNotifications();
  }, [audio]);

  /** Persist a terminal session with its report (+ pending changes) atomically. */
  const finalize = useCallback(
    async (s: Session, extra: { putPending?: PendingRealert[]; deletePending?: string[] } = {}) => {
      stopAlertEffects();
      const report = buildReport(s, {
        reportId: A.newId('RPT'),
        terminalId: settingsRef.current.terminalId,
        now: Date.now(),
      });
      setActive(s);
      setReports((rs) => [report, ...rs.filter((r) => r.sessionId !== s.id)]);
      setPending((ps) => {
        const del = new Set(extra.deletePending ?? []);
        return [...ps.filter((p) => !del.has(p.id)), ...(extra.putPending ?? [])];
      });
      await safe(() => storageRef.current.commit({ session: s, report, ...extra }));
      return report;
    },
    [safe, setActive, stopAlertEffects],
  );

  const raise = useCallback(
    async (s: Session, extra: { deletePending?: string[]; alarm?: Alarm } = {}) => {
      setActive(s);
      await safe(() => storageRef.current.commit({ session: s, ...extra }));
      startAlertEffects(s);
      navigate('/alert/' + s.id);
    },
    [navigate, safe, setActive, startAlertEffects],
  );

  /* ---------- scheduler callbacks ---------- */
  const persistWatermark = useCallback((t: number, force = false) => {
    watermarkRef.current = t;
    if (force || t - lastPersistRef.current > 15000) {
      lastPersistRef.current = t;
      void storageRef.current.setMeta('lastTickAt', t).catch(() => {});
    }
  }, []);

  const disableOneTime = useCallback(
    async (ids: string[]) => {
      const targets = alarmsRef.current.filter((a) => ids.includes(a.id) && a.weekdays.length === 0 && a.enabled);
      for (const a of targets) {
        const next = { ...a, enabled: false, revision: a.revision + 1 };
        setAlarms((as) => as.map((x) => (x.id === a.id ? next : x)));
        await safe(() => storageRef.current.putAlarm(next));
      }
    },
    [safe],
  );

  const onDue = useCallback(
    async (due: { at: number; alarmIds: string[]; late: number }) => {
      persistWatermark(Math.max(due.at, watermarkRef.current), true);
      const live = activeRef.current;
      const t = Date.now();
      if (isLive(live)) {
        // Concurrent alarms merge into the running incident.
        const merged: Session = {
          ...A.logEvent(live, undefined, '동시 발생 경보를 현재 사건에 통합', t),
          alarmIds: Array.from(new Set([...live.alarmIds, ...due.alarmIds])),
        };
        setActive(merged);
        await safe(() => storageRef.current.putSession(merged));
        await disableOneTime(due.alarmIds);
        return;
      }
      const list = alarmsRef.current.filter((a) => due.alarmIds.includes(a.id));
      if (list.length === 0) return;
      const snapshot = A.mergeSnapshot(list);
      let s = A.createScheduledSession({ at: due.at, now: t, alarmIds: due.alarmIds, snapshot, seed: A.newSeed() });
      if (due.late > 60000) s = A.logEvent(s, undefined, `앱 재실행으로 ${Math.round(due.late / 60000)}분 지연 발생`, t);
      await raise(s);
      await disableOneTime(due.alarmIds);
    },
    [disableOneTime, persistWatermark, raise, safe, setActive],
  );

  const onPendingDue = useCallback(
    async (p: PendingRealert) => {
      setPending((ps) => ps.filter((x) => x.id !== p.id));
      const live = activeRef.current;
      const t = Date.now();
      if (isLive(live)) {
        const merged = A.logEvent(live, undefined, '재경보 시각 도래 — 진행 중 사건에 통합', t);
        setActive(merged);
        await safe(() => storageRef.current.commit({ session: merged, deletePending: [p.id] }));
        return;
      }
      const s = A.createSessionFromPending(p, t, A.newSeed());
      await raise(s, { deletePending: [p.id] });
    },
    [raise, safe, setActive],
  );

  const onMissed = useCallback(
    async (m: { at: number; alarmIds: string[] }) => {
      void storageRef.current.setMeta('lastMissed', m).catch(() => {});
      await disableOneTime(m.alarmIds);
    },
    [disableOneTime],
  );

  const cbRef = useRef({ onDue, onPendingDue, onMissed });
  cbRef.current = { onDue, onPendingDue, onMissed };

  /* ---------- init ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        storageRef.current = await openStorage();
      } catch (e) {
        setStorageError(errText(e));
      }
      const st = storageRef.current;
      const load = async <T,>(fn: () => Promise<T>, fb: T) => (await safe(fn)) ?? fb;
      let s = await load(() => st.getSettings(), null);
      if (!s) {
        s = defaultSettings();
        await safe(() => st.putSettings(s!));
      }
      const [as, ps, rs, ss, wm] = await Promise.all([
        load(() => st.listAlarms(), [] as Alarm[]),
        load(() => st.listPending(), [] as PendingRealert[]),
        load(() => st.listReports(), [] as Report[]),
        load(() => st.listSessions(), [] as Session[]),
        load(() => st.getMeta<number>('lastTickAt'), undefined),
      ]);
      if (cancelled) return;
      setSettings(s);
      settingsRef.current = s;
      setAlarms(as);
      alarmsRef.current = as;
      setPending(ps);
      pendingRef.current = ps;
      setReports(rs.sort((a, b) => b.createdAt - a.createdAt));
      watermarkRef.current = wm ?? 0;
      lastPersistRef.current = wm ?? 0;

      // Recover a live incident left from a previous run.
      const live = ss.filter(isLive).sort((a, b) => b.startedAt - a.startedAt);
      const t = Date.now();
      for (const old of live.slice(1)) {
        await finalize(A.timeout(old, t));
      }
      const top = live[0];
      if (top) {
        if (t - top.startedAt >= ALERT_MAX_MS) {
          await finalize(A.timeout(top, t));
          setActive(null);
        } else {
          setActive(top);
          startAlertEffects(top);
          navigate('/alert/' + top.id);
        }
      }

      const sched = createScheduler({
        now: () => Date.now(),
        getWatermark: () => watermarkRef.current,
        setWatermark: (v) => persistWatermark(v),
        onDue: (d) => void cbRef.current.onDue(d),
        onPendingDue: (p) => void cbRef.current.onPendingDue(p),
        onMissed: (m) => void cbRef.current.onMissed(m),
      });
      sched.update(as, ps);
      sched.start();
      schedulerRef.current = sched;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      schedulerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    schedulerRef.current?.update(alarms, pending);
  }, [alarms, pending]);

  /* ---------- clock + 30-minute cap ---------- */
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      const live = activeRef.current;
      if (isLive(live) && t - live.startedAt >= ALERT_MAX_MS) {
        void finalize(A.timeout(live, t));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [finalize]);

  /* ---------- environment listeners ---------- */
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    const onOnline = () => setOnline(navigator.onLine);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMq = () => setSystemReduced(!!mq?.matches);
    mq?.addEventListener?.('change', onMq);
    const offAudio = audio.onChange(() => {
      if (wantSirenRef.current && audio.unlocked && !audio.sounding) audio.startSiren();
      setAudioState({ unlocked: audio.unlocked, sounding: audio.sounding });
    });
    const offWake = wake.onChange(() => setWakeActive(wake.active));
    const offInstall = pwa.onInstallAvailabilityChange(setCanPrompt);
    const onSwMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; sessionId?: string } | undefined;
      if (d?.type === 'rem-open' && d.sessionId) navigate('/alert/' + d.sessionId);
    };
    navigator.serviceWorker?.addEventListener?.('message', onSwMsg);
    if (import.meta.env.PROD) {
      const reg = pwa.registerServiceWorker(() => setUpdateAvailable(true));
      updateRef.current = reg.applyUpdate;
    }
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
      mq?.removeEventListener?.('change', onMq);
      offAudio();
      offWake();
      offInstall();
      navigator.serviceWorker?.removeEventListener?.('message', onSwMsg);
    };
  }, [audio, wake, navigate]);

  /* ---------- session operations ---------- */
  const current = useCallback(async (id: string): Promise<Session | null> => {
    if (activeRef.current?.id === id) return activeRef.current;
    return (await storageRef.current.getSession(id).catch(() => null)) ?? null;
  }, []);

  const mutate = useCallback(
    async (id: string, fn: (s: Session, t: number) => Session) => {
      const s = await current(id);
      if (!s) return null;
      const next = fn(s, Date.now());
      if (next === s) return s;
      if (next.status === 'recovered' && s.status !== 'recovered') {
        await finalize(next);
      } else {
        setActive(next);
        await safe(() => storageRef.current.putSession(next));
      }
      return next;
    },
    [current, finalize, safe, setActive],
  );

  const api: RemApi = {
    ready,
    now,
    storageError,
    settings,
    reducedMotion:
      settings.display.reducedMotion === 'on' || (settings.display.reducedMotion === 'system' && systemReduced),
    updateSettings: async (patch) => {
      const next: Settings = {
        ...settingsRef.current,
        ...patch,
        display: { ...settingsRef.current.display, ...(patch.display ?? {}) },
        diagnostics: { ...settingsRef.current.diagnostics, ...(patch.diagnostics ?? {}) },
      };
      settingsRef.current = next;
      setSettings(next);
      await safe(() => storageRef.current.putSettings(next));
    },

    alarms,
    validateAlarm: (a) => A.validateAlarm(a),
    newAlarmDraft: () => A.createAlarmDraft(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    saveAlarm: async (a) => {
      const errors = A.validateAlarm(a);
      if (errors.length) throw new Error(errors.join('\n'));
      const exists = alarmsRef.current.find((x) => x.id === a.id);
      const next: Alarm = { ...a, revision: (exists?.revision ?? 0) + 1 };
      await storageRef.current.putAlarm(next).catch((e) => {
        setStorageError(errText(e));
        throw new Error(errText(e));
      });
      setStorageError(null);
      setAlarms((as) => (exists ? as.map((x) => (x.id === a.id ? next : x)) : [...as, next]));
    },
    deleteAlarm: async (id) => {
      setAlarms((as) => as.filter((a) => a.id !== id));
      // Re-alerts that came only from this schedule are removed with it.
      const orphan = pendingRef.current
        .filter((p) => p.alarmIds.length > 0 && p.alarmIds.every((x) => x === id))
        .map((p) => p.id);
      if (orphan.length) setPending((ps) => ps.filter((p) => !orphan.includes(p.id)));
      await safe(async () => {
        await storageRef.current.deleteAlarm(id);
        if (orphan.length) await storageRef.current.commit({ deletePending: orphan });
      });
    },
    setAlarmEnabled: async (id, enabled) => {
      const a = alarmsRef.current.find((x) => x.id === id);
      if (!a) return;
      const next = { ...a, enabled, revision: a.revision + 1 };
      setAlarms((as) => as.map((x) => (x.id === id ? next : x)));
      await safe(() => storageRef.current.putAlarm(next));
    },

    nextAlert: A.computeNextAlert(alarms, pending, now),
    pending,
    cancelPending: async (id) => {
      setPending((ps) => ps.filter((p) => p.id !== id));
      await safe(() => storageRef.current.deletePending(id));
    },

    activeSession,
    getSession: current,
    startSimulation: async ({ level, modules }: { level: Level; modules: ModuleId[] }) => {
      if (isLive(activeRef.current) && activeRef.current.mode === 'real') {
        throw new Error('진행 중인 실제 경보가 있어 훈련을 시작할 수 없습니다.');
      }
      void audio.unlock();
      const s = A.createSimulationSession({ now: Date.now(), level, modules, seed: A.newSeed() });
      await raise(s);
      return s.id;
    },
    beginRecovery: async (id) => {
      void audio.unlock().then(() => {
        if (isLive(activeRef.current) && !audio.sounding) audio.startSiren();
      });
      await mutate(id, (s, t) => A.beginRecovery(s, t));
    },
    startModule: async (id, m) => {
      await mutate(id, (s, t) => A.startModule(s, m, t));
    },
    recordFailure: async (id, m, msg) => {
      audio.playError();
      await mutate(id, (s, t) => A.recordFailure(s, m, msg, t));
    },
    logEvent: async (id, m, msg) => {
      await mutate(id, (s, t) => A.logEvent(s, m, msg, t));
    },
    completeModule: async (id, m, r: MissionResult) => {
      audio.playSuccess();
      await mutate(id, (s, t) => A.completeModule(s, m, r, t));
    },
    emergencyStop: async (id) => {
      const s = await current(id);
      if (!s) throw new Error('사건을 찾을 수 없습니다.');
      const { session, pending: p } = A.emergencyStop(s, Date.now());
      const report = await finalize(session, p ? { putPending: [p] } : {});
      return { realertAt: p?.at ?? null, reportId: report.id };
    },
    cancelSession: async (id) => {
      const s = await current(id);
      if (!s) throw new Error('사건을 찾을 수 없습니다.');
      const ended = A.cancel(s, Date.now());
      const lineage = pendingRef.current.filter((p) => p.lineageId === s.lineageId).map((p) => p.id);
      const report = await finalize(ended, { deletePending: lineage });
      return { reportId: report.id };
    },
    requestSnooze: async (id) => {
      const s = await current(id);
      if (!s) return null;
      const { session, pending: p } = A.snooze(s, Date.now());
      if (!p) return null;
      setActive(session);
      setPending((ps) => [...ps, p]);
      await safe(() => storageRef.current.commit({ session, putPending: [p] }));
      return p.at;
    },
    reportIdForSession: (sid) => reports.find((r) => r.sessionId === sid)?.id ?? null,
    dismissSession: () => {
      if (!isLive(activeRef.current)) setActive(null);
    },

    reports,
    getReport: (id) => reports.find((r) => r.id === id),
    deleteReport: async (id) => {
      setReports((rs) => rs.filter((r) => r.id !== id));
      await safe(() => storageRef.current.deleteReport(id));
    },
    clearAllData: async () => {
      stopAlertEffects();
      await safe(() => storageRef.current.clearAll());
      const fresh = { ...defaultSettings(), introSeen: true };
      await safe(() => storageRef.current.putSettings(fresh));
      settingsRef.current = fresh;
      setSettings(fresh);
      setAlarms([]);
      setPending([]);
      setReports([]);
      setActive(null);
      watermarkRef.current = Date.now();
      setStorageError(null);
    },

    audio: {
      unlocked: audioState.unlocked,
      sounding: audioState.sounding,
      unlock: async () => {
        const ok = await audio.unlock();
        if (ok && isLive(activeRef.current) && !audio.sounding) audio.startSiren();
        return ok;
      },
    },
    pwa: {
      standalone: pwa.isStandalone(),
      platform: pwa.detectPlatform() as Platform,
      canPrompt,
      promptInstall: () => pwa.promptInstall(),
      updateAvailable,
      applyUpdate: () => updateRef.current(),
      online,
    },
    wakeLock: {
      supported: wake.supported,
      active: wakeActive,
      request: () => wake.request(),
      release: () => wake.release(),
    },
    diagnostics,
    navigate,
    route,
  };

  return <RemContext.Provider value={api}>{children}</RemContext.Provider>;
}
