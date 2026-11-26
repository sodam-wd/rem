import { useState } from 'react';
import type { Level, ModuleId } from '../app/contracts';
import { LEVEL_LABEL } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { ModulePicker, Panel, Screen } from './common';

export function SimulationScreen() {
  const { startSimulation, navigate, activeSession } = useRem();
  const [level, setLevel] = useState<Level>(1);
  const [modules, setModules] = useState<ModuleId[]>(['POWER']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = activeSession && (activeSession.status === 'alerting' || activeSession.status === 'recovering');

  const start = async () => {
    if (modules.length < 1 || modules.length > 5) {
      setErr('모듈을 1~5개 선택하십시오.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const id = await startSimulation({ level, modules });
      navigate(`/alert/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '훈련을 시작하지 못했습니다.');
      setBusy(false);
    }
  };

  return (
    <Screen en="SIMULATION" ko="훈련">
      <div className="ui-banner">
        <strong>SIMULATION · 체험 모드</strong> — 실제 일정과 분리된 훈련입니다. 예약 경보나 재경보를 만들지 않으며, 보고서는 ‘훈련’ 분류로 보관됩니다.
      </div>
      {live ? (
        <p className="ui-banner ui-banner-alert" role="alert">진행 중인 사건이 있어 훈련을 시작할 수 없습니다. 먼저 사건을 종료하십시오.</p>
      ) : null}

      <Panel title="난이도" en="LEVEL">
        <div className="ui-seg" role="radiogroup" aria-label="훈련 난이도">
          {([1, 2, 3] as Level[]).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={level === l} onClick={() => setLevel(l)}>
              {LEVEL_LABEL[l].ko} <span className="mono" style={{ fontSize: 11 }}>{LEVEL_LABEL[l].en}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={`복구 모듈 (${modules.length}개)`} en="MODULES">
        <ModulePicker mode="ordered" value={modules} onChange={setModules} />
      </Panel>

      {err ? <p className="ui-field-error" role="alert">{err}</p> : null}
      <button type="button" className="ui-btn ui-btn-primary ui-btn-block ui-recover-btn" disabled={busy || !!live || modules.length === 0} onClick={() => void start()}>
        {busy ? '훈련 준비 중…' : '훈련 시작'}
      </button>
    </Screen>
  );
}
