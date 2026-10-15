import { Fragment, useEffect, useState } from 'react';
import { siteApi, type PageDetail } from '../api';
import { Conf, Empty, Filter, Kind, Loading, Note, Pre, Prio, UrlLink, useLoad } from '../ui';
import { CATEGORY_LABEL, type IssueCategory, type PriorityLevel, type RecType } from '../../../../shared/site';
import { Drawer } from '../../components/ui';

const PRIOS: { v: PriorityLevel; l: string }[] = [{ v: 'P0', l: 'P0 – kritikus' }, { v: 'P1', l: 'P1 – magas' }, { v: 'P2', l: 'P2 – közepes' }, { v: 'P3', l: 'P3 – alacsony' }];
const OWNER: Record<string, string> = { dev: 'fejlesztő', content: 'tartalom', both: 'fejlesztő + tartalom', business: 'üzleti döntés' };
const REC_HU: Record<RecType, string> = { title: 'Title', meta_description: 'Meta description', h1: 'H1', heading_outline: 'Címsor-struktúra', answer_block: 'Válaszblokk', faq: 'GYIK', jsonld: 'JSON-LD', internal_link: 'Belső link', content_brief: 'Content brief', entity_description: 'Entitásleírás', author_bio: 'Szerzői bemutatkozás', html: 'HTML', robots: 'robots.txt' };
const VAL: Record<string, { l: string; cls: string }> = { tested: { l: 'tesztelt kód', cls: 'evidence-observed' }, unverified: { l: 'ellenőrizetlen', cls: 'evidence-hypothesis' }, template: { l: 'kitöltendő sablon', cls: 'evidence-unverifiable' } };

export function IssuesTab({ id }: { id: string }) {
  const issues = useLoad(() => siteApi.issues(id), [id]);
  const recs = useLoad(() => siteApi.recommendations(id), [id]);
  const [view, setView] = useState<'issues' | 'recs'>('issues');
  const [prio, setPrio] = useState<PriorityLevel | ''>('');
  const [cat, setCat] = useState<IssueCategory | ''>('');
  const [effort, setEffort] = useState<'' | 'S' | 'M' | 'L'>('');
  const [site, setSite] = useState<'own' | 'all'>('own');
  const [rtype, setRtype] = useState<RecType | ''>('');
  const [q, setQ] = useState('');
  const [openIssue, setOpenIssue] = useState<string>();
  const list = (issues.data ?? []).filter((i) => (site === 'all' || i.site === 'own') && (!prio || i.priority === prio) && (!cat || i.category === cat) && (!effort || i.effort === effort) && (!q || `${i.title} ${i.urls.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const rlist = (recs.data ?? []).filter((r) => (!prio || r.priority === prio) && (!rtype || r.type === rtype) && (!q || `${r.title} ${r.url ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const matrix = (i: number, e: string) => (issues.data ?? []).filter((x) => x.site === 'own' && (i >= 4 ? x.impact >= 4 : i === 3 ? x.impact === 3 : x.impact <= 2) && x.effort === e).length;
  return (
    <Loading error={issues.error ?? recs.error} loading={issues.loading || recs.loading}>
      <div className="stack">
        <div className="grid cols-2">
          <div className="card">
            <h2>Impact / Effort</h2>
            <table className="t impact">
              <thead><tr><th>Hatás \ ráfordítás</th><th>S (kicsi)</th><th>M (közepes)</th><th>L (nagy)</th></tr></thead>
              <tbody>
                {[[4, 'magas (4–5)'], [3, 'közepes (3)'], [2, 'alacsony (1–2)']].map(([i, l]) => (
                  <tr key={i}><td>{l}</td>{['S', 'M', 'L'].map((e) => <td key={e} className={`num ${i === 4 && e === 'S' ? 'quick' : ''}`}>{matrix(i as number, e)}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <Note>A bal felső cella a quick win: nagy várható hatás kis ráfordítással. A hatás becslés, nem garancia.</Note>
          </div>
          <div className="card">
            <h2>Prioritás</h2>
            <p className="small">A prioritás a várható hatás, az üzleti fontosság (fontos oldalakat érint-e), az érintett URL-ek száma, a ráfordítás, a bizonyosság és a bizonyíték minősége alapján számolódik. P0 csak blokkoló, magas bizonyosságú hiba lehet. A kapcsolódó problémák csoportosítva jelennek meg, az érintett URL-ek megmaradnak.</p>
            <div className="counts">{PRIOS.map((p) => <span key={p.v}><Prio p={p.v} /> {(issues.data ?? []).filter((i) => i.site === 'own' && i.priority === p.v).length}</span>)}</div>
          </div>
        </div>
        <div className="card flat">
          <div className="row" style={{ padding: '12px 20px' }}>
            <div className="chip-select">
              <button className={view === 'issues' ? 'on' : ''} onClick={() => setView('issues')}>Problémák ({list.length})</button>
              <button className={view === 'recs' ? 'on' : ''} onClick={() => setView('recs')}>Konkrét javaslatok ({rlist.length})</button>
            </div>
            <div className="spacer" style={{ flex: 1 }} />
            <input type="text" placeholder="Keresés címben/URL-ben…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
            <Filter label="Prioritás" value={prio} options={PRIOS} onChange={setPrio} />
            {view === 'issues' ? (
              <>
                <Filter label="Kategória" value={cat} options={Object.entries(CATEGORY_LABEL).map(([v, l]) => ({ v: v as IssueCategory, l }))} onChange={setCat} />
                <Filter label="Ráfordítás" value={effort} options={[{ v: 'S', l: 'S' }, { v: 'M', l: 'M' }, { v: 'L', l: 'L' }]} onChange={setEffort} />
                <label className="check small"><input type="checkbox" checked={site === 'all'} onChange={(e) => setSite(e.target.checked ? 'all' : 'own')} /> versenytársaké is</label>
              </>
            ) : (
              <Filter label="Típus" value={rtype} options={Object.entries(REC_HU).map(([v, l]) => ({ v: v as RecType, l }))} onChange={setRtype} />
            )}
          </div>
          {view === 'issues' ? (
            list.length ? list.map((i) => (
              <div key={i.id} className="finding">
                <div className="head" onClick={() => setOpenIssue(openIssue === i.id ? undefined : i.id)}>
                  <Prio p={i.priority} />
                  <div className="t">
                    <b>{i.title}{i.site !== 'own' && <span className="tag outline" style={{ marginLeft: 6 }}>{i.site}</span>}</b>
                    <span className="s small">{CATEGORY_LABEL[i.category]} · {i.urls.length} érintett URL · hatás {i.impact}/5 · ráfordítás {i.effort} · {OWNER[i.owner]}</span>
                  </div>
                  <Kind k={i.evidenceKind} />
                  <Conf v={i.confidence} />
                </div>
                {openIssue === i.id && (
                  <div className="body small stack" style={{ gap: 8 }}>
                    <div><b>Miért fontos:</b> {i.why}</div>
                    <div><b>Javasolt megoldás:</b> {i.fix}</div>
                    <div><b>Elfogadási kritérium:</b> {i.acceptance}</div>
                    {i.qa && <div className="muted"><b>QA:</b> {i.qa}</div>}
                    <div>
                      <b>Bizonyítékok ({i.evidence.length})</b>
                      <ul className="details">{i.evidence.slice(0, 60).map((e, k) => <li key={k}>{e.url && <UrlLink url={e.url} max={60} />} {e.detail}{e.snippet && <div className="muted">„{e.snippet}”</div>}</li>)}</ul>
                    </div>
                    {(recs.data ?? []).filter((r) => r.issueId === i.id).length > 0 && (
                      <div><b>Kapcsolódó javaslatok:</b> {(recs.data ?? []).filter((r) => r.issueId === i.id).map((r) => r.id).join(', ')} <button className="btn sm ghost" onClick={() => { setView('recs'); setQ(''); setRtype(''); }}>megnyitás →</button></div>
                    )}
                  </div>
                )}
              </div>
            )) : <Empty>Nincs a szűrésnek megfelelő probléma.</Empty>
          ) : rlist.length ? (
            rlist.map((r) => (
              <div key={r.id} className="finding">
                <div className="row" style={{ marginBottom: 6 }}>
                  <Prio p={r.priority} /> <b>{r.id} · {r.title}</b> <span className="tag outline">{REC_HU[r.type]}</span> <span className={`tag ${VAL[r.validation].cls}`}>{VAL[r.validation].l}</span> <Conf v={r.confidence} />
                </div>
                {r.url && <div className="small"><UrlLink url={r.url} /></div>}
                <div className="grid cols-2" style={{ marginTop: 6 }}>
                  {r.original !== undefined && r.original !== '' && <div><span className="label">Eredeti állapot</span><Pre text={r.original} /></div>}
                  <div style={r.original ? undefined : { gridColumn: '1 / -1' }}><span className="label">Javasolt állapot</span><Pre text={r.proposed} lang={r.lang} /></div>
                </div>
                <div className="small"><b>Indoklás:</b> {r.rationale}</div>
                {r.validationNote && <div className="small muted"><b>Validáció:</b> {r.validationNote}</div>}
                {r.evidence.length > 0 && <div className="small muted">Bizonyíték: {r.evidence.slice(0, 3).map((e) => `${e.url ? e.url + ' – ' : ''}${e.detail}`).join(' | ')}</div>}
              </div>
            ))
          ) : <Empty>Nincs a szűrésnek megfelelő javaslat.</Empty>}
        </div>
        <Note>A javaslatokat nem alkalmazzuk automatikusan a vizsgált weboldalon. A „tesztelt kód” automatikusan validált (JSON szintaxis, schema.org készlet, robots-értelmező); élesítés előtt a hivatalos validátorokkal is ellenőrizd.</Note>
      </div>
    </Loading>
  );
}

export function BacklogTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.backlog(id), [id]);
  const [prio, setPrio] = useState<PriorityLevel | ''>('');
  const [owner, setOwner] = useState('');
  const [open, setOpen] = useState<string>();
  const tasks = (data ?? []).filter((t) => (!prio || t.priority === prio) && (!owner || t.owner === owner));
  return (
    <Loading error={error} loading={loading}>
      <div className="card flat">
        <div className="row" style={{ padding: '12px 20px' }}>
          <h2 style={{ margin: 0, flex: 1 }}>Fejlesztői backlog ({tasks.length})</h2>
          <Filter label="Prioritás" value={prio} options={PRIOS} onChange={setPrio} />
          <Filter label="Felelős" value={owner} options={Object.entries(OWNER).map(([v, l]) => ({ v, l }))} onChange={setOwner} />
          <a className="btn sm" href={siteApi.exportUrl(id, 'backlog')}>CSV</a>
        </div>
        {tasks.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>ID</th><th>Feladat</th><th>Prio</th><th className="num">Hatás</th><th>Ráfordítás</th><th>Felelős</th><th>Függőség</th><th className="num">URL</th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <Fragment key={t.id}>
                    <tr onClick={() => setOpen(open === t.id ? undefined : t.id)} style={{ cursor: 'pointer' }}>
                      <td><b>{t.id}</b></td>
                      <td>{t.title}</td>
                      <td><Prio p={t.priority} /></td>
                      <td className="num">{t.impact}/5</td>
                      <td><span className="effort">{t.effort}</span></td>
                      <td className="small">{OWNER[t.owner]}</td>
                      <td className="small">{t.dependencies.join(', ') || '—'}</td>
                      <td className="num">{t.urls.length}</td>
                    </tr>
                    {open === t.id && (
                      <tr>
                        <td colSpan={8} className="small">
                          <div style={{ whiteSpace: 'pre-wrap' }}>{t.description}</div>
                          <h3 style={{ marginTop: 10 }}>Technikai részletek</h3>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{t.technical}</div>
                          <h3 style={{ marginTop: 10 }}>Acceptance criteria</h3>
                          <ul className="tight">{t.acceptance.map((a) => <li key={a}>{a}</li>)}</ul>
                          <h3 style={{ marginTop: 10 }}>Érintett URL-ek</h3>
                          <div style={{ maxHeight: 200, overflow: 'auto' }}>{t.urls.map((u) => <div key={u}><UrlLink url={u} max={100} /></div>)}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Nincs feladat.</Empty>}
      </div>
    </Loading>
  );
}

const CLS = [
  { v: 'indexable', l: 'indexelhető' }, { v: 'noindex', l: 'noindex' }, { v: 'canonicalized', l: 'kanonizált' }, { v: 'redirect', l: 'átirányítás' }, { v: 'error', l: 'hibás' }, { v: 'blocked', l: 'robots-tiltott' }, { v: 'non_html', l: 'nem HTML' },
];
const FLAGS = [
  { v: 'thin', l: 'thin' }, { v: 'duplicate', l: 'duplikált' }, { v: 'near_duplicate', l: 'közel duplikált' }, { v: 'orphan', l: 'orphan' }, { v: 'deep', l: 'mély' }, { v: 'hard_to_discover', l: 'nehezen felfedezhető' }, { v: 'js_dependent', l: 'JS-függő' }, { v: 'low_inlinks', l: 'kevés belső link' },
];

export function PagesTab({ id }: { id: string }) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const [cls, setCls] = useState(params.get('cls') ?? '');
  const [flag, setFlag] = useState(params.get('flag') ?? '');
  const [q, setQ] = useState('');
  const [site, setSite] = useState('own');
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<number>();
  const comps = useLoad(() => siteApi.competitors(id), [id]);
  const { data, error, loading } = useLoad(() => siteApi.pages(id, { site, cls, flag, q, limit: '100', offset: String(offset) }), [id, site, cls, flag, q, offset]);
  useEffect(() => setOffset(0), [cls, flag, q, site]);
  return (
    <div className="stack">
      <div className="card flat">
        <div className="row" style={{ padding: '12px 20px' }}>
          <h2 style={{ margin: 0, flex: 1 }}>Oldalak {data ? `(${data.total})` : ''}</h2>
          <input type="text" placeholder="URL tartalmazza…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
          <Filter label="Besorolás" value={cls} options={CLS} onChange={setCls} />
          <Filter label="Jelző" value={flag} options={FLAGS} onChange={setFlag} />
          <label className="field inline"><span>Webhely</span><select value={site} onChange={(e) => setSite(e.target.value)}><option value="own">saját</option>{(comps.data?.competitors ?? []).map((c) => <option key={c.domain} value={c.domain}>{c.domain}</option>)}</select></label>
        </div>
        <Loading error={error} loading={loading}>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>URL</th><th>HTTP</th><th>Besorolás</th><th>Jelzők</th><th className="num">Mélység</th><th className="num">Bejövő</th><th className="num">Szó</th><th>Title / H1</th></tr></thead>
              <tbody>
                {(data?.rows ?? []).map((r) => (
                  <tr key={r.id} onClick={() => site === 'own' && setSel(r.id)} style={{ cursor: site === 'own' ? 'pointer' : undefined }}>
                    <td><span className="url">{r.url.replace(/^https?:\/\/(www\.)?/, '')}</span></td>
                    <td>{r.status ?? '—'}</td>
                    <td>{CLS.find((c) => c.v === r.pageClass)?.l ?? r.pageClass}</td>
                    <td className="small">{r.flags.map((f) => FLAGS.find((x) => x.v === f)?.l ?? f).join(', ')}</td>
                    <td className="num">{r.depth < 0 ? '—' : r.depth}</td>
                    <td className="num">{r.inlinks}</td>
                    <td className="num">{r.wordCount}</td>
                    <td className="small">{r.title}<div className="muted">{r.h1}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.total > 100 && (
            <div className="row" style={{ padding: 12 }}>
              <button className="btn sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>← Előző</button>
              <span className="small muted">{offset + 1}–{Math.min(data.total, offset + 100)} / {data.total}</span>
              <button className="btn sm" disabled={offset + 100 >= data.total} onClick={() => setOffset(offset + 100)}>Következő →</button>
            </div>
          )}
        </Loading>
      </div>
      {sel !== undefined && <PageDrawer id={id} pageId={sel} onClose={() => setSel(undefined)} />}
    </div>
  );
}

function PageDrawer({ id, pageId, onClose }: { id: string; pageId: number; onClose: () => void }) {
  const { data, error, loading } = useLoad<PageDetail>(() => siteApi.page(id, pageId), [id, pageId]);
  const http = data?.snapshots.http as Record<string, unknown> | undefined;
  const raw = data?.snapshots.raw as Record<string, unknown> | undefined;
  const ren = data?.snapshots.rendered as Record<string, unknown> | undefined;
  return (
    <Drawer onClose={onClose}>
      <Loading error={error} loading={loading}>
        {data && (
          <div className="stack">
            <div className="row between"><p className="label">URL-részletek</p><button className="btn sm ghost" onClick={onClose}>Bezárás ✕</button></div>
            <h2 style={{ wordBreak: 'break-all' }}><UrlLink url={data.row.url} max={200} /></h2>
            <dl className="kv">
              <dt>HTTP</dt><dd>{data.row.status ?? '—'} {data.row.error && `· ${data.row.error}`}</dd>
              <dt>Besorolás</dt><dd>{data.row.pageClass}{data.row.flags.length ? ` · ${data.row.flags.join(', ')}` : ''}</dd>
              <dt>Kattintási mélység</dt><dd>{data.row.depth < 0 ? 'linkekből nem elérhető' : data.row.depth}</dd>
              <dt>Belső linkek</dt><dd>{data.row.inlinks} bejövő · {data.row.outlinks} kimenő</dd>
              <dt>Canonical</dt><dd>{data.row.canonical ?? '—'}</dd>
              <dt>Sitemap</dt><dd>{data.row.inSitemap ? 'igen' : 'nem'}{data.row.lastModified ? ` · ${data.row.lastModified}` : ''}</dd>
              <dt>Felfedezés</dt><dd>{data.row.discoveredVia}</dd>
              {http && <><dt>Válasz</dt><dd>TTFB {String(http.ttfbMs ?? '—')} ms · {String(http.bytes ?? '—')} bájt{(http.redirects as unknown[] | undefined)?.length ? ` · ${(http.redirects as { status: number; location: string }[]).map((r) => `${r.status}→${r.location}`).join(' → ')}` : ''}</dd></>}
              {data.row.duplicateOf && <><dt>Duplikátuma</dt><dd><UrlLink url={data.row.duplicateOf} /></dd></>}
            </dl>
            {data.issues.length > 0 && (
              <div>
                <h3>Problémák ezen az URL-en</h3>
                <ul className="tight small">{data.issues.map((i) => <li key={i.id}><Prio p={i.priority} /> <b>{i.title}</b>{i.evidence[0] && <div className="muted">{i.evidence[0].detail}</div>}</li>)}</ul>
              </div>
            )}
            {data.content && (
              <div>
                <h3>Tartalmi értékelés</h3>
                <div className="small">Citation Potential (becslés): <b>{data.content.citationPotential}</b> · közvetlen válasz: {data.content.signals.answerFirst ? 'igen' : 'nem'}</div>
                <div className="small">Erősségek: {data.content.strengths.join('; ') || '—'}</div>
                <div className="small">Hiányzik: {data.content.missing.join('; ') || '—'}</div>
              </div>
            )}
            {data.queries.length > 0 && <div><h3>Erre az oldalra mutató kérdések</h3><ul className="tight small">{data.queries.map((q) => <li key={q.id}>{q.text} – {q.coverage}</li>)}</ul></div>}
            {data.recommendations.length > 0 && (
              <div>
                <h3>Javaslatok</h3>
                {data.recommendations.map((r) => <div key={r.id} className="small" style={{ marginBottom: 8 }}><b>{r.id} · {r.title}</b><Pre text={r.proposed} lang={r.lang} /></div>)}
              </div>
            )}
            {raw && (
              <details open>
                <summary>Metaadatok és címsorok (nyers HTML)</summary>
                <dl className="kv small">
                  <dt>Title</dt><dd>{String(raw.title ?? '—')}</dd>
                  <dt>Meta description</dt><dd>{String(raw.metaDescription ?? '—')}</dd>
                  <dt>Meta robots</dt><dd>{(raw.metaRobots as string[]).join('; ') || '—'}</dd>
                  <dt>X-Robots-Tag</dt><dd>{(raw.xRobotsTag as string[]).join(', ') || '—'}</dd>
                  <dt>lang</dt><dd>{String(raw.lang ?? '—')}</dd>
                  <dt>hreflang</dt><dd>{(raw.hreflang as { lang: string; href: string }[]).map((h) => `${h.lang}: ${h.href}`).join(' · ') || '—'}</dd>
                  <dt>Szerző</dt><dd>{(raw.author as { name: string; source: string }[]).map((a) => `${a.name} (${a.source})`).join(', ') || '—'}</dd>
                  <dt>Dátumok</dt><dd>{[raw.datePublished && `publikálva: ${raw.datePublished}`, raw.dateModified && `módosítva: ${raw.dateModified}`].filter(Boolean).join(' · ') || '—'}</dd>
                  <dt>Breadcrumb</dt><dd>{(raw.breadcrumb as string[]).join(' › ') || '—'}</dd>
                  <dt>Landmarkok</dt><dd>{Object.entries(raw.landmarks as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}×${v}`).join(', ')}</dd>
                  <dt>Képek alt nélkül</dt><dd>{(raw.images as { alt: string | null }[]).filter((i) => i.alt === null).length} / {(raw.images as unknown[]).length}</dd>
                  <dt>Rejtett blokkok</dt><dd>{(raw.hiddenBlocks as { kind: string; count: number }[]).map((h) => `${h.kind} ×${h.count}`).join(', ') || '—'}</dd>
                </dl>
                <ul className="tight small">{(raw.headings as { level: number; text: string }[]).slice(0, 40).map((h, i) => <li key={i} style={{ marginLeft: (h.level - 1) * 12 }}>H{h.level}: {h.text}</li>)}</ul>
              </details>
            )}
            {ren && (
              <details>
                <summary>Renderelt DOM összehasonlítás</summary>
                <div className="small">Szószám: nyers {String(raw?.wordCount ?? '—')} → renderelt {String(ren.wordCount ?? '—')} · title: {String(ren.title ?? '—')} · JSON-LD blokk: {String(ren.jsonld ?? 0)} · betöltés {String(ren.loadMs ?? '—')} ms{ren.blockedRequests ? ` · ${ren.blockedRequests} kérés blokkolva (SSRF-szűrő)` : ''}</div>
                {typeof ren.visibleText === 'string' && <Pre text={ren.visibleText.slice(0, 3000)} />}
              </details>
            )}
            {data.structured.length > 0 && (
              <details>
                <summary>Strukturált adat ({data.structured.length})</summary>
                {data.structured.map((s, i) => <div key={i} className="small"><b>{s.format}: {s.types.join(', ')}</b>{s.errors.length > 0 && <div style={{ color: '#9d2222' }}>{s.errors.join(' ')}</div>}<Pre text={s.raw} /></div>)}
              </details>
            )}
            {raw && (
              <details>
                <summary>Fő szöveg (kinyert)</summary>
                <Pre text={String(raw.mainText ?? '').slice(0, 8000)} />
              </details>
            )}
            <details>
              <summary>Belső linkek ({data.links.inbound.length} bejövő, {data.links.outbound.length} kimenő)</summary>
              <div className="grid cols-2 small">
                <div><b>Bejövő</b>{data.links.inbound.slice(0, 50).map((l, i) => <div key={i}><UrlLink url={l.url} max={40} /> <span className="muted">„{l.anchor}” ({l.zone})</span></div>)}</div>
                <div><b>Kimenő</b>{data.links.outbound.slice(0, 50).map((l, i) => <div key={i}><UrlLink url={l.url} max={40} /> <span className="muted">„{l.anchor}” ({l.zone})</span></div>)}</div>
              </div>
            </details>
            {http && <details><summary>HTTP fejlécek</summary><Pre text={JSON.stringify(http.headers, null, 2)} /></details>}
          </div>
        )}
      </Loading>
    </Drawer>
  );
}

export function ExportTab({ id }: { id: string }) {
  const items: [string, string, string][] = [
    ['html', 'Nyomtatható riport', 'Teljes riport HTML-ben – a böngészőben „Nyomtatás → Mentés PDF-ként”.'],
    ['json', 'Teljes JSON export', 'Minden adat, bizonyíték, oldal, kérdés, AI-válasz, javaslat és backlog – gépi feldolgozásra.'],
    ['issues', 'Problémák (CSV)', 'Prioritás, kategória, érintett URL-ek, bizonyítékok.'],
    ['recommendations', 'Javaslatok (CSV)', 'Eredeti és javasolt állapot, indoklás, validáció.'],
    ['backlog', 'Fejlesztői backlog (CSV)', 'ID, leírás, acceptance criteria, függőségek – Asana/Jira importhoz.'],
    ['pages', 'Oldalak (CSV)', 'Minden bejárt URL besorolással és metrikákkal.'],
    ['queries', 'Kérdések (CSV)', 'Query Coverage Matrix versenytársakkal.'],
    ['gaps', 'Competitor query gapek (CSV)', 'Gapek alap szerint (megfigyelt / SERP / következtetett).'],
  ];
  return (
    <div className="card">
      <h2>Export és riport</h2>
      <table className="t">
        <tbody>
          {items.map(([k, l, d]) => (
            <tr key={k}><td><b>{l}</b><div className="small muted">{d}</div></td><td style={{ width: 160 }}><a className="btn sm" href={siteApi.exportUrl(id, k)} target={k === 'html' ? '_blank' : undefined} rel="noreferrer">{k === 'html' ? 'Megnyitás' : 'Letöltés'}</a></td></tr>
          ))}
        </tbody>
      </table>
      <Note>Minden lényeges megállapításnál szerepel az érintett URL és a bizonyíték. A riport az audit futásakor érvényes állapotot rögzíti (audit ID, dátum, konfiguráció, adatforrások, módszerverzió).</Note>
    </div>
  );
}
