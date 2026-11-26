import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { MissionProps } from '../app/contracts';
import { HoldMeter, MissionFrame, useHold, useMissionRun, type Tone } from './common';
import {
  SENSOR_TIMEOUT_MS,
  clampAttitude,
  generateGravity,
  orientToAttitude,
  validateGravity,
  type Attitude,
} from './gravity';

type Mode = 'choose' | 'sensor-wait' | 'sensor' | 'touch';

const PX = 3; // px per degree of pitch in the indicator
const PAD_RANGE = 20; // touch pad edge = ±20°

function signed(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}°`;
}

function screenAngle(): number {
  const so = typeof screen !== 'undefined' ? screen.orientation : undefined;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

interface DOEStatic {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

export function GravityMission(props: MissionProps) {
  const run = useMissionRun(props);
  const puzzle = useMemo(() => generateGravity(props.level, props.seed), [props.level, props.seed]);
  const [mode, setMode] = useState<Mode>('choose');
  const [notice, setNotice] = useState<string | null>(null);
  const [attitude, setAttitude] = useState<Attitude>({ pitch: 0, roll: 0 });
  const [index, setIndex] = useState(0);
  const clipId = useId().replace(/:/g, '');

  const listenerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const baselineRef = useRef<{ att: Attitude; angle: number } | null>(null);
  const draggingRef = useRef(false);

  const stopSensor = () => {
    if (listenerRef.current) window.removeEventListener('deviceorientation', listenerRef.current);
    listenerRef.current = null;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };
  useEffect(() => stopSensor, []);

  const switchToTouch = (reason: string | null) => {
    stopSensor();
    setAttitude({ pitch: 0, roll: 0 });
    setNotice(reason);
    setMode('touch');
  };

  const startSensor = async () => {
    const DOE = (window as unknown as { DeviceOrientationEvent?: DOEStatic }).DeviceOrientationEvent;
    if (!DOE) {
      switchToTouch('이 브라우저는 자세 센서를 지원하지 않아 터치 조작으로 전환했습니다.');
      return;
    }
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') {
          switchToTouch('센서 권한이 허용되지 않아 터치 조작으로 전환했습니다.');
          return;
        }
      } catch {
        switchToTouch('센서 권한 요청에 실패하여 터치 조작으로 전환했습니다.');
        return;
      }
    }
    stopSensor();
    baselineRef.current = null;
    setNotice(null);
    setMode('sensor-wait');
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      const angle = screenAngle();
      const raw = orientToAttitude(e.beta, e.gamma, angle);
      if (!baselineRef.current || baselineRef.current.angle !== angle) {
        // Zero at the user's current comfortable position; re-zero when the screen rotates.
        baselineRef.current = { att: raw, angle };
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        setMode('sensor');
      }
      const b = baselineRef.current.att;
      setAttitude(clampAttitude({ pitch: raw.pitch - b.pitch, roll: raw.roll - b.roll }));
    };
    listenerRef.current = onOrient;
    window.addEventListener('deviceorientation', onOrient);
    timeoutRef.current = window.setTimeout(() => {
      switchToTouch('2초 동안 센서 신호가 없어 터치 조작으로 전환했습니다.');
    }, SENSOR_TIMEOUT_MS);
  };

  const rezero = () => {
    baselineRef.current = null;
  };

  const active = (mode === 'sensor' || mode === 'touch') && !run.solved;
  const inRange = active && validateGravity(puzzle, index, attitude);
  const held = useHold(
    inRange,
    puzzle.holdMs,
    () => {
      if (index + 1 < puzzle.targets.length) {
        run.log(`자세 목표 ${index + 1} 보정 완료`);
        setIndex(index + 1);
      } else {
        stopSensor();
        run.log('항공 자세 보정 완료');
        run.succeed();
      }
    },
    index,
  );

  const nudge = (dPitch: number, dRoll: number) => {
    if (mode !== 'touch' || run.solved) return;
    setAttitude((a) => clampAttitude({ pitch: a.pitch + dPitch, roll: a.roll + dRoll }));
  };

  const padFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (mode !== 'touch' || run.solved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (e.clientX - rect.left) / rect.width; // 0..1
    const y = (e.clientY - rect.top) / rect.height;
    setAttitude(
      clampAttitude({
        roll: Math.round((x * 2 - 1) * PAD_RANGE),
        pitch: Math.round((1 - y * 2) * PAD_RANGE),
      }),
    );
  };

  const target = puzzle.targets[index];
  const tol = puzzle.tolerance;
  const pitchOk = Math.abs(attitude.pitch - target.pitch) <= tol;
  const rollOk = Math.abs(attitude.roll - target.roll) <= tol;
  const holdS = (puzzle.holdMs / 1000).toFixed(0);

  let tone: Tone = 'idle';
  let statusText = '조작 방식을 선택하십시오.';
  if (run.solved) {
    tone = 'ok';
    statusText = '자세 보정 완료. 중력 기준 정상.';
  } else if (mode === 'sensor-wait') {
    tone = 'warn';
    statusText = '센서 신호 대기 중…';
  } else if (active) {
    tone = inRange ? 'warn' : 'idle';
    statusText = inRange
      ? `목표 범위 진입. ${holdS}초간 유지하십시오.`
      : `실선 수평선을 점선 목표선에 맞추십시오 (목표 ${index + 1}/${puzzle.targets.length}).`;
  }

  const horizonT = (a: Attitude) => `rotate(${-a.roll}) translate(0 ${a.pitch * PX})`;
  const ladder = [];
  for (let d = -30; d <= 30; d += 5) {
    if (d === 0) continue;
    const w = d % 10 === 0 ? 40 : 20;
    ladder.push(
      <g key={d}>
        <line x1={-w / 2} y1={-d * PX} x2={w / 2} y2={-d * PX} className="m-adi-ladder" />
        {d % 10 === 0 && (
          <text x={w / 2 + 4} y={-d * PX + 3} className="m-adi-num">
            {Math.abs(d)}
          </text>
        )}
      </g>,
    );
  }
  const rollTicks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((d) => (
    <line
      key={d}
      x1={0}
      y1={-92}
      x2={0}
      y2={d % 30 === 0 ? -82 : -86}
      transform={`rotate(${d})`}
      className="m-adi-tick"
    />
  ));

  return (
    <MissionFrame
      code="GRAVITY"
      instrument="항공 자세계"
      rule={`목표 ${puzzle.targets.length}곳, 허용 ±${tol}°, 각 ${holdS}초 유지. 기기를 살짝 기울이거나 터치로 조정.`}
      failures={run.failures}
      tone={tone}
      status={statusText}
    >
      <div className="m-adi-wrap">
        <svg viewBox="-100 -100 200 200" className="m-adi" role="img" aria-label={`자세계: 현재 피치 ${signed(attitude.pitch)}, 롤 ${signed(attitude.roll)}`}>
          <defs>
            <clipPath id={clipId}>
              <circle cx={0} cy={0} r={78} />
            </clipPath>
          </defs>
          <circle cx={0} cy={0} r={98} className="m-adi-bezel" />
          <g clipPath={`url(#${clipId})`}>
            <g transform={horizonT(attitude)}>
              <rect x={-200} y={-400} width={400} height={400} className="m-adi-sky" />
              <rect x={-200} y={0} width={400} height={400} className="m-adi-ground" />
              <line x1={-200} y1={0} x2={200} y2={0} className="m-adi-horizon" />
              {ladder}
            </g>
            <g transform={horizonT(target)}>
              <line x1={-90} y1={0} x2={90} y2={0} className="m-adi-target" data-ok={inRange} />
              <rect
                x={-90}
                y={-tol * PX}
                width={180}
                height={tol * PX * 2}
                className="m-adi-band"
              />
            </g>
          </g>
          {rollTicks}
          <path d="M0 -78 L-5 -70 L5 -70 Z" className="m-adi-pointer" transform={`rotate(${-attitude.roll})`} />
          <g className="m-adi-plane">
            <path d="M-48 0 H-16 L-8 8 M48 0 H16 L8 8" />
            <circle cx={0} cy={0} r={2.5} />
          </g>
        </svg>
        <dl className="m-adi-read m-mono">
          <div>
            <dt>피치</dt>
            <dd>
              {signed(attitude.pitch)} <span className="m-dim">목표 {signed(target.pitch)}</span>{' '}
              <span className="m-chip" data-tone={pitchOk ? 'ok' : 'idle'}>
                {pitchOk ? '일치' : '조정'}
              </span>
            </dd>
          </div>
          <div>
            <dt>롤</dt>
            <dd>
              {signed(attitude.roll)} <span className="m-dim">목표 {signed(target.roll)}</span>{' '}
              <span className="m-chip" data-tone={rollOk ? 'ok' : 'idle'}>
                {rollOk ? '일치' : '조정'}
              </span>
            </dd>
          </div>
          <div>
            <dt>목표</dt>
            <dd>
              {Math.min(index + 1, puzzle.targets.length)} / {puzzle.targets.length}
            </dd>
          </div>
        </dl>
      </div>

      {notice && (
        <p className="m-notice" role="note">
          {notice}
        </p>
      )}

      {mode === 'choose' && (
        <div className="m-gv-choose">
          <p className="m-dim">
            안전 안내: 앉은 자세에서 기기를 손에 든 채 손목으로 살짝(15° 이내) 기울이면 됩니다. 일어서거나
            몸을 크게 움직이지 마십시오.
          </p>
          <div className="m-actions">
            <button type="button" className="m-btn m-btn-primary" onClick={() => void startSensor()}>
              센서로 조작
            </button>
            <button type="button" className="m-btn" onClick={() => switchToTouch(null)}>
              터치로 조작
            </button>
          </div>
        </div>
      )}

      {(mode === 'sensor' || mode === 'sensor-wait') && !run.solved && (
        <div className="m-actions">
          <button type="button" className="m-btn" onClick={rezero}>
            현재 자세를 영점으로
          </button>
          <button type="button" className="m-btn" onClick={() => switchToTouch(null)}>
            터치로 조작
          </button>
        </div>
      )}

      {mode === 'touch' && !run.solved && (
        <div className="m-gv-touch">
          <div
            className="m-gv-pad"
            tabIndex={0}
            role="group"
            aria-label="자세 조정 패드. 드래그하거나 화살표 키로 1도씩 조정"
            onPointerDown={(e) => {
              draggingRef.current = true;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              padFromPointer(e);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) padFromPointer(e);
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
            onPointerCancel={() => {
              draggingRef.current = false;
            }}
            onKeyDown={(e) => {
              const map: Record<string, [number, number]> = {
                ArrowUp: [1, 0],
                ArrowDown: [-1, 0],
                ArrowLeft: [0, -1],
                ArrowRight: [0, 1],
              };
              const d = map[e.key];
              if (d) {
                e.preventDefault();
                nudge(d[0], d[1]);
              }
            }}
          >
            <span
              className="m-gv-dot"
              style={{
                left: `${50 + (attitude.roll / PAD_RANGE) * 50}%`,
                top: `${50 - (attitude.pitch / PAD_RANGE) * 50}%`,
              }}
              aria-hidden="true"
            />
            <span className="m-gv-axis m-mono" aria-hidden="true">
              ±{PAD_RANGE}°
            </span>
          </div>
          <div className="m-gv-btns" role="group" aria-label="방향 버튼">
            <button type="button" className="m-btn m-btn-sq m-gv-up" aria-label="피치 1도 올림" onClick={() => nudge(1, 0)}>
              ↑
            </button>
            <button type="button" className="m-btn m-btn-sq m-gv-left" aria-label="롤 1도 왼쪽" onClick={() => nudge(0, -1)}>
              ←
            </button>
            <button type="button" className="m-btn m-btn-sq m-gv-right" aria-label="롤 1도 오른쪽" onClick={() => nudge(0, 1)}>
              →
            </button>
            <button type="button" className="m-btn m-btn-sq m-gv-down" aria-label="피치 1도 내림" onClick={() => nudge(-1, 0)}>
              ↓
            </button>
          </div>
          <button type="button" className="m-btn m-gv-sensor" onClick={() => void startSensor()}>
            센서로 다시 시도
          </button>
        </div>
      )}

      {active && <HoldMeter held={held} holdMs={puzzle.holdMs} label="자세 유지" />}
    </MissionFrame>
  );
}
