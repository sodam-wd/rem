import type { Level } from '../app/contracts';
import { mulberry32, randRange } from './rng';

export interface Attitude {
  /** Nose up (+) / down (−), degrees. */
  pitch: number;
  /** Right wing down (+) / left wing down (−), degrees. */
  roll: number;
}

export const GRAVITY_SPEC: Record<Level, { targets: number; tolerance: number; holdMs: number }> = {
  1: { targets: 1, tolerance: 8, holdMs: 2000 },
  2: { targets: 1, tolerance: 4, holdMs: 4000 },
  3: { targets: 3, tolerance: 5, holdMs: 2000 },
};

/** Small, safe tilts only (relative to the user's own zero position). */
export const GRAVITY_LIMIT = { pitch: 12, roll: 15 } as const;
/** Clamp for displayed/controlled attitude. */
export const ATTITUDE_CLAMP = 30;
/** Each target is at least max(this, tolerance + 4)° (max-axis) from zero, and 2×tolerance+1° from the previous target. */
export const GRAVITY_MIN_SEPARATION = 8;
/** Sensor fallback: switch to touch if no orientation event arrives within this window. */
export const SENSOR_TIMEOUT_MS = 2000;

export interface GravityPuzzle {
  level: Level;
  targets: Attitude[];
  tolerance: number;
  holdMs: number;
}

function dist(a: Attitude, b: Attitude): number {
  return Math.max(Math.abs(a.pitch - b.pitch), Math.abs(a.roll - b.roll));
}

export function generateGravity(level: Level, seed: number): GravityPuzzle {
  const rng = mulberry32(seed);
  const spec = GRAVITY_SPEC[level];
  const targets: Attitude[] = [];
  let prev: Attitude = { pitch: 0, roll: 0 };
  for (let i = 0; i < spec.targets; i++) {
    let t: Attitude = prev;
    for (let tries = 0; tries < 200; tries++) {
      t = {
        pitch: randRange(rng, -GRAVITY_LIMIT.pitch, GRAVITY_LIMIT.pitch),
        roll: randRange(rng, -GRAVITY_LIMIT.roll, GRAVITY_LIMIT.roll),
      };
      // Must not be satisfiable from the zero position or from the previous target.
      const zeroSep = Math.max(GRAVITY_MIN_SEPARATION, spec.tolerance + 4);
      const prevSep = i === 0 ? zeroSep : spec.tolerance * 2 + 1;
      if (dist(t, { pitch: 0, roll: 0 }) >= zeroSep && dist(t, prev) >= prevSep) break;
    }
    targets.push(t);
    prev = t;
  }
  return { level, targets, tolerance: spec.tolerance, holdMs: spec.holdMs };
}

/** True when the attitude is within tolerance of target #index on both axes. */
export function validateGravity(p: GravityPuzzle, index: number, a: Attitude): boolean {
  const t = p.targets[index];
  if (!t) return false;
  return Math.abs(a.pitch - t.pitch) <= p.tolerance && Math.abs(a.roll - t.roll) <= p.tolerance;
}

export function clampAttitude(a: Attitude): Attitude {
  const c = (v: number) => Math.max(-ATTITUDE_CLAMP, Math.min(ATTITUDE_CLAMP, v));
  return { pitch: c(a.pitch), roll: c(a.roll) };
}

/**
 * Map DeviceOrientation beta/gamma to device-screen pitch/roll, correcting for
 * screen.orientation.angle (0, 90, 180, 270 / -90).
 */
export function orientToAttitude(beta: number, gamma: number, screenAngle: number): Attitude {
  const a = ((Math.round(screenAngle / 90) * 90) % 360 + 360) % 360;
  switch (a) {
    case 90:
      return { pitch: -gamma, roll: beta };
    case 180:
      return { pitch: -beta, roll: -gamma };
    case 270:
      return { pitch: gamma, roll: -beta };
    default:
      return { pitch: beta, roll: gamma };
  }
}
