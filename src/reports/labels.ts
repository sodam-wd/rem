import { LEVEL_LABEL } from '../app/contracts';
import type { Level, ModuleId, ReportStatus, SessionEventType, SessionMode } from '../app/contracts';

/** Document-side module names (kept here so reports do not depend on mission components). */
export const MODULE_LABEL: Record<ModuleId, { ko: string; instrument: string }> = {
  POWER: { ko: '배전 복구', instrument: '배전반 단자대' },
  SIGNAL: { ko: '신호 동기화', instrument: '오실로스코프' },
  MEMORY: { ko: '기억 장치 진단', instrument: '메모리 진단 격자' },
  GRAVITY: { ko: '자세 보정', instrument: '항공 자세계' },
  ACCESS: { ko: '출입 인증', instrument: '물리 키패드' },
};

export const STATUS_LABEL: Record<ReportStatus, { ko: string; en: string }> = {
  recovered: { ko: '정상 복구', en: 'RECOVERED' },
  deferred: { ko: '복구 유예', en: 'DEFERRED' },
  failed: { ko: '복구 실패', en: 'FAILED' },
  cancelled: { ko: '안전 취소', en: 'CANCELLED' },
};

export const MODE_LABEL: Record<SessionMode, string> = {
  real: '실제 경보',
  simulation: '훈련',
};

/** Incident grade text derived from the difficulty level (e.g. "L2 · 보통"). */
export const LEVEL_GRADE: Record<Level, string> = {
  1: `L1 · ${LEVEL_LABEL[1].ko}`,
  2: `L2 · ${LEVEL_LABEL[2].ko}`,
  3: `L3 · ${LEVEL_LABEL[3].ko}`,
};

export const EVENT_LABEL: Record<SessionEventType, string> = {
  scheduled: '예약',
  alert: '경보',
  'recovery-start': '복구 개시',
  'module-start': '모듈 시작',
  'module-fail': '모듈 오류',
  'module-complete': '모듈 완료',
  emergency: '긴급 종료',
  snooze: '재경보',
  cancel: '안전 취소',
  timeout: '시간 초과',
  recovered: '복구 완료',
  note: '기록',
};

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fmtTime(ts: number, seconds = true): string {
  const d = new Date(ts);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${hm}:${pad(d.getSeconds())}` : hm;
}
export function fmtDateTime(ts: number): string {
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}
/** "00:04:12" style elapsed time. */
export function fmtElapsed(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '--:--:--';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
