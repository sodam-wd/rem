import { useMemo, useState } from 'react';
import { SIGNAL_HOLD_MS, type MissionProps } from '../app/contracts';
import { HoldMeter, MissionFrame, useHold, useMissionRun } from './common';
import {
  SIGNAL_RANGE,
  generateSignal,
  paramInRange,
  snap,
  validateSignal,
  waveAt,
  type SignalParam,
  type SignalValues,
} from './signal';

const DIV = 32;
const W = DIV * 10; // 10 div × 100 ms = 1 s
const H = DIV * 8; // ±4 div × 1 V
const SAMPLES = 240;

function wavePath(v: SignalValues): string {
  let d = '';
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const x = t * W;
    const y = H / 2 - waveAt(v, t) * DIV;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

function fmt(param: SignalParam, v: number): string {
  return `${v.toFixed(SIGNAL_RANGE[param].decimals)} ${SIGNAL_RANGE[param].unit}`;
}

export function SignalMission(props: MissionProps) {
  const run = useMissionRun(props);
  const puzzle = useMemo(() => generateSignal(props.level, props.seed), [props.level, props.seed]);
  const [values, setValues] = useState<SignalValues>(puzzle.initial);
  const locked = validateSignal(puzzle, values);

  const held = useHold(locked && !run.solved, SIGNAL_HOLD_MS, () => {
    run.log('수신 파형 동기 완료');
    run.succeed();
  });

  const setParam = (param: SignalParam, v: number) => {
    if (run.solved) return;
    setValues((prev) => ({ ...prev, [param]: snap(param, v) }));
  };
  const nudge = (param: SignalParam, dir: 1 | -1) => {
    if (run.solved) return;
    setValues((prev) => ({ ...prev, [param]: snap(param, prev[param] + dir * SIGNAL_RANGE[param].step) }));
  };

  const tone = run.solved ? 'ok' : locked ? 'warn' : 'idle';
  const statusText = run.solved
    ? '신호 동기 완료. 수신 정상.'
    : locked
      ? `허용 범위 진입. ${(SIGNAL_HOLD_MS / 1000).toFixed(0)}초간 유지하십시오.`
      : '실선(수신)을 점선(기준)에 맞추십시오.';

  const tolText = puzzle.params
    .map((p) => `${SIGNAL_RANGE[p].labelKo} ±${puzzle.tolerance[p]} ${SIGNAL_RANGE[p].unit}`)
    .join(' · ');

  const grid = [];
  for (let i = 1; i < 10; i++)
    grid.push(<line key={`v${i}`} x1={i * DIV} y1={0} x2={i * DIV} y2={H} className="m-grat" />);
  for (let j = 1; j < 8; j++)
    grid.push(<line key={`h${j}`} x1={0} y1={j * DIV} x2={W} y2={j * DIV} className="m-grat" />);
  const ticks = [];
  for (let i = 0; i <= 50; i++) {
    const x = (i * W) / 50;
    ticks.push(
      <line key={`tx${i}`} x1={x} y1={H / 2 - 3} x2={x} y2={H / 2 + 3} className="m-grat-tick" />,
    );
  }
  for (let j = 0; j <= 40; j++) {
    const y = (j * H) / 40;
    ticks.push(
      <line key={`ty${j}`} x1={W / 2 - 3} y1={y} x2={W / 2 + 3} y2={y} className="m-grat-tick" />,
    );
  }

  return (
    <MissionFrame
      code="SIGNAL"
      instrument="오실로스코프 · 다이얼"
      rule={`조절 항목: ${puzzle.params.map((p) => SIGNAL_RANGE[p].labelKo).join(', ')}. 허용 오차 ${tolText}. 범위 안에서 ${(SIGNAL_HOLD_MS / 1000).toFixed(0)}초 유지.`}
      failures={run.failures}
      tone={tone}
      status={statusText}
    >
      <figure className="m-scope">
        <svg
          viewBox={`-2 -2 ${W + 4} ${H + 4}`}
          className="m-scope-svg"
          role="img"
          aria-label={`오실로스코프: 기준 파형은 점선, 수신 파형은 실선. 현재 ${locked ? '허용 범위 안' : '허용 범위 밖'}`}
        >
          <rect x={0} y={0} width={W} height={H} className="m-scope-bg" />
          {grid}
          {ticks}
          <path d={wavePath(puzzle.target)} className="m-wave-ref" />
          <path d={wavePath(values)} className="m-wave-rx" data-locked={locked} />
        </svg>
        <figcaption className="m-scope-cap m-mono">
          <span>100 ms/div</span>
          <span>1 V/div</span>
          <span>
            <i className="m-key-ref" aria-hidden="true" /> 기준
          </span>
          <span>
            <i className="m-key-rx" aria-hidden="true" /> 수신
          </span>
        </figcaption>
      </figure>

      <div className="m-dials">
        {puzzle.params.map((param) => {
          const r = SIGNAL_RANGE[param];
          const ok = paramInRange(puzzle, param, values[param]);
          const id = `m-sig-${param}`;
          return (
            <div className="m-dial" key={param}>
              <div className="m-dial-head">
                <label htmlFor={id}>{r.labelKo}</label>
                <span className="m-mono m-dial-val">{fmt(param, values[param])}</span>
                <span className="m-chip" data-tone={ok ? 'ok' : 'idle'}>
                  {ok ? '범위 안' : '범위 밖'}
                </span>
              </div>
              <div className="m-dial-row">
                <button
                  type="button"
                  className="m-btn m-btn-sq"
                  aria-label={`${r.labelKo} ${r.step} ${r.unit} 감소`}
                  disabled={run.solved}
                  onClick={() => nudge(param, -1)}
                >
                  −
                </button>
                <input
                  id={id}
                  type="range"
                  className="m-range"
                  min={r.min}
                  max={r.max}
                  step={r.step}
                  value={values[param]}
                  disabled={run.solved}
                  aria-valuetext={fmt(param, values[param])}
                  onChange={(e) => setParam(param, Number(e.currentTarget.value))}
                />
                <button
                  type="button"
                  className="m-btn m-btn-sq"
                  aria-label={`${r.labelKo} ${r.step} ${r.unit} 증가`}
                  disabled={run.solved}
                  onClick={() => nudge(param, 1)}
                >
                  +
                </button>
              </div>
              <div className="m-dial-scale m-mono" aria-hidden="true">
                <span>
                  {r.min} {r.unit}
                </span>
                <span>
                  {r.max} {r.unit}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <HoldMeter held={held} holdMs={SIGNAL_HOLD_MS} label="동기 유지" />
    </MissionFrame>
  );
}
