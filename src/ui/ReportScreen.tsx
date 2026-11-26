import { useState } from 'react';
import { useRem } from '../app/RemContext';
import { ReportDocument } from '../reports';
import { ConfirmDialog, Panel, Screen } from './common';

export function ReportScreen({ reportId }: { reportId: string }) {
  const { getReport, deleteReport, navigate, ready } = useRem();
  const report = getReport(reportId);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!report) {
    return (
      <Screen en="ARCHIVE / REPORT" ko="사건 보고서" back="/archive">
        <Panel title={ready ? '보고서를 찾을 수 없음' : '불러오는 중'} en={ready ? 'NOT FOUND' : 'LOADING'}>
          <div className="ui-stack">
            <p>{ready ? '삭제되었거나 이 기기에 없는 보고서입니다.' : '보관된 보고서를 불러오고 있습니다.'}</p>
            <button type="button" className="ui-btn" onClick={() => navigate('/archive')}>보관소로</button>
          </div>
        </Panel>
      </Screen>
    );
  }

  return (
    <Screen en="ARCHIVE / REPORT" ko="사건 보고서" back="/archive">
      {err ? <p className="ui-banner ui-banner-alert" role="alert">{err}</p> : null}
      <ReportDocument report={report} />
      <div className="ui-row">
        <button type="button" className="ui-btn" style={{ flex: 1 }} onClick={() => navigate('/archive')}>보관소</button>
        <button type="button" className="ui-btn ui-btn-danger" style={{ flex: 1 }} onClick={() => setConfirm(true)}>보고서 삭제</button>
      </div>
      {confirm ? (
        <ConfirmDialog
          title="보고서 삭제"
          body={<>문서 <span className="mono">{report.docNo}</span>을(를) 삭제합니다. 삭제한 보고서는 복구할 수 없습니다.</>}
          confirmLabel="삭제"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            try {
              await deleteReport(report.id);
              navigate('/archive');
            } catch (e) {
              setErr(e instanceof Error ? e.message : '삭제하지 못했습니다.');
            }
          }}
        />
      ) : null}
    </Screen>
  );
}
