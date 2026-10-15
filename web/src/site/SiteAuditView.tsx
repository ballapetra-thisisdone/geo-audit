import { useEffect, useState } from 'react';
import { siteApi, type AuditDetail } from './api';
import { Loading } from './ui';
import { AuditStatus } from './SiteList';
import { toast, fmtDate } from '../components/ui';
import { OverviewTab, ProgressTab } from './tabs/overview';
import { TechnicalTab, ContentTab, EntitiesTab, StructuredTab } from './tabs/analysis';
import { QueriesTab, VisibilityTab, CompetitorsTab, QueryGapsTab, ContentGapsTab } from './tabs/market';
import { IssuesTab, BacklogTab, PagesTab, ExportTab } from './tabs/actions';

export const TABS: { id: string; l: string }[] = [
  { id: 'overview', l: 'Áttekintés' },
  { id: 'progress', l: 'Crawl és folyamat' },
  { id: 'technical', l: 'Technikai' },
  { id: 'content', l: 'Tartalom' },
  { id: 'entities', l: 'Entitások' },
  { id: 'structured', l: 'Strukturált adat' },
  { id: 'queries', l: 'Kérdés-lefedettség' },
  { id: 'visibility', l: 'AI Visibility' },
  { id: 'competitors', l: 'Versenytársak' },
  { id: 'qgaps', l: 'Query gapek' },
  { id: 'cgaps', l: 'Tartalmi gapek' },
  { id: 'issues', l: 'Ajánlások' },
  { id: 'backlog', l: 'Backlog' },
  { id: 'pages', l: 'Oldalak' },
  { id: 'export', l: 'Export' },
];

export function SiteAuditView({ id, tab }: { id: string; tab: string }) {
  const [d, setD] = useState<AuditDetail>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const running = d && (d.audit.status === 'running' || d.audit.status === 'queued');

  useEffect(() => {
    let alive = true;
    siteApi.get(id).then((x) => alive && setD(x)).catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id, tick]);
  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(h);
  }, [running]);

  const go = (t: string) => (window.location.hash = `/site/${id}?tab=${t}`);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      setTick((t) => t + 1);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  // futás közben a folyamat fül az alapértelmezett
  const active = running && tab === 'overview' ? 'progress' : tab;

  return (
    <Loading error={error} loading={!d && !error}>
      {d && (
        <div className="stack">
          <div className="header-block">
            <div className="stripe" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="label">GEO audit · {d.audit.id}</p>
              <h1 className="title">{d.audit.domain}</h1>
              <div className="row small muted">
                <AuditStatus s={d.audit.status} />
                <span>Indítva: {fmtDate(d.audit.createdAt)}</span>
                {d.audit.finishedAt && <span>Befejezve: {fmtDate(d.audit.finishedAt)}</span>}
                <span>Módszer: {d.audit.methodVersion}</span>
                <span>{d.counts.pages} oldal · {d.counts.issues} problémacsoport · {d.counts.recommendations} javaslat</span>
              </div>
            </div>
            <div className="row no-print" style={{ alignSelf: 'center' }}>
              {running ? (
                <button className="btn" onClick={() => act(() => siteApi.cancel(id), 'Megszakítás kérve')}>Megszakítás</button>
              ) : (
                <button className="btn" onClick={() => act(() => siteApi.rerun(id), 'Az audit újra sorba került')}>Újrafuttatás</button>
              )}
              <a className="btn" href={siteApi.exportUrl(id, 'html')} target="_blank" rel="noreferrer">Riport (PDF-hez)</a>
              <button
                className="btn ghost"
                onClick={() => {
                  if (confirm('Biztosan törlöd az auditot és minden adatát?')) void act(() => siteApi.remove(id), 'Törölve').then(() => (window.location.hash = '/'));
                }}
              >
                Törlés
              </button>
            </div>
          </div>
          {(d.audit.partial || running) && (
            <div className="notice">
              {running
                ? 'Az audit fut – az eddig elkészült eredmények részlegesek, és a feldolgozás végéig változhatnak.'
                : d.audit.status === 'failed'
                  ? `Az audit sikertelen: ${d.audit.error ?? 'lásd a folyamat fület'}.`
                  : 'Részleges eredmény: egy vagy több lépés nem futott le teljesen (lásd a „Crawl és folyamat” fület). Az érintett részek ennek megfelelően jelölve.'}
            </div>
          )}
          <div className="tabs no-print" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'active' : ''} onClick={() => go(t.id)}>
                {t.l}
                {t.id === 'issues' && d.counts.p0 + d.counts.p1 ? <span className="count">{d.counts.p0 + d.counts.p1}</span> : null}
              </button>
            ))}
          </div>
          {active === 'overview' && <OverviewTab d={d} go={go} />}
          {active === 'progress' && <ProgressTab d={d} running={!!running} />}
          {active === 'technical' && <TechnicalTab id={id} />}
          {active === 'content' && <ContentTab id={id} />}
          {active === 'entities' && <EntitiesTab id={id} />}
          {active === 'structured' && <StructuredTab id={id} />}
          {active === 'queries' && <QueriesTab id={id} />}
          {active === 'visibility' && <VisibilityTab id={id} />}
          {active === 'competitors' && <CompetitorsTab id={id} />}
          {active === 'qgaps' && <QueryGapsTab id={id} />}
          {active === 'cgaps' && <ContentGapsTab id={id} />}
          {active === 'issues' && <IssuesTab id={id} />}
          {active === 'backlog' && <BacklogTab id={id} />}
          {active === 'pages' && <PagesTab id={id} />}
          {active === 'export' && <ExportTab id={id} />}
        </div>
      )}
    </Loading>
  );
}
