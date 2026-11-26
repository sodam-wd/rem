import type { Level } from '../app/contracts';
import { mulberry32, randInt } from './rng';

export type SignalParam = 'freq' | 'amp' | 'phase';

export interface SignalRange {
  min: number;
  max: number;
  step: number;
  unit: string;
  labelKo: string;
  decimals: number;
}

/** Control ranges (display scale: 100 ms/div × 10 div, 1 V/div × ±4 div). */
export const SIGNAL_RANGE: Record<SignalParam, SignalRange> = {
  freq: { min: 1, max: 8, step: 0.1, unit: 'Hz', labelKo: '주파수', decimals: 1 },
  amp: { min: 0.5, max: 3.5, step: 0.1, unit: 'V', labelKo: '진폭', decimals: 1 },
  phase: { min: 0, max: 355, step: 5, unit: '°', labelKo: '위상', decimals: 0 },
};

/**
 * Allowed error per level (≈6% / 4% / 3% of full scale, aligned to whole control steps so
 * the window is always reachable with ± buttons).
 */
export const SIGNAL_TOLERANCE: Record<Level, Record<SignalParam, number>> = {
  1: { freq: 0.4, amp: 0, phase: 0 },
  2: { freq: 0.3, amp: 0.15, phase: 0 },
  3: { freq: 0.2, amp: 0.1, phase: 10 },
};

export const SIGNAL_PARAMS: Record<Level, SignalParam[]> = {
  1: ['freq'],
  2: ['freq', 'amp'],
  3: ['freq', 'amp', 'phase'],
};

export type SignalValues = Record<SignalParam, number>;

export interface SignalPuzzle {
  level: Level;
  /** Adjustable parameters at this level. Others are fixed at `target` value. */
  params: SignalParam[];
  target: SignalValues;
  initial: SignalValues;
  tolerance: Record<SignalParam, number>;
}

const EPS = 1e-6;

/** Round to the control grid of a parameter (avoids float drift). */
export function snap(param: SignalParam, v: number): number {
  const r = SIGNAL_RANGE[param];
  const steps = Math.round((v - r.min) / r.step);
  const clamped = Math.min(Math.max(steps, 0), Math.round((r.max - r.min) / r.step));
  return Number((r.min + clamped * r.step).toFixed(r.decimals));
}

function gridValue(rng: () => number, param: SignalParam): number {
  const r = SIGNAL_RANGE[param];
  const count = Math.round((r.max - r.min) / r.step) + 1;
  return snap(param, r.min + randInt(rng, count) * r.step);
}

export function paramError(param: SignalParam, value: number, target: number): number {
  if (param === 'phase') {
    const d = Math.abs(value - target) % 360;
    return Math.min(d, 360 - d);
  }
  return Math.abs(value - target);
}

export function paramInRange(p: SignalPuzzle, param: SignalParam, value: number): boolean {
  return paramError(param, value, p.target[param]) <= p.tolerance[param] + EPS;
}

export function generateSignal(level: Level, seed: number): SignalPuzzle {
  const rng = mulberry32(seed);
  const params = SIGNAL_PARAMS[level];
  const tolerance = SIGNAL_TOLERANCE[level];
  const target: SignalValues = {
    freq: gridValue(rng, 'freq'),
    amp: params.includes('amp') ? gridValue(rng, 'amp') : 2,
    phase: params.includes('phase') ? gridValue(rng, 'phase') : 0,
  };
  const initial: SignalValues = { ...target };
  for (const param of params) {
    // Start clearly outside the window: at least 3× tolerance (and ≥ 3 steps) away.
    const minGap = Math.max(tolerance[param] * 3, SIGNAL_RANGE[param].step * 3);
    let v = target[param];
    for (let i = 0; i < 64; i++) {
      v = gridValue(rng, param);
      if (paramError(param, v, target[param]) >= minGap - EPS) break;
    }
    if (paramError(param, v, target[param]) < minGap - EPS) {
      const r = SIGNAL_RANGE[param];
      v = param === 'phase' ? snap(param, (target[param] + 180) % 360) : target[param] - r.min > r.max - target[param] ? r.min : r.max;
    }
    initial[param] = v;
  }
  return { level, params, target, initial, tolerance };
}

/** True when every adjustable parameter is inside its tolerance window. */
export function validateSignal(p: SignalPuzzle, values: SignalValues): boolean {
  return p.params.every((param) => paramInRange(p, param, values[param]));
}

/** Instantaneous waveform voltage (V) at time t (s). */
export function waveAt(v: SignalValues, t: number): number {
  return v.amp * Math.sin(2 * Math.PI * v.freq * t + (v.phase * Math.PI) / 180);
}
