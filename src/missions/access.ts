import type { Level } from '../app/contracts';
import { mulberry32, pick, randInt, randRange, shuffle } from './rng';
import { SYMBOL_IDS, type SymbolId } from './symbols';

export const ACCESS_LENGTH: Record<Level, number> = { 1: 4, 2: 6, 3: 8 };
/** Level ≥2 order rules; 'rotate' moves the first k digits (1..ACCESS_ROTATE_MAX) to the end. */
export const ACCESS_ORDER_KINDS = ['reverse', 'swapHalves', 'rotate'] as const;
export const ACCESS_ROTATE_MAX = 3;
/** Level 3 digit rules; 'add' uses k in ACCESS_ADD_RANGE (mod 10), 'complement' maps n → 9 − n. */
export const ACCESS_DIGIT_KINDS = ['add', 'complement'] as const;
export const ACCESS_ADD_RANGE = { min: 1, max: 9 } as const;

export type OrderRule =
  | { kind: 'reverse' }
  | { kind: 'swapHalves' }
  | { kind: 'rotate'; k: number };

export type DigitRule = { kind: 'add'; k: number } | { kind: 'complement' };

export interface AccessPuzzle {
  level: Level;
  /** symbol → digit (bijection over 10 symbols / digits 0–9). */
  table: { symbol: SymbolId; digit: number }[];
  code: SymbolId[];
  digitRule: DigitRule | null;
  orderRule: OrderRule | null;
  /** Human-readable steps, in application order. */
  steps: string[];
  /** The unique correct key sequence. */
  answer: string;
}

export function applyOrder(digits: number[], r: OrderRule): number[] {
  const d = digits.slice();
  switch (r.kind) {
    case 'reverse':
      return d.reverse();
    case 'swapHalves': {
      const h = d.length / 2;
      return [...d.slice(h), ...d.slice(0, h)];
    }
    case 'rotate':
      return [...d.slice(r.k), ...d.slice(0, r.k)];
  }
}

export function applyDigit(n: number, r: DigitRule): number {
  return r.kind === 'add' ? (n + r.k) % 10 : 9 - n;
}

function orderText(r: OrderRule, len: number): string {
  switch (r.kind) {
    case 'reverse':
      return '순서 규칙: 전체를 역순으로 입력';
    case 'swapHalves':
      return `순서 규칙: 앞 ${len / 2}자리와 뒤 ${len / 2}자리를 맞바꿔 입력`;
    case 'rotate':
      return `순서 규칙: 앞 ${r.k}자리를 맨 뒤로 옮겨 입력`;
  }
}

function digitText(r: DigitRule): string {
  return r.kind === 'add'
    ? `숫자 규칙: 각 자리에 ${r.k}${[1, 3, 6, 7, 8].includes(r.k) ? '을' : '를'} 더함 (10 이상이면 10을 뺌)`
    : '숫자 규칙: 각 자리 숫자 n을 (9 − n)으로 바꿈';
}

/** Solve a puzzle from its visible information only (used to derive `answer` and in tests). */
export function solveAccess(p: Pick<AccessPuzzle, 'table' | 'code' | 'digitRule' | 'orderRule'>): string {
  const map = new Map(p.table.map((e) => [e.symbol, e.digit]));
  let digits = p.code.map((s) => map.get(s)!);
  if (p.digitRule) digits = digits.map((n) => applyDigit(n, p.digitRule!));
  if (p.orderRule) digits = applyOrder(digits, p.orderRule);
  return digits.join('');
}

export function generateAccess(level: Level, seed: number): AccessPuzzle {
  const rng = mulberry32(seed);
  const len = ACCESS_LENGTH[level];
  const digits = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const symbols = shuffle(rng, SYMBOL_IDS);
  const table = symbols.map((symbol, i) => ({ symbol, digit: digits[i] }));
  // Present the table sorted by digit so it reads like a printed card.
  table.sort((a, b) => a.digit - b.digit);
  const code = Array.from({ length: len }, () => symbols[randInt(rng, symbols.length)]);

  let orderRule: OrderRule | null = null;
  let digitRule: DigitRule | null = null;
  if (level >= 2) {
    const kind = pick(rng, ACCESS_ORDER_KINDS);
    orderRule =
      kind === 'rotate'
        ? { kind, k: randRange(rng, 1, Math.min(ACCESS_ROTATE_MAX, len - 1)) }
        : ({ kind } as OrderRule);
  }
  if (level === 3) {
    digitRule = pick(rng, ACCESS_DIGIT_KINDS) === 'add'
      ? { kind: 'add', k: randRange(rng, ACCESS_ADD_RANGE.min, ACCESS_ADD_RANGE.max) }
      : { kind: 'complement' };
  }

  const steps = ['1) 대응표로 각 기호를 숫자로 변환'];
  if (digitRule) steps.push(`${steps.length + 1}) ${digitText(digitRule)}`);
  if (orderRule) steps.push(`${steps.length + 1}) ${orderText(orderRule, len)}`);

  const base = { table, code, digitRule, orderRule };
  return { level, ...base, steps, answer: solveAccess(base) };
}

export function validateAccess(p: AccessPuzzle, input: string): boolean {
  return input === p.answer;
}
