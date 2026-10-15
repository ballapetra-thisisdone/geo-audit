import { Fragment, useEffect, useState } from 'react';
import type { CostEstimate, CrawlConfig, SiteAuditInput } from '../../../shared/site';
import { siteApi } from './api';
import { Loading, useLoad } from './ui';
import { toast } from '../components/ui';

const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

export function NewSiteAudit() {
  const meta = useLoad(() => siteApi.meta(), []);
  const [url, setUrl] = useState('');
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('');
  const [category, setCategory] = useState('');
  const [products, setProducts] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [topics, setTopics] = useState('');
  const [queries, setQueries] = useState('');
  const [crawl, setCrawl] = useState<CrawlConfig | null>(null);
  const [compPages, setCompPages] = useState(30);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [maxQueries, setMaxQueries] = useState(20);
  const [llmOn, setLlmOn] = useState(false);
  const [llmCalls, setLlmCalls] = useState(12);
  const [est, setEst] = useState<CostEstimate | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!meta.data) return;
    setCrawl(meta.data.defaults.crawl);
    setLlmOn(meta.data.llm.configured);
    setPlatforms(meta.data.platforms.filter((p) => p.configured).map((p) => p.id));
  }, [meta.data]);

  const input = (): Partial<SiteAuditInput> => ({
    url,
    country: country || undefined,
    language: language || undefined,
    category: category || undefined,
    products: lines(products),
    competitors: lines(competitors),
    topics: lines(topics),
    queries: queries.split('\n').map((x) => x.trim()).filter(Boolean),
    crawl: crawl ?? undefined,
    competitorMaxPages: compPages,
    visibility: { platforms, maxQueries },
    llm: { enabled: llmOn, maxCalls: llmCalls },
  });

  useEffect(() => {
    if (!url.trim() || !crawl) return setEst(null);
    const h = setTimeout(() => {
      siteApi.estimate(input()).then(setEst).catch(() => setEst(null));
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, competitors, crawl, compPages, platforms, maxQueries, llmOn, llmCalls]);

  const compCount = lines(competitors).length;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await siteApi.create(input());
      window.location.hash = `/site/${r.id}`;
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof CrawlConfig, v: unknown) => setCrawl((c) => (c ? { ...c, [k]: v } : c));

  return (
    <div className="stack">
      <div className="header-block">
        <div className="stripe" />
        <div>
          <p className="label">Új audit</p>
          <h1 className="title">Webhely GEO audit indítása</h1>
          <p className="sub">A domain megadása elég. A többi mező opcionális – amit megbízhatóan ki lehet következtetni, azt a rendszer felismeri, és jelzi a bizonytalanságot.</p>
        </div>
      </div>
      <Loading error={meta.error} loading={meta.loading}>
        <div className="grid cols-2">
          <div className="card stack">
            <h2>Alapadatok</h2>
            <label className="field">
              <span>Saját domain vagy URL *</span>
              <input type="url" placeholder="pelda.hu vagy https://www.pelda.hu/" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <div className="grid cols-3">
              <label className="field">
                <span>Célország</span>
                <input type="text" placeholder="pl. HU" value={country} onChange={(e) => setCountry(e.target.value)} />
              </label>
              <label className="field">
                <span>Nyelv</span>
                <input type="text" placeholder="automatikus" value={language} onChange={(e) => setLanguage(e.target.value)} />
              </label>
              <label className="field">
                <span>Üzleti kategória</span>
                <input type="text" placeholder="pl. fogászat" value={category} onChange={(e) => setCategory(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Fő termékek / szolgáltatások</span>
              <textarea placeholder="soronként vagy vesszővel – üresen hagyva felismerjük" value={products} onChange={(e) => setProducts(e.target.value)} />
            </label>
            <label className="field">
              <span>Key competitor domainek (3–10)</span>
              <textarea placeholder={'versenytars1.hu\nversenytars2.hu'} value={competitors} onChange={(e) => setCompetitors(e.target.value)} />
              <small>{compCount ? `${compCount} domain${compCount > 10 ? ' – legfeljebb 10-et vizsgálunk' : compCount < 3 ? ' – 3–10 ajánlott' : ''}` : 'Ha üres, nincs versenytárs-összehasonlítás (AI/SERP API esetén javaslunk jelölteket).'}</small>
            </label>
            <label className="field">
              <span>Fontos témák</span>
              <textarea placeholder="soronként" value={topics} onChange={(e) => setTopics(e.target.value)} />
            </label>
            <label className="field">
              <span>Fontos keresési kérdések</span>
              <textarea placeholder="soronként egy kérdés" value={queries} onChange={(e) => setQueries(e.target.value)} />
            </label>
          </div>
          <div className="stack">
            <div className="card stack">
              <h2>Crawl beállítások</h2>
              {crawl && (
                <>
                  <div className="grid cols-3">
                    <label className="field"><span>Max. oldalszám</span><input type="number" min={1} max={2000} value={crawl.maxPages} onChange={(e) => set('maxPages', Number(e.target.value))} /></label>
                    <label className="field"><span>Crawl depth</span><input type="number" min={0} max={15} value={crawl.maxDepth} onChange={(e) => set('maxDepth', Number(e.target.value))} /></label>
                    <label className="field"><span>Párhuzamosság</span><input type="number" min={1} max={8} value={crawl.concurrency} onChange={(e) => set('concurrency', Number(e.target.value))} /></label>
                    <label className="field"><span>Timeout (ms)</span><input type="number" min={2000} max={60000} step={1000} value={crawl.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} /></label>
                    <label className="field"><span>Kérések közti szünet (ms)</span><input type="number" min={0} max={10000} value={crawl.delayMs} onChange={(e) => set('delayMs', Number(e.target.value))} /></label>
                    <label className="field"><span>Újrapróbálás</span><input type="number" min={0} max={5} value={crawl.retries} onChange={(e) => set('retries', Number(e.target.value))} /></label>
                  </div>
                  <div className="grid cols-3">
                    <label className="field">
                      <span>Renderelés</span>
                      <select value={crawl.render} onChange={(e) => set('render', e.target.value)}>
                        <option value="auto">automatikus (fontos + gyanús oldalak)</option>
                        <option value="all">minden oldal (max.)</option>
                        <option value="off">kikapcsolva</option>
                      </select>
                    </label>
                    <label className="field"><span>Max. renderelt oldal</span><input type="number" min={0} max={200} value={crawl.renderMax} onChange={(e) => set('renderMax', Number(e.target.value))} /></label>
                    <label className="field">
                      <span>Query paraméterek</span>
                      <select value={crawl.queryParams} onChange={(e) => set('queryParams', e.target.value)}>
                        <option value="strip-tracking">követők eltávolítása</option>
                        <option value="drop-all">minden eldobása</option>
                        <option value="keep">megtartás</option>
                      </select>
                    </label>
                  </div>
                  <label className="check"><input type="checkbox" checked={crawl.includeSubdomains} onChange={(e) => set('includeSubdomains', e.target.checked)} /> Aldomainek bejárása</label>
                  <label className="field"><span>Versenytársanként max. oldal</span><input type="number" min={1} max={300} value={compPages} onChange={(e) => setCompPages(Number(e.target.value))} /></label>
                  <p className="small muted">A crawler betartja a robots.txt-t és a Crawl-delay-t, nem kerül meg hozzáférés-védelmet, és csak nyilvános címeket kér le.</p>
                </>
              )}
            </div>
            <div className="card stack">
              <h2>Külső szolgáltatások</h2>
              <div>
                <b>LLM-értékelés</b> <span className="small muted">({meta.data?.llm.model})</span>
                <label className="check" style={{ marginTop: 6 }}>
                  <input type="checkbox" disabled={!meta.data?.llm.configured} checked={llmOn} onChange={(e) => setLlmOn(e.target.checked)} />
                  {meta.data?.llm.configured ? 'Szemantikai értékelés a fontos oldalakon és kérdéseken' : `Nincs konfigurálva (${meta.data?.llm.env} a .env-ben)`}
                </label>
                {llmOn && <label className="field" style={{ maxWidth: 200 }}><span>Max. LLM-hívás</span><input type="number" min={0} max={500} value={llmCalls} onChange={(e) => setLlmCalls(Number(e.target.value))} /></label>}
              </div>
              <div>
                <b>AI/search visibility</b>
                <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                  {meta.data?.platforms.map((p) => (
                    <label key={p.id} className="check">
                      <input type="checkbox" disabled={!p.configured} checked={platforms.includes(p.id)} onChange={(e) => setPlatforms((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} />
                      <span>
                        {p.name} {p.configured ? <span className="tag evidence-observed">konfigurálva</span> : <span className="tag evidence-unverifiable">nincs kulcs: {p.env}</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <label className="field" style={{ maxWidth: 200, marginTop: 8 }}><span>Vizsgált kérdések száma</span><input type="number" min={1} max={200} value={maxQueries} onChange={(e) => setMaxQueries(Number(e.target.value))} /></label>
                <p className="small muted">Kulcs nélkül az AI visibility „nem mérhető” lesz – nem szimulálunk AI-válaszokat. A technikai és tartalmi audit ettől függetlenül teljes.</p>
              </div>
            </div>
            <div className="card stack">
              <h2>Becsült terjedelem</h2>
              {est ? (
                <>
                  <dl className="kv">
                    <dt>Oldalak (max.)</dt><dd>{est.pages}</dd>
                    <dt>Renderelés (max.)</dt><dd>{est.renders}</dd>
                    <dt>Versenytárs-oldalak (max.)</dt><dd>{est.competitorPages}</dd>
                    <dt>LLM-hívás (max.)</dt><dd>{est.llmCalls}{est.llmCalls ? ` · ≈${(est.llmInputTokens + est.llmOutputTokens).toLocaleString('hu-HU')} token · becslés ≈ $${est.llmCostUsd ?? '?'}` : ''}</dd>
                    {est.externalQueries.filter((q) => q.calls).map((q) => (
                      <Fragment key={q.platform}><dt>{q.platform}</dt><dd>{q.calls} lekérdezés</dd></Fragment>
                    ))}
                  </dl>
                  <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{est.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </>
              ) : (
                <p className="small muted">Add meg a domaint a becsléshez.</p>
              )}
              <button className="btn primary" disabled={!url.trim() || busy} onClick={submit}>
                {busy ? <span className="spinner" /> : null} Audit indítása
              </button>
            </div>
          </div>
        </div>
      </Loading>
    </div>
  );
}
