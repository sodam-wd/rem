/**
 * Alarm engine: schedule math, session reducers, and the client-side scheduler.
 * Pure (no React). External push is on hold: alarms fire only while the app runs.
 */
import {
  LIMITS,
  MISSED_GRACE_MS,
  MODULE_IDS,
  type Alarm,
  type AlarmSnapshot,
  type Level,
  type MissionResult,
  type ModuleAttempt,
  type ModuleId,
  type NextAlert,
  type PendingRealert,
  type Session,
  type SessionEvent,
  type SessionEventType,
} from '../app/contracts';
import type { AlarmModule, CreateScheduler, Scheduler } from '../app/services';
import { addDays, isValidTimeZone, safeTimeZone, wallParts, wallToEpoch } from './time';

const MINUTE = 60_000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Safety cap for occurrence enumeration over long windows. */
const MAX_OCCURRENCES_PER_ALARM = 500;

/* ------------------------------------------------------------------ ids / seeds */

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomHex(6)}`;
}

function newSeed(): number {
  const arr = new Uint32Array(1);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else arr[0] = Math.floor(Math.random() * 0x1_0000_0000);
  return arr[0] >>> 0;
}

/** mulberry32 PRNG — deterministic for a given seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ alarm config */

function createAlarmDraft(now: number, timezone: string): Alarm {
  return {
    id: newId('alm'),
    timeHHMM: '07:00',
    weekdays: [1, 2, 3, 4, 5],
    enabled: true,
    timezone: safeTimeZone(timezone),
    label: '',
    level: 1,
    selectionMode: 'random',
    allowedModules: [...MODULE_IDS],
    moduleCount: 3,
    allowSnooze: false,
    snoozeMinutes: 5,
    snoozeLimit: 1,
    emergencyMinutes: 5,
    emergencyLimit: 3,
    createdAt: now,
    revision: 0,
  };
}

function isIntIn(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function validateAlarm(a: Alarm): string[] {
  const errors: string[] = [];
  if (typeof a.timeHHMM !== 'string' || !TIME_RE.test(a.timeHHMM)) {
    errors.push('시각 형식이 올바르지 않습니다. HH:MM(00:00~23:59) 형식으로 입력하십시오.');
  }
  if (
    !Array.isArray(a.weekdays) ||
    a.weekdays.some((w) => !isIntIn(w, 0, 6)) ||
    new Set(a.weekdays).size !== a.weekdays.length
  ) {
    errors.push('요일 설정이 올바르지 않습니다.');
  }
  if (!isValidTimeZone(a.timezone)) errors.push('시간대 정보가 올바르지 않습니다.');
  if (a.level !== 1 && a.level !== 2 && a.level !== 3) errors.push('난이도는 1~3단계 중 하나여야 합니다.');
  const countOk = isIntIn(a.moduleCount, LIMITS.minModules, LIMITS.maxModules);
  if (!countOk) errors.push(`복구 모듈 수는 ${LIMITS.minModules}~${LIMITS.maxModules}개여야 합니다.`);

  const mods = Array.isArray(a.allowedModules) ? a.allowedModules : [];
  if (!Array.isArray(a.allowedModules) || mods.some((m) => !MODULE_IDS.includes(m))) {
    errors.push('알 수 없는 복구 모듈이 포함되어 있습니다.');
  }
  const distinct = new Set(mods).size === mods.length;
  if (a.selectionMode === 'manual') {
    if (!distinct) errors.push('같은 복구 모듈을 중복 선택할 수 없습니다.');
    if (countOk && mods.length !== a.moduleCount) {
      errors.push(`직접 선택한 모듈(${mods.length}개)이 설정한 모듈 수(${a.moduleCount}개)와 일치해야 합니다.`);
    }
  } else if (a.selectionMode === 'random') {
    if (!distinct) errors.push('랜덤 허용 모듈 목록에 중복이 있습니다.');
    if (countOk && new Set(mods).size < a.moduleCount) {
      errors.push(`랜덤 허용 모듈(${new Set(mods).size}개)이 설정한 모듈 수(${a.moduleCount}개)보다 적습니다.`);
    }
  } else {
    errors.push('모듈 선택 방식이 올바르지 않습니다.');
  }

  const range = `${LIMITS.minMinutes}~${LIMITS.maxMinutes}`;
  const rep = `${LIMITS.minRepeat}~${LIMITS.maxRepeat}`;
  if (typeof a.allowSnooze !== 'boolean') errors.push('다시 울리기 허용 여부가 올바르지 않습니다.');
  if (!isIntIn(a.snoozeMinutes, LIMITS.minMinutes, LIMITS.maxMinutes)) errors.push(`다시 울리기 간격은 ${range}분이어야 합니다.`);
  if (!isIntIn(a.snoozeLimit, LIMITS.minRepeat, LIMITS.maxRepeat)) errors.push(`다시 울리기 횟수는 ${rep}회여야 합니다.`);
  if (!isIntIn(a.emergencyMinutes, LIMITS.minMinutes, LIMITS.maxMinutes)) errors.push(`긴급 종료 후 재경보 간격은 ${range}분이어야 합니다.`);
  if (!isIntIn(a.emergencyLimit, LIMITS.minRepeat, LIMITS.maxRepeat)) errors.push(`긴급 종료 횟수 상한은 ${rep}회여야 합니다.`);
  return errors;
}

/* ------------------------------------------------------------------ schedule math */

function nextOccurrence(a: Alarm, after: number): number | null {
  if (!a.enabled) return null;
  const m = TIME_RE.exec(a.timeHHMM);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const tz = safeTimeZone(a.timezone);
  const days = new Set<number>(a.weekdays ?? []);
  const base = wallParts(after, tz);
  for (let i = 0; i <= 8; i++) {
    const day = addDays(base.y, base.mo, base.d, i);
    if (days.size > 0 && !days.has(day.wd)) continue;
    const t = wallToEpoch(day.y, day.mo, day.d, hh, mm, tz);
    if (t > after) return t;
  }
  return null;
}

function minuteKey(t: number): number {
  return Math.floor(t / MINUTE);
}

function dueOccurrences(alarms: Alarm[], from: number, to: number): { at: number; alarmIds: string[] }[] {
  const groups = new Map<number, { at: number; alarmIds: string[] }>();
  if (!(to > from)) return [];
  for (const a of alarms) {
    if (!a.enabled) continue;
    const oneTime = !a.weekdays || a.weekdays.length === 0;
    let t = nextOccurrence(a, from);
    let n = 0;
    while (t !== null && t <= to && n < MAX_OCCURRENCES_PER_ALARM) {
      const k = minuteKey(t);
      const g = groups.get(k);
      if (g) {
        if (!g.alarmIds.includes(a.id)) g.alarmIds.push(a.id);
        g.at = Math.min(g.at, t);
      } else groups.set(k, { at: t, alarmIds: [a.id] });
      n++;
      if (oneTime) break;
      t = nextOccurrence(a, t);
    }
  }
  return [...groups.values()].sort((x, y) => x.at - y.at);
}

function computeNextAlert(alarms: Alarm[], pending: PendingRealert[], now: number): NextAlert | null {
  let best: { at: number; alarmIds: string[] } | null = null;
  for (const a of alarms) {
    const t = nextOccurrence(a, now);
    if (t === null) continue;
    if (!best || minuteKey(t) < minuteKey(best.at)) best = { at: t, alarmIds: [a.id] };
    else if (minuteKey(t) === minuteKey(best.at)) {
      best.at = Math.min(best.at, t);
      best.alarmIds.push(a.id);
    }
  }
  let bestPending: PendingRealert | null = null;
  for (const p of pending) if (!bestPending || p.at < bestPending.at) bestPending = p;
  // Pending re-alert takes priority on ties (it is a continuation of an open incident).
  if (bestPending && (!best || bestPending.at <= best.at)) {
    return { at: bestPending.at, kind: bestPending.kind, alarmIds: [...bestPending.alarmIds] };
  }
  return best ? { at: best.at, kind: 'scheduled', alarmIds: best.alarmIds } : null;
}

function mergeSnapshot(alarms: Alarm[]): AlarmSnapshot {
  if (alarms.length === 0) throw new Error('mergeSnapshot: no alarms');
  const winner = [...alarms].sort((x, y) => y.level - x.level || x.createdAt - y.createdAt)[0];
  const { enabled: _e, revision: _r, ...snap } = winner;
  return { ...snap, weekdays: [...snap.weekdays], allowedModules: [...snap.allowedModules] };
}

function resolveModules(snapshot: AlarmSnapshot, seed: number): ModuleId[] {
  const pool = Array.from(new Set(snapshot.allowedModules.filter((m) => MODULE_IDS.includes(m))));
  const count = Math.max(LIMITS.minModules, Math.min(LIMITS.maxModules, Math.floor(snapshot.moduleCount)));
  if (snapshot.selectionMode === 'manual') return pool.slice(0, count);
  const rnd = prng(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/* ------------------------------------------------------------------ session reducers */

const TERMINAL = new Set(['recovered', 'deferred', 'failed', 'cancelled']);
export function isTerminal(s: Session): boolean {
  return TERMINAL.has(s.status);
}

function ev(at: number, type: SessionEventType, message: string, module?: ModuleId): SessionEvent {
  return module ? { at, type, module, message } : { at, type, message };
}

function withEvent(s: Session, e: SessionEvent, patch: Partial<Session> = {}): Session {
  return { ...s, ...patch, events: [...s.events, e], revision: s.revision + 1 };
}

function fmtHHMM(t: number, tz: string): string {
  const p = wallParts(t, safeTimeZone(tz));
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

function createScheduledSession(p: {
  at: number;
  now: number;
  alarmIds: string[];
  snapshot: AlarmSnapshot;
  seed: number;
}): Session {
  const id = newId('ses');
  const merged = p.alarmIds.length > 1 ? ` (일정 ${p.alarmIds.length}건 통합)` : '';
  return {
    id,
    lineageId: id,
    origin: 'scheduled',
    alarmIds: [...p.alarmIds],
    snapshot: p.snapshot,
    scheduledAt: p.at,
    startedAt: p.now,
    mode: 'real',
    status: 'alerting',
    level: p.snapshot.level,
    modules: resolveModules(p.snapshot, p.seed),
    seed: p.seed,
    completed: [],
    attempts: [],
    events: [ev(p.now, 'alert', `경보 발생 — 정기 일정 ${fmtHHMM(p.at, p.snapshot.timezone)}${merged}`)],
    emergencyCount: 0,
    snoozeCount: 0,
    revision: 0,
  };
}

function createSessionFromPending(p: PendingRealert, now: number, seed: number): Session {
  const msg =
    p.kind === 'emergency'
      ? `재경보 발생 — 긴급 종료 후 재경보 (${p.emergencyCount}/${p.snapshot.emergencyLimit})`
      : `재경보 발생 — 다시 울리기 (${p.snoozeCount}/${p.snapshot.snoozeLimit})`;
  return {
    id: newId('ses'),
    lineageId: p.lineageId,
    parentSessionId: p.parentSessionId,
    origin: p.kind,
    alarmIds: [...p.alarmIds],
    snapshot: p.snapshot,
    scheduledAt: p.at,
    startedAt: now,
    mode: 'real',
    status: 'alerting',
    level: p.snapshot.level,
    modules: resolveModules(p.snapshot, seed),
    seed,
    completed: [],
    attempts: [],
    events: [ev(now, 'alert', msg)],
    emergencyCount: p.emergencyCount,
    snoozeCount: p.snoozeCount,
    revision: 0,
  };
}

function createSimulationSession(p: { now: number; level: Level; modules: ModuleId[]; seed: number }): Session {
  const id = newId('sim');
  const modules = Array.from(new Set(p.modules.filter((m) => MODULE_IDS.includes(m))));
  return {
    id,
    lineageId: id,
    origin: 'simulation',
    alarmIds: [],
    snapshot: null,
    scheduledAt: p.now,
    startedAt: p.now,
    mode: 'simulation',
    status: 'alerting',
    level: p.level,
    modules,
    seed: p.seed,
    completed: [],
    attempts: [],
    events: [ev(p.now, 'alert', '훈련 경보 발생 — SIMULATION')],
    emergencyCount: 0,
    snoozeCount: 0,
    revision: 0,
  };
}

function beginRecovery(s: Session, now: number): Session {
  if (s.status !== 'alerting') return s;
  return withEvent(s, ev(now, 'recovery-start', '복구 절차 개시'), { status: 'recovering', recoveryStartedAt: now });
}

function ensureRecovering(s: Session, now: number): Session {
  return s.status === 'alerting' ? beginRecovery(s, now) : s;
}

function openAttemptIndex(s: Session, m: ModuleId): number {
  for (let i = s.attempts.length - 1; i >= 0; i--) {
    const a = s.attempts[i];
    if (a.module === m && !a.completed && a.endedAt === undefined) return i;
  }
  return -1;
}

function canWork(s: Session, m: ModuleId): boolean {
  return !isTerminal(s) && s.modules.includes(m) && !s.completed.includes(m);
}

function startModule(s: Session, m: ModuleId, now: number): Session {
  if (!canWork(s, m)) return s;
  const r = ensureRecovering(s, now);
  if (openAttemptIndex(r, m) >= 0) return r;
  const attempt: ModuleAttempt = { module: m, startedAt: now, failures: 0, completed: false };
  return withEvent(r, ev(now, 'module-start', `${m} 모듈 복구 착수`, m), { attempts: [...r.attempts, attempt] });
}

function recordFailure(s: Session, m: ModuleId, message: string, now: number): Session {
  if (!canWork(s, m)) return s;
  let r = startModule(s, m, now);
  const idx = openAttemptIndex(r, m);
  const attempts = r.attempts.map((a, i) => (i === idx ? { ...a, failures: a.failures + 1 } : a));
  r = { ...r, attempts };
  const detail = message ? ` — ${message}` : '';
  return withEvent(r, ev(now, 'module-fail', `${m} 모듈 조작 오류${detail}`, m));
}

function logEvent(s: Session, m: ModuleId | undefined, message: string, now: number): Session {
  if (isTerminal(s)) return s;
  return withEvent(s, ev(now, 'note', message, m));
}

function completeModule(s: Session, m: ModuleId, r: MissionResult, now: number): Session {
  if (!canWork(s, m)) return s;
  let next = ensureRecovering(s, now);
  let idx = openAttemptIndex(next, m);
  let attempts = next.attempts;
  if (idx < 0) {
    attempts = [...attempts, { module: m, startedAt: Math.max(next.startedAt, now - Math.max(0, r.durationMs)), failures: 0, completed: false }];
    idx = attempts.length - 1;
  }
  attempts = attempts.map((a, i) =>
    i === idx ? { ...a, endedAt: now, completed: true, failures: Math.max(a.failures, r.failures) } : a,
  );
  const completed = [...next.completed, m];
  next = withEvent(next, ev(now, 'module-complete', `${m} 모듈 복구 완료`, m), { attempts, completed });
  if (next.modules.every((x) => completed.includes(x))) {
    next = withEvent(next, ev(now, 'recovered', '전 모듈 복구 완료 — 현실 연결률 100%, 경보 해제'), {
      status: 'recovered',
      endedAt: now,
    });
  }
  return next;
}

function emergencyStop(s: Session, now: number): { session: Session; pending: PendingRealert | null } {
  if (isTerminal(s)) return { session: s, pending: null };
  const count = s.emergencyCount + 1;
  if (s.mode === 'simulation') {
    const session = withEvent(s, ev(now, 'emergency', '긴급 종료 — 훈련 모드이므로 재경보 없음'), {
      status: 'deferred',
      endedAt: now,
      emergencyCount: count,
    });
    return { session, pending: null };
  }
  const snap = s.snapshot;
  if (snap && count <= snap.emergencyLimit) {
    const at = now + snap.emergencyMinutes * MINUTE;
    const session = withEvent(
      s,
      ev(now, 'emergency', `긴급 종료 — ${snap.emergencyMinutes}분 후 재경보 (${count}/${snap.emergencyLimit})`),
      { status: 'deferred', endedAt: now, emergencyCount: count },
    );
    const pending: PendingRealert = {
      id: newId('pnd'),
      at,
      kind: 'emergency',
      lineageId: s.lineageId,
      parentSessionId: s.id,
      snapshot: snap,
      alarmIds: [...s.alarmIds],
      emergencyCount: count,
      snoozeCount: s.snoozeCount,
    };
    return { session, pending };
  }
  const limit = snap?.emergencyLimit ?? 0;
  const session = withEvent(s, ev(now, 'emergency', `긴급 종료 — 재경보 상한(${limit}회) 소진, 복구 실패로 종결`), {
    status: 'failed',
    endedAt: now,
    emergencyCount: count,
  });
  return { session, pending: null };
}

function cancel(s: Session, now: number): Session {
  if (isTerminal(s)) return s;
  return withEvent(s, ev(now, 'cancel', '완전 취소 — 경보 즉시 정지, 같은 사건의 예약 재경보 해제'), {
    status: 'cancelled',
    endedAt: now,
  });
}

function timeout(s: Session, now: number): Session {
  if (isTerminal(s)) return s;
  return withEvent(s, ev(now, 'timeout', '경보 최대 지속 시간(30분) 초과 — 자동 종료, 복구 실패로 종결'), {
    status: 'failed',
    endedAt: now,
  });
}

function snooze(s: Session, now: number): { session: Session; pending: PendingRealert | null } {
  const snap = s.snapshot;
  if (
    s.status !== 'recovered' ||
    s.mode !== 'real' ||
    !snap ||
    !snap.allowSnooze ||
    s.snoozeCount >= snap.snoozeLimit ||
    s.events.some((e) => e.type === 'snooze') // one snooze per session (idempotent)
  ) {
    return { session: s, pending: null };
  }
  const count = s.snoozeCount + 1;
  const session = withEvent(
    s,
    ev(now, 'snooze', `다시 울리기 — ${snap.snoozeMinutes}분 후 재경보 (${count}/${snap.snoozeLimit})`),
    { snoozeCount: count },
  );
  const pending: PendingRealert = {
    id: newId('pnd'),
    at: now + snap.snoozeMinutes * MINUTE,
    kind: 'snooze',
    lineageId: s.lineageId,
    parentSessionId: s.id,
    snapshot: snap,
    alarmIds: [...s.alarmIds],
    emergencyCount: s.emergencyCount,
    snoozeCount: count,
  };
  return { session, pending };
}

export const alarm: AlarmModule = {
  createAlarmDraft,
  validateAlarm,
  nextOccurrence,
  computeNextAlert,
  dueOccurrences,
  mergeSnapshot,
  resolveModules,
  newId,
  newSeed,
  createScheduledSession,
  createSessionFromPending,
  createSimulationSession,
  beginRecovery,
  startModule,
  recordFailure,
  logEvent,
  completeModule,
  emergencyStop,
  cancel,
  timeout,
  snooze,
};

/* ------------------------------------------------------------------ scheduler */

const FIRED_RETENTION_MS = 2 * 86_400_000;

export const createScheduler: CreateScheduler = (o) => {
  let alarms: Alarm[] = [];
  let pending: PendingRealert[] = [];
  /** occurrence key → occurrence time, to prevent duplicate fires (e.g. after a clock moves backwards). */
  const fired = new Map<string, number>();
  const firedPending = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') scheduler.tick();
  };

  const safe = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.error('[rem] scheduler callback failed', e);
    }
  };

  const scheduler: Scheduler = {
    update(a, p) {
      alarms = [...a];
      pending = [...p];
      const ids = new Set(p.map((x) => x.id));
      for (const id of firedPending) if (!ids.has(id)) firedPending.delete(id);
    },
    start() {
      if (timer !== null) return;
      timer = setInterval(() => scheduler.tick(), o.intervalMs ?? 1000);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      scheduler.tick();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
    tick() {
      const now = o.now();
      let wm = o.getWatermark();
      if (!Number.isFinite(wm) || wm <= 0 || now < wm) {
        // First run: ignore the past. Clock moved backwards: restart from now (fired keys block repeats).
        wm = now;
        o.setWatermark(now);
      }
      const dues = now > wm ? dueOccurrences(alarms, wm, now) : [];
      if (now > wm) o.setWatermark(now);

      for (const d of dues) {
        const key = `${d.at}|${[...d.alarmIds].sort().join(',')}`;
        if (fired.has(key)) continue;
        fired.set(key, d.at);
        const late = now - d.at;
        if (late <= MISSED_GRACE_MS) safe(() => o.onDue({ at: d.at, alarmIds: [...d.alarmIds], late }));
        else safe(() => o.onMissed({ at: d.at, alarmIds: [...d.alarmIds] }));
      }
      for (const p of pending) {
        if (p.at <= now && !firedPending.has(p.id)) {
          firedPending.add(p.id);
          safe(() => o.onPendingDue(p, now - p.at));
        }
      }
      for (const [k, at] of fired) if (at < now - FIRED_RETENTION_MS) fired.delete(k);
    },
  };
  return scheduler;
};

