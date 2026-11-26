/**
 * Web Audio engine. No external sound files.
 * Siren: alternating square tones (880 Hz / 660 Hz) with a short pause, scheduled with a lookahead timer.
 * Gains stay well below 1.0 and every note has an attack/release envelope to avoid clipping and clicks.
 * Browsers only allow audio after a user gesture → call unlock() from a tap/click.
 */
import type { AudioEngine, CreateAudioEngine } from '../app/services';

type Ctor = typeof AudioContext;

function getCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function audioSupported(): boolean {
  return getCtor() !== null;
}

/** Siren pattern, seconds: [freq, duration] — a gap is freq 0. Cycle ≈ 1.3 s. */
const SIREN_PATTERN: [number, number][] = [
  [880, 0.26],
  [660, 0.26],
  [880, 0.26],
  [660, 0.26],
  [0, 0.26],
];
const SIREN_CYCLE = SIREN_PATTERN.reduce((s, [, d]) => s + d, 0);
const SIREN_MASTER_GAIN = 0.8;
const SIREN_NOTE_GAIN = 0.7; // effective peak 0.56
const LOOKAHEAD_S = 1.0;
const SCHED_INTERVAL_MS = 250;

export const createAudioEngine: CreateAudioEngine = () => {
  let ctx: AudioContext | null = null;
  let sirenGain: GainNode | null = null;
  let sirenTimer: ReturnType<typeof setInterval> | null = null;
  let nextNoteTime = 0;
  let patternIdx = 0;
  let sounding = false;
  const liveOscs = new Set<OscillatorNode>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const cb of listeners) {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const isRunning = () => !!ctx && ctx.state === 'running';

  function ensureCtx(): AudioContext | null {
    if (ctx) return ctx;
    const C = getCtor();
    if (!C) return null;
    try {
      ctx = new C();
    } catch {
      return null;
    }
    ctx.onstatechange = () => emit();
    return ctx;
  }

  function tone(dest: AudioNode, freq: number, start: number, dur: number, peak: number, type: OscillatorType) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.008);
    g.gain.setValueAtTime(peak, Math.max(start + 0.008, start + dur - 0.02));
    g.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.01);
    liveOscs.add(osc);
    osc.onended = () => {
      liveOscs.delete(osc);
      try {
        g.disconnect();
      } catch {
        /* noop */
      }
    };
  }

  function scheduleSiren() {
    if (!ctx || !sirenGain) return;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    if (nextNoteTime < ctx.currentTime) nextNoteTime = ctx.currentTime + 0.03;
    while (nextNoteTime < horizon) {
      const [freq, dur] = SIREN_PATTERN[patternIdx];
      if (freq > 0) tone(sirenGain, freq, nextNoteTime, dur, SIREN_NOTE_GAIN, 'square');
      nextNoteTime += dur;
      patternIdx = (patternIdx + 1) % SIREN_PATTERN.length;
    }
  }

  const engine: AudioEngine = {
    get unlocked() {
      return isRunning();
    },
    get sounding() {
      return sounding;
    },
    async unlock() {
      const c = ensureCtx();
      if (!c) return false;
      try {
        if (c.state !== 'running') await c.resume();
      } catch {
        /* resume may reject outside a gesture */
      }
      // iOS: playing a (silent) buffer inside the gesture fully unlocks output.
      try {
        const buf = c.createBuffer(1, 1, 22050);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start(0);
      } catch {
        /* noop */
      }
      emit();
      return isRunning();
    },
    startSiren() {
      if (!isRunning() || !ctx) return false;
      if (sounding) return true;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = SIREN_MASTER_GAIN;
      sirenGain.connect(ctx.destination);
      nextNoteTime = ctx.currentTime + 0.03;
      patternIdx = 0;
      scheduleSiren();
      sirenTimer = setInterval(scheduleSiren, SCHED_INTERVAL_MS);
      sounding = true;
      emit();
      return true;
    },
    stopSiren() {
      if (sirenTimer !== null) clearInterval(sirenTimer);
      sirenTimer = null;
      const g = sirenGain;
      sirenGain = null;
      if (ctx && g) {
        const t = ctx.currentTime;
        try {
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + 0.03);
        } catch {
          /* noop */
        }
        for (const o of liveOscs) {
          try {
            o.stop(t + 0.04);
          } catch {
            /* already stopped */
          }
        }
        setTimeout(() => {
          try {
            g.disconnect();
          } catch {
            /* noop */
          }
        }, 100);
      }
      if (sounding) {
        sounding = false;
        emit();
      }
    },
    playSuccess() {
      if (!isRunning() || !ctx) return;
      const t = ctx.currentTime + 0.02;
      tone(ctx.destination, 660, t, 0.12, 0.35, 'triangle');
      tone(ctx.destination, 990, t + 0.14, 0.18, 0.35, 'triangle');
    },
    playError() {
      if (!isRunning() || !ctx) return;
      tone(ctx.destination, 180, ctx.currentTime + 0.02, 0.25, 0.3, 'square');
    },
    async testTone() {
      if (!isRunning()) await engine.unlock();
      if (!isRunning() || !ctx) return false;
      const g = ctx.createGain();
      g.gain.value = 0.6;
      g.connect(ctx.destination);
      let t = ctx.currentTime + 0.03;
      const end = t + 1.5;
      let i = 0;
      while (t < end) {
        const [freq, dur] = SIREN_PATTERN[i % SIREN_PATTERN.length];
        const d = Math.min(dur, end - t);
        if (freq > 0 && d > 0.03) tone(g, freq, t, d, 0.7, 'square');
        t += dur;
        i++;
      }
      await new Promise((r) => setTimeout(r, 1550));
      try {
        g.disconnect();
      } catch {
        /* noop */
      }
      return true;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return engine;
};

export { SIREN_CYCLE };
