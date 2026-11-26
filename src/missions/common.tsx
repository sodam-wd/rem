import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { MissionProps } from '../app/contracts';

export type Tone = 'idle' | 'ok' | 'warn' | 'alert';

const TONE_LABEL: Record<Tone, string> = {
  idle: '대기',
  ok: '정상',
  warn: '주의',
  alert: '오류',
};

/**
 * Shared bookkeeping for a mission run: elapsed time, failure count, single onSuccess call.
 * Always reads the latest props through a ref so timers never call stale callbacks.
 */
export function useMissionRun(props: MissionProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const startRef = useRef<number>(Date.now());
  const failRef = useRef(0);
  const doneRef = useRef(false);
  const [failures, setFailures] = useState(0);
  const [solved, setSolved] = useState(false);

  const fail = useCallback((message: string) => {
    if (doneRef.current) return;
    failRef.current += 1;
    setFailures(failRef.current);
    propsRef.current.onFailure(message);
  }, []);

  const succeed = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setSolved(true);
    propsRef.current.onSuccess({
      durationMs: Math.max(0, Date.now() - startRef.current),
      failures: failRef.current,
    });
  }, []);

  const log = useCallback((message: string) => {
    propsRef.current.onLog?.(message);
  }, []);

  return { failures, solved, fail, succeed, log, attempt: failRef };
}

export function MissionFrame(props: {
  code: string;
  instrument: string;
  rule: string;
  failures: number;
  tone: Tone;
  status: string;
  children: ReactNode;
}) {
  return (
    <section className="m-frame" aria-label={`${props.instrument} 계기`}>
      <header className="m-head">
        <div className="m-head-row">
          <span className="m-code">{props.code}</span>
          <h2 className="m-title">{props.instrument}</h2>
          <span className="m-fail" aria-label={`실패 ${props.failures}회`}>
            실패 <b>{props.failures}</b>회
          </span>
        </div>
        <p className="m-rule">{props.rule}</p>
      </header>
      <p className="m-status" data-tone={props.tone} role="status" aria-live="polite">
        <span className="m-status-tag">[{TONE_LABEL[props.tone]}]</span> {props.status}
      </p>
      <div className="m-body">{props.children}</div>
    </section>
  );
}

/**
 * Continuous-hold timer: calls onHold once `active` stays true for `holdMs`.
 * Returns the current held duration (ms) for progress display.
 */
export function useHold(active: boolean, holdMs: number, onHold: () => void, resetKey: unknown = 0) {
  const [held, setHeld] = useState(0);
  const cbRef = useRef(onHold);
  cbRef.current = onHold;
  useEffect(() => {
    setHeld(0);
    if (!active) return;
    const start = Date.now();
    const tick = window.setInterval(() => {
      setHeld(Math.min(holdMs, Date.now() - start));
    }, 100);
    const done = window.setTimeout(() => {
      window.clearInterval(tick);
      setHeld(holdMs);
      cbRef.current();
    }, holdMs);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
  }, [active, holdMs, resetKey]);
  return held;
}

export function HoldMeter({ held, holdMs, label }: { held: number; holdMs: number; label: string }) {
  const pct = Math.round((held / holdMs) * 100);
  return (
    <div className="m-hold">
      <div className="m-hold-label">
        <span>{label}</span>
        <span className="m-mono">
          {(held / 1000).toFixed(1)} / {(holdMs / 1000).toFixed(1)} s
        </span>
      </div>
      <div
        className="m-hold-bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Move focus among sibling buttons sharing a data-nav group, for arrow-key navigation in grids/columns. */
export function focusNav(
  e: KeyboardEvent<HTMLElement>,
  group: string,
  cols: number,
): boolean {
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (!keys.includes(e.key)) return false;
  const root = e.currentTarget.closest('.m-frame');
  if (!root) return false;
  const items = Array.from(root.querySelectorAll<HTMLElement>(`[data-nav="${group}"]`));
  const idx = items.indexOf(e.currentTarget);
  if (idx < 0) return false;
  let next = idx;
  if (e.key === 'ArrowLeft') next = idx - 1;
  if (e.key === 'ArrowRight') next = idx + 1;
  if (e.key === 'ArrowUp') next = idx - cols;
  if (e.key === 'ArrowDown') next = idx + cols;
  if (next < 0 || next >= items.length) return true;
  e.preventDefault();
  items[next].focus();
  return true;
}
