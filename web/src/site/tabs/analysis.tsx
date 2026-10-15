import { Fragment, useMemo, useState } from 'react';
import { siteApi } from '../api';
import { Conf, Empty, Filter, Kind, Loading, Note, Pre, ScoreBar, UrlLink, useLoad } from '../ui';
import type { EntityEdge, EntityNode } from '../../../../shared/site';

export function TechnicalTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.technical(id), [id]);
  const t = data?.technical;
  const bots = data?.aiBots;
  const links = data?.links;
  return (
    <Loading error={error} loading={loading}>
      {!t ? (
        <Empty>A technikai elemzés még nem készült el.</Empty>
      ) : (
        <div className="stack">
          <div className="grid cols-2">
            <div className="card">
              <h2>Oldalbesorolás</h2>
              <table className="t">
                <tbody>
                  {[
                    ['indexable', 'Indexelhető'], ['noindex', 'Noindex'], ['canonicalized', 'Máshová kanonizált'], ['redirect', 'Átirányítás'], ['error', 'Hibás (4xx/5xx/hálózat)'], ['blocked', 'robots.txt tiltja'], ['non_html', 'Nem HTML (PDF stb.)'],
                    ['thin', 'Thin content'], ['duplicate', 'Duplikált'], ['near_duplicate', 'Közel duplikált'], ['orphan', 'Orphan (csak sitemap)'], ['deep', 'Mély (4+ kattintás)'], ['hard_to_discover', 'Linkekből nem elérhető'], ['js_dependent', 'JS-függő tartalom'], ['low_inlinks', 'Kevés belső link (≤1)'],
                  ].map(([k, l]) => (
                    <tr key={k}>
                      <td><a href={`#/site/${id}?tab=pages&${['indexable', 'noindex', 'canonicalized', 'redirect', 'error', 'blocked', 'non_html'].includes(k) ? 'cls' : 'flag'}=${k}`}>{l}</a></td>
                      <td className="num">{t.classCounts[k] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {t.limitReached && <div className="notice small">A crawl elérte az oldalszámkorlátot ({t.skipped} URL kimaradt) – a besorolás és a linkgráf részleges.</div>}
            </div>
            <div className="card stack">
              <h2>robots.txt és sitemap</h2>
              <dl className="kv">
                <dt>robots.txt</dt>
                <dd>{t.robots.present ? `megvan (HTTP ${t.robots.status})` : `nincs/nem olvasható (HTTP ${t.robots.status ?? '—'})`}{t.robots.crawlDelay ? ` · Crawl-delay: ${t.robots.crawlDelay}s` : ''}</dd>
                <dt>Sitemap a robots.txt-ben</dt>
                <dd>{t.robots.sitemaps.length ? t.robots.sitemaps.map((s) => <div key={s}><UrlLink url={s} /></div>) : <span className="muted">nincs</span>}</dd>
                <dt>Renderelés</dt>
                <dd>{t.renderer ?? t.renderUnavailable ?? 'nem futott'}</dd>
              </dl>
              <table className="t">
                <thead><tr><th>Sitemap-fájl</th><th>Típus</th><th className="num">URL</th></tr></thead>
                <tbody>
                  {t.sitemapFiles.map((f) => (
                    <tr key={f.url}><td><UrlLink url={f.url} /></td><td>{f.type}{f.error ? ` – ${f.error}` : ''}</td><td className="num">{f.urls}</td></tr>
                  ))}
                </tbody>
              </table>
              {t.robots.text && <details><summary>robots.txt tartalma</summary><Pre text={t.robots.text} /></details>}
            </div>
          </div>

          {bots && (
            <div className="card">
              <h2>AI-crawler és robots audit</h2>
              <p className="small muted">{bots.note}</p>
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Robot</th><th>Cél</th><th>Kezdőoldal</th><th>Tiltott fontos oldalak</th><th>Következmény (a szolgáltató dokumentációja alapján)</th></tr></thead>
                  <tbody>
                    {bots.rows.map((r) => (
                      <tr key={r.token}>
                        <td><b>{r.name}</b><div className="small muted">{r.owner}{r.docs && <> · <a href={r.docs} target="_blank" rel="noreferrer">dokumentáció</a></>}</div></td>
                        <td>{({ crawler: 'kereső', search: 'keresés / AI-válasz', training: 'modelltanítás', user: 'felhasználói lekérés', ads: 'hirdetés' } as Record<string, string>)[r.purpose] ?? r.purpose}</td>
                        <td>
                          {r.allowedHome === null ? <span className="muted">—</span> : r.allowedHome ? <span className="status pass"><span className="ic">✓</span>engedélyezett</span> : <span className="status fail"><span className="ic">✕</span>tiltott</span>}
                          {r.rule && <div className="small muted">{r.rule}{r.specificGroup ? ' (saját csoport)' : ' (* csoport)'}</div>}
                        </td>
                        <td className="num">{r.blockedSample.length}</td>
                        <td className="small">{r.consequence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {bots.uaTests.length > 0 && (
                <>
                  <h3>User-agent teszt a kezdőoldalon (WAF/CDN felismerés)</h3>
                  <table className="t">
                    <thead><tr><th>Robot UA</th><th>HTTP</th><th>Bájt</th><th>Challenge / hiba</th><th>Mint a böngésző?</th></tr></thead>
                    <tbody>
                      {bots.uaTests.map((u) => (
                        <tr key={u.bot}><td>{u.bot}</td><td>{u.status ?? '—'}</td><td className="num">{u.bytes ?? '—'}</td><td>{u.challenge ?? u.error ?? '—'}</td><td>{u.sameAsBrowser === null ? '—' : u.sameAsBrowser ? 'igen' : <b>nem</b>}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          <div className="card">
            <h2>Renderelés: nyers HTML vs. renderelt DOM</h2>
            <p className="small muted">A JavaScript-alapú tartalom nem automatikusan hiba: azt vizsgáljuk, mi érhető el renderelés nélkül (a legtöbb AI-crawler így olvas), és mi csak renderelve.</p>
            {t.renderComparisons.length ? (
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>URL</th><th className="num">Szó (nyers)</th><th className="num">Szó (renderelt)</th><th>Eltérés</th><th>Rejtett blokkok a nyers HTML-ben</th></tr></thead>
                  <tbody>
                    {t.renderComparisons.map((r) => (
                      <tr key={r.url}>
                        <td><UrlLink url={r.url} /></td>
                        <td className="num">{r.rawWords}</td>
                        <td className="num">{r.renderedWords}</td>
                        <td className="small">{[r.renderedWords > r.rawWords * 1.5 && r.renderedWords - r.rawWords > 100 && 'tartalom csak renderelve', r.titleDiffers && 'title eltér', r.canonicalDiffers && 'canonical eltér', r.jsonldRendered !== r.jsonldRaw && `JSON-LD ${r.jsonldRaw}→${r.jsonldRendered}`].filter(Boolean).join(', ') || '—'}</td>
                        <td className="small">{r.hiddenBlocks.map((h) => `${h.kind} ×${h.count}`).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Renderelés nem futott ({t.renderUnavailable ?? 'kikapcsolva'}).</Empty>
            )}
          </div>

          {links && (
            <div className="card">
              <h2>Belső linkelés és tudásszerkezet</h2>
              <div className="grid cols-2">
                <div>
                  <h3>Hub oldalak (legtöbb belső link)</h3>
                  <table className="t"><tbody>{links.hubs.slice(0, 10).map((h) => <tr key={h.url}><td><UrlLink url={h.url} /></td><td className="num">{h.inlinks}</td></tr>)}</tbody></table>
                  <h3>Témaklaszterek (URL-struktúra szerint)</h3>
                  <ul className="tight small">{links.clusters.map((c) => <li key={c.label}><b>/{c.label}</b> – {c.urls.length} oldal</li>)}</ul>
                </div>
                <div>
                  <h3>Problémák</h3>
                  <ul className="tight small">
                    <li>Orphan oldalak: {links.orphans.length}</li>
                    <li>Kevés belső linkkel: {links.lowInlinks.length}</li>
                    <li>Mély oldalak (4+): {links.deep.length}</li>
                    <li>Hibás belső linkek: {links.broken.length}</li>
                    <li>Semmitmondó anchor: {links.genericAnchors.length}</li>
                  </ul>
                  {links.broken.length > 0 && (<><h3>Hibás belső linkek</h3><table className="t"><tbody>{links.broken.slice(0, 15).map((b, i) => <tr key={i}><td><UrlLink url={b.from} max={40} /></td><td>→ <UrlLink url={b.to} max={40} /></td><td>{b.status ?? 'hiba'}</td></tr>)}</tbody></table></>)}
                </div>
              </div>
              <h3>Javasolt belső linkek</h3>
              {links.suggestions.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th>Forrásoldal</th><th>Céloldal</th><th>Javasolt anchor</th><th>Indoklás</th></tr></thead>
                    <tbody>{links.suggestions.slice(0, 30).map((s, i) => <tr key={i}><td><UrlLink url={s.from} max={45} /></td><td><UrlLink url={s.to} max={45} /></td><td>„{s.anchor}”</td><td className="small">{s.reason}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <p className="small muted">Nincs javaslat (a gyengén linkelt oldalakhoz nem található elég hasonló forrásoldal).</p>}
            </div>
          )}
        </div>
      )}
    </Loading>
  );
}

const KIND_HU: Record<string, string> = { home: 'kezdőoldal', service: 'szolgáltatás', product: 'termék', article: 'cikk', category: 'kategória', about: 'rólunk', contact: 'kapcsolat', legal: 'jogi', other: 'egyéb' };

export function ContentTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.content(id), [id]);
  const [kind, setKind] = useState<string>('');
  const [open, setOpen] = useState<string>();
  const pages = (data?.content?.pages ?? []).filter((p) => !kind || p.kind === kind);
  return (
    <Loading error={error} loading={loading}>
      {!data?.content ? (
        <Empty>A tartalmi elemzés még nem készült el.</Empty>
      ) : (
        <div className="stack">
          <div className="card">
            <h2>Tartalmi GEO – átlagok</h2>
            <div className="grid cols-4">
              {Object.entries(data.content.averages).map(([k, v]) => (
                <div key={k}>
                  <p className="label">{({ clarity: 'Érthetőség', answerability: 'Megválaszolhatóság', evidence: 'Bizonyíték', structure: 'Struktúra', authorship: 'Szerzőség', freshness: 'Frissesség', originality: 'Eredetiség', citationPotential: 'Citation Potential (becslés)' } as Record<string, string>)[k] ?? k}</p>
                  <ScoreBar value={v} label={k} />
                </div>
              ))}
            </div>
            <Note>{data.content.note}</Note>
          </div>
          <div className="card flat">
            <div className="row" style={{ padding: '12px 20px' }}>
              <h2 style={{ margin: 0, flex: 1 }}>Oldalankénti értékelés</h2>
              <Filter label="Oldaltípus" value={kind} options={Object.entries(KIND_HU).map(([v, l]) => ({ v, l }))} onChange={setKind} />
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Oldal</th><th>Típus</th><th className="num">Szó</th><th>Közvetlen válasz</th><th className="num">Érthetőség</th><th className="num">Bizonyíték</th><th className="num">Citation P.</th><th>Hiányzik</th></tr></thead>
                <tbody>
                  {pages.map((p) => (
                    <Fragment key={p.url}>
                      <tr onClick={() => setOpen(open === p.url ? undefined : p.url)} style={{ cursor: 'pointer' }}>
                        <td><b>{p.topic || '(nincs H1)'}</b><div><UrlLink url={p.url} max={60} /></div></td>
                        <td>{KIND_HU[p.kind] ?? p.kind}</td>
                        <td className="num">{p.words}</td>
                        <td>{p.signals.answerFirst ? '✓ igen' : '✕ nem'}</td>
                        <td className="num">{p.scores.clarity}</td>
                        <td className="num">{p.scores.evidence}</td>
                        <td className="num">{p.citationPotential}</td>
                        <td className="small">{p.missing.slice(0, 2).join('; ')}</td>
                      </tr>
                      {open === p.url && (
                        <tr>
                          <td colSpan={8}>
                            <div className="grid cols-2 small">
                              <div>
                                <b>Erősségek</b>
                                <ul className="tight">{p.strengths.map((s) => <li key={s}>{s}</li>) }</ul>
                                <b>Hiányzik</b>
                                <ul className="tight">{p.missing.map((s) => <li key={s}>{s}</li>)}</ul>
                                {p.signals.firstParagraph && <><b>Első bekezdés</b><p className="muted">„{p.signals.firstParagraph}”</p></>}
                              </div>
                              <div>
                                <b>Pontok</b>
                                {Object.entries(p.scores).map(([k, v]) => <div key={k} className="row"><span style={{ width: 120 }}>{k}</span><ScoreBar value={v} label={k} /></div>)}
                                {p.llm && (
                                  <div className="ai-box">
                                    <Kind k="ai" /> <b>{p.llm.mainQuestion}</b> – megválaszolva: {p.llm.answered}
                                    <div>{p.llm.summary}</div>
                                    {p.llm.missing.length > 0 && <div>Hiányzó információ: {p.llm.missing.join('; ')}</div>}
                                    {p.llm.claimsWithoutEvidence.length > 0 && <div>Bizonyíték nélküli állítások (szó szerint): {p.llm.claimsWithoutEvidence.map((c) => `„${c}”`).join(' ')}</div>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {data.trust && (
            <div className="card">
              <h2>E-E-A-T és bizalmi jelek</h2>
              <p className="small muted">{data.trust.note}</p>
              <table className="t">
                <thead><tr><th>Csoport</th><th>Jel</th><th>Állapot</th><th>Bizonyíték</th></tr></thead>
                <tbody>
                  {data.trust.signals.map((s) => (
                    <tr key={s.id}>
                      <td className="small muted">{s.group}</td>
                      <td>{s.label}</td>
                      <td>{s.present === null ? <span className="status na"><span className="ic">–</span>nem értékelhető</span> : s.present ? <span className="status pass"><span className="ic">✓</span>van</span> : <span className="status fail"><span className="ic">✕</span>hiányzik</span>}</td>
                      <td className="small">
                        {s.evidence.slice(0, 3).map((e, i) => <div key={i}>{e.url && <UrlLink url={e.url} max={45} />} {e.detail}{e.snippet && <span className="muted"> – „{e.snippet}”</span>}</div>)}
                        {s.note && <div className="muted">{s.note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Loading>
  );
}

// Kategorikus paletta (validált alapsorrend, fix hozzárendelés entitástípusonként – nem ciklikus)
const TYPE_COLOR: [string, string][] = [
  ['Organization', '#2a78d6'], ['Person', '#eb6834'], ['Service', '#1baf7a'], ['Product', '#eda100'], ['Location', '#e87ba4'], ['Brand', '#008300'], ['Partner', '#4a3aa7'], ['Topic', '#e34948'],
];
const colorOf = (t: string) => TYPE_COLOR.find(([k]) => k === t)?.[1] ?? '#a0a0a0';

function layout(nodes: EntityNode[], edges: EntityEdge[], w: number, h: number) {
  // determinisztikus erő-alapú elrendezés (kezdőpont: kör), 300 iteráció
  const pos = nodes.map((_, i) => ({ x: w / 2 + Math.cos((i / nodes.length) * Math.PI * 2) * w * 0.35, y: h / 2 + Math.sin((i / nodes.length) * Math.PI * 2) * h * 0.35, vx: 0, vy: 0 }));
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const E = edges.map((e) => [idx.get(e.from), idx.get(e.to)]).filter((x): x is [number, number] => x[0] !== undefined && x[1] !== undefined);
  for (let it = 0; it < 300; it++) {
    for (let a = 0; a < pos.length; a++) for (let b = a + 1; b < pos.length; b++) {
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const d2 = Math.max(100, dx * dx + dy * dy);
      const f = 700 / d2;
      pos[a].vx += dx * f * 0.05; pos[a].vy += dy * f * 0.05; pos[b].vx -= dx * f * 0.05; pos[b].vy -= dy * f * 0.05;
    }
    for (const [a, b] of E) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      pos[a].vx += dx * 0.008; pos[a].vy += dy * 0.008; pos[b].vx -= dx * 0.008; pos[b].vy -= dy * 0.008;
    }
    for (const p of pos) {
      p.vx += (w / 2 - p.x) * 0.008; p.vy += (h / 2 - p.y) * 0.008;
      p.x = Math.max(30, Math.min(w - 30, p.x + p.vx)); p.y = Math.max(20, Math.min(h - 20, p.y + p.vy));
      p.vx *= 0.6; p.vy *= 0.6;
    }
  }
  return pos;
}

export function EntitiesTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.entities(id), [id]);
  const [sel, setSel] = useState<string>();
  const [hover, setHover] = useState<string>();
  const nodes = useMemo(() => (data?.nodes ?? []).slice(0, 60), [data]);
  const edges = useMemo(() => (data?.edges ?? []).filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)), [data, nodes]);
  const W = 900;
  const H = 520;
  const pos = useMemo(() => layout(nodes, edges, W, H), [nodes, edges]);
  const selNode = nodes.find((n) => n.id === sel);
  const types = [...new Set(nodes.map((n) => n.type))];
  return (
    <Loading error={error} loading={loading}>
      {!data ? (
        <Empty>Az entitáselemzés még nem készült el.</Empty>
      ) : (
        <div className="stack">
          <div className="card">
            <h2>Entity graph (auditon belüli)</h2>
            <p className="small muted">{data.note}</p>
            <div className="legend" style={{ margin: '8px 0' }}>
              {types.map((t) => <span key={t}><i style={{ background: colorOf(t) }} />{t} ({nodes.filter((n) => n.type === t).length})</span>)}
              <span>· vastag keret = strukturált adatban is jelölve</span>
            </div>
            <div className="graph-wrap">
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Entitásgráf" style={{ width: '100%', height: 'auto', background: 'var(--white)' }}>
                {edges.map((e, i) => {
                  const a = pos[nodes.findIndex((n) => n.id === e.from)];
                  const b = pos[nodes.findIndex((n) => n.id === e.to)];
                  const hi = sel && (e.from === sel || e.to === sel);
                  return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={hi ? '#1a1a1a' : '#c3c2b7'} strokeWidth={hi ? 2 : 1} />;
                })}
                {nodes.map((n, i) => (
                  <g key={n.id} transform={`translate(${pos[i].x},${pos[i].y})`} onClick={() => setSel(n.id === sel ? undefined : n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(undefined)} style={{ cursor: 'pointer' }}>
                    <circle r={18} fill="transparent" />
                    <circle r={n.type === 'Organization' ? 11 : 8} fill={colorOf(n.type)} stroke={n.inSchema ? '#1a1a1a' : '#fcfcfb'} strokeWidth={n.inSchema ? 2.5 : 2} />
                    {(n.type === 'Organization' || hover === n.id || sel === n.id || nodes.length <= 40) && (
                      <text x={12} y={4} fontSize={10} fill="#1a1a1a" paintOrder="stroke" stroke="#fcfcfb" strokeWidth={3}>{n.name.length > 32 ? n.name.slice(0, 31) + '…' : n.name}</text>
                    )}
                    <title>{`${n.type}: ${n.name}`}</title>
                  </g>
                ))}
              </svg>
            </div>
            {selNode && (
              <div className="card" style={{ marginTop: 12 }}>
                <b>{selNode.name}</b> <span className="tag outline">{selNode.type}</span> <Kind k={selNode.evidenceKind} /> <Conf v={selNode.confidence} />
                {selNode.description && <p className="small">{selNode.description}</p>}
                {selNode.sameAs.length > 0 && <div className="small">sameAs: {selNode.sameAs.map((s) => <div key={s}><UrlLink url={s} /></div>)}</div>}
                <div className="small">Forrás URL-ek: {selNode.urls.map((u) => <div key={u}><UrlLink url={u} /></div>)}</div>
                <div className="small">Kapcsolatok: {edges.filter((e) => e.from === selNode.id || e.to === selNode.id).map((e, i) => <div key={i}>{nodes.find((n) => n.id === e.from)?.name} → <i>{e.type}</i> → {nodes.find((n) => n.id === e.to)?.name}</div>)}</div>
              </div>
            )}
          </div>
          <div className="card flat table-wrap">
            <table className="t">
              <thead><tr><th>Entitás</th><th>Típus</th><th>Jelölve</th><th>Bizonyosság</th><th>Forrás</th><th>Változatok</th></tr></thead>
              <tbody>
                {data.nodes.map((n) => (
                  <tr key={n.id} onClick={() => setSel(n.id)} style={{ cursor: 'pointer' }}>
                    <td><b>{n.name}</b></td>
                    <td><span className="legend"><span><i style={{ background: colorOf(n.type) }} />{n.type}</span></span></td>
                    <td>{n.inSchema ? 'igen' : 'nem'}</td>
                    <td>{Math.round(n.confidence * 100)}%</td>
                    <td><Kind k={n.evidenceKind} /> <span className="small muted">{n.urls.length} URL</span></td>
                    <td className="small">{n.variants.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.nameVariants.length > 1 && (
            <div className="card">
              <h3>Névhasználat következetessége</h3>
              <ul className="tight small">{data.nameVariants.map((v) => <li key={v.name}><b>{v.name}</b> – {v.sources.join(', ')}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Loading>
  );
}

export function StructuredTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.structured(id), [id]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [type, setType] = useState('');
  const recs = (data?.records ?? []).filter((r) => (!onlyProblems || !r.syntaxValid || r.errors.length || r.visibilityMismatches.length || r.richResults.some((x) => x.missingRequired.length)) && (!type || r.types.includes(type)));
  const s = data?.summary;
  return (
    <Loading error={error} loading={loading}>
      {!s ? (
        <Empty>A strukturált adat elemzés még nem készült el.</Empty>
      ) : (
        <div className="stack">
          <div className="card">
            <h2>Strukturált adat (JSON-LD, Microdata, RDFa)</h2>
            <p>{s.pagesWithSd}/{s.pagesTotal} vizsgált oldalon van strukturált adat.</p>
            <div className="chip-select" style={{ margin: '8px 0' }}>
              {Object.entries(s.typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t, n]) => (
                <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(type === t ? '' : t)}>{t} · {n}</button>
              ))}
            </div>
            <Note>{s.note}</Note>
            {s.orgNodes.length > 0 && (
              <details>
                <summary>Szervezeti csomópontok ({s.orgNodes.length})</summary>
                <table className="t"><tbody>{s.orgNodes.map((o, i) => <tr key={i}><td><UrlLink url={o.url} max={40} /></td><td>{o.name}</td><td>{o.telephone}</td><td>{o.address}</td></tr>)}</tbody></table>
              </details>
            )}
          </div>
          <label className="check"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Csak a hibás/hiányos blokkok</label>
          {recs.slice(0, 150).map((r, i) => (
            <div key={i} className="card stack" style={{ gap: 6 }}>
              <div className="row between">
                <div><UrlLink url={r.url} /> <span className="tag outline">{r.format}</span> {r.types.slice(0, 6).map((t) => <span key={t} className="tag">{t}</span>)}</div>
                <span className={`status ${!r.syntaxValid || r.errors.length ? 'fail' : r.warnings.length ? 'warn' : 'pass'}`}><span className="ic">{!r.syntaxValid || r.errors.length ? '✕' : r.warnings.length ? '!' : '✓'}</span>{!r.syntaxValid ? 'szintaktikai hiba' : r.errors.length ? 'hibás érték' : r.warnings.length ? 'figyelmeztetés' : 'érvényes'}</span>
              </div>
              {r.errors.length > 0 && <ul className="tight small">{r.errors.map((e) => <li key={e}><b>Hiba:</b> {e}</li>)}</ul>}
              {r.visibilityMismatches.length > 0 && <ul className="tight small">{r.visibilityMismatches.map((e) => <li key={e}><b>Nem látható tartalom:</b> {e}</li>)}</ul>}
              {r.richResults.length > 0 && (
                <table className="t small">
                  <thead><tr><th>Google funkció</th><th>Hiányzó kötelező</th><th>Hiányzó ajánlott</th><th>Megjegyzés</th></tr></thead>
                  <tbody>{r.richResults.map((x, k) => <tr key={k}><td>{x.type}{!x.eligibleType && ' (nem rich result típus)'}</td><td>{x.missingRequired.join(', ') || '—'}</td><td>{x.missingRecommended.join(', ') || '—'}</td><td className="muted">{x.note}</td></tr>)}</tbody>
                </table>
              )}
              {r.warnings.length > 0 && <details><summary className="small">{r.warnings.length} figyelmeztetés (schema.org szókincs)</summary><ul className="tight small">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>}
              <details><summary className="small">Jelenlegi markup</summary><Pre text={r.raw} lang={r.format} /></details>
            </div>
          ))}
          {!recs.length && <Empty>Nincs megjeleníthető blokk.</Empty>}
          <p className="small muted">A javított JSON-LD példák az „Ajánlások” fülön, típus szerint szűrve találhatók (validálva).</p>
        </div>
      )}
    </Loading>
  );
}

