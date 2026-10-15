import { useEffect, useState } from 'react';
import { api } from '../api';
import { band, fmtDate, toast } from '../components/ui';
import type { AuditSummary } from '../../../shared/types';

export function AuditList() {
  const [list, setList] = useState<AuditSummary[] | null>(null);
  const load = () => api.audits().then(setList).catch((e) => toast(e.message, true));
  useEffect(() => void load(), []);

  return (
    <>
      <div className="header-block">
        <div className="stripe" />
        <div>
          <p className="label">GEO / AI-láthatóság</p>
          <h1 className="title">Auditok</h1>
          <p className="sub">Bing/Copilot és ChatGPT láthatósági auditok, körönként verziózva.</p>
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="row">
          <a className="btn primary" href="#/new">
            + Új audit
          </a>
        </div>
      </div>

      {list === null ? (
        <div className="empty">
          <span className="spinner" />
        </div>
      ) : !list.length ? (
        <div className="card empty">
          <p>Még nincs audit.</p>
          <a className="btn primary" href="#/new">
            Az első audit indítása
          </a>
        </div>
      ) : (
        <div className="card flat table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Oldal</th>
                <th>Szervezet</th>
                <th>Típus</th>
                <th className="num">Körök</th>
                <th className="num">Bing/Copilot</th>
                <th className="num">ChatGPT</th>
                <th>Utolsó kör</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const last = a.rounds[a.rounds.length - 1];
                const s = last?.scores?.surfaces;
                return (
                  <tr key={a.id}>
                    <td>
                      <a href={`#/audit/${a.id}`}>
                        <b>{a.input.name || a.input.url}</b>
                      </a>
                      <div className="small muted">{a.input.url}</div>
                    </td>
                    <td>{a.input.org || '—'}</td>
                    <td>{a.input.pageType || '—'}</td>
                    <td className="num">{a.rounds.length}</td>
                    <td className={`num band-${band(s?.bing.score ?? null).cls}`}>
                      <b>{s?.bing.score ?? '—'}</b>
                    </td>
                    <td className={`num band-${band(s?.chatgpt.score ?? null).cls}`}>
                      <b>{s?.chatgpt.score ?? '—'}</b>
                    </td>
                    <td className="small">
                      {last ? `${fmtDate(last.createdAt)}${last.status === 'running' ? ' · fut…' : last.status === 'error' ? ' · hiba' : ''}` : '—'}
                    </td>
                    <td>
                      <button
                        className="btn sm ghost"
                        onClick={async () => {
                          if (!confirm(`Törlöd a(z) „${a.input.name || a.input.url}” auditot minden körével?`)) return;
                          await api.deleteAudit(a.id);
                          void load();
                        }}
                      >
                        Törlés
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
