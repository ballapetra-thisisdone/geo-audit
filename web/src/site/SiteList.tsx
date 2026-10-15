import { siteApi } from './api';
import { Loading, useLoad, Empty } from './ui';
import { fmtDate } from '../components/ui';

export const STATUS_HU: Record<string, { l: string; cls: string; ic: string }> = {
  queued: { l: 'Sorban áll', cls: 'info', ic: '…' },
  running: { l: 'Fut', cls: 'info', ic: '↻' },
  done: { l: 'Kész', cls: 'pass', ic: '✓' },
  partial: { l: 'Részleges', cls: 'warn', ic: '!' },
  failed: { l: 'Sikertelen', cls: 'fail', ic: '✕' },
  cancelled: { l: 'Megszakítva', cls: 'na', ic: '–' },
};

export function AuditStatus({ s }: { s: string }) {
  const x = STATUS_HU[s] ?? { l: s, cls: 'na', ic: '?' };
  return (
    <span className={`status ${x.cls}`}>
      <span className="ic" aria-hidden>{x.ic}</span>
      {x.l}
    </span>
  );
}

export function SiteList() {
  const { data, error, loading } = useLoad(() => siteApi.list(), []);
  return (
    <div className="stack">
      <div className="header-block">
        <div className="stripe" />
        <div style={{ flex: 1 }}>
          <p className="label">Webhely-szintű GEO audit</p>
          <h1 className="title">Auditok</h1>
          <p className="sub">Egyszeri, pillanatfelvétel-alapú audit: crawl, technikai és tartalmi elemzés, entitások, kérdés-lefedettség, versenytársak, AI-láthatóság (ha konfigurált), prioritásos javaslatok és backlog.</p>
        </div>
        <a className="btn primary" href="#/site/new" style={{ alignSelf: 'center' }}>
          + Új audit
        </a>
      </div>
      <Loading error={error} loading={loading}>
        {!data?.length ? (
          <Empty>
            Még nincs audit. <a href="#/site/new">Indíts egyet</a> egy domain megadásával.
          </Empty>
        ) : (
          <div className="card flat table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Állapot</th>
                  <th className="num">GEO Score</th>
                  <th className="num">Versenytárs</th>
                  <th>Indítva</th>
                  <th>Audit ID</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <a href={`#/site/${a.id}`}>
                        <b>{a.domain}</b>
                      </a>
                    </td>
                    <td>
                      <AuditStatus s={a.status} />
                    </td>
                    <td className="num">{a.score ?? '—'}</td>
                    <td className="num">{a.competitors}</td>
                    <td>{fmtDate(a.createdAt)}</td>
                    <td className="small muted">{a.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loading>
    </div>
  );
}
