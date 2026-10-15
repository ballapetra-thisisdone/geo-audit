import { useEffect, useState } from 'react';
import { api, type BotRow } from '../../api';
import { toast } from '../../components/ui';
import type { TabProps } from '../AuditView';

const PURPOSE: Record<string, string> = {
  browser: 'viszonyítás',
  crawler: 'keresőrobot',
  search: 'keresés / válasz',
  training: 'modelltanítás',
  user: 'felhasználói lekérés',
  ads: 'hirdetés',
};

type Tone = 'pass' | 'warn' | 'fail' | 'na' | 'info';
const C = ({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) => (
  <td className={`cell ${tone}`} title={title}>
    {children}
  </td>
);

export function Bots({ id, round }: TabProps) {
  const [rows, setRows] = useState<BotRow[] | null>(null);
  useEffect(() => {
    api.botMatrix(id, round.n).then(setRows).catch((e) => toast(e.message, true));
  }, [id, round.n]);

  if (!rows) return <div className="empty"><span className="spinner" /></div>;
  const fetched = rows.filter((r) => r.fetched);
  const robotsOnly = rows.filter((r) => !r.fetched);
  const a = round.artifacts;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card flat">
        <div style={{ padding: '16px 20px 8px' }}>
          <p className="label">Lekérés bot user-agentekkel</p>
          <p className="small muted" style={{ margin: 0 }}>
            Ugyanaz az URL a megadott UA-kkal, JS nélkül. A UA-hamisítás nem helyettesíti a valódi robot-IP-ről érkező kérést: a WAF IP alapján is dönthet.
          </p>
        </div>
        <div className="table-wrap">
          <table className="t heat">
            <thead>
              <tr>
                <th>Robot</th>
                <th>Cél</th>
                <th>HTTP</th>
                <th>Átirányítás</th>
                <th>Blokk / challenge</th>
                <th>robots.txt</th>
                <th>Szöveg a böngészőhöz képest</th>
                <th>Title egyezik</th>
                <th>Kulcsadatok</th>
                <th className="num">TTFB</th>
                <th className="num">Méret</th>
              </tr>
            </thead>
            <tbody>
              {fetched.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                    <div className="small muted">{r.owner}</div>
                  </td>
                  <td className="small">{PURPOSE[r.purpose]}</td>
                  {r.error ? (
                    <C tone="fail" title={r.error}>hiba</C>
                  ) : (
                    <C tone={r.status === 200 ? 'pass' : 'fail'}>{r.status}</C>
                  )}
                  <C tone={r.redirects === null ? 'na' : r.redirects > 1 ? 'warn' : 'pass'}>{r.redirects ?? '—'}</C>
                  <C tone={r.challenge ? 'fail' : 'pass'}>{r.challenge ?? 'nincs'}</C>
                  {r.robotsAllowed === null ? (
                    <C tone="na">{r.id === 'browser' ? '—' : 'n. a.'}</C>
                  ) : (
                    <C tone={r.robotsAllowed ? 'pass' : r.purpose === 'training' ? 'info' : 'fail'} title={r.robotsRule ?? ''}>
                      {r.robotsAllowed ? 'engedélyezett' : 'tiltva'}
                      {r.robotsSpecific ? ' *' : ''}
                    </C>
                  )}
                  <C tone={r.textPct === null ? 'na' : r.textPct < 70 ? 'warn' : 'pass'}>{r.textPct === null ? '—' : `${r.textPct}%`}</C>
                  <C tone={r.titleMatch === null ? 'na' : r.titleMatch ? 'pass' : 'warn'}>{r.titleMatch === null ? '—' : r.titleMatch ? 'igen' : 'nem'}</C>
                  <C tone={r.keyFound === null ? 'na' : r.keyFound === r.keyTotal ? 'pass' : r.keyFound === 0 ? 'fail' : 'warn'}>
                    {r.keyFound === null ? '—' : `${r.keyFound}/${r.keyTotal}`}
                  </C>
                  <td className="num">{r.ttfbMs ?? '—'} ms</td>
                  <td className="num">{r.bytes ? `${Math.round(r.bytes / 1024)} KB` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ padding: '8px 20px 16px', margin: 0 }}>
          * saját user-agent csoport a robots.txt-ben. A ChatGPT-User-re a robots.txt az OpenAI szerint nem feltétlenül vonatkozik.
          {a?.render?.ok ? ` Renderelés: ${a.render.engine}, ${a.render.loadMs} ms, ${a.render.requestCount} kérés.` : ` Renderelés: ${a?.render?.error ?? 'nem futott'}.`}
        </p>
      </div>

      <div className="card flat">
        <div style={{ padding: '16px 20px 8px' }}>
          <p className="label">További robotok (csak robots.txt)</p>
          <p className="small muted" style={{ margin: 0 }}>Keresési/válaszadó és tanító célú robotok külön. Engedélyezésük üzleti döntés, nem automatikus javaslat.</p>
        </div>
        <div className="table-wrap">
          <table className="t heat">
            <thead>
              <tr>
                <th>Robot</th>
                <th>Üzemeltető</th>
                <th>Cél</th>
                <th>robots.txt vonatkozik rá</th>
                <th>Döntés a vizsgált útvonalon</th>
                <th>Szabály</th>
              </tr>
            </thead>
            <tbody>
              {robotsOnly.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                  </td>
                  <td>{r.owner}</td>
                  <td className="small">{PURPOSE[r.purpose]}</td>
                  <td className="small">{r.robotsApplies}</td>
                  {r.robotsAllowed === null ? (
                    <C tone="na">n. a.</C>
                  ) : (
                    <C tone={r.robotsAllowed ? 'pass' : r.purpose === 'training' ? 'info' : 'warn'}>{r.robotsAllowed ? 'engedélyezett' : 'tiltva'}</C>
                  )}
                  <td className="small">
                    <code>{r.robotsRule ?? (r.robotsSpecific ? 'saját csoport' : "'*' csoport / nincs szabály")}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {a && (
        <div className="card">
          <p className="label">Nyers válaszok</p>
          <div className="row">
            {a.fetches
              .filter((f) => f.bodyFile)
              .map((f) => (
                <a key={f.botId} className="btn sm" href={api.bodyUrl(id, round.n, f.bodyFile!)} target="_blank" rel="noreferrer">
                  {rows.find((r) => r.id === f.botId)?.name ?? f.botId}
                </a>
              ))}
            {a.render?.bodyFile && (
              <a className="btn sm" href={api.bodyUrl(id, round.n, a.render.bodyFile)} target="_blank" rel="noreferrer">
                Renderelt DOM
              </a>
            )}
            {a.saved?.bodyFile && (
              <a className="btn sm" href={api.bodyUrl(id, round.n, a.saved.bodyFile)} target="_blank" rel="noreferrer">
                Mentett HTML ({a.saved.fileName})
              </a>
            )}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Ellenőrző parancsok kézi futtatáshoz:</p>
          <pre className="code">
            {a.fetches
              .filter((f) => f.botId !== 'browser')
              .map((f) => `curl -A "${f.ua}" -sL -o /dev/null -w "%{http_code} %{size_download}\\n" ${round.input.url}`)
              .join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
