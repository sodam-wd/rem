import type { Level } from '../app/contracts';
import { mulberry32, shuffle } from './rng';

export const MEMORY_SPEC: Record<Level, { size: number; count: number }> = {
  1: { size: 3, count: 3 },
  2: { size: 4, count: 5 },
  3: { size: 5, count: 7 },
};

/** Each cell stays lit at least this long (no rapid flashing). */
export const MEMORY_LIT_MS = 800;
/** Dark gap between two cells. */
export const MEMORY_GAP_MS = 400;
/** Fade duration for the smooth light-up (0 when reduced motion). */
export const MEMORY_FADE_MS = 250;
/** Pause before the first cell lights after pressing start. */
export const MEMORY_LEAD_MS = 600;

export interface MemoryPuzzle {
  level: Level;
  size: number;
  /** Ordered list of distinct cell indices (row-major, 0-based). */
  sequence: number[];
}

export function generateMemory(level: Level, seed: number): MemoryPuzzle {
  const rng = mulberry32(seed);
  const { size, count } = MEMORY_SPEC[level];
  const cells = Array.from({ length: size * size }, (_, i) => i);
  return { level, size, sequence: shuffle(rng, cells).slice(0, count) };
}

/** Full-answer check: same cells in the same order. */
export function validateMemory(p: MemoryPuzzle, input: number[]): boolean {
  return input.length === p.sequence.length && input.every((c, i) => c === p.sequence[i]);
}

/** Prefix check while entering: false as soon as an entry deviates. */
export function memoryPrefixOk(p: MemoryPuzzle, input: number[]): boolean {
  return input.length <= p.sequence.length && input.every((c, i) => c === p.sequence[i]);
}

export function cellName(size: number, idx: number): string {
  return `${Math.floor(idx / size) + 1}행 ${(idx % size) + 1}열`;
}
