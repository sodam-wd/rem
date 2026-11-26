import { useEffect, useRef, useState } from 'react';
import type { Platform } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { STANDBY_NOTICE, asset, useFocusTrap } from './common';

/** Platform-specific install steps; reused by SystemScreen. */
export function InstallGuide({ platform }: { platform: Platform }) {
  const { pwa } = useRem();
  const [result, setResult] = useState<string | null>(null);
  const prompt = async () => {
    const r = await pwa.promptInstall();
    setResult(r === 'accepted' ? '설치를 시작했습니다.' : r === 'dismissed' ? '설치를 취소했습니다.' : '이 브라우저에서는 설치 창을 열 수 없습니다. 아래 방법을 따르십시오.');
  };
  return (
    <div className="ui-stack">
      {platform === 'ios' ? (
        <ol className="ui-steps">
          <li>Safari 하단(또는 상단)의 <strong>공유</strong> 버튼을 누릅니다.</li>
          <li><strong>홈 화면에 추가</strong>를 선택합니다.</li>
          <li>홈 화면의 R.E.M. 아이콘으로 실행합니다. iPhone 알림은 홈 화면 앱에서만 쓸 수 있습니다.</li>
        </ol>
      ) : platform === 'android' ? (
        <ol className="ui-steps">
          <li>Chrome 오른쪽 위 <strong>메뉴(⋮)</strong>를 누릅니다.</li>
          <li><strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택합니다.</li>
        </ol>
      ) : platform === 'desktop' ? (
        <ol className="ui-steps">
          <li>Chrome 또는 Edge 주소창 오른쪽의 <strong>설치 아이콘</strong>을 누릅니다.</li>
          <li>또는 브라우저 메뉴에서 <strong>앱 설치</strong>를 선택합니다.</li>
        </ol>
      ) : platform === 'inapp' ? (
        <ol className="ui-steps">
          <li>메신저·SNS 앱 내부 브라우저에서는 설치와 알림이 제한됩니다.</li>
          <li>메뉴의 <strong>외부 브라우저로 열기</strong>를 눌러 Safari(iPhone) 또는 Chrome(Android)에서 다시 여십시오.</li>
        </ol>
      ) : (
        <ol className="ui-steps">
          <li>브라우저 메뉴에서 <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 찾으십시오.</li>
          <li>메뉴가 없다면 Chrome, Edge 또는 iPhone Safari에서 여십시오.</li>
        </ol>
      )}
      {pwa.canPrompt && platform !== 'ios' && platform !== 'inapp' ? (
        <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={() => void prompt()}>
          지금 설치
        </button>
      ) : null}
      {result ? <p className="ui-note" role="status">{result}</p> : null}
    </div>
  );
}

export function InstallPrompt({ onClose }: { onClose: () => void }) {
  const { pwa } = useRem();
  const closeRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="ui-dialog-backdrop">
      <div ref={boxRef} className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <div className="ui-brand">
          <img src={asset('rem-logo.svg')} alt="" width={36} height={38} />
          <div>
            <div className="ui-brand-en">INSTALL TERMINAL</div>
            <h2 id="install-title">단말기를 홈 화면에 설치</h2>
          </div>
        </div>
        <p className="ui-note">설치하면 전체 화면 단말기로 실행되고 알림 권한을 쓸 수 있습니다. 설치하지 않아도 모든 기능을 바로 체험할 수 있습니다.</p>
        <InstallGuide platform={pwa.platform} />
        <p className="ui-banner">{STANDBY_NOTICE}</p>
        <button ref={closeRef} type="button" className="ui-btn ui-btn-block" onClick={onClose}>
          설치 없이 체험
        </button>
      </div>
    </div>
  );
}
