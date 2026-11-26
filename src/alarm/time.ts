/**
 * Timezone helpers (IANA, via Intl). Wall-clock ↔ epoch conversion that is DST-safe:
 *  - nonexistent local times (spring-forward gap) resolve to the first valid instant after the gap,
 *  - ambiguous local times (fall-back overlap) resolve to the FIRST (earlier) instant.
 */
const DAY_MS = 86_400_000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Returns a usable timezone (falls back to the system zone for invalid input). */
export function safeTimeZone(tz: string): string {
  return isValidTimeZone(tz) ? tz : systemTimeZone();
}

export interface WallParts {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

export function wallParts(t: number, tz: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(t))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second };
}

/** tz offset in ms at instant t (local = utc + offset). */
export function tzOffset(t: number, tz: string): number {
  const p = wallParts(t, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Epoch ms for a local wall-clock time in tz (DST rules described above). mo is 1-12; day overflow allowed. */
export function wallToEpoch(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const L = Date.UTC(y, mo - 1, d, h, mi);
  const oA = tzOffset(L - DAY_MS, tz);
  const oB = tzOffset(L + DAY_MS, tz);
  const cands = Array.from(new Set([L - oA, L - oB]))
    .filter((t) => t + tzOffset(t, tz) === L)
    .sort((a, b) => a - b);
  if (cands.length > 0) return cands[0];
  // Gap: find the transition instant between the two candidates.
  let lo = Math.min(L - oA, L - oB);
  let hi = Math.max(L - oA, L - oB);
  const loOffset = tzOffset(lo, tz);
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000;
    if (mid <= lo) break;
    if (tzOffset(mid, tz) === loOffset) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Calendar date (y, mo 1-12, d) plus `days`, and its weekday (0=Sun). Pure calendar arithmetic. */
export function addDays(y: number, mo: number, d: number, days: number): { y: number; mo: number; d: number; wd: number } {
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}
