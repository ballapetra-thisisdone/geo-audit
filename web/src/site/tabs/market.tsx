import { useState } from 'react';
import { siteApi } from '../api';
import { CoverageBadge, Empty, Filter, Kind, Loading, Note, Prio, UrlLink, useLoad, Conf } from '../ui';
import { COMPETITOR_TYPE_LABEL, QUERY_TYPE_LABEL, type QueryType, type Coverage } from '../../../../shared/site';

export function QueriesTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.queries(id), [id]);
  const [type, setType] = useState<QueryType | ''>('');
  const [cov, setCov] = useState<Coverage | ''>('');
  const [topic, setTopic] = useState('');
  const [q, setQ] = useState('');
  const qs = (data?.queries ?? []).filter((x) => (!type || x.type === type) && (!cov || x.coverage === cov) && (!topic || x.cluster === topic) && (!q || x.text.toLowerCase().includes(q.toLowerCase())));
  const all = data?.queries ?? [];
  const totalW = all.reduce((s, x) => s + x.weight, 0);
  const acs = totalW ? Math.round((all.reduce((s, x) => s + x.weight * (x.coverage === 'full' ? 1 : x.coverage === 'partial' ? 0.5 : 0), 0) / totalW) * 100) : null;
  const comps = [...new Set(all.flatMap((x) => x.competitors.map((c) => c.domain)))];
  return (
    <Loading error={error} loading={loading}>
      {!all.length ? (
        <Empty>A kérdéselemzés még nem készült el.</Empty>
      ) : (
        <div className="stack">
          <div className="grid cols-4">
            <div className="card stat"><p className="label">Answer Coverage Score</p><div className="stat-v">{acs ?? '—'}<small>/100</small></div><div className="small muted">súlyozott: teljes = 1, részleges = 0,5</div></div>
            <div className="card stat"><p className="label">Teljes</p><div className="stat-v">{all.filter((x) => x.coverage === 'full').length}</div></div>
            <div className="card stat"><p className="label">Részleges</p><div className="stat-v">{all.filter((x) => x.coverage === 'partial').length}</div></div>
            <div className="card stat"><p className="label">Hiányzó</p><div className="stat-v">{all.filter((x) => x.coverage === 'missing').length}</div></div>
          </div>
          <div className="notice neutral small">
            A generált kérdések <b>hipotézisek</b> a webhely témái, szolgáltatásai és a felismert kontextus alapján – tényleges keresési adat (volumen) nem támasztja alá őket. A lefedettséget szakasz-szintű szövegegyezés (BM25){all.some((x) => x.judgedBy === 'llm') ? ' és LLM-ellenőrzés (szó szerinti idézet-validálással)' : ''} határozza meg.
          </div>
          <div className="card stack">
            <h2>Topic Coverage Matrix</h2>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Téma</th><th>Saját URL-ek</th><th>Lefedettség</th><th>Hiány</th>{comps.map((c) => <th key={c}>{c}</th>)}<th>Javasolt fejlesztés</th></tr></thead>
                <tbody>
                  {(data?.topics ?? []).map((t) => (
                    <tr key={t.id}>
                      <td><a href="#" onClick={(e) => (e.preventDefault(), setTopic(topic === t.id ? '' : t.id))}><b>{t.label}</b></a><div className="small muted">{t.queryCount} kérdés · {t.depthWords} szó</div></td>
                      <td className="small">{t.ownUrls.slice(0, 3).map((u) => <div key={u}><UrlLink url={u} max={40} /></div>)}{!t.ownUrls.length && <span className="muted">nincs</span>}</td>
                      <td><CoverageBadge c={t.coverage} /></td>
                      <td className="small">{t.missingQueries.slice(0, 3).map((m) => <div key={m}>{m}</div>)}{t.missingQueries.length > 3 && <div className="muted">+{t.missingQueries.length - 3}</div>}</td>
                      {comps.map((c) => {
                        const cc = t.competitorCoverage.find((x) => x.domain === c);
                        return <td key={c}>{cc ? <CoverageBadge c={cc.coverage} /> : '—'}</td>;
                      })}
                      <td className="small">{t.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card flat">
            <div className="row" style={{ padding: '12px 20px' }}>
              <h2 style={{ margin: 0, flex: 1 }}>Query Coverage Matrix {topic && <button className="btn sm ghost" onClick={() => setTopic('')}>téma szűrő törlése ✕</button>}</h2>
              <input type="text" placeholder="Keresés…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} />
              <Filter label="Típus" value={type} options={Object.entries(QUERY_TYPE_LABEL).map(([v, l]) => ({ v: v as QueryType, l }))} onChange={setType} />
              <Filter label="Lefedettség" value={cov} options={[{ v: 'full', l: 'teljes' }, { v: 'partial', l: 'részleges' }, { v: 'missing', l: 'hiányzó' }]} onChange={setCov} />
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Kérdés</th><th>Típus</th><th className="num">Súly</th><th>Saját lefedettség</th><th>Válaszoló URL és részlet</th>{comps.map((c) => <th key={c}>{c}</th>)}<th>Teendő</th></tr></thead>
                <tbody>
                  {qs.map((x) => (
                    <tr key={x.id}>
                      <td><b>{x.text}</b><div className="small muted">{x.topic} · {x.origin === 'user' ? 'megadott kérdés' : 'generált hipotézis'}{x.branded ? ' · márkázott' : ''}</div></td>
                      <td className="small">{QUERY_TYPE_LABEL[x.type]}</td>
                      <td className="num">{x.weight}</td>
                      <td><CoverageBadge c={x.coverage} /><div className="small muted">{x.judgedBy === 'llm' ? 'LLM' : 'lexikai'} · konkrétság: {x.specificity}{x.hasEvidence ? ' · van adat' : ''}</div></td>
                      <td className="small">{x.bestUrl && <UrlLink url={x.bestUrl} max={45} />}{x.snippet && <div className="muted">„{x.snippet}”</div>}{x.contradiction && <div style={{ color: '#9d2222' }}>{x.contradiction}</div>}</td>
                      {comps.map((c) => {
                        const cc = x.competitors.find((y) => y.domain === c);
                        return <td key={c}>{cc ? <CoverageBadge c={cc.coverage} /> : '—'}{cc?.url && <div><UrlLink url={cc.url} max={30} /></div>}</td>;
                      })}
                      <td className="small">{x.action === 'none' ? '—' : x.action === 'improve' ? 'meglévő oldal javítása' : 'új tartalom'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Loading>
  );
}

export function VisibilityTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.visibility(id), [id]);
  const [platform, setPlatform] = useState('');
  const s = data?.summary;
  return (
    <Loading error={error} loading={loading}>
      {!s ? (
        <Empty>Az AI visibility lépés még nem futott.</Empty>
      ) : (
        <div className="stack">
          <div className="card">
            <h2>Platformok</h2>
            <table className="t">
              <thead><tr><th>Platform</th><th>Típus</th><th>Állapot</th><th>Megjegyzés</th></tr></thead>
              <tbody>
                {s.platforms.map((p) => (
                  <tr key={p.id}><td><a href={p.docs} target="_blank" rel="noreferrer">{p.name}</a></td><td>{p.kind === 'ai' ? 'AI-válasz' : 'SERP'}</td><td>{p.status === 'used' ? <span className="status pass"><span className="ic">✓</span>mért</span> : p.status === 'not_configured' ? <span className="status unverifiable"><span className="ic">?</span>API nem konfigurált</span> : p.status === 'failed' ? <span className="status fail"><span className="ic">✕</span>sikertelen</span> : <span className="status na"><span className="ic">–</span>kihagyva</span>}</td><td className="small">{p.note}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {!s.measured ? (
            <div className="notice">
              <b>Nem mérhető.</b> {s.state === 'not_configured' ? 'Nincs konfigurált AI/search API. A technikai és tartalmi audit ettől függetlenül teljes; tényleges AI-megjelenést vagy idézést nem állítunk, és nem szimulálunk AI-válaszokat.' : s.state === 'failed' ? 'A konfigurált platformok egyetlen lekérdezése sem sikerült (lásd a naplót).' : 'Nincs adat.'}
              <div className="small" style={{ marginTop: 6 }}>Bekapcsolás: OPENAI_API_KEY, PERPLEXITY_API_KEY, BRAVE_SEARCH_API_KEY vagy ANTHROPIC_API_KEY + CLAUDE_SEARCH_ENABLED=1 a .env-ben, majd az audit újrafuttatása.</div>
            </div>
          ) : (
            <>
              <div className="card">
                <h2>Mentions, citations, share of voice</h2>
                <p className="small muted">{s.responseCount} sikeres válasz, {s.queryCount} kérdés. <Kind k="external" /> – ténylegesen megfigyelt eredmény, egyetlen időpontban.</p>
                <table className="t">
                  <thead><tr><th>Domain</th><th className="num">Mention</th><th className="num">Citation</th><th className="num">Kérdés (mention)</th><th className="num">Kérdés (citation)</th><th className="num">Mention share</th><th className="num">Citation share</th></tr></thead>
                  <tbody>
                    {s.metrics.map((m) => (
                      <tr key={m.domain}><td><b>{m.domain}</b>{m.isOwn && <span className="tag orange" style={{ marginLeft: 6 }}>saját</span>}</td><td className="num">{m.mentions}</td><td className="num">{m.citations}</td><td className="num">{m.queriesWithMention}</td><td className="num">{m.queriesWithCitation}</td><td className="num">{m.mentionShare ?? '—'}%</td><td className="num">{m.citationShare ?? '—'}%</td></tr>
                    ))}
                  </tbody>
                </table>
                <Note>{s.methodology}</Note>
              </div>
              {s.suggestedCompetitors && s.suggestedCompetitors.length > 0 && (
                <div className="card">
                  <h2>Javasolt további versenytársak (megerősítendő)</h2>
                  <p className="small muted">A válaszokban legalább 2 kérdésnél idézett domainek. Nem mindegyik közvetlen üzleti versenytárs – a besorolás döntést igényel.</p>
                  <table className="t"><tbody>{s.suggestedCompetitors.map((c) => <tr key={c.domain}><td><b>{c.domain}</b></td><td>{c.kind === 'serp' ? 'SERP competitor' : 'AI Search competitor'}</td><td className="num">{c.queries} kérdés</td><td className="small">{c.urls.slice(0, 2).map((u) => <div key={u}><UrlLink url={u} max={50} /></div>)}</td></tr>)}</tbody></table>
                </div>
              )}
              <div className="card">
                <h2>Forrás-domainek (Source URL → Domain → Topic)</h2>
                <table className="t"><thead><tr><th>Domain</th><th className="num">Idézett URL-ek</th><th>Szerep</th><th>Témák</th></tr></thead><tbody>{data.sources.slice(0, 25).map((x) => <tr key={x.domain}><td>{x.domain}</td><td className="num">{x.n}</td><td>{x.own ? 'saját' : x.competitor ? 'versenytárs' : 'egyéb'}</td><td className="small">{x.topics}</td></tr>)}</tbody></table>
              </div>
            </>
          )}
          {data.responses.length > 0 && (
            <div className="card flat">
              <div className="row" style={{ padding: '12px 20px' }}>
                <h2 style={{ margin: 0, flex: 1 }}>Query → AI Response → Citation</h2>
                <Filter label="Platform" value={platform} options={s.platforms.filter((p) => p.status === 'used' || p.status === 'failed').map((p) => ({ v: p.id, l: p.name }))} onChange={setPlatform} />
              </div>
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Kérdés</th><th>Platform · idő</th><th>Válaszrészlet</th><th>Említett</th><th>Idézett URL-ek</th></tr></thead>
                  <tbody>
                    {data.responses.filter((r) => !platform || r.platform === platform).map((r) => (
                      <tr key={r.id}>
                        <td>{r.query}</td>
                        <td className="small">{r.platform}<div className="muted">{r.at.slice(0, 16).replace('T', ' ')}</div><div className="muted">{r.method}</div></td>
                        <td className="small">{r.error ? <span style={{ color: '#9d2222' }}>Hiba: {r.error}</span> : <details><summary>{r.excerpt.slice(0, 120)}…</summary><div style={{ whiteSpace: 'pre-wrap' }}>{r.excerpt}</div></details>}</td>
                        <td className="small">{r.mentions.join(', ') || '—'}</td>
                        <td className="small">{r.citations.slice(0, 6).map((c, i) => <div key={i}><UrlLink url={c.url} max={45} /></div>)}{!r.citations.length && '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Loading>
  );
}

const METRIC_HU: Record<string, string> = {
  pages: 'Bejárt URL', indexable: 'Indexelhető', avgWords: 'Átl. szószám', sdPagesPct: 'Strukt. adat oldalarány %', orgSchema: 'Organization jelölés', answerCoverage: 'Kérdés-lefedettség', citationPotential: 'Citation Potential (becslés)', answerFirstPct: 'Közvetlen válasz %', evidence: 'Bizonyíték-pont', trustSignals: 'Bizalmi jelek', faqOrQuestionHeadings: 'Kérdés-szakaszos oldalak', tables: 'Táblázatos oldalak', aiCitations: 'AI-citationök (mért)', serpAppearances: 'SERP-megjelenések (mért)',
};

export function CompetitorsTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.competitors(id), [id]);
  const comps = data?.competitors ?? [];
  const keys = Object.keys(METRIC_HU).filter((k) => comps.some((c) => c.metrics[k] !== undefined && c.metrics[k] !== null));
  return (
    <Loading error={error} loading={loading}>
      {!comps.length ? (
        <Empty>Nem volt megadott key competitor. Adj meg 3–10 domaint az audit indításakor, majd futtasd újra.</Empty>
      ) : (
        <div className="stack">
          <div className="card">
            <h2>Key competitor snapshot</h2>
            <p className="small muted">Egyszeri pillanatfelvétel; a saját domainnel azonos kérdéskészlet és azonos értékelési szabályok alapján. Nem monitoring, nincs trend.</p>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Mutató</th>{comps.map((c) => <th key={c.id}>{c.domain}</th>)}</tr></thead>
                <tbody>
                  <tr><td>Besorolás</td>{comps.map((c) => <td key={c.id}>{c.types.map((t) => COMPETITOR_TYPE_LABEL[t]).join(', ') || '—'}{!c.confirmed && <div className="small muted">megerősítendő</div>}</td>)}</tr>
                  <tr><td>Crawl</td>{comps.map((c) => <td key={c.id}>{c.crawlStatus}{c.error && <div className="small" style={{ color: '#9d2222' }}>{c.error}</div>}</td>)}</tr>
                  {keys.map((k) => <tr key={k}><td>{METRIC_HU[k]}</td>{comps.map((c) => <td key={c.id} className="num">{c.metrics[k] ?? '—'}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid cols-2">
            {comps.map((c) => (
              <div key={c.id} className="card">
                <h3>{c.domain}</h3>
                <b className="small">Hol erősebb a saját domainnél</b>
                <ul className="tight small">{c.strengths.length ? c.strengths.map((s) => <li key={s}>{s}</li>) : <li className="muted">—</li>}</ul>
                <b className="small">Hol gyengébb / hiányos</b>
                <ul className="tight small">{c.weaknesses.length ? c.weaknesses.map((s) => <li key={s}>{s}</li>) : <li className="muted">—</li>}</ul>
                {c.citedUrls.length > 0 && <><b className="small">Ténylegesen idézett URL-ek</b><ul className="tight small">{c.citedUrls.slice(0, 5).map((u) => <li key={u}><UrlLink url={u} /></li>)}</ul></>}
              </div>
            ))}
          </div>
          {data!.opportunities.length > 0 && (
            <div className="card stack">
              <h2>Opportunity elemzés</h2>
              {data!.opportunities.map((o) => (
                <div key={o.id} className="opp">
                  <div className="row"><Prio p={o.priority} /> <b>{o.title}</b></div>
                  <div className="grid cols-2 small">
                    <div><span className="label">Versenytárs</span><ul className="tight">{o.competitorSide.map((x) => <li key={x}>{x}</li>)}</ul></div>
                    <div><span className="label">Saját domain</span><ul className="tight">{o.ownSide.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  </div>
                  <div className="small"><b>Opportunity:</b> {o.action}</div>
                  <div className="small muted">Várható hatás: {o.expectedImpact} · Bizonytalanság: {o.uncertainty}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Loading>
  );
}

const BASIS: Record<string, { l: string; k: string }> = {
  observed_citation: { l: 'Megfigyelt AI-citation gap', k: 'external' },
  serp: { l: 'Keresési eredményeken alapuló gap', k: 'external' },
  content_inferred: { l: 'Tartalmi összehasonlításból következtetett', k: 'estimate' },
};

export function QueryGapsTab({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => siteApi.competitors(id), [id]);
  const [basis, setBasis] = useState('');
  const [comp, setComp] = useState('');
  const gaps = (data?.gaps ?? []).filter((g) => (!basis || g.basis === basis) && (!comp || g.competitor === comp));
  return (
    <Loading error={error} loading={loading}>
      {!data?.gaps.length ? (
        <Empty>Nincs competitor query gap (nincs versenytárs-adat, vagy a saját domain minden vizsgált kérdésben legalább olyan jó).</Empty>
      ) : (
        <div className="card flat">
          <div className="row" style={{ padding: '12px 20px' }}>
            <h2 style={{ margin: 0, flex: 1 }}>Competitor Query Gaps</h2>
            <Filter label="Alap" value={basis} options={Object.entries(BASIS).map(([v, x]) => ({ v, l: x.l }))} onChange={setBasis} />
            <Filter label="Versenytárs" value={comp} options={[...new Set(data.gaps.map((g) => g.competitor))].map((v) => ({ v, l: v }))} onChange={setComp} />
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Prio</th><th>Kérdés · téma · szándék</th><th>Versenytárs</th><th>Alap</th><th>Saját</th><th>Javaslat</th><th>Hatás · ráfordítás</th></tr></thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.id}>
                    <td><Prio p={g.priority} /></td>
                    <td><b>{g.query}</b><div className="small muted">{g.topic} · {QUERY_TYPE_LABEL[g.intent]}</div></td>
                    <td className="small"><b>{g.competitor}</b>{g.competitorUrl && <div><UrlLink url={g.competitorUrl} max={40} /></div>}{g.competitorTraits.length > 0 && <div className="muted">{g.competitorTraits.join(' · ')}</div>}</td>
                    <td className="small"><Kind k={BASIS[g.basis].k} /><div>{BASIS[g.basis].l}</div></td>
                    <td className="small">{g.ownUrl ? <UrlLink url={g.ownUrl} max={35} /> : <span className="muted">nincs releváns URL</span>}<div className="muted">{g.ownGap}</div></td>
                    <td className="small">{g.suggestion}</td>
                    <td className="small">{g.impact}/5 · {g.effort}<div><Conf v={g.confidence} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Loading>
  );
}

export function ContentGapsTab({ id }: { id: string }) {
  const q = useLoad(() => siteApi.queries(id), [id]);
  const r = useLoad(() => siteApi.recommendations(id), [id]);
  const topics = (q.data?.topics ?? []).filter((t) => t.coverage !== 'full');
  const briefs = (r.data ?? []).filter((x) => x.type === 'content_brief' || x.type === 'faq');
  return (
    <Loading error={q.error ?? r.error} loading={q.loading || r.loading}>
      <div className="stack">
        <div className="card">
          <h2>Tartalmi hiányok témánként</h2>
          {topics.length ? (
            <table className="t">
              <thead><tr><th>Téma</th><th>Lefedettség</th><th>Megválaszolatlan kérdések</th><th>Versenytárs lefedi</th><th>Javaslat</th></tr></thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.label}</b></td>
                    <td><CoverageBadge c={t.coverage} /></td>
                    <td className="small">{t.missingQueries.map((m) => <div key={m}>{m}</div>)}</td>
                    <td className="small">{t.competitorCoverage.filter((c) => c.coverage === 'full').map((c) => <div key={c.domain}>{c.domain}</div>)}</td>
                    <td className="small">{t.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">Minden azonosított téma teljesen lefedett.</p>}
          <Note>Hiányt csak a vizsgált (generált vagy megadott) kérdéskészleten állapítunk meg; nem létező keresési igényt nem állítunk.</Note>
        </div>
        {briefs.map((b) => (
          <div key={b.id} className="card stack" style={{ gap: 6 }}>
            <div className="row"><Prio p={b.priority} /> <b>{b.id} · {b.title}</b> <span className="tag evidence-hypothesis">sablon</span></div>
            {b.url && <UrlLink url={b.url} />}
            <pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{b.proposed}</pre>
            <div className="small muted">{b.rationale}</div>
          </div>
        ))}
      </div>
    </Loading>
  );
}
