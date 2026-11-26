import type { Report } from '../app/contracts';
import { LEVEL_GRADE, MODE_LABEL, MODULE_LABEL, EVENT_LABEL, STATUS_LABEL, fmtDate, fmtDateTime, fmtElapsed, fmtTime } from './labels';
import './report.css';

const asset = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`;

const RESULT_LABEL = { complete: '완료', incomplete: '미완료', 'not-started': '미착수' } as const;

/** Official paper document. Fictional agency — the footer says so. */
export function ReportDocument({ report }: { report: Report }) {
  const m = report.metrics;
  const statusStamp = report.status === 'cancelled' ? 'failed' : report.status;
  const isSim = report.mode === 'simulation';
  const st = STATUS_LABEL[report.status];

  return (
    <article className="rep-paper" aria-label={`사건 보고서 ${report.docNo}`}>
      <header className="rep-head">
        <img className="rep-logo" src={asset('rem-logo.svg')} alt="R.E.M. 공식 심볼" width={56} height={59} />
        <div className="rep-agency">
          <div className="rep-agency-en">REALITY EMERGENCY MANAGEMENT</div>
          <div className="rep-agency-ko">현실 비상 관리국</div>
          <div className="rep-agency-sub">현실 복구과 · 단말기 운용반</div>
        </div>
        <img className="rep-stamp rep-stamp-restricted" src={asset('stamps/restricted.svg')} alt="대외비 직인" />
      </header>

      <h2 className="rep-title">
        현실 연결 장애 복구 보고서
        <span className="rep-title-en">INCIDENT RECOVERY REPORT</span>
      </h2>

      <dl className="rep-meta">
        <div><dt>문서번호</dt><dd className="mono">{report.docNo}</dd></div>
        <div><dt>작성일자</dt><dd className="mono">{fmtDate(report.createdAt)}</dd></div>
        <div><dt>담당부서</dt><dd>현실 복구과</dd></div>
        <div><dt>단말기</dt><dd className="mono">{report.terminalId}</dd></div>
        <div><dt>분류</dt><dd>{MODE_LABEL[report.mode]} · {st.ko}</dd></div>
        <div><dt>보안등급</dt><dd>대외비</dd></div>
      </dl>

      <section className="rep-sec">
        <h3>1. 사건 개요</h3>
        <p className="rep-summary">{report.summary}</p>
      </section>

      <section className="rep-sec">
        <h3>2. 사건 경과</h3>
        <dl className="rep-facts">
          <div><dt>예약 시각</dt><dd className="mono">{fmtDateTime(m.scheduledAt)}</dd></div>
          <div><dt>경보 발생</dt><dd className="mono">{fmtDateTime(m.startedAt)}</dd></div>
          <div><dt>복구 개시</dt><dd className="mono">{m.recoveryStartedAt ? fmtDateTime(m.recoveryStartedAt) : '개시 안 함'}</dd></div>
          <div><dt>종료 시각</dt><dd className="mono">{fmtDateTime(m.endedAt)}</dd></div>
          <div><dt>경과 시간</dt><dd className="mono">{fmtElapsed(m.elapsedMs)}</dd></div>
          <div><dt>장애 등급</dt><dd>{LEVEL_GRADE[report.level]}</dd></div>
          <div><dt>연결률</dt><dd className="mono">{m.connectionRate}%</dd></div>
          <div><dt>누적 오류</dt><dd className="mono">{m.totalFailures}회</dd></div>
        </dl>
      </section>

      <section className="rep-sec">
        <h3>3. 모듈별 복구 결과</h3>
        <table className="rep-table">
          <thead>
            <tr><th scope="col">모듈</th><th scope="col">소요</th><th scope="col">오류</th><th scope="col">결과</th></tr>
          </thead>
          <tbody>
            {report.moduleResults.map((r) => (
              <tr key={r.module}>
                <th scope="row">
                  <span className="mono">{r.module}</span>
                  <span className="rep-sub">{MODULE_LABEL[r.module].ko}</span>
                </th>
                <td className="mono">{fmtElapsed(r.durationMs)}</td>
                <td className="mono">{r.failures}</td>
                <td>{RESULT_LABEL[r.result]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rep-sec">
        <h3>4. 시간순 기록</h3>
        {report.events.length === 0 ? (
          <p className="rep-summary">기록된 이벤트 없음.</p>
        ) : (
          <ol className="rep-events">
            {report.events.map((e, i) => (
              <li key={i}>
                <span className="mono rep-ev-time">{fmtTime(e.at)}</span>
                <span className="rep-ev-type">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="rep-ev-msg">
                  {e.module ? <span className="mono">[{e.module}] </span> : null}
                  {e.message}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rep-sec rep-final">
        <h3>5. 최종 판정</h3>
        <p className="rep-verdict">
          <strong>{st.ko} ({st.en})</strong> — {report.verdict}
        </p>
        <dl className="rep-facts">
          <div><dt>긴급 종료</dt><dd className="mono">{m.emergencyCount}회</dd></div>
          <div><dt>재경보</dt><dd className="mono">{m.snoozeCount}회</dd></div>
          <div><dt>잔여 장애</dt><dd className="mono">{m.remainingFaults}건</dd></div>
        </dl>
        <div className="rep-stamps">
          <img className="rep-stamp rep-stamp-status" src={asset(`stamps/${statusStamp}.svg`)} alt={`${st.ko} 직인`} />
          {isSim ? <img className="rep-stamp rep-stamp-sim" src={asset('stamps/simulation.svg')} alt="훈련 직인" /> : null}
        </div>
      </section>

      <footer className="rep-foot">
        <span>본 문서는 가상 서비스 R.E.M. : Recovery Terminal이 기기에 저장한 기록이며 실제 기관 문서가 아님.</span>
        <span className="mono rep-page">1 / 1</span>
      </footer>
    </article>
  );
}
