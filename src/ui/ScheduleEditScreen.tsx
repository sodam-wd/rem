import { useId, useState } from 'react';
import type { Alarm, Level, Weekday } from '../app/contracts';
import { LEVEL_LABEL, LIMITS, WEEKDAY_KO } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { ConfirmDialog, ModulePicker, Panel, Screen, Stepper, Switch } from './common';

type FieldKey = 'time' | 'weekdays' | 'label' | 'level' | 'modules' | 'snooze' | 'emergency' | 'general';
const ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** validateAlarm returns plain Korean messages; route each to the closest field by keyword. */
export function fieldForError(msg: string): FieldKey {
  if (/시간대/.test(msg)) return 'general';
  if (/긴급/.test(msg)) return 'emergency';
  if (/다시 울리기|재경보|스누즈|snooze/i.test(msg)) return 'snooze';
  if (/모듈|후보|풀|선택/.test(msg)) return 'modules';
  if (/요일/.test(msg)) return 'weekdays';
  if (/난이도|등급/.test(msg)) return 'level';
  if (/레이블|이름|메모/.test(msg)) return 'label';
  if (/시각|시간|HH:MM/.test(msg)) return 'time';
  return 'general';
}

function FieldErrors({ id, list }: { id: string; list: string[] }) {
  if (list.length === 0) return null;
  return (
    <div id={id} role="alert">
      {list.map((m) => (
        <p key={m} className="ui-field-error">{m}</p>
      ))}
    </div>
  );
}

export function ScheduleEditScreen({ alarmId }: { alarmId: string | null }) {
  const { alarms, newAlarmDraft, validateAlarm, saveAlarm, deleteAlarm, navigate, ready } = useRem();
  const existing = alarmId ? alarms.find((a) => a.id === alarmId) ?? null : null;
  const [draft, setDraft] = useState<Alarm | null>(() => (alarmId ? existing : newAlarmDraft()));
  const [errors, setErrors] = useState<string[] | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const uid = useId();

  // Alarm list may arrive after first render (storage load).
  if (!draft && existing) setDraft(existing);

  if (!draft) {
    return (
      <Screen en="SCHEDULE / EDIT" ko="일정 편집" back="/schedule">
        <Panel title={ready ? '일정을 찾을 수 없음' : '불러오는 중'} en={ready ? 'NOT FOUND' : 'LOADING'}>
          <div className="ui-stack">
            <p>{ready ? '삭제되었거나 존재하지 않는 일정입니다.' : '저장된 일정을 불러오고 있습니다.'}</p>
            <button type="button" className="ui-btn" onClick={() => navigate('/schedule')}>일정 목록</button>
          </div>
        </Panel>
      </Screen>
    );
  }

  const byField = (k: FieldKey) => (errors ?? []).filter((m) => fieldForError(m) === k);
  const errId = (k: FieldKey) => `${uid}-${k}-err`;
  const update = (patch: Partial<Alarm>) => {
    const next = { ...draft, ...patch };
    if (next.selectionMode === 'manual') next.moduleCount = next.allowedModules.length;
    setDraft(next);
    if (errors) setErrors(validateAlarm(next));
  };
  const toggleDay = (d: Weekday) => {
    const set = new Set(draft.weekdays);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    update({ weekdays: ORDER.filter((x) => set.has(x)).sort((a, b) => a - b) });
  };

  const onSave = async () => {
    const list = validateAlarm(draft);
    setErrors(list);
    setSaveErr(null);
    if (list.length > 0) return;
    setSaving(true);
    try {
      await saveAlarm(draft);
      navigate('/schedule');
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setConfirmDel(false);
    try {
      await deleteAlarm(draft.id);
      navigate('/schedule');
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : '삭제하지 못했습니다.');
    }
  };

  const general = byField('general');
  const hasErrors = (errors ?? []).length > 0;

  return (
    <Screen en={alarmId ? 'SCHEDULE / EDIT' : 'SCHEDULE / NEW'} ko={alarmId ? '일정 편집' : '일정 등록'} back="/schedule">
      {hasErrors ? (
        <div className="ui-banner ui-banner-alert" role="alert">
          <strong>입력 확인 필요</strong> — 표시된 항목 {errors!.length}건을 수정하십시오.
          <FieldErrors id={errId('general')} list={general} />
        </div>
      ) : null}
      {saveErr ? <p className="ui-banner ui-banner-alert" role="alert"><strong>저장 실패</strong> — {saveErr}</p> : null}

      <Panel title="경보 시각" en="TIME">
        <div className="ui-stack">
          <div className="ui-field">
            <label className="ui-field-label" htmlFor={`${uid}-time`}>울릴 시각</label>
            <input
              id={`${uid}-time`}
              type="time"
              className="ui-input ui-input-time"
              value={draft.timeHHMM}
              required
              aria-invalid={byField('time').length > 0}
              aria-describedby={byField('time').length ? errId('time') : undefined}
              onChange={(e) => update({ timeHHMM: e.target.value })}
            />
            <FieldErrors id={errId('time')} list={byField('time')} />
          </div>
          <div className="ui-field">
            <span className="ui-field-label" id={`${uid}-wd`}>반복 요일</span>
            <div className="ui-weekdays" role="group" aria-labelledby={`${uid}-wd`} aria-describedby={byField('weekdays').length ? errId('weekdays') : undefined}>
              {ORDER.map((d) => (
                <button key={d} type="button" aria-pressed={draft.weekdays.includes(d)} onClick={() => toggleDay(d)}>
                  {WEEKDAY_KO[d]}
                </button>
              ))}
            </div>
            <span className="ui-field-hint">{draft.weekdays.length === 0 ? '요일을 고르지 않으면 1회만 울리고 자동으로 꺼집니다.' : '선택한 요일마다 반복합니다.'}</span>
            <FieldErrors id={errId('weekdays')} list={byField('weekdays')} />
          </div>
          <div className="ui-field">
            <label className="ui-field-label" htmlFor={`${uid}-label`}>레이블 (선택)</label>
            <input
              id={`${uid}-label`}
              className="ui-input"
              maxLength={40}
              value={draft.label}
              placeholder="예: 평일 출근"
              aria-invalid={byField('label').length > 0}
              onChange={(e) => update({ label: e.target.value })}
            />
            <FieldErrors id={errId('label')} list={byField('label')} />
          </div>
        </div>
      </Panel>

      <Panel title="복구 난이도와 모듈" en="RECOVERY">
        <div className="ui-stack">
          <div className="ui-field">
            <span className="ui-field-label" id={`${uid}-lv`}>난이도</span>
            <div className="ui-seg" role="radiogroup" aria-labelledby={`${uid}-lv`}>
              {([1, 2, 3] as Level[]).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={draft.level === l} onClick={() => update({ level: l })}>
                  {LEVEL_LABEL[l].ko} <span className="mono" style={{ fontSize: 11 }}>{LEVEL_LABEL[l].en}</span>
                </button>
              ))}
            </div>
            <FieldErrors id={errId('level')} list={byField('level')} />
          </div>
          <div className="ui-field">
            <span className="ui-field-label" id={`${uid}-sel`}>선택 방식</span>
            <div className="ui-seg" role="radiogroup" aria-labelledby={`${uid}-sel`}>
              <button type="button" role="radio" aria-checked={draft.selectionMode === 'manual'} onClick={() => update({ selectionMode: 'manual' })}>
                직접 선택
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={draft.selectionMode === 'random'}
                onClick={() => update({ selectionMode: 'random', moduleCount: Math.max(LIMITS.minModules, Math.min(draft.moduleCount, draft.allowedModules.length || 1)) })}
              >
                랜덤
              </button>
            </div>
          </div>
          {draft.selectionMode === 'manual' ? (
            <div className="ui-field">
              <span className="ui-field-label">모듈 순서 ({draft.allowedModules.length}개 · 1~5개)</span>
              <ModulePicker mode="ordered" value={draft.allowedModules} onChange={(v) => update({ allowedModules: v })} describedBy={byField('modules').length ? errId('modules') : undefined} />
            </div>
          ) : (
            <>
              <div className="ui-field">
                <span className="ui-field-label">모듈 수</span>
                <Stepper value={draft.moduleCount} min={LIMITS.minModules} max={LIMITS.maxModules} unit="개" label="모듈 수" onChange={(v) => update({ moduleCount: v })} />
              </div>
              <div className="ui-field">
                <span className="ui-field-label">랜덤 허용 후보 ({draft.allowedModules.length}개 선택)</span>
                <ModulePicker mode="pool" value={draft.allowedModules} onChange={(v) => update({ allowedModules: v })} describedBy={byField('modules').length ? errId('modules') : undefined} />
                <span className="ui-field-hint">후보는 모듈 수 이상이어야 합니다. 경보 때마다 후보 중에서 중복 없이 고릅니다.</span>
              </div>
            </>
          )}
          <FieldErrors id={errId('modules')} list={byField('modules')} />
        </div>
      </Panel>

      <Panel title="정상 복구 후 다시 울리기" en="SNOOZE">
        <div className="ui-stack">
          <div className="ui-spread">
            <span>복구 완료 후 다시 울리기 허용</span>
            <Switch checked={draft.allowSnooze} label="다시 울리기 허용" onChange={(v) => update({ allowSnooze: v })} />
          </div>
          {draft.allowSnooze ? (
            <div className="ui-row">
              <div className="ui-field">
                <span className="ui-field-label">간격</span>
                <Stepper value={draft.snoozeMinutes} min={LIMITS.minMinutes} max={LIMITS.maxMinutes} unit="분" label="다시 울리기 간격" onChange={(v) => update({ snoozeMinutes: v })} />
              </div>
              <div className="ui-field">
                <span className="ui-field-label">최대 횟수</span>
                <Stepper value={draft.snoozeLimit} min={LIMITS.minRepeat} max={LIMITS.maxRepeat} unit="회" label="다시 울리기 횟수" onChange={(v) => update({ snoozeLimit: v })} />
              </div>
            </div>
          ) : (
            <p className="ui-note">복구 완료 화면에 ‘다시 울리기’ 버튼이 나타나지 않습니다.</p>
          )}
          <FieldErrors id={errId('snooze')} list={byField('snooze')} />
        </div>
      </Panel>

      <Panel title="긴급 종료 재경보" en="EMERGENCY">
        <div className="ui-stack">
          <p className="ui-note">긴급 종료하면 지정한 간격 뒤 다시 경보가 울립니다. 횟수를 모두 쓰면 복구 실패로 종료됩니다.</p>
          <div className="ui-row">
            <div className="ui-field">
              <span className="ui-field-label">재경보 간격</span>
              <Stepper value={draft.emergencyMinutes} min={LIMITS.minMinutes} max={LIMITS.maxMinutes} unit="분" label="긴급 종료 재경보 간격" onChange={(v) => update({ emergencyMinutes: v })} />
            </div>
            <div className="ui-field">
              <span className="ui-field-label">최대 횟수</span>
              <Stepper value={draft.emergencyLimit} min={LIMITS.minRepeat} max={LIMITS.maxRepeat} unit="회" label="긴급 종료 횟수" onChange={(v) => update({ emergencyLimit: v })} />
            </div>
          </div>
          <FieldErrors id={errId('emergency')} list={byField('emergency')} />
        </div>
      </Panel>

      <div className="ui-stack">
        <button type="button" className="ui-btn ui-btn-primary ui-btn-block" disabled={saving} onClick={() => void onSave()}>
          {saving ? '저장 중…' : '저장'}
        </button>
        {alarmId ? (
          <button type="button" className="ui-btn ui-btn-danger ui-btn-block" onClick={() => setConfirmDel(true)}>
            일정 삭제
          </button>
        ) : null}
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-block" onClick={() => navigate('/schedule')}>
          취소
        </button>
      </div>

      {confirmDel ? (
        <ConfirmDialog
          title="일정 삭제"
          body={`${draft.timeHHMM} 일정을 삭제합니다. 이미 진행 중인 사건과 발행된 보고서는 유지됩니다.`}
          confirmLabel="삭제"
          danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={() => void onDelete()}
        />
      ) : null}
    </Screen>
  );
}
