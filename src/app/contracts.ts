/**
 * R.E.M. : Recovery Terminal — shared contracts.
 * Single source of truth for domain types and module interfaces.
 *
 * Alarm policy summary:
 *  - Multiple alarms, weekday repeat (empty weekdays = one-time), level 1|2|3, 1–5 modules.
 *  - selectionMode 'manual' (allowedModules is the exact ordered list, length === moduleCount)
 *    or 'random' (pick moduleCount distinct modules from allowedModules pool; pool >= moduleCount).
 *  - After normal recovery, optional re-alert ("다시 울리기"): allowSnooze, 1–10 min, 1–10 times.
 *  - Emergency stop ("긴급 종료"): re-alert after emergencyMinutes (1–10), at most emergencyLimit (1–10) times.
 *    When the limit is exhausted, emergency stop ends the incident as 'failed' with no re-alert.
 *  - Safe cancel ("완전 취소") is always reachable: stops sound immediately, ends incident as 'cancelled',
 *    removes every pending re-alert of the same lineage.
 *  - An alert auto-stops after ALERT_MAX_MS (30 min) → session 'failed' (finite cap).
 *  - Concurrent alarms in the same minute merge into one incident (highest level wins; tie → earliest createdAt).
 *  - External push server is ON HOLD. Alarms fire only while the app is running.
 */

export type ModuleId = 'POWER' | 'SIGNAL' | 'MEMORY' | 'GRAVITY' | 'ACCESS';
export const MODULE_IDS: readonly ModuleId[] = ['POWER', 'SIGNAL', 'MEMORY', 'GRAVITY', 'ACCESS'];
export type Level = 1 | 2 | 3;
export const LEVEL_LABEL: Record<Level, { ko: string; en: string }> = {
  1: { ko: '쉬움', en: 'LOW' },
  2: { ko: '보통', en: 'MID' },
  3: { ko: '어려움', en: 'HIGH' },
};
/** 0 = Sunday … 6 = Saturday (JS Date.getDay()). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

export const LIMITS = {
  minModules: 1,
  maxModules: 5,
  minMinutes: 1,
  maxMinutes: 10,
  minRepeat: 1,
  maxRepeat: 10,
} as const;
export const ALERT_MAX_MS = 30 * 60 * 1000;
/** Missed occurrences older than this when the app (re)opens are skipped, not fired. */
export const MISSED_GRACE_MS = ALERT_MAX_MS;
export const INTRO_MS = 5600;
export const SIGNAL_HOLD_MS = 2000;

export interface Alarm {
  id: string;
  /** "HH:MM" 24h, local wall-clock time in `timezone`. */
  timeHHMM: string;
  /** Empty array = one-time alarm (auto-disabled after it fires). */
  weekdays: Weekday[];
  enabled: boolean;
  /** IANA timezone captured at creation, e.g. "Asia/Seoul". */
  timezone: string;
  label: string;
  level: Level;
  selectionMode: 'manual' | 'random';
  allowedModules: ModuleId[];
  moduleCount: number;
  allowSnooze: boolean;
  snoozeMinutes: number;
  snoozeLimit: number;
  emergencyMinutes: number;
  emergencyLimit: number;
  createdAt: number;
  revision: number;
}

/** Immutable copy of the alarm config used by a session (settings changes never mutate running incidents). */
export type AlarmSnapshot = Omit<Alarm, 'enabled' | 'revision'>;

export type SessionMode = 'real' | 'simulation';
export type SessionStatus =
  | 'alerting' // sound on, waiting for user
  | 'recovering' // missions in progress (sound continues)
  | 'recovered' // all modules complete
  | 'deferred' // emergency stop with re-alert scheduled
  | 'failed' // emergency limit exhausted, or 30-min cap
  | 'cancelled'; // safe cancel

export type SessionEventType =
  | 'scheduled'
  | 'alert'
  | 'recovery-start'
  | 'module-start'
  | 'module-fail'
  | 'module-complete'
  | 'emergency'
  | 'snooze'
  | 'cancel'
  | 'timeout'
  | 'recovered'
  | 'note';

export interface SessionEvent {
  at: number;
  type: SessionEventType;
  module?: ModuleId;
  message: string;
}

export interface ModuleAttempt {
  module: ModuleId;
  startedAt: number;
  endedAt?: number;
  failures: number;
  completed: boolean;
}

export interface Session {
  id: string;
  /** Root incident id shared by all re-alerts in one chain. */
  lineageId: string;
  parentSessionId?: string;
  /** 'scheduled' | 'snooze' | 'emergency' — why this occurrence exists. */
  origin: 'scheduled' | 'snooze' | 'emergency' | 'simulation';
  alarmIds: string[];
  snapshot: AlarmSnapshot | null; // null for simulation
  scheduledAt: number;
  startedAt: number; // alert start
  recoveryStartedAt?: number;
  endedAt?: number;
  mode: SessionMode;
  status: SessionStatus;
  level: Level;
  modules: ModuleId[]; // ordered, resolved at alert time
  seed: number;
  completed: ModuleId[];
  attempts: ModuleAttempt[];
  events: SessionEvent[];
  /** Counts carried across the lineage. */
  emergencyCount: number;
  snoozeCount: number;
  revision: number;
}

export type ReportStatus = 'recovered' | 'deferred' | 'failed' | 'cancelled';
export type ArchiveFilter = 'all' | 'real' | 'recovered' | 'deferred' | 'failed' | 'simulation';

export interface ModuleResult {
  module: ModuleId;
  durationMs: number | null;
  failures: number;
  result: 'complete' | 'incomplete' | 'not-started';
}

export interface Report {
  id: string;
  /** Official document number, e.g. "REM-20261126-0712-A3F" */
  docNo: string;
  sessionId: string;
  lineageId: string;
  createdAt: number;
  terminalId: string;
  mode: SessionMode;
  status: ReportStatus;
  level: Level;
  summary: string;
  metrics: {
    scheduledAt: number;
    startedAt: number;
    recoveryStartedAt: number | null;
    endedAt: number;
    elapsedMs: number;
    connectionRate: number; // 0–100, completed/total*100 rounded
    totalFailures: number;
    emergencyCount: number;
    snoozeCount: number;
    remainingFaults: number; // modules not completed
  };
  verdict: string; // final judgement text (Korean)
  events: SessionEvent[];
  moduleResults: ModuleResult[];
}

export interface DisplaySettings {
  /** UI brightness 60–100 (%), CSS-level only (not the device brightness). */
  brightness: number;
  scanlines: boolean;
  glow: boolean;
  /** 'system' respects prefers-reduced-motion. */
  reducedMotion: 'system' | 'on' | 'off';
}

export interface Settings {
  schemaVersion: 1;
  /** e.g. "RT-7K2Q" generated on first run */
  terminalId: string;
  introSeen: boolean;
  installPromptDismissedAt: number | null;
  display: DisplaySettings;
  diagnostics: {
    lastRunAt: number | null;
    notification: DiagState;
    vibration: DiagState;
    sensor: DiagState;
    audio: DiagState;
    network: DiagState;
  };
}
export type DiagState = 'unknown' | 'ok' | 'denied' | 'unsupported' | 'failed' | 'manual-ok';

/** A re-alert waiting to fire (snooze or emergency). Persisted. */
export interface PendingRealert {
  id: string;
  at: number;
  kind: 'snooze' | 'emergency';
  lineageId: string;
  parentSessionId: string;
  snapshot: AlarmSnapshot;
  alarmIds: string[];
  emergencyCount: number;
  snoozeCount: number;
}

export interface NextAlert {
  at: number;
  kind: 'scheduled' | 'snooze' | 'emergency';
  alarmIds: string[];
}

/* ---------------- Missions (implemented in src/missions) ---------------- */

export interface MissionResult {
  durationMs: number;
  failures: number;
}

export interface MissionProps {
  level: Level;
  /** Deterministic seed; same seed+level → same puzzle. Regenerate with derived seeds on failure. */
  seed: number;
  /** Called once when the module is solved. */
  onSuccess: (result: MissionResult) => void;
  /** Called on every failed attempt (wrong input). Missions never lock out; failures are unlimited. */
  onFailure: (message: string) => void;
  /** Optional log line for the incident timeline (e.g. "단자 3 연결"). Keep sparse. */
  onLog?: (message: string) => void;
  /** True if user prefers reduced motion. */
  reducedMotion: boolean;
}

export interface MissionDefinition {
  id: ModuleId;
  nameKo: string; // e.g. '배전반 복구'
  nameEn: string; // e.g. 'POWER'
  instrument: string; // e.g. '배전반 단자대'
  /** Short rule text per level for the briefing panel. */
  briefing: Record<Level, string>;
  Component: (props: MissionProps) => import('react').ReactElement | null;
}

/* ---------------- Integration API (implemented by RemProvider in src/app) ---------------- */

export type Platform = 'ios' | 'android' | 'desktop' | 'inapp' | 'other';

export interface DiagnosticsApi {
  network: () => DiagState;
  /** Requests permission if needed (must be called from a user gesture) and shows a local test notification. */
  testNotification: () => Promise<DiagState>;
  /** Vibrates ~600ms if supported. 'unsupported' when API missing (e.g. iOS Safari). */
  testVibration: () => DiagState;
  /** Requests DeviceOrientation permission (iOS) from a gesture; resolves 'ok' once a real event arrives (≤2s). */
  testSensor: () => Promise<DiagState>;
  /** Plays a 1.5s test tone. User then confirms audibility manually. */
  testAudio: () => Promise<DiagState>;
}

export interface RemApi {
  ready: boolean;
  /** Ticks every second. */
  now: number;
  storageError: string | null;

  settings: Settings;
  updateSettings: (patch: Partial<Omit<Settings, 'schemaVersion' | 'terminalId'>>) => Promise<void>;
  /** Resolved reduced-motion flag (settings + media query). */
  reducedMotion: boolean;

  alarms: Alarm[];
  /** Validates and saves (create or update). Throws Error with Korean message on invalid input. */
  saveAlarm: (alarm: Alarm) => Promise<void>;
  deleteAlarm: (id: string) => Promise<void>;
  setAlarmEnabled: (id: string, enabled: boolean) => Promise<void>;
  newAlarmDraft: () => Alarm;
  validateAlarm: (alarm: Alarm) => string[]; // Korean error messages; [] = valid

  nextAlert: NextAlert | null;
  pending: PendingRealert[];
  cancelPending: (id: string) => Promise<void>;

  /** Current non-terminal session (alerting/recovering) or the most recently ended one still on screen. */
  activeSession: Session | null;
  getSession: (id: string) => Promise<Session | null>;
  startSimulation: (opts: { level: Level; modules: ModuleId[] }) => Promise<string>;
  beginRecovery: (sessionId: string) => Promise<void>;
  startModule: (sessionId: string, module: ModuleId) => Promise<void>;
  recordFailure: (sessionId: string, module: ModuleId, message: string) => Promise<void>;
  logEvent: (sessionId: string, module: ModuleId | undefined, message: string) => Promise<void>;
  completeModule: (sessionId: string, module: ModuleId, result: MissionResult) => Promise<void>;
  /** Returns realert time, or null if limit exhausted (incident failed) / simulation. Report is saved. */
  emergencyStop: (sessionId: string) => Promise<{ realertAt: number | null; reportId: string }>;
  /** Safe cancel: immediate stop + clear lineage pending. Report is saved. */
  cancelSession: (sessionId: string) => Promise<{ reportId: string }>;
  /** After 'recovered': schedule one more alert if allowed. Returns time or null if not allowed / exhausted. */
  requestSnooze: (sessionId: string) => Promise<number | null>;
  /** Report id produced for a terminal session, if any. */
  reportIdForSession: (sessionId: string) => string | null;
  dismissSession: () => void;

  reports: Report[];
  getReport: (id: string) => Report | undefined;
  deleteReport: (id: string) => Promise<void>;
  clearAllData: () => Promise<void>;

  audio: {
    unlocked: boolean;
    /** Call from a user gesture. */
    unlock: () => Promise<boolean>;
    /** True while the alarm siren is sounding. */
    sounding: boolean;
  };
  pwa: {
    standalone: boolean;
    platform: Platform;
    /** beforeinstallprompt captured (Chromium). */
    canPrompt: boolean;
    promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
    updateAvailable: boolean;
    applyUpdate: () => void;
    online: boolean;
  };
  wakeLock: {
    supported: boolean;
    active: boolean;
    request: () => Promise<boolean>;
    release: () => Promise<void>;
  };
  diagnostics: DiagnosticsApi;

  navigate: (path: string) => void;
  route: string; // current hash path without '#', e.g. '/schedule'
}
