/**
 * Vibration. Uses navigator.vibrate only where it exists (not available in iOS Safari).
 * Browsers may still ignore calls without prior user activation; the return value reflects that.
 */
import type { VibrationModule } from '../app/services';

/** ~3.6 s pattern re-issued every 4 s while alerting. */
export const ALARM_PATTERN = [800, 400, 800, 400, 800, 400];
export const ALARM_REPEAT_MS = 4000;

let timer: ReturnType<typeof setInterval> | null = null;

function supported(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as Navigator).vibrate === 'function';
}

function vib(pattern: number | number[]): boolean {
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export const vibration: VibrationModule = {
  vibrationSupported: supported,
  startAlarmVibration() {
    if (!supported()) return false;
    if (timer !== null) clearInterval(timer);
    const ok = vib(ALARM_PATTERN);
    timer = setInterval(() => vib(ALARM_PATTERN), ALARM_REPEAT_MS);
    return ok;
  },
  stopAlarmVibration() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (supported()) vib(0);
  },
  vibrateOnce(ms: number) {
    if (!supported()) return false;
    return vib(Math.max(0, Math.round(ms)));
  },
};
