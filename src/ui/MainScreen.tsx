import { useRef, useState } from 'react';
import { MODULE_IDS, WEEKDAY_KO } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { MISSIONS } from '../missions';
import { MODULE_LABEL } from '../reports/labels';
import { Panel, STANDBY_NOTICE, StorageBanner, VIRTUAL_NOTICE, asset, fmtRemaining, hhmm } from './common';

const pad = (n: number) => String(n).padStart(2, '0');

const MENU = [
  { code: '01', en: 'SCHEDULE', ko: '일정', path: '/schedule' },
  { code: '02', en: 'PROTOCOL', ko: '복구 절차', path: '#protocol' },
  { code: '03', en: 'DIAGNOSTICS', ko: '장비 점검', path: '/diagnostics' },
  { code: '04', en: 'ARCHIVE', ko: '보관소', path: '/archive' },
  { code: '05', en: 'SIMULATION', ko: '훈련', path: '/simulation' },
  { code: '06', en: 'SYSTEM', ko: '시스템', path: '/system' },
] as const;

const KIND_LABEL = { scheduled: '정기 일정', snooze: '다시 울리기', emergency: '긴급 종료 재경보' } as const;

export function MainScreen() {
  const rem = useRem();
  const { now, nextAlert, alarms, activeSession, wakeLock, audio, pwa, settings, navigate } = rem;
  const protocolRef = useRef<HTMLElement>(null);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [standbyMsg, setStandbyMsg] = useState<string | null>(null);
  const d = new Date(now);
  const live = activeSession && (activeSession.status === 'alerting' || activeSession.status === 'recovering') ? activeSession : null;

  const enterStandby = async () => {
    const sound = await audio.unlock().catch(() => false);
    const lock = wakeLock.supported ? await wakeLock.request().catch(() => false) : false;
    if (!wakeLock.supported) setStandbyMsg('이 브라우저는 화면 유지(Wake Lock)를 지원하지 않습니다. 기기의 자동 잠금 시간을 늘려 두십시오.');
    else if (!lock) setStandbyMsg('화면 유지 요청이 거부되었습니다. 저전력 모드 또는 브라우저 설정을 확인하십시오.');
    else if (!sound) setStandbyMsg('화면 유지는 작동하지만 경보음 활성화에 실패했습니다. 기기 음량을 확인하십시오.');
    else setStandbyMsg(null);
  };

  const openMenu = (path: string) => {
    if (path === '#protocol') {
      setProtocolOpen(true);
      requestAnimationFrame(() => protocolRef.current?.scrollIntoView?.({ block: 'start' }));
      return;
    }
    navigate(path);
  };

  return (
    <main className="ui-screen">
      <header className="ui-topbar">
        <div className="ui-brand ui-topbar-title">
          <img src={asset('rem-logo.svg')} alt="R.E.M. 공식 심볼" width={36} height={38} />
          <div>
            <div className="ui-brand-en">R.E.M. : RECOVERY TERMINAL</div>
            <div className="ui-brand-ko">현실 복구 단말기</div>
          </div>
        </div>
        <div className="mono dim" style={{ fontSize: 12, textAlign: 'right' }}>
          {settings.terminalId}
          <br />
          <span className={pwa.online ? 'st-ok' : 'st-warn'}>{pwa.online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
      </header>

      <StorageBanner />

      {live ? (
        <div className="ui-banner ui-banner-alert" role="alert">
          <div className="ui-spread">
            <div>
              <strong>{live.status === 'alerting' ? '경보 진행 중' : '복구 진행 중'}</strong>
              <div className="mono" style={{ fontSize: 13 }}>{live.id}</div>
            </div>
            <button type="button" className="ui-btn ui-btn-danger" onClick={() => navigate(`/alert/${live.id}`)}>
              즉시 복귀
            </button>
          </div>
        </div>
      ) : null}

      <section aria-label="현재 시각">
        <div className="mono dim" style={{ fontSize: 13 }}>
          {d.getFullYear()}-{pad(d.getMonth() + 1)}-{pad(d.getDate())} ({WEEKDAY_KO[d.getDay()]})
        </div>
        <div className="ui-clock" role="timer" aria-live="off">
          {pad(d.getHours())}:{pad(d.getMinutes())}
          <span className="ui-clock-sec">{pad(d.getSeconds())}</span>
        </div>
      </section>

      <Panel title="다음 경보" en="NEXT ALERT">
        {nextAlert ? (
          <div className="ui-spread">
            <div>
              <div className="ui-next-time">{hhmm(nextAlert.at)}</div>
              <div className="ui-note">
                {KIND_LABEL[nextAlert.kind]} · <span className="mono">{fmtRemaining(nextAlert.at - now)}</span>
              </div>
            </div>
            <button type="button" className="ui-btn" onClick={() => navigate('/schedule')}>일정 보기</button>
          </div>
        ) : alarms.length === 0 ? (
          <div className="ui-stack">
            <p>등록된 일정이 없습니다. 기상 시각을 등록하면 이 단말기가 경보를 울립니다.</p>
            <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={() => navigate('/schedule/new')}>
              첫 일정 등록
            </button>
          </div>
        ) : (
          <div className="ui-stack">
            <p>활성화된 일정이 없습니다.</p>
            <button type="button" className="ui-btn ui-btn-block" onClick={() => navigate('/schedule')}>일정 관리</button>
          </div>
        )}
      </Panel>

      <Panel title="대기 모드" en="STANDBY">
        <div className="ui-stack">
          <div className="ui-row">
            <span className={`ui-chip ${wakeLock.active ? 'st-ok' : 'st-dim'}`}>화면 유지 {wakeLock.active ? '작동 중' : wakeLock.supported ? '꺼짐' : '미지원'}</span>
            <span className={`ui-chip ${audio.unlocked ? 'st-ok' : 'st-warn'}`}>경보음 {audio.unlocked ? '활성' : '비활성'}</span>
          </div>
          <p className="ui-note">{STANDBY_NOTICE}</p>
          {standbyMsg ? <p className="ui-field-error" role="status">{standbyMsg}</p> : null}
          {wakeLock.active ? (
            <button type="button" className="ui-btn ui-btn-block" onClick={() => void wakeLock.release()}>대기 모드 해제</button>
          ) : (
            <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={() => void enterStandby()}>
              대기 모드 진입 <span className="ui-label-en">STANDBY</span>
            </button>
          )}
        </div>
      </Panel>

      <nav className="ui-menu" aria-label="주 메뉴">
        {MENU.map((m) => (
          <button key={m.en} type="button" className="ui-menu-btn" onClick={() => openMenu(m.path)} aria-expanded={m.path === '#protocol' ? protocolOpen : undefined}>
            <span className="ui-menu-code">{m.code}</span>
            <span>
              <span className="ui-menu-en">{m.en}</span>
              <br />
              <span className="ui-menu-ko">{m.ko}</span>
            </span>
          </button>
        ))}
      </nav>

      {protocolOpen ? (
        <section ref={protocolRef} className="ui-panel" id="protocol" aria-label="복구 절차">
          <div className="ui-panel-head">
            <h2>복구 절차</h2>
            <span className="ui-label-en">PROTOCOL</span>
          </div>
          <div className="ui-stack">
            <ol className="ui-steps">
              <li>예약 시각이 되면 단말기가 경보음과 비상 화면을 띄웁니다(지원 기기는 진동).</li>
              <li>‘복구 실행’을 누르면 배정된 복구 모듈이 순서대로 열립니다. 경보음은 복구 중에도 유지됩니다.</li>
              <li>모든 모듈을 완료하면 경보가 멈추고 사건 보고서가 발행됩니다.</li>
              <li>‘긴급 종료’는 일정에 설정한 간격 뒤 재경보를 예약합니다. 허용 횟수를 모두 쓰면 복구 실패로 종료됩니다.</li>
              <li>‘완전 취소’는 언제든 경보와 재경보를 즉시 모두 중단합니다.</li>
              <li>경보는 최대 30분 동안 유지된 뒤 자동 종료됩니다.</li>
            </ol>
            <hr className="ui-rule" />
            <ul className="ui-list">
              {MODULE_IDS.map((id) => {
                const def = MISSIONS?.[id];
                return (
                  <li key={id} style={{ padding: 12 }}>
                    <div className="ui-spread">
                      <strong><span className="mono">{id}</span> {def?.nameKo ?? MODULE_LABEL[id].ko}</strong>
                      <span className="dim" style={{ fontSize: 13 }}>{def?.instrument ?? MODULE_LABEL[id].instrument}</span>
                    </div>
                    {def ? (
                      <dl className="ui-kv" style={{ marginTop: 6, fontSize: 13 }}>
                        <dt>쉬움</dt><dd>{def.briefing[1]}</dd>
                        <dt>보통</dt><dd>{def.briefing[2]}</dd>
                        <dt>어려움</dt><dd>{def.briefing[3]}</dd>
                      </dl>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <button type="button" className="ui-btn" onClick={() => setProtocolOpen(false)}>절차 닫기</button>
          </div>
        </section>
      ) : null}

      <p className="ui-footer-note">{VIRTUAL_NOTICE}</p>
    </main>
  );
}
