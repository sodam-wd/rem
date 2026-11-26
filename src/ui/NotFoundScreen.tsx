import { useRem } from '../app/RemContext';
import { Panel, Screen } from './common';

export function NotFoundScreen() {
  const { navigate, route } = useRem();
  return (
    <Screen en="ERROR 404" ko="경로 없음">
      <Panel title="요청한 화면이 없습니다" en="NOT FOUND">
        <div className="ui-stack">
          <p>
            단말기에 등록되지 않은 경로입니다: <span className="mono">{route}</span>
          </p>
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => navigate('/')}>메인으로</button>
        </div>
      </Panel>
    </Screen>
  );
}
