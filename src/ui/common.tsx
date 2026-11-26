import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import type { DiagState, ModuleId } from '../app/contracts';
import { MODULE_IDS } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { MODULE_LABEL } from '../reports/labels';

export const asset = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`;

/** Fact notice (no external push) — shown on main, schedule, system, install guide. */
export const STANDBY_NOTICE =
  '화면을 켠 채 대기 모드로 두어야 경보가 울립니다. 잠금 화면이나 앱 종료 상태의 경보는 아직 지원하지 않습니다.';
export const VIRTUAL_NOTICE =
  'R.E.M.(현실 비상 관리국)은 실제 기관이 아닌 가상 서비스입니다. 모든 기록은 이 기기에만 저장됩니다.';

const pad = (n: number) => String(n).padStart(2, '0');
export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** "7시간 12분 후" style remaining time. */
export function fmtRemaining(ms: number): string {
  if (ms <= 0) return '곧 발생';
  const totalMin = Math.ceil(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}일`);
  if (h) parts.push(`${h}시간`);
  if (m || parts.length === 0) parts.push(`${m}분`);
  return `${parts.join(' ')} 후`;
}

export function Screen(props: { en: string; ko: string; back?: string | false; children: ReactNode; actions?: ReactNode }) {
  const { navigate } = useRem();
  const back = props.back === undefined ? '/' : props.back;
  return (
    <main className="ui-screen">
      <header className="ui-topbar">
        {back !== false ? (
          <button type="button" className="ui-btn ui-btn-ghost ui-back" onClick={() => navigate(back)} aria-label="이전 화면">
            ←
          </button>
        ) : null}
        <div className="ui-topbar-title">
          <div className="ui-topbar-en">{props.en}</div>
          <h1 className="ui-topbar-ko">{props.ko}</h1>
        </div>
        {props.actions}
      </header>
      <StorageBanner />
      {props.children}
    </main>
  );
}

export function StorageBanner() {
  const { storageError } = useRem();
  if (!storageError) return null;
  return (
    <div className="ui-banner ui-banner-alert" role="alert">
      <strong>저장 오류</strong> — {storageError} 변경 사항이 기기에 저장되지 않았을 수 있습니다. 브라우저 저장 공간과 사생활 보호 모드를 확인하십시오.
    </div>
  );
}

export function Panel(props: { title: string; en?: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`ui-panel ${props.className ?? ''}`} id={props.id} aria-label={props.title}>
      <div className="ui-panel-head">
        <h2>{props.title}</h2>
        {props.en ? <span className="ui-label-en">{props.en}</span> : null}
      </div>
      {props.children}
    </section>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className="ui-switch"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="ui-switch-track" aria-hidden="true" />
      <span className="ui-switch-text" aria-hidden="true">{props.checked ? 'ON' : 'OFF'}</span>
    </button>
  );
}

export function Stepper(props: { value: number; min: number; max: number; unit: string; label: string; onChange: (v: number) => void; disabled?: boolean }) {
  const { value, min, max } = props;
  return (
    <div className="ui-stepper" role="group" aria-label={props.label}>
      <button type="button" aria-label={`${props.label} 줄이기`} disabled={props.disabled || value <= min} onClick={() => props.onChange(Math.max(min, value - 1))}>
        −
      </button>
      <output aria-live="polite">
        {value}
        {props.unit}
      </output>
      <button type="button" aria-label={`${props.label} 늘리기`} disabled={props.disabled || value >= max} onClick={() => props.onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

/** Keeps Tab focus inside a modal container and restores focus to the previous element on close. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return;
      const items = Array.from(
        ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!ref.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [ref]);
}

export function ConfirmDialog(props: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef);
  const onCancelRef = useRef(props.onCancel);
  onCancelRef.current = props.onCancel;
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="ui-dialog-backdrop">
      <div ref={boxRef} className="ui-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`}>
        <h2 id={`${id}-t`}>{props.title}</h2>
        <div id={`${id}-b`} className="ui-note">{props.body}</div>
        <div className="ui-row">
          <button ref={cancelRef} type="button" className="ui-btn" style={{ flex: 1 }} onClick={props.onCancel}>
            돌아가기
          </button>
          <button type="button" className={`ui-btn ${props.danger ? 'ui-btn-danger' : 'ui-btn-primary'}`} style={{ flex: 1 }} onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const DIAG_LABEL: Record<DiagState, { text: string; cls: string }> = {
  unknown: { text: '미점검', cls: 'st-dim' },
  ok: { text: '정상', cls: 'st-ok' },
  'manual-ok': { text: '수동 확인 정상', cls: 'st-ok' },
  denied: { text: '거부됨', cls: 'st-alert' },
  unsupported: { text: '미지원', cls: 'st-warn' },
  failed: { text: '실패', cls: 'st-alert' },
};
export function DiagChip({ state }: { state: DiagState }) {
  const d = DIAG_LABEL[state] ?? DIAG_LABEL.unknown;
  return <span className={`ui-chip ${d.cls}`}>{d.text}</span>;
}

/**
 * Module selector.
 *  - ordered: tap to append; selected items show order with ↑/↓/제거 controls (manual mode, simulation).
 *  - pool: checkboxes (random allowed pool).
 */
export function ModulePicker(props: { mode: 'ordered' | 'pool'; value: ModuleId[]; onChange: (v: ModuleId[]) => void; max?: number; invalid?: boolean; describedBy?: string }) {
  const { value, onChange } = props;
  const max = props.max ?? 5;
  if (props.mode === 'pool') {
    return (
      <div className="ui-mod-pool" role="group" aria-label="랜덤 허용 모듈" aria-describedby={props.describedBy}>
        {MODULE_IDS.map((m) => {
          const on = value.includes(m);
          return (
            <label key={m} className="ui-mod-item" data-on={on}>
              <span className="ui-check-label">
                <input
                  type="checkbox"
                  className="ui-check"
                  checked={on}
                  onChange={() => onChange(on ? value.filter((x) => x !== m) : MODULE_IDS.filter((x) => x === m || value.includes(x)))}
                />
                <span className="ui-mod-name">
                  <span className="mono">{m}</span>
                  {MODULE_LABEL[m].ko}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    );
  }
  const move = (i: number, d: -1 | 1) => {
    const next = value.slice();
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remaining = MODULE_IDS.filter((m) => !value.includes(m));
  return (
    <div className="ui-stack" aria-describedby={props.describedBy}>
      <ol className="ui-mod-pool" aria-label="선택된 모듈 순서" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {value.length === 0 ? <li className="ui-note">선택된 모듈이 없습니다. 아래에서 순서대로 추가하십시오.</li> : null}
        {value.map((m, i) => (
          <li key={m} className="ui-mod-item" data-on="true">
            <span className="ui-mod-idx">{i + 1}</span>
            <span className="ui-mod-name">
              <span className="mono">{m}</span>
              {MODULE_LABEL[m].ko}
            </span>
            <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" aria-label={`${m} 위로`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" aria-label={`${m} 아래로`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" aria-label={`${m} 제거`} onClick={() => onChange(value.filter((x) => x !== m))}>제거</button>
          </li>
        ))}
      </ol>
      {remaining.length > 0 ? (
        <div className="ui-row" role="group" aria-label="모듈 추가">
          {remaining.map((m) => (
            <button key={m} type="button" className="ui-btn ui-btn-sm" disabled={value.length >= max} onClick={() => onChange([...value, m])}>
              + <span className="mono">{m}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
