import { useEffect, useState } from 'react';
import { api } from './api';
import { ToastHost } from './components/ui';
import { AuditList } from './pages/AuditList';
import { NewAudit } from './pages/NewAudit';
import { AuditView } from './pages/AuditView';
import { CheckLibrary } from './pages/CheckLibrary';
import { SiteList } from './site/SiteList';
import { NewSiteAudit } from './site/NewSiteAudit';
import { SiteAuditView } from './site/SiteAuditView';
import './site/site.css';

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const h = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return hash;
}

export const go = (path: string) => (window.location.hash = path);

export function App() {
  const hash = useHash();
  const [meta, setMeta] = useState<{ ai: { enabled: boolean; model: string } } | null>(null);
  useEffect(() => {
    api.meta().then(setMeta).catch(() => setMeta(null));
    // Nyomtatásnál a jelmagyarázat mindig nyitva legyen.
    const open = () => document.querySelectorAll<HTMLDetailsElement>('details.legend-card').forEach((d) => (d.open = true));
    window.addEventListener('beforeprint', open);
    return () => window.removeEventListener('beforeprint', open);
  }, []);

  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);

  // Webhely-audit (v2): #/, #/site/new, #/site/:id · Egyoldalas audit (v1): #/pages, #/new, #/audit/:id, #/checks
  const legacy = ['pages', 'new', 'audit', 'checks'].includes(parts[0]);
  let page;
  if (parts[0] === 'site' && parts[1] === 'new') page = <NewSiteAudit />;
  else if (parts[0] === 'site' && parts[1]) page = <SiteAuditView key={parts[1]} id={parts[1]} tab={params.get('tab') ?? 'overview'} />;
  else if (parts[0] === 'new') page = <NewAudit />;
  else if (parts[0] === 'audit' && parts[1]) page = <AuditView key={parts[1]} id={parts[1]} n={parts[2] ? Number(parts[2]) : undefined} tab={params.get('tab') ?? 'overview'} aiEnabled={!!meta?.ai.enabled} />;
  else if (parts[0] === 'checks') page = <CheckLibrary />;
  else if (parts[0] === 'pages') page = <AuditList />;
  else page = <SiteList />;

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          <img src="/logo-dark.svg" alt="DONE." />
          <span>GEO Audit</span>
        </a>
        <nav>
          <a href="#/" className={!legacy && parts[1] !== 'new' ? 'active' : ''}>
            Webhely-auditok
          </a>
          <a href="#/site/new" className={parts[0] === 'site' && parts[1] === 'new' ? 'active' : ''}>
            Új audit
          </a>
          <a href="#/pages" className={legacy ? 'active' : ''} title="A korábbi, egyetlen oldalt vizsgáló audit (Bing/ChatGPT) és az ellenőrzés-könyvtár">
            Oldal-audit (v1)
          </a>
          {legacy && (
            <a href="#/checks" className={parts[0] === 'checks' ? 'active' : ''}>
              Ellenőrzés-könyvtár
            </a>
          )}
        </nav>
        <div className="spacer" />
        <div className="ai-pill" title={meta?.ai.enabled ? `Claude API: ${meta.ai.model}` : 'Nincs ANTHROPIC_API_KEY a .env-ben'}>
          <span className={`dot ${meta?.ai.enabled ? 'on' : ''}`} />
          <span className="txt">Claude API {meta?.ai.enabled ? 'bekapcsolva' : 'kikapcsolva'}</span>
        </div>
      </header>
      <main className="page">{page}</main>
      <ToastHost />
    </>
  );
}
