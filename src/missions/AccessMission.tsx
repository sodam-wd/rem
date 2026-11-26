import { useEffect, useMemo, useRef, useState } from 'react';
import type { MissionProps } from '../app/contracts';
import { MissionFrame, focusNav, useMissionRun, type Tone } from './common';
import { ACCESS_LENGTH, generateAccess, validateAccess } from './access';
import { deriveSeed } from './rng';
import { SYMBOL_NAME_KO, SymbolGlyph } from './symbols';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'DEL', '0', 'OK'] as const;

export function AccessMission(props: MissionProps) {
  const run = useMissionRun(props);
  const [attempt, setAttempt] = useState(0);
  const puzzle = useMemo(
    () => generateAccess(props.level, attempt === 0 ? props.seed : deriveSeed(props.seed, attempt)),
    [props.level, props.seed, attempt],
  );
  const len = ACCESS_LENGTH[props.level];
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<{ tone: Tone; text: string }>({
    tone: 'idle',
    text: `암호 ${len}자리를 규칙대로 변환하여 입력하십시오.`,
  });

  const press = (key: (typeof KEYS)[number]) => {
    if (run.solved) return;
    if (key === 'DEL') {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (key === 'OK') {
      if (input.length < len) {
        setStatus({ tone: 'warn', text: `${len}자리를 모두 입력하십시오 (현재 ${input.length}자리).` });
        return;
      }
      if (validateAccess(puzzle, input)) {
        setStatus({ tone: 'ok', text: '접근 승인. 출입 통제 해제.' });
        run.log('접근 암호 승인');
        run.succeed();
      } else {
        setStatus({ tone: 'alert', text: '접근 거부: 암호 불일치. 새 암호와 대응표를 발급했습니다.' });
        run.fail('접근 암호 불일치');
        setInput('');
        setAttempt((a) => a + 1);
      }
      return;
    }
    setInput((v) => (v.length >= len ? v : v + key));
  };

  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (/^[0-9]$/.test(e.key)) pressRef.current(e.key as (typeof KEYS)[number]);
      else if (e.key === 'Backspace') pressRef.current('DEL');
      else if (e.key === 'Enter' && !(t && t.tagName === 'BUTTON')) pressRef.current('OK');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const codeLabel = puzzle.code.map((s) => SYMBOL_NAME_KO[s]).join(', ');

  return (
    <MissionFrame
      code="ACCESS"
      instrument="물리 키패드"
      rule={`${len}자리 암호. 대응표와 규칙을 순서대로 적용. 틀리면 새 암호 발급.`}
      failures={run.failures}
      tone={status.tone}
      status={status.text}
    >
      <div className="m-acc-code" aria-label={`수신 암호 기호: ${codeLabel}`}>
        {puzzle.code.map((s, i) => (
          <span className="m-acc-sym" key={i}>
            <span className="m-acc-pos m-mono">{i + 1}</span>
            <SymbolGlyph id={s} size={24} />
          </span>
        ))}
      </div>

      <table className="m-acc-table">
        <caption>기호 대응표</caption>
        <tbody>
          {[puzzle.table.slice(0, 5), puzzle.table.slice(5)].map((row, ri) => (
            <tr key={ri}>
              {row.map((e) => (
                <td key={e.symbol} aria-label={`${SYMBOL_NAME_KO[e.symbol]} = ${e.digit}`}>
                  <SymbolGlyph id={e.symbol} size={20} />
                  <span className="m-mono">{e.digit}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ol className="m-acc-steps">
        {puzzle.steps.map((s) => (
          <li key={s}>{s.replace(/^\d+\)\s*/, '')}</li>
        ))}
      </ol>

      <div className="m-acc-display m-mono" aria-label={`입력 ${input.length}자리: ${input.split('').join(' ') || '없음'}`}>
        {Array.from({ length: len }, (_, i) => (
          <span key={i} data-filled={i < input.length}>
            {input[i] ?? '·'}
          </span>
        ))}
      </div>

      <div className="m-keypad" role="group" aria-label="키패드">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className="m-key"
            data-kind={k === 'OK' ? 'ok' : k === 'DEL' ? 'del' : 'num'}
            data-nav="keypad"
            disabled={run.solved}
            aria-label={k === 'OK' ? '확인' : k === 'DEL' ? '한 자리 지움' : k}
            onClick={() => press(k)}
            onKeyDown={(e) => focusNav(e, 'keypad', 3)}
          >
            {k === 'OK' ? '확인' : k === 'DEL' ? '지움' : k}
          </button>
        ))}
      </div>
    </MissionFrame>
  );
}
