import type { Level } from '../app/contracts';
import { mulberry32, pick, randRange, shuffle } from './rng';
import { SYMBOL_IDS, type SymbolId } from './symbols';

/** Wire colors: low-saturation but separable; always shown with a Korean name label (never color-only). */
export type WireColor = 'red' | 'blue' | 'yellow' | 'green' | 'white';
export const WIRE_COLORS: readonly WireColor[] = ['red', 'blue', 'yellow', 'green', 'white'];
export const WIRE_COLOR_KO: Record<WireColor, string> = {
  red: '적',
  blue: '청',
  yellow: '황',
  green: '녹',
  white: '백',
};
export const WIRE_COLOR_HEX: Record<WireColor, string> = {
  red: '#c98a7f',
  blue: '#86a4c4',
  yellow: '#c9b184',
  green: '#8fb79a',
  white: '#d5d9d1',
};

export const POWER_PAIRS: Record<Level, number> = { 1: 3, 2: 5, 3: 7 };
/** Level 2: pairs are unique combos drawn from this many colors × this many symbols. */
export const POWER_L2_COLORS = 3;
export const POWER_L2_SYMBOLS = 3;
/** Level 3 circuit rules: out = in + k (wrap 7) | 8 − in | (8 − in) + k (wrap 7), k in POWER_CIRCUIT_K. */
export const POWER_CIRCUIT_KINDS = ['add', 'mirror', 'mirrorAdd'] as const;
export const POWER_CIRCUIT_K = { min: 1, max: 6 } as const;

export interface PowerTerminal {
  id: string;
  /** Visible identification label (number / letter) — never rely on color alone. */
  label: string;
  color: WireColor | null;
  symbol: SymbolId | null;
}

export interface PowerPuzzle {
  level: Level;
  /** Display order, top → bottom. */
  left: PowerTerminal[];
  right: PowerTerminal[];
  /** leftId → rightId */
  solution: Record<string, string>;
  /** Rule shown on the panel. */
  rule: string;
  /** Level 3 only: the circuit rule parameters behind `rule`. */
  circuit?: { kind: 'add' | 'mirror' | 'mirrorAdd'; k: number };
}

const LETTERS = 'ABCDEFG';

function wrap7(n: number): number {
  return ((((n - 1) % 7) + 7) % 7) + 1;
}

export function generatePower(level: Level, seed: number): PowerPuzzle {
  const rng = mulberry32(seed);
  const n = POWER_PAIRS[level];

  if (level === 3) {
    const kind = pick(rng, POWER_CIRCUIT_KINDS);
    const k = randRange(rng, POWER_CIRCUIT_K.min, POWER_CIRCUIT_K.max);
    let f: (i: number) => number;
    let rule: string;
    if (kind === 'add') {
      f = (i) => wrap7(i + k);
      rule = `회로 규칙: 출력 단자 = 입력 단자 + ${k} (7을 넘으면 7을 뺌)`;
    } else if (kind === 'mirror') {
      f = (i) => 8 - i;
      rule = '회로 규칙: 출력 단자 = 8 − 입력 단자';
    } else {
      f = (i) => wrap7(8 - i + k);
      rule = `회로 규칙: 출력 단자 = (8 − 입력 단자) + ${k} (7을 넘으면 7을 뺌)`;
    }
    const nums = [1, 2, 3, 4, 5, 6, 7];
    const left = shuffle(rng, nums).map<PowerTerminal>((i) => ({
      id: `L${i}`,
      label: `IN ${i}`,
      color: null,
      symbol: null,
    }));
    const right = shuffle(rng, nums).map<PowerTerminal>((o) => ({
      id: `R${o}`,
      label: `OUT ${o}`,
      color: null,
      symbol: null,
    }));
    const solution: Record<string, string> = {};
    for (const i of nums) solution[`L${i}`] = `R${f(i)}`;
    return { level, left, right, solution, rule, circuit: { kind, k: kind === 'mirror' ? 0 : k } };
  }

  // Level 1: same color (n distinct colors). Level 2: unique color+symbol combos from 3 colors × 3 symbols.
  let combos: { color: WireColor; symbol: SymbolId | null }[];
  if (level === 1) {
    combos = shuffle(rng, WIRE_COLORS)
      .slice(0, n)
      .map((color) => ({ color, symbol: null }));
  } else {
    const colors = shuffle(rng, WIRE_COLORS).slice(0, POWER_L2_COLORS);
    const symbols = shuffle(rng, SYMBOL_IDS).slice(0, POWER_L2_SYMBOLS);
    const all: { color: WireColor; symbol: SymbolId }[] = [];
    for (const color of colors) for (const symbol of symbols) all.push({ color, symbol });
    combos = shuffle(rng, all).slice(0, n);
  }
  const leftOrder = shuffle(
    rng,
    combos.map((_, i) => i),
  );
  const rightOrder = shuffle(
    rng,
    combos.map((_, i) => i),
  );
  const left = leftOrder.map<PowerTerminal>((ci, pos) => ({
    id: `L${ci}`,
    label: String(pos + 1),
    color: combos[ci].color,
    symbol: combos[ci].symbol,
  }));
  const right = rightOrder.map<PowerTerminal>((ci, pos) => ({
    id: `R${ci}`,
    label: LETTERS[pos],
    color: combos[ci].color,
    symbol: combos[ci].symbol,
  }));
  const solution: Record<string, string> = {};
  combos.forEach((_, ci) => {
    solution[`L${ci}`] = `R${ci}`;
  });
  const rule =
    level === 1
      ? '같은 색 단자끼리 연결 (색 이름 표기)'
      : '색과 기호가 모두 같은 단자끼리 연결';
  return { level, left, right, solution, rule };
}

export function isCorrectPair(p: PowerPuzzle, leftId: string, rightId: string): boolean {
  return p.solution[leftId] === rightId;
}

/** True when every left terminal is connected to its correct right terminal (and nothing else). */
export function validatePower(p: PowerPuzzle, connections: Record<string, string>): boolean {
  const keys = Object.keys(connections);
  if (keys.length !== p.left.length) return false;
  return p.left.every((t) => connections[t.id] === p.solution[t.id]);
}
