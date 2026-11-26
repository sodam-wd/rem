import { useEffect, useMemo, useRef, useState } from 'react';
import type { MissionProps } from '../app/contracts';
import { MissionFrame, focusNav, useMissionRun, type Tone } from './common';
import {
  MEMORY_FADE_MS,
  MEMORY_GAP_MS,
  MEMORY_LEAD_MS,
  MEMORY_LIT_MS,
  MEMORY_SPEC,
  cellName,
  generateMemory,
  memoryPrefixOk,
  validateMemory,
} from './memory';
import { deriveSeed } from './rng';

type Phase = 'ready' | 'showing' | 'input';

export function MemoryMission(props: MissionProps) {
  const run = useMissionRun(props);
  const [attempt, setAttempt] = useState(0);
  const puzzle = useMemo(
    () => generateMemory(props.level, attempt === 0 ? props.seed : deriveSeed(props.seed, attempt)),
    [props.level, props.seed, attempt],
  );
  const [phase, setPhase] = useState<Phase>('ready');
  const [lit, setLit] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<number[]>([]);
  const [status, setStatus] = useState<{ tone: Tone; text: string }>({
    tone: 'idle',
    text: '점검 시작을 누르면 셀이 차례로 점등됩니다. 순서를 기억하십시오.',
  });
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const startShow = () => {
    if (run.solved || phase === 'showing') return;
    clearTimers();
    setInput([]);
    setPhase('showing');
    setStatus({ tone: 'warn', text: '점등 순서 기록 중. 화면을 보십시오.' });
    const period = MEMORY_LIT_MS + MEMORY_GAP_MS;
    puzzle.sequence.forEach((cell, i) => {
      const on = MEMORY_LEAD_MS + i * period;
      timers.current.push(
        window.setTimeout(() => {
          setLit(cell);
          setStep(i + 1);
        }, on),
        window.setTimeout(() => setLit(null), on + MEMORY_LIT_MS),
      );
    });
    const end = MEMORY_LEAD_MS + puzzle.sequence.length * period;
    timers.current.push(
      window.setTimeout(() => {
        setPhase('input');
        setStatus({ tone: 'idle', text: `같은 순서로 셀 ${puzzle.sequence.length}개를 입력하십시오.` });
      }, end),
    );
  };

  const onCell = (idx: number) => {
    if (run.solved || phase !== 'input') return;
    const next = [...input, idx];
    if (!memoryPrefixOk(puzzle, next)) {
      setStatus({
        tone: 'alert',
        text: `순서 불일치 (${next.length}번째: ${cellName(puzzle.size, idx)}). 새 패턴을 준비했습니다.`,
      });
      run.fail(`메모리 순서 불일치 (${next.length}번째 입력)`);
      setInput([]);
      setLit(null);
      setStep(0);
      setPhase('ready');
      setAttempt((a) => a + 1);
      return;
    }
    setInput(next);
    if (validateMemory(puzzle, next)) {
      setStatus({ tone: 'ok', text: '메모리 진단 통과. 기억 회로 정상.' });
      run.log('메모리 패턴 일치');
      run.succeed();
    } else {
      setStatus({ tone: 'idle', text: `입력 ${next.length} / ${puzzle.sequence.length}` });
    }
  };

  const { size, count } = MEMORY_SPEC[props.level];
  const cells = Array.from({ length: size * size }, (_, i) => i);
  const fade = props.reducedMotion ? 0 : MEMORY_FADE_MS;

  return (
    <MissionFrame
      code="MEMORY"
      instrument="메모리 진단 격자"
      rule={`${size}×${size} 격자, ${count}개 셀 순차 점등 → 같은 순서로 입력. 틀리면 새 패턴.`}
      failures={run.failures}
      tone={status.tone}
      status={status.text}
    >
      <div className="m-mem-meta m-mono">
        {phase === 'showing'
          ? `점등 ${step} / ${count}`
          : phase === 'input'
            ? `입력 ${input.length} / ${count}`
            : `패턴 #${attempt + 1}`}
      </div>
      <div
        className="m-mem-grid"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(44px, 1fr))` }}
        role="group"
        aria-label={`${size}×${size} 메모리 격자`}
      >
        {cells.map((idx) => {
          const entered = input.indexOf(idx);
          const isLit = lit === idx;
          return (
            <button
              key={idx}
              type="button"
              className="m-mem-cell"
              data-nav="mem"
              data-lit={isLit}
              data-entered={entered >= 0}
              style={{ transitionDuration: `${fade}ms` }}
              aria-label={`${cellName(size, idx)}${entered >= 0 ? `, ${entered + 1}번째 입력됨` : ''}`}
              aria-disabled={phase !== 'input' || run.solved}
              onClick={() => onCell(idx)}
              onKeyDown={(e) => focusNav(e, 'mem', size)}
            >
              {entered >= 0 && <span className="m-mono">{entered + 1}</span>}
            </button>
          );
        })}
      </div>
      <div className="m-actions">
        <button
          type="button"
          className="m-btn m-btn-primary"
          onClick={startShow}
          disabled={phase !== 'ready' || run.solved}
        >
          {attempt === 0 ? '점검 시작' : '새 패턴 점검 시작'}
        </button>
      </div>
    </MissionFrame>
  );
}
