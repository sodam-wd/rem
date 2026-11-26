import { useState } from 'react';
import type { ArchiveFilter, Report } from '../app/contracts';
import { LEVEL_LABEL } from '../app/contracts';
import { useRem } from '../app/RemContext';
import { filterReports } from '../reports';
import { MODE_LABEL, STATUS_LABEL, fmtDateTime } from '../reports/labels';
import { ConfirmDialog, Panel, Screen } from './common';

const FILTERS: { id: ArchiveFilter; ko: string }[] = [
  { id: 'all', ko: '전체' },
  { id: 'real', ko: '실제' },
  { id: 'recovered', ko: '정상' },
  { id: 'deferred', ko: '유예' },
  { id: 'failed', ko: '실패' },
  { id: 'simulation', ko: '훈련' },
];

export const STATUS_CLS: Record<Report['status'], string> = {
  recovered: 'st-ok',
  deferred: 'st-warn',
  failed: 'st-alert',
  cancelled: 'st-alert',
};

export function ArchiveScreen() {
  const { reports, navigate, deleteReport } = useRem();
  const [filter, setFilter] = useState<ArchiveFilter>('all');
  const [toDelete, setToDelete] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = filterReports(reports, filter).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Screen en="ARCHIVE" ko="보관소">
      <p className="ui-note">발행된 사건 보고서는 이 기기의 브라우저 저장소에만 보관됩니다.</p>
      <div className="ui-filter" role="group" aria-label="보고서 분류">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.ko} <span className="mono" style={{ fontSize: 11 }}>{filterReports(reports, f.id).length}</span>
          </button>
        ))}
      </div>
      {err ? <p className="ui-banner ui-banner-alert" role="alert">{err}</p> : null}

      {reports.length === 0 ? (
        <Panel title="보관된 보고서 없음" en="EMPTY">
          <div className="ui-stack">
            <p>경보를 복구하거나 긴급 종료·취소하면 공식 보고서가 발행되어 이곳에 보관됩니다.</p>
            <button type="button" className="ui-btn ui-btn-block" onClick={() => navigate('/simulation')}>훈련으로 보고서 발행해 보기</button>
          </div>
        </Panel>
      ) : list.length === 0 ? (
        <Panel title="해당 분류의 보고서 없음" en="NO MATCH">
          <p>다른 분류를 선택하십시오.</p>
        </Panel>
      ) : (
        <ul className="ui-list" aria-label="보고서 목록">
          {list.map((r) => (
            <li key={r.id} className="ui-report-row">
              <button type="button" className="ui-report-open" onClick={() => navigate(`/archive/${r.id}`)}>
                <span className="ui-spread" style={{ width: '100%' }}>
                  <span className="mono" style={{ fontSize: 14 }}>{r.docNo}</span>
                  <span className={`ui-chip ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status].ko}</span>
                </span>
                <span className="ui-alarm-meta">
                  <span className="mono">{fmtDateTime(r.metrics.startedAt)}</span>
                  <span>{MODE_LABEL[r.mode]}</span>
                  <span>난이도 {LEVEL_LABEL[r.level].ko}</span>
                  <span className="mono">연결률 {r.metrics.connectionRate}%</span>
                </span>
              </button>
              <button type="button" className="ui-report-del" aria-label={`${r.docNo} 삭제`} onClick={() => setToDelete(r)}>
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      {toDelete ? (
        <ConfirmDialog
          title="보고서 삭제"
          body={<>문서 <span className="mono">{toDelete.docNo}</span>을(를) 삭제합니다. 삭제한 보고서는 복구할 수 없습니다.</>}
          confirmLabel="삭제"
          danger
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            const id = toDelete.id;
            setToDelete(null);
            deleteReport(id).catch((e) => setErr(e instanceof Error ? e.message : '삭제하지 못했습니다.'));
          }}
        />
      ) : null}
    </Screen>
  );
}
