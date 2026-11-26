import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { MissionProps } from '../app/contracts';
import { MissionFrame, focusNav, useMissionRun, type Tone } from './common';
import {
  POWER_ERROR_MS,
  POWER_FAIL_MESSAGE,
  POWER_RULE_TEXT,
  WIRE_COLOR_HEX,
  WIRE_COLOR_KO,
  generatePower,
  isCorrectPair,
  validatePower,
  type PowerTerminal,
} from './power';

/** Panel geometry (px). Terminals sit at a fixed inset from each edge; rows are evenly spaced. */
const ROW_H = 60;
const INSET = 28; // terminal centre distance from the panel edge
const HIT_X = 34; // generous horizontal hit radius for fingers
const DEFAULT_W = 320; // used until the panel has been measured (and in jsdom)

type Side = 'left' | 'right';
interface Pt {
  x: number;
  y: number;
}

/** Gentle drooping cable between two points. */
export function cablePath(a: Pt, b: Pt): string {
  const dx = b.x - a.x;
  const sag = Math.min(36, Math.abs(dx) * 0.12 + Math.abs(b.y - a.y) * 0.08 + 8);
  const c1 = { x: a.x + dx * 0.35, y: a.y + sag };
  const c2 = { x: b.x - dx * 0.35, y: b.y + sag };
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export function PowerMission(props: MissionProps) {
  const run = useMissionRun(props);
  const puzzle = useMemo(() => generatePower(props.level, props.seed), [props.level, props.seed]);
  const total = puzzle.left.length;
  const height = total * ROW_H;

  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_W);
  const [connections, setConnections] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: string; pointerId: number; to: Pt } | null>(null);
  const [errorPair, setErrorPair] = useState<[string, string] | null>(null);
  const errorTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<{ tone: Tone; text: string }>({
    tone: 'idle',
    text: '단자를 누른 채 같은 색 단자까지 선을 끌어 놓으십시오.',
  });

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setWidth(w > 0 ? w : DEFAULT_W);
    };
    measure();
    window.addEventListener('resize', measure);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);
  useEffect(
    () => () => {
      if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    },
    [],
  );

  const byId = useMemo(() => {
    const m = new Map<string, { t: PowerTerminal; side: Side; row: number }>();
    puzzle.left.forEach((t, row) => m.set(t.id, { t, side: 'left', row }));
    puzzle.right.forEach((t, row) => m.set(t.id, { t, side: 'right', row }));
    return m;
  }, [puzzle]);

  const centre = (id: string): Pt => {
    const e = byId.get(id)!;
    return { x: e.side === 'left' ? INSET : width - INSET, y: (e.row + 0.5) * ROW_H };
  };
  const connectedRight = new Set(Object.values(connections));
  const isConnected = (id: string) =>
    byId.get(id)!.side === 'left' ? id in connections : connectedRight.has(id);
  const done = Object.keys(connections).length;

  const toLocal = (e: { clientX: number; clientY: number }): Pt => {
    const r = panelRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const hitTest = (p: Pt): string | null => {
    if (p.y < 0 || p.y >= height) return null;
    const row = Math.floor(p.y / ROW_H);
    if (Math.abs(p.x - INSET) <= HIT_X) return puzzle.left[row]?.id ?? null;
    if (Math.abs(p.x - (width - INSET)) <= HIT_X) return puzzle.right[row]?.id ?? null;
    return null;
  };

  const tryConnect = (a: string, b: string) => {
    const [leftId, rightId] = byId.get(a)!.side === 'left' ? [a, b] : [b, a];
    setSelected(null);
    if (isCorrectPair(puzzle, leftId, rightId)) {
      const next = { ...connections, [leftId]: rightId };
      setConnections(next);
      const name = WIRE_COLOR_KO[byId.get(leftId)!.t.color];
      run.log(`${name} 배선 연결`);
      if (validatePower(puzzle, next)) {
        setStatus({ tone: 'ok', text: `전 회로 연결 완료 (${total}/${total}). 배전 정상.` });
        run.succeed();
      } else {
        setStatus({ tone: 'ok', text: `배선 연결됨 (${Object.keys(next).length}/${total}).` });
      }
    } else {
      setErrorPair([leftId, rightId]);
      if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
      errorTimer.current = window.setTimeout(() => setErrorPair(null), POWER_ERROR_MS);
      setStatus({ tone: 'alert', text: '오연결: 색이 다른 단자입니다. 선을 다시 그으십시오.' });
      run.fail(POWER_FAIL_MESSAGE);
    }
  };

  /** Tap / keyboard sequential selection: first terminal, then a terminal on the other side. */
  const select = (id: string) => {
    if (run.solved || isConnected(id)) return;
    if (selected && selected !== id && byId.get(selected)!.side !== byId.get(id)!.side) {
      tryConnect(selected, id);
      return;
    }
    setSelected(selected === id ? null : id);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (run.solved || drag) return;
    const id = hitTest(toLocal(e));
    if (!id || isConnected(id)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    setDrag({ from: id, pointerId: e.pointerId, to: toLocal(e) });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    setDrag({ ...drag, to: toLocal(e) });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const from = drag.from;
    setDrag(null);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    const target = hitTest(toLocal(e));
    if (target === from) {
      select(from); // a tap on a terminal
      return;
    }
    if (!target || isConnected(target) || byId.get(target)!.side === byId.get(from)!.side) {
      return; // released on empty space / same side: cancel, no failure
    }
    tryConnect(from, target);
  };
  const onPointerCancel = () => setDrag(null);

  /** Keyboard and assistive-tech activation (click with detail 0). Pointer taps are handled above. */
  const onTerminalClick = (e: MouseEvent<HTMLButtonElement>, id: string) => {
    if (e.detail !== 0) return;
    select(id);
  };

  const renderTerminal = (t: PowerTerminal, side: Side, row: number) => {
    const connected = isConnected(t.id);
    const isSel = selected === t.id || drag?.from === t.id;
    const isErr = !!errorPair && errorPair.includes(t.id);
    const state = isErr ? 'error' : connected ? 'connected' : isSel ? 'selected' : 'open';
    const label = `${side === 'left' ? '왼쪽' : '오른쪽'} ${WIRE_COLOR_KO[t.color]} 단자${
      connected ? ', 연결됨' : isSel ? ', 선택됨' : ''
    }`;
    return (
      <button
        key={t.id}
        type="button"
        className="m-jack"
        data-side={side}
        data-state={state}
        data-terminal={t.id}
        data-nav={`power-${side}`}
        style={{
          top: row * ROW_H + (ROW_H - 44) / 2,
          ['--jack' as string]: WIRE_COLOR_HEX[t.color],
        }}
        aria-disabled={connected || run.solved}
        aria-pressed={isSel}
        aria-label={label}
        onClick={(e) => onTerminalClick(e, t.id)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const target = e.key === 'ArrowLeft' ? 'left' : 'right';
            if (target === side) return;
            const root = e.currentTarget.closest('.m-frame');
            const first = root?.querySelector<HTMLElement>(
              `[data-nav="power-${target}"]:not([aria-disabled="true"])`,
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
        <span className="m-jack-core" aria-hidden="true" />
      </button>
    );
  };

  const dragFrom = drag ? byId.get(drag.from)! : null;

  return (
    <MissionFrame
      code="POWER"
      instrument="배전반 단자대"
      rule={POWER_RULE_TEXT}
      failures={run.failures}
      tone={status.tone}
      status={status.text}
    >
      <div className="m-power-meta m-mono" aria-label={`연결 ${done} / ${total}`}>
        연결 {done} / {total}
      </div>
      <div
        ref={panelRef}
        className="m-power-panel"
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
      >
        <svg
          className="m-power-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          {puzzle.left.map((_, row) => (
            <line
              key={row}
              x1={INSET + 26}
              x2={width - INSET - 26}
              y1={(row + 0.5) * ROW_H}
              y2={(row + 0.5) * ROW_H}
              className="m-power-guide"
            />
          ))}
          {Object.entries(connections).map(([l, r]) => {
            const d = cablePath(centre(l), centre(r));
            return (
              <g key={l} className="m-cable">
                <path d={d} className="m-cable-sheath" />
                <path d={d} className="m-cable-core" style={{ stroke: WIRE_COLOR_HEX[byId.get(l)!.t.color] }} />
              </g>
            );
          })}
          {drag && dragFrom && (
            <g className="m-cable" data-live="true">
              <path d={cablePath(centre(drag.from), drag.to)} className="m-cable-sheath" />
              <path
                d={cablePath(centre(drag.from), drag.to)}
                className="m-cable-core"
                style={{ stroke: WIRE_COLOR_HEX[dragFrom.t.color] }}
              />
              <circle cx={drag.to.x} cy={drag.to.y} r={6} className="m-cable-plug" style={{ fill: WIRE_COLOR_HEX[dragFrom.t.color] }} />
            </g>
          )}
        </svg>
        {puzzle.left.map((t, row) => renderTerminal(t, 'left', row))}
        {puzzle.right.map((t, row) => renderTerminal(t, 'right', row))}
      </div>
    </MissionFrame>
  );
}
