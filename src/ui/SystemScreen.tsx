import { useState } from 'react';
import type { DisplaySettings } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { ConfirmDialog, DiagChip, Panel, STANDBY_NOTICE, Screen, Switch, VIRTUAL_NOTICE } from './common';
import { InstallGuide } from './InstallPrompt';

const PLATFORM_LABEL = { ios: 'iPhone / iPad', android: 'Android', desktop: 'PC', inapp: '앱 내부 브라우저', other: '기타 브라우저' } as const;

export function SystemScreen() {
  const { settings, updateSettings, pwa, clearAllData, navigate, reports, alarms } = useRem();
  const [confirmClear, setConfirmClear] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const display = settings.display;

  const setDisplay = (patch: Partial<DisplaySettings>) => {
    updateSettings({ display: { ...display, ...patch } }).catch((e) => setErr(e instanceof Error ? e.message : '설정을 저장하지 못했습니다.'));
  };

  return (
    <Screen en="SYSTEM" ko="시스템">
      {err ? <p className="ui-banner ui-banner-alert" role="alert">{err}</p> : null}
      {msg ? <p className="ui-banner" role="status">{msg}</p> : null}

      <Panel title="설치 상태" en="INSTALL">
        <div className="ui-stack">
          <div className="ui-row">
            <span className={`ui-chip ${pwa.standalone ? 'st-ok' : 'st-dim'}`}>{pwa.standalone ? '설치된 앱으로 실행 중' : '브라우저에서 실행 중'}</span>
            <span className="ui-chip st-dim">{PLATFORM_LABEL[pwa.platform]}</span>
          </div>
          {pwa.standalone ? <p className="ui-note">홈 화면 앱으로 실행 중입니다.</p> : <InstallGuide platform={pwa.platform} />}
        </div>
      </Panel>

      <Panel title="권한" en="PERMISSIONS">
        <div className="ui-stack">
          <dl className="ui-kv">
            <dt>알림</dt><dd><DiagChip state={settings.diagnostics.notification} /></dd>
            <dt>자세 센서</dt><dd><DiagChip state={settings.diagnostics.sensor} /></dd>
            <dt>경보음</dt><dd><DiagChip state={settings.diagnostics.audio} /></dd>
          </dl>
          <p className="ui-note">권한을 거부했다면 브라우저 또는 기기 설정의 사이트 권한에서 다시 허용해야 합니다.</p>
          <button type="button" className="ui-btn" onClick={() => navigate('/diagnostics')}>장비 점검으로</button>
        </div>
      </Panel>

      <Panel title="경보 동작 제한" en="LIMITATIONS">
        <ul className="ui-steps">
          <li><strong>{STANDBY_NOTICE}</strong></li>
          <li>메인 화면의 ‘대기 모드 진입’을 누르면 화면 유지(지원 브라우저)와 경보음이 준비됩니다.</li>
          <li>기기 음량이 0이거나 무음·방해 금지 모드면 경보음이 들리지 않을 수 있습니다. 앱은 이를 우회하지 않습니다.</li>
          <li>진동은 진동 API를 지원하는 기기에서만 동작합니다(iPhone Safari 미지원).</li>
          <li>경보는 최대 30분 유지 후 자동 종료됩니다. ‘완전 취소’는 언제든 사용할 수 있습니다.</li>
        </ul>
      </Panel>

      <Panel title="화면 설정" en="DISPLAY">
        <div className="ui-stack">
          <div className="ui-field">
            <label className="ui-field-label" htmlFor="sys-bright">
              화면 밝기 표현 <span className="mono">{display.brightness}%</span>
            </label>
            <input
              id="sys-bright"
              type="range"
              className="ui-range"
              min={60}
              max={100}
              step={5}
              value={display.brightness}
              onChange={(e) => setDisplay({ brightness: Number(e.target.value) })}
            />
            <span className="ui-field-hint">앱 화면만 어둡게 합니다. 기기 밝기는 바뀌지 않습니다.</span>
          </div>
          <div className="ui-spread"><span>주사선 효과</span><Switch checked={display.scanlines} label="주사선 효과" onChange={(v) => setDisplay({ scanlines: v })} /></div>
          <div className="ui-spread"><span>글자 발광</span><Switch checked={display.glow} label="글자 발광" onChange={(v) => setDisplay({ glow: v })} /></div>
          <div className="ui-field">
            <span className="ui-field-label" id="sys-motion">모션 최소화</span>
            <div className="ui-seg" role="radiogroup" aria-labelledby="sys-motion">
              {(['system', 'on', 'off'] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={display.reducedMotion === v} onClick={() => setDisplay({ reducedMotion: v })}>
                  {v === 'system' ? '기기 설정' : v === 'on' ? '켜기' : '끄기'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="데이터 관리" en="DATA">
        <div className="ui-stack">
          <ul className="ui-steps">
            <li>일정, 사건 기록, 보고서, 설정은 이 기기 브라우저의 IndexedDB에만 저장됩니다. 서버로 전송하지 않으며 가입이 없습니다.</li>
            <li>브라우저 데이터 삭제, 사생활 보호 모드, 기기 변경, 앱 삭제 시 기록이 사라집니다. 백업 기능은 제공하지 않습니다.</li>
          </ul>
          <p className="ui-note mono">일정 {alarms.length}건 · 보고서 {reports.length}건</p>
          <button type="button" className="ui-btn ui-btn-danger ui-btn-block" onClick={() => setConfirmClear(true)}>
            전체 데이터 삭제
          </button>
        </div>
      </Panel>

      <Panel title="앱 정보" en="ABOUT">
        <div className="ui-stack">
          <dl className="ui-kv">
            <dt>이름</dt><dd>R.E.M. : Recovery Terminal / 현실 복구 단말기</dd>
            <dt>버전</dt><dd className="mono">1.0.0</dd>
            <dt>단말기 ID</dt><dd className="mono">{settings.terminalId}</dd>
            <dt>네트워크</dt><dd>{pwa.online ? '온라인' : '오프라인'}</dd>
          </dl>
          {pwa.updateAvailable ? (
            <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={pwa.applyUpdate}>새 버전 적용 (다시 시작)</button>
          ) : (
            <p className="ui-note">최신 버전으로 실행 중입니다.</p>
          )}
          <p className="ui-note">{VIRTUAL_NOTICE}</p>
        </div>
      </Panel>

      {confirmClear ? (
        <ConfirmDialog
          title="전체 데이터 삭제"
          body="일정, 진행 기록, 보고서, 설정을 이 기기에서 모두 삭제합니다. 대기 중인 재경보도 취소됩니다. 되돌릴 수 없습니다."
          confirmLabel="모두 삭제"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={async () => {
            setConfirmClear(false);
            try {
              await clearAllData();
              setMsg('모든 데이터를 삭제했습니다.');
            } catch (e) {
              setErr(e instanceof Error ? e.message : '삭제하지 못했습니다.');
            }
          }}
        />
      ) : null}
    </Screen>
  );
}
