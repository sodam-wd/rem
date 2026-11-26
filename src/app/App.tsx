import { useEffect, useState, type ReactElement } from 'react';
import { useRem } from './RemContext';
import {
  ArchiveScreen,
  DiagnosticsScreen,
  EntrySequence,
  IncidentScreen,
  InstallPrompt,
  MainScreen,
  NotFoundScreen,
  ReportScreen,
  ScheduleEditScreen,
  ScheduleScreen,
  SimulationScreen,
  SystemScreen,
} from '../ui';

const DAY = 24 * 60 * 60 * 1000;

export function matchRoute(route: string): ReactElement {
  const parts = route.split('/').filter(Boolean);
  const [head, arg] = parts;
  if (parts.length === 0) return <MainScreen />;
  switch (head) {
    case 'schedule':
      if (!arg) return <ScheduleScreen />;
      return <ScheduleEditScreen key={arg} alarmId={arg === 'new' ? null : decodeURIComponent(arg)} />;
    case 'diagnostics':
      return <DiagnosticsScreen />;
    case 'archive':
      return arg ? <ReportScreen key={arg} reportId={decodeURIComponent(arg)} /> : <ArchiveScreen />;
    case 'simulation':
      return <SimulationScreen />;
    case 'system':
      return <SystemScreen />;
    case 'alert':
      return arg ? <IncidentScreen key={arg} sessionId={decodeURIComponent(arg)} /> : <NotFoundScreen />;
    default:
      return <NotFoundScreen />;
  }
}

export function App() {
  const rem = useRem();
  const { settings, route, ready, pwa, reducedMotion } = rem;
  const isAlertRoute = route.startsWith('/alert');
  const [introDone, setIntroDone] = useState(false);
  const [installClosed, setInstallClosed] = useState(false);

  // Display settings → <html> attributes (consumed by src/ui/global.css).
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.scanlines = settings.display.scanlines ? 'on' : 'off';
    el.dataset.glow = settings.display.glow ? 'on' : 'off';
    el.dataset.motion = reducedMotion ? 'reduced' : 'full';
    el.style.setProperty('--ui-brightness', String(Math.min(100, Math.max(60, settings.display.brightness)) / 100));
  }, [settings.display, reducedMotion]);

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <span>TERMINAL INITIALIZING…</span>
      </div>
    );
  }

  // Intro: every app entry (skip button available), never in front of an active alert.
  const showIntro = !introDone && !isAlertRoute;
  if (showIntro) {
    return (
      <EntrySequence
        onDone={() => {
          setIntroDone(true);
          void rem.updateSettings({ introSeen: true });
        }}
      />
    );
  }

  const dismissedRecently =
    settings.installPromptDismissedAt != null && Date.now() - settings.installPromptDismissedAt < DAY;
  const showInstall =
    !pwa.standalone &&
    !installClosed &&
    !dismissedRecently &&
    !isAlertRoute &&
    !route.startsWith('/simulation');

  return (
    <>
      {matchRoute(route)}
      {showInstall && (
        <InstallPrompt
          onClose={() => {
            setInstallClosed(true);
            void rem.updateSettings({ installPromptDismissedAt: Date.now() });
          }}
        />
      )}
    </>
  );
}
