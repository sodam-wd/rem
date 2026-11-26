import { useState } from 'react';
import type { DiagState, Settings } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { fmtDateTime } from '../reports/labels';
import { DiagChip, Panel, Screen } from './common';

type Key = keyof Omit<Settings['diagnostics'], 'lastRunAt'>;

export function DiagnosticsScreen() {
  const { settings, updateSettings, diagnostics, pwa } = useRem();
  const diag = settings.diagnostics;
  const [busy, setBusy] = useState<Key | null>(null);
  const [audioAwaiting, setAudioAwaiting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (key: Key, state: DiagState) => {
    try {
      await updateSettings({ diagnostics: { ...diag, [key]: state, lastRunAt: Date.now() } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '점검 결과를 저장하지 못했습니다.');
    }
  };

  const run = async (key: Key, fn: () => DiagState | Promise<DiagState>) => {
    setBusy(key);
    setErr(null);
    try {
      const st = await fn();
      if (key === 'audio' && st === 'ok') {
        // Playback started; only the person can confirm it was audible.
        setAudioAwaiting(true);
      } else {
        await save(key, st);
      }
    } catch {
      await save(key, 'failed');
    } finally {
      setBusy(null);
    }
  };

  const networkLive = pwa.online ? diag.network : 'failed';

  return (
    <Screen en="DIAGNOSTICS" ko="장비 점검">
      <p className="ui-note">
        경보 전에 이 기기의 기능을 점검합니다. 미지원이나 거부 상태는 정상으로 표시하지 않습니다.
        {diag.lastRunAt ? <> 마지막 점검 <span className="mono">{fmtDateTime(diag.lastRunAt)}</span>.</> : null}
      </p>
      {err ? <p className="ui-banner ui-banner-alert" role="alert">{err}</p> : null}

      <ul className="ui-list" aria-label="점검 항목">
        <li className="ui-diag-row">
          <div className="ui-spread"><span className="ui-diag-title">네트워크 <span className="ui-label-en">NETWORK</span></span><DiagChip state={networkLive} /></div>
          <p className="ui-note">경보 자체는 네트워크 없이 동작합니다. 앱 설치·업데이트에만 필요합니다. 현재 {pwa.online ? '온라인' : '오프라인'}.</p>
          <button type="button" className="ui-btn" disabled={busy !== null} onClick={() => void run('network', diagnostics.network)}>네트워크 확인</button>
        </li>

        <li className="ui-diag-row">
          <div className="ui-spread"><span className="ui-diag-title">알림 <span className="ui-label-en">NOTIFICATION</span></span><DiagChip state={diag.notification} /></div>
          <p className="ui-note">권한을 요청하고 테스트 알림을 띄웁니다. 앱이 실행 중일 때만 경보 알림이 표시됩니다. iPhone은 홈 화면에 설치한 앱에서만 알림을 쓸 수 있습니다.</p>
          <button type="button" className="ui-btn" disabled={busy !== null} onClick={() => void run('notification', diagnostics.testNotification)}>
            {busy === 'notification' ? '확인 중…' : '알림 권한 및 테스트'}
          </button>
        </li>

        <li className="ui-diag-row">
          <div className="ui-spread"><span className="ui-diag-title">경보음 <span className="ui-label-en">AUDIO</span></span><DiagChip state={diag.audio} /></div>
          <p className="ui-note">1.5초 시험음을 재생합니다. 미디어 음량이 0이거나 무음 모드면 들리지 않을 수 있습니다. 앱은 무음·방해 금지 설정을 우회하지 않습니다.</p>
          {audioAwaiting ? (
            <div className="ui-stack" role="group" aria-label="시험음 확인">
              <p>시험음이 들렸습니까?</p>
              <div className="ui-row">
                <button type="button" className="ui-btn ui-btn-primary" style={{ flex: 1 }} onClick={() => { setAudioAwaiting(false); void save('audio', 'manual-ok'); }}>들렸음</button>
                <button type="button" className="ui-btn ui-btn-danger" style={{ flex: 1 }} onClick={() => { setAudioAwaiting(false); void save('audio', 'failed'); }}>들리지 않음</button>
              </div>
            </div>
          ) : (
            <button type="button" className="ui-btn" disabled={busy !== null} onClick={() => void run('audio', diagnostics.testAudio)}>
              {busy === 'audio' ? '재생 중…' : '시험음 재생'}
            </button>
          )}
        </li>

        <li className="ui-diag-row">
          <div className="ui-spread"><span className="ui-diag-title">진동 <span className="ui-label-en">VIBRATION</span></span><DiagChip state={diag.vibration} /></div>
          <p className="ui-note">진동 API를 지원하는 기기에서만 진동합니다. iPhone Safari는 지원하지 않습니다.</p>
          <button type="button" className="ui-btn" disabled={busy !== null} onClick={() => void run('vibration', diagnostics.testVibration)}>진동 테스트</button>
        </li>

        <li className="ui-diag-row">
          <div className="ui-spread"><span className="ui-diag-title">자세 센서 <span className="ui-label-en">SENSOR</span></span><DiagChip state={diag.sensor} /></div>
          <p className="ui-note">GRAVITY 모듈에 사용합니다. 미지원·거부 시 터치 조작으로 대체됩니다.</p>
          <button type="button" className="ui-btn" disabled={busy !== null} onClick={() => void run('sensor', diagnostics.testSensor)}>
            {busy === 'sensor' ? '센서 대기 중…' : '센서 확인'}
          </button>
        </li>
      </ul>

      <Panel title="결과 요약" en="SUMMARY">
        <dl className="ui-kv">
          <dt>네트워크</dt><dd><DiagChip state={networkLive} /></dd>
          <dt>알림</dt><dd><DiagChip state={diag.notification} /></dd>
          <dt>경보음</dt><dd><DiagChip state={diag.audio} /></dd>
          <dt>진동</dt><dd><DiagChip state={diag.vibration} /></dd>
          <dt>센서</dt><dd><DiagChip state={diag.sensor} /></dd>
        </dl>
      </Panel>
    </Screen>
  );
}
