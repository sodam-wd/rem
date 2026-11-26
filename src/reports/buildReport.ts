import type { ArchiveFilter, ModuleResult, Report, ReportStatus, Session } from '../app/contracts';
import { LEVEL_GRADE, fmtDateTime } from './labels';

const pad = (n: number) => String(n).padStart(2, '0');

function toReportStatus(s: Session): ReportStatus {
  switch (s.status) {
    case 'recovered':
    case 'deferred':
    case 'failed':
    case 'cancelled':
      return s.status;
    default:
      // A non-terminal session should not produce a report; treat as failure if it ever does.
      return 'failed';
  }
}

function docNumber(s: Session, reportId: string): string {
  const d = new Date(s.startedAt);
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const suffix = (reportId.replace(/[^a-zA-Z0-9]/g, '').slice(-3) || '000').toUpperCase().padStart(3, '0');
  return `REM-${ymd}-${hm}-${suffix}`;
}

function moduleResults(s: Session): ModuleResult[] {
  return s.modules.map((module) => {
    const attempts = s.attempts.filter((a) => a.module === module);
    const failures = attempts.reduce((n, a) => n + a.failures, 0);
    const done = s.completed.includes(module);
    if (attempts.length === 0) {
      return { module, durationMs: null, failures, result: done ? 'complete' : 'not-started' };
    }
    const start = Math.min(...attempts.map((a) => a.startedAt));
    const ends = attempts.map((a) => a.endedAt).filter((v): v is number => typeof v === 'number');
    const durationMs = done && ends.length ? Math.max(0, Math.max(...ends) - start) : null;
    return { module, durationMs, failures, result: done ? 'complete' : 'incomplete' };
  });
}

function verdictFor(status: ReportStatus, s: Session): string {
  switch (status) {
    case 'recovered':
      return '현실 연결 정상 복구. 잔여 장애 없음.';
    case 'deferred':
      return '복구 유예. 긴급 종료 후 재경보가 예약됨.';
    case 'cancelled':
      return '안전 취소. 대상자 요청에 따라 경보 및 재경보 전면 중단.';
    case 'failed':
      return s.events.some((e) => e.type === 'timeout')
        ? '복구 실패. 경보 최대 지속 시간(30분) 초과로 자동 종료.'
        : '복구 실패. 긴급 종료 허용 횟수 소진.';
  }
}

/** Pure: same session + ctx → same report. */
export function buildReport(s: Session, ctx: { reportId: string; terminalId: string; now: number }): Report {
  const status = toReportStatus(s);
  const total = s.modules.length;
  const completedCount = s.modules.filter((m) => s.completed.includes(m)).length;
  const endedAt = s.endedAt ?? ctx.now;
  const elapsedMs = Math.max(0, endedAt - s.startedAt);
  const connectionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const totalFailures = s.attempts.reduce((n, a) => n + a.failures, 0);
  const remainingFaults = total - completedCount;
  const prefix = s.mode === 'simulation' ? '[훈련] ' : '';
  const summary =
    `${prefix}${fmtDateTime(s.startedAt)} 단말기 ${ctx.terminalId}에서 현실 연결 장애(${LEVEL_GRADE[s.level]})가 감지되어 ` +
    `복구 모듈 ${total}개가 배정됨. 복구 완료 ${completedCount}개, 잔여 장애 ${remainingFaults}개.`;

  return {
    id: ctx.reportId,
    docNo: docNumber(s, ctx.reportId),
    sessionId: s.id,
    lineageId: s.lineageId,
    createdAt: ctx.now,
    terminalId: ctx.terminalId,
    mode: s.mode,
    status,
    level: s.level,
    summary,
    metrics: {
      scheduledAt: s.scheduledAt,
      startedAt: s.startedAt,
      recoveryStartedAt: s.recoveryStartedAt ?? null,
      endedAt,
      elapsedMs,
      connectionRate,
      totalFailures,
      emergencyCount: s.emergencyCount,
      snoozeCount: s.snoozeCount,
      remainingFaults,
    },
    verdict: verdictFor(status, s),
    events: [...s.events].sort((a, b) => a.at - b.at),
    moduleResults: moduleResults(s),
  };
}

/** 'real' = mode real; 'failed' includes 'cancelled'; 'simulation' = mode simulation. Order is preserved. */
export function filterReports(reports: Report[], f: ArchiveFilter): Report[] {
  switch (f) {
    case 'all':
      return reports.slice();
    case 'real':
      return reports.filter((r) => r.mode === 'real');
    case 'simulation':
      return reports.filter((r) => r.mode === 'simulation');
    case 'recovered':
      return reports.filter((r) => r.status === 'recovered');
    case 'deferred':
      return reports.filter((r) => r.status === 'deferred');
    case 'failed':
      return reports.filter((r) => r.status === 'failed' || r.status === 'cancelled');
  }
}
