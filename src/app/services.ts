/**
 * Service module contracts. Implementations live in:
 *   src/storage/index.ts  → openStorage, StorageError  (implements RemStorage)
 *   src/alarm/index.ts    → schedule + session reducers + createScheduler (pure; no React)
 *   src/alarm/audio.ts    → createAudioEngine (AudioEngine)
 *   src/alarm/vibration.ts→ vibration helpers
 *   src/pwa/index.ts      → install/standalone/platform, SW registration, wake lock, notifications, diagnostics
 *   public/sw-notify.js   → imported into the generated service worker (notificationclick → focus/open '#/alert/<id>')
 * RemProvider (src/app/RemProvider.tsx) is the ONLY consumer that wires these together.
 * UI (src/ui) must not import src/storage / src/alarm / src/pwa directly — use useRem().
 */
import type {
  Alarm,
  AlarmSnapshot,
  DiagnosticsApi,
  Level,
  MissionResult,
  ModuleId,
  NextAlert,
  PendingRealert,
  Platform,
  Report,
  Session,
  Settings,
} from './contracts';

/* ---------- storage (IndexedDB "rem-terminal", v1) ----------
 * stores: alarms(id), sessions(id), reports(id), settings(key='settings'), pending(id), meta(key)
 * Every write is a single transaction. Quota → StorageError('quota'); IDB missing/blocked (private mode) → 'unavailable'.
 */
export interface RemStorage {
  listAlarms(): Promise<Alarm[]>;
  putAlarm(a: Alarm): Promise<void>;
  deleteAlarm(id: string): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  putSession(s: Session): Promise<void>;
  listSessions(): Promise<Session[]>;
  listReports(): Promise<Report[]>;
  putReport(r: Report): Promise<void>;
  deleteReport(id: string): Promise<void>;
  getSettings(): Promise<Settings | null>;
  putSettings(s: Settings): Promise<void>;
  listPending(): Promise<PendingRealert[]>;
  putPending(p: PendingRealert): Promise<void>;
  deletePending(id: string): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Saves session + optional report + pending changes atomically in ONE transaction. */
  commit(ops: {
    session?: Session;
    report?: Report;
    putPending?: PendingRealert[];
    deletePending?: string[];
    alarm?: Alarm;
  }): Promise<void>;
  clearAll(): Promise<void>;
}
export type OpenStorage = () => Promise<RemStorage>;

/* ---------- alarm (pure functions; `now`/times are epoch ms) ---------- */
export interface AlarmModule {
  createAlarmDraft(now: number, timezone: string): Alarm;
  /** Korean messages; [] if valid. Checks HH:MM, weekdays, level, moduleCount 1–5, manual list length === moduleCount
   *  and distinct, random pool size >= moduleCount, minutes/limits 1–10. */
  validateAlarm(a: Alarm): string[];
  /** First occurrence strictly AFTER `after` (ms), honoring alarm.timezone (DST-safe via Intl). null if disabled
   *  or a one-time alarm whose time has passed relative to createdAt-based rule (one-time = next occurrence after `after`). */
  nextOccurrence(a: Alarm, after: number): number | null;
  /** Earliest of enabled alarms' next occurrence and pending re-alerts. Merges same-minute alarms. */
  computeNextAlert(alarms: Alarm[], pending: PendingRealert[], now: number): NextAlert | null;
  /** Occurrences with at in (from, to]. Same-minute alarms merged into one entry. */
  dueOccurrences(alarms: Alarm[], from: number, to: number): { at: number; alarmIds: string[] }[];
  /** Merge policy: highest level wins; tie → earliest createdAt. */
  mergeSnapshot(alarms: Alarm[]): AlarmSnapshot;
  /** Resolve module order: manual → allowedModules as-is; random → seeded distinct pick of moduleCount from pool. */
  resolveModules(snapshot: AlarmSnapshot, seed: number): ModuleId[];
  newId(prefix: string): string;
  newSeed(): number;

  // Session reducers — pure, return new objects, never mutate input. All are idempotent on terminal sessions.
  createScheduledSession(p: { at: number; now: number; alarmIds: string[]; snapshot: AlarmSnapshot; seed: number }): Session;
  createSessionFromPending(p: PendingRealert, now: number, seed: number): Session;
  createSimulationSession(p: { now: number; level: Level; modules: ModuleId[]; seed: number }): Session;
  beginRecovery(s: Session, now: number): Session;
  startModule(s: Session, m: ModuleId, now: number): Session;
  recordFailure(s: Session, m: ModuleId, message: string, now: number): Session;
  logEvent(s: Session, m: ModuleId | undefined, message: string, now: number): Session;
  /** Marks module complete; when all complete → status 'recovered', endedAt set. */
  completeModule(s: Session, m: ModuleId, r: MissionResult, now: number): Session;
  /** emergencyCount+1. If real && count <= emergencyLimit → 'deferred' + PendingRealert at now+emergencyMinutes.
   *  If limit exceeded (count would exceed limit) → 'failed', pending null. Simulation → 'deferred', pending null. */
  emergencyStop(s: Session, now: number): { session: Session; pending: PendingRealert | null };
  cancel(s: Session, now: number): Session;
  /** 30-minute cap → 'failed' with 'timeout' event. */
  timeout(s: Session, now: number): Session;
  /** Only for status 'recovered', real mode, snapshot.allowSnooze and snoozeCount < snoozeLimit. */
  snooze(s: Session, now: number): { session: Session; pending: PendingRealert | null };
}

export interface SchedulerOptions {
  now: () => number;
  /** Persisted watermark of the last processed time (ms). Provider loads/saves it via storage meta 'lastTickAt'. */
  getWatermark: () => number;
  setWatermark: (t: number) => void;
  /** A scheduled occurrence is due. `late` = ms after its time. Occurrences later than MISSED_GRACE_MS are reported via onMissed instead. */
  onDue: (due: { at: number; alarmIds: string[]; late: number }) => void;
  onPendingDue: (p: PendingRealert, late: number) => void;
  onMissed: (missed: { at: number; alarmIds: string[] }) => void;
  intervalMs?: number; // default 1000
}
export interface Scheduler {
  /** Replace the scheduler's view of alarms/pending (call after every change). */
  update(alarms: Alarm[], pending: PendingRealert[]): void;
  /** Start ticking. Also ticks immediately on visibilitychange→visible. */
  start(): void;
  stop(): void;
  /** Run one check now (used by tests with a fake clock). */
  tick(): void;
}
export type CreateScheduler = (o: SchedulerOptions) => Scheduler;

/* ---------- audio (src/alarm/audio.ts) — Web Audio only, no external files ---------- */
export interface AudioEngine {
  readonly unlocked: boolean;
  /** Must be called inside a user gesture. Resumes/creates AudioContext. */
  unlock(): Promise<boolean>;
  /** Strong repeating siren until stopSiren(). No-op (returns false) if locked. */
  startSiren(): boolean;
  stopSiren(): void;
  readonly sounding: boolean;
  playSuccess(): void;
  playError(): void;
  testTone(): Promise<boolean>;
  onChange(cb: () => void): () => void;
}
export type CreateAudioEngine = () => AudioEngine;

/* ---------- vibration (src/alarm/vibration.ts) ---------- */
export interface VibrationModule {
  vibrationSupported(): boolean;
  /** Repeating pattern while alerting (re-issued every few seconds). */
  startAlarmVibration(): boolean;
  stopAlarmVibration(): void;
  vibrateOnce(ms: number): boolean;
}

/* ---------- pwa (src/pwa/index.ts) ---------- */
export interface PwaModule {
  isStandalone(): boolean;
  detectPlatform(): Platform;
  /** Subscribes to beforeinstallprompt availability. */
  onInstallAvailabilityChange(cb: (available: boolean) => void): () => void;
  promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** virtual:pwa-register based. */
  registerServiceWorker(onNeedRefresh: () => void): { applyUpdate: () => void };
  createWakeLock(): {
    supported: boolean;
    readonly active: boolean;
    request(): Promise<boolean>;
    release(): Promise<void>;
    onChange(cb: () => void): () => void;
  };
  /** Local notification via SW registration (works only while the page/SW is alive). tag = 'rem-alert'. */
  showAlertNotification(sessionId: string, title: string, body: string): Promise<boolean>;
  closeAlertNotifications(): Promise<void>;
  createDiagnostics(audio: AudioEngine): DiagnosticsApi;
}
