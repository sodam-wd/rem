import { useMemo, useState } from 'react';
import type { MissionProps } from '../app/contracts';
import { MissionFrame, focusNav, useMissionRun, type Tone } from './common';
import {
  WIRE_COLOR_HEX,
  WIRE_COLOR_KO,
  generatePower,
  isCorrectPair,
  validatePower,
  type PowerTerminal,
} from './power';
import { SYMBOL_NAME_KO, SymbolGlyph } from './symbols';

const ROW_H = 52;

function terminalName(t: PowerTerminal, side: 'left' | 'right'): string {
  const parts = [side === 'left' ? `입력 단자 ${t.label}` : `출력 단자 ${t.label}`];
  if (t.color) parts.push(`${WIRE_COLOR_KO[t.color]}색`);
  if (t.symbol) parts.push(`${SYMBOL_NAME_KO[t.symbol]} 기호`);
  return parts.join(' ');
}

export function PowerMission(props: MissionProps) {
  const run = useMissionRun(props);
  const puzzle = useMemo(() => generatePower(props.level, props.seed), [props.level, props.seed]);
  const [connections, setConnections] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<{ side: 'left' | 'right'; id: string } | null>(null);
  const [status, setStatus] = useState<{ tone: Tone; text: string }>({
    tone: 'idle',
    text: '왼쪽 입력 단자를 누른 뒤 연결할 오른쪽 출력 단자를 누르십시오.',
  });

  const connectedRight = new Set(Object.values(connections));
  const total = puzzle.left.length;
  const done = Object.keys(connections).length;

  const tryConnect = (leftId: string, rightId: string) => {
    const l = puzzle.left.find((t) => t.id === leftId)!;
    const r = puzzle.right.find((t) => t.id === rightId)!;
    setSelected(null);
    if (isCorrectPair(puzzle, leftId, rightId)) {
      const next = { ...connections, [leftId]: rightId };
      setConnections(next);
      run.log(`단자 ${l.label} → ${r.label} 연결`);
      if (validatePower(puzzle, next)) {
        setStatus({ tone: 'ok', text: `전 회로 연결 완료 (${total}/${total}). 배전 정상.` });
        run.succeed();
      } else {
        setStatus({
          tone: 'ok',
          text: `단자 ${l.label} → ${r.label} 연결됨 (${Object.keys(next).length}/${total}).`,
        });
      }
    } else {
      setStatus({
        tone: 'alert',
        text: `오연결: 단자 ${l.label} → ${r.label}. 규칙을 확인하고 다시 연결하십시오.`,
      });
      run.fail(`배전반 오연결 (단자 ${l.label} → ${r.label})`);
    }
  };

  const onTerminal = (side: 'left' | 'right', id: string) => {
    if (run.solved) return;
    if (!selected || selected.side === side) {
      setSelected(selected && selected.id === id ? null : { side, id });
      return;
    }
    if (side === 'right') tryConnect(selected.id, id);
    else tryConnect(id, selected.id);
  };

  const renderTerminal = (t: PowerTerminal, side: 'left' | 'right') => {
    const isConnected = side === 'left' ? t.id in connections : connectedRight.has(t.id);
    const isSelected = selected?.id === t.id;
    return (
      <button
        key={t.id}
        type="button"
        className="m-term"
        data-side={side}
        data-nav={`power-${side}`}
        data-state={isConnected ? 'connected' : isSelected ? 'selected' : 'open'}
        disabled={isConnected || run.solved}
        aria-pressed={isSelected}
        aria-label={`${terminalName(t, side)}${isConnected ? ', 연결됨' : ''}`}
        onClick={() => onTerminal(side, t.id)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const target = e.key === 'ArrowLeft' ? 'left' : 'right';
            if (target === side) return;
            const root = e.currentTarget.closest('.m-frame');
            const first = root?.querySelector<HTMLElement>(
              `[data-nav="power-${target}"]:not(:disabled)`,
            );
            if (first) {
              e.preventDefault();
              first.focus();
            }
            return;
          }
          focusNav(e, `power-${side}`, 1);
        }}
      >
        <span
          className="m-term-jack"
          style={t.color ? { background: WIRE_COLOR_HEX[t.color] } : undefined}
          aria-hidden="true"
        />
        <span className="m-term-label m-mono">{t.label}</span>
        {t.color && <span className="m-term-color">{WIRE_COLOR_KO[t.color]}</span>}
        {t.symbol && <SymbolGlyph id={t.symbol} size={20} />}
        <span className="m-term-state">{isConnected ? '연결' : isSelected ? '선택' : ''}</span>
      </button>
    );
  };

  const leftIndex = new Map(puzzle.left.map((t, i) => [t.id, i]));
  const rightIndex = new Map(puzzle.right.map((t, i) => [t.id, i]));
  const height = total * ROW_H;

  return (
    <MissionFrame
      code="POWER"
      instrument="배전반 단자대"
      rule={puzzle.rule}
      failures={run.failures}
      tone={status.tone}
      status={status.text}
    >
      <div className="m-power-meta m-mono" aria-label={`연결 ${done} / ${total}`}>
        연결 {done} / {total}
      </div>
      <div className="m-power" style={{ gridTemplateRows: `repeat(${total}, ${ROW_H}px)` }}>
        <div className="m-power-col" data-side="left" style={{ gridRow: `1 / span ${total}` }}>
          {puzzle.left.map((t) => renderTerminal(t, 'left'))}
        </div>
        <svg
          className="m-power-wires"
          style={{ gridRow: `1 / span ${total}` }}
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {Object.entries(connections).map(([l, r]) => {
            const lt = puzzle.left[leftIndex.get(l)!];
            const y1 = (leftIndex.get(l)! + 0.5) * ROW_H;
            const y2 = (rightIndex.get(r)! + 0.5) * ROW_H;
            return (
              <path
                key={l}
                d={`M0 ${y1} C 50 ${y1}, 50 ${y2}, 100 ${y2}`}
                fill="none"
                stroke={lt.color ? WIRE_COLOR_HEX[lt.color] : 'var(--c-ok)'}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        <div className="m-power-col" data-side="right" style={{ gridRow: `1 / span ${total}` }}>
          {puzzle.right.map((t) => renderTerminal(t, 'right'))}
        </div>
      </div>
    </MissionFrame>
  );
}
