/**
 * PWA helpers: standalone/platform detection, install prompt, SW registration, wake lock,
 * local notifications (only while the page/SW is alive — no external push), diagnostics.
 */
import type { DiagnosticsApi, DiagState, Platform } from '../app/contracts';
import type { AudioEngine, PwaModule } from '../app/services';
import { audioSupported } from '../alarm/audio';
import { vibration } from '../alarm/vibration';

export const ALERT_TAG = 'rem-alert';
export const TEST_TAG = 'rem-test';
const ICON = './icons/icon-192.png';
const SENSOR_WAIT_MS = 2000;
const SW_READY_TIMEOUT_MS = 4000;

/* ------------------------------------------------------------ install prompt capture */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();
function emitInstall() {
  for (const cb of installListeners) cb(deferredPrompt !== null);
}

if (typeof window !== 'undefined') {
  // Captured at module load so an early event (before React mounts) is not lost.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // suppress the default mini-infobar; the app shows its own popup
    deferredPrompt = e as BeforeInstallPromptEvent;
    emitInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emitInstall();
  });
}

/* ------------------------------------------------------------ detection */

const INAPP_RE = /KAKAOTALK|NAVER\(inapp|NAVER|Instagram|FBAN|FBAV|FB_IAB|\bLine\/|DaumApps|everytimeApp|;\s?wv\)/i;

export function detectPlatformFrom(ua: string, maxTouchPoints: number): Platform {
  if (INAPP_RE.test(ua)) return 'inapp';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows NT|Macintosh|X11|CrOS|Linux x86_64/.test(ua)) return 'desktop';
  return 'other';
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    /* noop */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/* ------------------------------------------------------------ notifications */

type NotifOptions = NotificationOptions & { renotify?: boolean; vibrate?: number[] };

function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), SW_READY_TIMEOUT_MS)),
    ]);
    return reg ?? null;
  } catch {
    return null;
  }
}

async function show(title: string, options: NotifOptions): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  const reg = await swRegistration();
  if (reg) {
    try {
      await reg.showNotification(title, options);
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    // Desktop fallback when no SW is active (throws on Android Chrome — caught).
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ wake lock */

interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}

function createWakeLock() {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }) : undefined;
  const supported = !!nav?.wakeLock;
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((cb) => cb());

  async function acquire(): Promise<boolean> {
    if (!supported || !nav?.wakeLock) return false;
    if (sentinel && !sentinel.released) return true;
    try {
      const s = await nav.wakeLock.request('screen');
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
        emit();
      });
      emit();
      return true;
    } catch {
      return false;
    }
  }

  if (supported && typeof document !== 'undefined') {
    // The browser drops the lock when the page is hidden; re-acquire on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wanted && !sentinel) void acquire();
    });
  }

  return {
    supported,
    get active() {
      return !!sentinel && !sentinel.released;
    },
    async request() {
      wanted = true;
      return acquire();
    },
    async release() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      if (s && !s.released) {
        try {
          await s.release();
        } catch {
          /* noop */
        }
      }
      emit();
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/* ------------------------------------------------------------ diagnostics */

function createDiagnostics(audio: AudioEngine): DiagnosticsApi {
  return {
    network: () => (typeof navigator !== 'undefined' && navigator.onLine ? 'ok' : 'failed'),

    async testNotification(): Promise<DiagState> {
      if (!notificationsSupported()) return 'unsupported';
      let perm: NotificationPermission = Notification.permission;
      if (perm === 'default') {
        try {
          perm = await Notification.requestPermission();
        } catch {
          return 'failed';
        }
      }
      if (perm === 'denied') return 'denied';
      if (perm !== 'granted') return 'unknown';
      const ok = await show('R.E.M. 알림 점검', {
        body: '현실 복구 단말기 — 로컬 알림 수신 점검',
        tag: TEST_TAG,
        icon: ICON,
        data: {},
      });
      return ok ? 'ok' : 'failed';
    },

    testVibration(): DiagState {
      if (!vibration.vibrationSupported()) return 'unsupported';
      return vibration.vibrateOnce(600) ? 'ok' : 'failed';
    },

    async testSensor(): Promise<DiagState> {
      if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
      if (typeof DOE.requestPermission === 'function') {
        try {
          const res = await DOE.requestPermission();
          if (res !== 'granted') return 'denied';
        } catch {
          return 'failed'; // e.g. not called from a user gesture
        }
      }
      return new Promise<DiagState>((resolve) => {
        const handler = (e: DeviceOrientationEvent) => {
          if (e.beta === null && e.gamma === null && e.alpha === null) return; // no real sensor data
          cleanup();
          resolve('ok');
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve('unsupported');
        }, SENSOR_WAIT_MS);
        const cleanup = () => {
          clearTimeout(timer);
          window.removeEventListener('deviceorientation', handler);
        };
        window.addEventListener('deviceorientation', handler);
      });
    },

    async testAudio(): Promise<DiagState> {
      if (!audioSupported()) return 'unsupported';
      try {
        return (await audio.testTone()) ? 'ok' : 'failed';
      } catch {
        return 'failed';
      }
    },
  };
}

/* ------------------------------------------------------------ module */

export const pwa: PwaModule = {
  isStandalone,
  detectPlatform() {
    if (typeof navigator === 'undefined') return 'other';
    return detectPlatformFrom(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0);
  },
  onInstallAvailabilityChange(cb) {
    installListeners.add(cb);
    cb(deferredPrompt !== null);
    return () => {
      installListeners.delete(cb);
    };
  },
  async promptInstall() {
    const p = deferredPrompt;
    if (!p) return 'unavailable';
    try {
      await p.prompt();
      const { outcome } = await p.userChoice;
      return outcome;
    } catch {
      return 'unavailable';
    } finally {
      deferredPrompt = null;
      emitInstall();
    }
  },
  registerServiceWorker(onNeedRefresh) {
    let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      import('virtual:pwa-register')
        .then(({ registerSW }) => {
          updateSW = registerSW({ immediate: true, onNeedRefresh });
        })
        .catch((e) => console.warn('[rem] service worker registration unavailable', e));
    }
    return {
      applyUpdate: () => {
        if (updateSW) void updateSW(true);
        else if (typeof location !== 'undefined') location.reload();
      },
    };
  },
  createWakeLock,
  showAlertNotification(sessionId, title, body) {
    return show(title, {
      body,
      tag: ALERT_TAG,
      renotify: true,
      requireInteraction: true,
      icon: ICON,
      data: { sessionId },
    });
  },
  async closeAlertNotifications() {
    const reg = await swRegistration();
    if (!reg) return;
    try {
      const list = await reg.getNotifications({ tag: ALERT_TAG });
      list.forEach((n) => n.close());
    } catch {
      /* noop */
    }
  },
  createDiagnostics,
};
