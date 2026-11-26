import { useState } from 'react';
import type { Alarm, Weekday } from '../app/contracts';
import { LEVEL_LABEL, WEEKDAY_KO } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { ConfirmDialog, Panel, STANDBY_NOTICE, Screen, Switch, hhmm } from './common';

const ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export function weekdaysText(w: Weekday[]): string {
  if (w.length === 0) return '1회';
  if (w.length === 7) return '매일';
  const set = new Set(w);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d as Weekday))) return '평일';
  if (set.size === 2 && set.has(0) && set.has(6)) return '주말';
  return ORDER.filter((d) => set.has(d)).map((d) => WEEKDAY_KO[d]).join(' ');
}

export function modulesText(a: Pick<Alarm, 'selectionMode' | 'allowedModules' | 'moduleCount'>): string {
  return a.selectionMode === 'manual'
    ? a.allowedModules.join(' → ')
    : `랜덤 ${a.moduleCount}개 / 후보 ${a.allowedModules.length}개`;
}

const KIND = { snooze: '다시 울리기', emergency: '긴급 종료 재경보' } as const;

export function ScheduleScreen() {
  const { alarms, setAlarmEnabled, navigate, pending, cancelPending, now } = useRem();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmPending, setConfirmPending] = useState<string | null>(null);
  const sorted = alarms.slice().sort((a, b) => a.timeHHMM.localeCompare(b.timeHHMM) || a.createdAt - b.createdAt);
  const upcoming = pending.filter((p) => p.at > now).sort((a, b) => a.at - b.at);

  const toggle = async (a: Alarm, v: boolean) => {
    setBusy(a.id);
    setErr(null);
    try {
      await setAlarmEnabled(a.id, v);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      en="SCHEDULE"
      ko="일정"
      actions={
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => navigate('/schedule/new')}>
          + 등록
        </button>
      }
    >
      <p className="ui-banner">{STANDBY_NOTICE}</p>
      {err ? <p className="ui-banner ui-banner-alert" role="alert">{err}</p> : null}

      {sorted.length === 0 ? (
        <Panel title="등록된 일정 없음" en="EMPTY">
          <div className="ui-stack">
            <p>기상 시각, 요일, 난이도와 복구 모듈을 정해 일정을 등록하십시오. 여러 개를 등록할 수 있습니다.</p>
            <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={() => navigate('/schedule/new')}>
              일정 등록
            </button>
          </div>
        </Panel>
      ) : (
        <ul className="ui-list" aria-label="일정 목록">
          {sorted.map((a) => (
            <li key={a.id} className={`ui-alarm-row ${a.enabled ? '' : 'ui-alarm-off'}`}>
              <button type="button" className="ui-alarm-main" onClick={() => navigate(`/schedule/${a.id}`)} aria-label={`${a.timeHHMM} 일정 편집`}>
                <div className="ui-alarm-time">{a.timeHHMM}</div>
                <div className="ui-alarm-meta">
                  <span>{weekdaysText(a.weekdays)}</span>
                  <span>난이도 {LEVEL_LABEL[a.level].ko}</span>
                  <span className="mono">{modulesText(a)}</span>
                  {a.label ? <span>· {a.label}</span> : null}
                </div>
              </button>
              <Switch checked={a.enabled} label={`${a.timeHHMM} 일정 활성화`} disabled={busy === a.id} onChange={(v) => void toggle(a, v)} />
            </li>
          ))}
        </ul>
      )}

      {upcoming.length > 0 ? (
        <Panel title="대기 중인 재경보" en="PENDING RE-ALERT">
          <ul className="ui-list">
            {upcoming.map((p) => (
              <li key={p.id} className="ui-alarm-row">
                <div style={{ flex: 1 }}>
                  <div className="ui-next-time" style={{ fontSize: 22 }}>{hhmm(p.at)}</div>
                  <div className="ui-alarm-meta">{KIND[p.kind]}</div>
                </div>
                <button type="button" className="ui-btn ui-btn-danger ui-btn-sm" onClick={() => setConfirmPending(p.id)}>취소</button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {confirmPending ? (
        <ConfirmDialog
          title="재경보 취소"
          body="이 재경보를 취소합니다. 예약된 경보가 울리지 않습니다."
          confirmLabel="재경보 취소"
          danger
          onCancel={() => setConfirmPending(null)}
          onConfirm={() => {
            const id = confirmPending;
            setConfirmPending(null);
            cancelPending(id).catch((e) => setErr(e instanceof Error ? e.message : '취소하지 못했습니다.'));
          }}
        />
      ) : null}
    </Screen>
  );
}
