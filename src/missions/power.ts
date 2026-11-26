import type { Level } from '../app/contracts';
import { mulberry32, shuffle } from './rng';

/* ---------------- POWER constants ---------------- */

/** Pair count is the only difficulty axis: every level is "connect the same color". */
export const POWER_PAIRS: Record<Level, number> = { 1: 3, 2: 5, 3: 7 };

/** Seven industrial wiring colors: low-saturation, but clearly separable from each other. */
export type WireColor = 'white' | 'red' | 'green' | 'yellow' | 'blue' | 'orange' | 'purple';
export const WIRE_COLORS: readonly WireColor[] = [
  'white',
  'red',
  'green',
  'yellow',
  'blue',
  'orange',
  'purple',
];
export const WIRE_COLOR_HEX: Record<WireColor, string> = {
  white: '#ddd8c6',
  red: '#c4665b',
  green: '#6ea47a',
  yellow: '#d6b85a',
  blue: '#5e8ec2',
  orange: '#d4874a',
  purple: '#9a7dbc',
};
/** Screen-reader names only (never rendered as visible text). */
export const WIRE_COLOR_KO: Record<WireColor, string> = {
  white: '흰색',
  red: '빨간색',
  green: '초록색',
  yellow: '노란색',
  blue: '파란색',
  orange: '주황색',
  purple: '보라색',
};

/** Instruction line shown at the top of the panel. */
export const POWER_RULE_TEXT = '같은 색 단자를 선으로 이으십시오.';
/** Failure message passed to onFailure on a wrong-color connection. */
export const POWER_FAIL_MESSAGE = '배전반 오연결';
/** Duration of the static (non-flashing) error mark on a wrong connection. */
export const POWER_ERROR_MS = 700;

/* ---------------- model ---------------- */

export interface PowerTerminal {
  id: string;
  color: WireColor;
}

export interface PowerPuzzle {
  level: Level;
  /** Display order, top → bottom. */
  left: PowerTerminal[];
  right: PowerTerminal[];
  /** leftId → rightId */
  solution: Record<string, string>;
}

export function generatePower(level: Level, seed: number): PowerPuzzle {
  const rng = mulberry32(seed);
  const n = POWER_PAIRS[level];
  const colors = shuffle(rng, WIRE_COLORS).slice(0, n);
  const left = shuffle(rng, colors);
  let right = shuffle(rng, colors);
  // Avoid the trivial layout where every wire would run straight across.
  for (let i = 0; i < 8 && right.every((c, k) => c === left[k]); i++) right = shuffle(rng, colors);
  if (right.every((c, k) => c === left[k])) right = [...right.slice(1), right[0]];
  const solution: Record<string, string> = {};
  for (const c of colors) solution[`L-${c}`] = `R-${c}`;
  return {
    level,
    left: left.map((color) => ({ id: `L-${color}`, color })),
    right: right.map((color) => ({ id: `R-${color}`, color })),
    solution,
  };
}

export function isCorrectPair(p: PowerPuzzle, leftId: string, rightId: string): boolean {
  return p.solution[leftId] === rightId;
}

/** True when every left terminal is connected to its same-color right terminal. */
export function validatePower(p: PowerPuzzle, connections: Record<string, string>): boolean {
  if (Object.keys(connections).length !== p.left.length) return false;
  return p.left.every((t) => connections[t.id] === p.solution[t.id]);
}
