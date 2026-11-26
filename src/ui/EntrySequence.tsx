import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { INTRO_MS } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { asset } from './common';

/** recovery-office.png intrinsic size. */
const IMG_W = 1672;
const IMG_H = 941;
/**
 * Dark glass area of the CRT, measured from the image (≈ x 749–924, y 456–591 px):
 * the safe inner rectangle inside the curved glass, NOT the bezel. Zooming to this rectangle
 * (instead of the outer screen frame in tokens.css --crt-*) keeps the beige bezel off-screen,
 * which previously showed as a faint rectangular edge during the zoom.
 */
export const CRT = { x: 0.5003, y: 0.5558, w: 0.1047, h: 0.1435 };

export interface EntryGeometry {
  img: { left: number; top: number; width: number; height: number };
  origin: { x: number; y: number };
  translate: { x: number; y: number };
  scale: number;
}

/**
 * Cover-fit the office image into the viewport, then compute a transform that moves the CRT screen
 * centre to the viewport centre and scales it until the screen covers the whole viewport
 * (works for portrait phones, where the zoom is limited by height).
 */
export function entryGeometry(vw: number, vh: number): EntryGeometry {
  const s = Math.max(vw / IMG_W, vh / IMG_H);
  const width = IMG_W * s;
  const height = IMG_H * s;
  const left = (vw - width) / 2;
  const top = (vh - height) / 2;
  const cx = left + CRT.x * width;
  const cy = top + CRT.y * height;
  const cw = CRT.w * width;
  const ch = CRT.h * height;
  const scale = Math.max(vw / cw, vh / ch) * 1.06;
  return { img: { left, top, width, height }, origin: { x: cx, y: cy }, translate: { x: vw / 2 - cx, y: vh / 2 - cy }, scale };
}

const BOOT_LINES = [
  ['R.E.M. BIOS 1.0.0', 'OK'],
  ['MEMORY CHECK 640K', 'OK'],
  ['REALITY LINK BUS', 'OK'],
  ['TERMINAL AUTH', 'OK'],
  ['LOADING RECOVERY TERMINAL', '…'],
] as const;

type Phase = 'office' | 'zoom' | 'boot';

export function EntrySequence({ onDone }: { onDone: () => void }) {
  const { reducedMotion, settings } = useRem();
  const [phase, setPhase] = useState<Phase>('office');
  const [lines, setLines] = useState(reducedMotion ? BOOT_LINES.length : 0);
  const [size, setSize] = useState(() => ({ w: typeof window !== 'undefined' ? window.innerWidth : 390, h: typeof window !== 'undefined' ? window.innerHeight : 844 }));
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  };

  useLayoutEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    if (reducedMotion) {
      // No zoom: brief fade to the boot screen, then hand over.
      at(400, () => setPhase('boot'));
      at(2400, finish);
    } else {
      at(1000, () => setPhase('zoom'));
      at(3000, () => setPhase('boot'));
      BOOT_LINES.forEach((_, i) => at(3100 + i * 280, () => setLines(i + 1)));
      at(INTRO_MS, finish);
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const g = entryGeometry(size.w, size.h);
  const zoomed = phase !== 'office';
  const stageStyle: CSSProperties = {
    transformOrigin: `${g.origin.x}px ${g.origin.y}px`,
    transform: zoomed ? `translate(${g.translate.x}px, ${g.translate.y}px) scale(${g.scale})` : 'none',
    transition: reducedMotion ? 'none' : 'transform 2s cubic-bezier(.55,.05,.6,.95)',
  };

  return (
    <div className="ui-entry" role="dialog" aria-modal="true" aria-label="단말기 접속">
      {phase !== 'boot' || !reducedMotion ? (
        <div className="ui-entry-stage" style={stageStyle} aria-hidden="true">
          <img src={asset('recovery-office.png')} alt="" style={{ left: g.img.left, top: g.img.top, width: g.img.width, height: g.img.height }} draggable={false} />
        </div>
      ) : null}
      <div
        className="ui-entry-black"
        style={{ opacity: phase === 'zoom' || phase === 'boot' ? 1 : 0, transition: reducedMotion ? 'none' : `opacity .7s ease ${phase === 'zoom' ? '1.2s' : '0s'}` }}
      />
      <div className="ui-entry-boot" data-on={phase === 'boot'} aria-live="polite">
        <ul className="ui-entry-log">
          {BOOT_LINES.slice(0, lines).map(([t, r]) => (
            <li key={t}>
              {t} … <span>{r}</span>
            </li>
          ))}
          {lines > 0 ? <li>TERMINAL ID <span>{settings.terminalId}</span></li> : null}
        </ul>
        <img className="ui-entry-logo" src={asset('rem-logo.svg')} alt="R.E.M. 공식 심볼" width={88} height={92} />
        <div className="ui-entry-title">
          <div className="ui-entry-title-en">RETURN TO CONSCIOUSNESS.</div>
          <div className="ui-entry-title-ko">현실로 복귀하십시오.</div>
          <div className="mono dim" style={{ fontSize: 12, marginTop: 10 }}>R.E.M. : Recovery Terminal · 현실 복구 단말기</div>
        </div>
      </div>
      <button type="button" className="ui-btn ui-btn-sm ui-entry-skip" onClick={finish}>
        건너뛰기 <span className="ui-label-en">SKIP</span>
      </button>
      <p className="ui-entry-foot">R.E.M.(현실 비상 관리국)은 실제 기관이 아닌 가상 서비스입니다.</p>
    </div>
  );
}
