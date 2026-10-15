// Végponttól végpontig: két kontrollált, helyi tesztoldal (saját + versenytárs), teljes pipeline.
// Az AI-adapter itt MOCK – kizárólag tesztben létezik, a felületen nem jelenhet meg.
process.env.GEO_ALLOW_PRIVATE_HOSTS = '1';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve, memoryDb, page } from './helpers.ts';
import { normalizeInput, runAudit, estimate } from '../server/site/pipeline.ts';
import * as repo from '../server/site/repo.ts';
import { csv, htmlReport, bundle } from '../server/site/export.ts';
import type { PlatformAdapter } from '../server/site/visibility/adapters.ts';
import { defaultPolicy } from '../server/site/security.ts';

const nav = '<nav><a href="/">Kezdőlap</a> <a href="/szolgaltatasok/seo-audit/">SEO audit</a> <a href="/szolgaltatasok/geo-audit/">GEO audit</a> <a href="/blog/mi-az-a-geo/">Blog</a> <a href="/rolunk/">Rólunk</a> <a href="/kapcsolat/">Kapcsolat</a></nav>';
const footer = '<footer><a href="tel:+3611234567">+36 1 123 4567</a> <a href="mailto:info@teszt.example">info@teszt.example</a></footer>';
const filler = (n: number, topic: string) => Array.from({ length: n }, (_, i) => `<p>${topic} ${i + 1}. bekezdés: a vizsgálat részletesen áttekinti a weboldal szerkezetét, a tartalmat és a technikai beállításokat, hogy a keresők pontosan értsék.</p>`).join('');

const own = (base: string): Record<string, { status?: number; headers?: Record<string, string>; body?: string }> => ({
  '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: `User-agent: *\nDisallow: /private/\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n\nSitemap: ${base}/sitemap.xml\n` },
  '/sitemap.xml': {
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/szolgaltatasok/seo-audit/', '/szolgaltatasok/geo-audit/', '/blog/mi-az-a-geo/', '/orphan/', '/old', '/noindex/', '/missing'].map((p) => `<url><loc>${base}${p}</loc><lastmod>2026-09-01</lastmod></url>`).join('')}</urlset>`,
  },
  '/': { body: page({ title: 'Teszt Ügynökség | Kezdőlap', head: '<meta property="og:site_name" content="Teszt Ügynökség">', body: `<header>${nav}</header><main><h1>Teszt Ügynökség</h1><p>Weboldal-auditokat készítünk kis- és középvállalkozásoknak, hogy a keresők és az AI-rendszerek is jól értsék a weboldalukat.</p>${filler(4, 'Bevezető')}<a href="/old">Régi oldal</a> <a href="/private/titok">Privát</a></main>${footer}` }) },
  '/szolgaltatasok/seo-audit/': { body: page({ title: 'SEO audit | Teszt Ügynökség', head: `<link rel="canonical" href="${base}/szolgaltatasok/seo-audit/"><meta name="description" content="SEO audit leírás">`, body: `<header>${nav}</header><main><h1>SEO audit</h1><p>A SEO audit a weboldal keresőoptimalizálási állapotának átfogó vizsgálata, amely konkrét javítási listát ad.</p><h2>SEO audit: mennyibe kerül?</h2><p>A SEO audit ára 149 000 Ft, az átfutási idő 10 munkanap.</p>${filler(6, 'SEO audit')}</main>${footer}` }) },
  '/szolgaltatasok/geo-audit/': { body: page({ title: 'GEO audit | Teszt Ügynökség', head: `<link rel="canonical" href="${base}/szolgaltatasok/geo-audit/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Láthatatlan kérdés?","acceptedAnswer":{"@type":"Answer","text":"Ez a válasz nem szerepel az oldalon."}}]}</script>`, body: `<header>${nav}</header><main><h1>GEO audit</h1>${filler(5, 'GEO audit')}</main>${footer}` }) },
  '/blog/mi-az-a-geo/': { body: page({ title: 'Mi az a GEO? | Teszt Ügynökség', head: '<script type="application/ld+json">{ "@type": "Article", hibás }</script>', body: `<header>${nav}</header><main><h1>Mi az a GEO?</h1><p>A GEO a generatív keresőkre való optimalizálás, amely 2024 óta egyre fontosabb, a keresések 30%-ában már AI-összefoglaló jelenik meg.</p>${filler(5, 'GEO')}<a href="/missing">Hibás link</a> <a href="/dup/">Másolat</a> <a href="/tovabb">tovább</a></main>${footer}` }) },
  '/dup/': { body: page({ title: 'SEO audit másolat', body: `<header>${nav}</header><main><h1>SEO audit</h1><p>A SEO audit a weboldal keresőoptimalizálási állapotának átfogó vizsgálata, amely konkrét javítási listát ad.</p><h2>SEO audit: mennyibe kerül?</h2><p>A SEO audit ára 149 000 Ft, az átfutási idő 10 munkanap.</p>${filler(6, 'SEO audit')}</main>${footer}` }) },
  '/rolunk/': { body: page({ title: 'Rólunk | Teszt Ügynökség', body: `<header>${nav}</header><main><h1>Rólunk</h1><p>A Teszt Ügynökség 2015 óta foglalkozik weboldal-auditokkal; csapatunk 6 főből áll.</p>${filler(2, 'Rólunk')}</main>${footer}` }) },
  '/kapcsolat/': { body: page({ title: 'Kapcsolat | Teszt Ügynökség', body: `<header>${nav}</header><main><h1>Kapcsolat</h1><address>1111 Budapest, Teszt utca 1.</address></main>${footer}` }) },
  '/old': { status: 301, headers: { location: '/redirect-1' } },
  '/redirect-1': { status: 301, headers: { location: '/szolgaltatasok/seo-audit/' } },
  '/noindex/': { body: page({ title: 'Noindex', head: '<meta name="robots" content="noindex,follow">', body: `<main><h1>Noindex oldal</h1>${filler(3, 'Noindex')}</main>` }) },
  '/orphan/': { body: page({ title: 'Árva oldal | Teszt Ügynökség', body: `<main><h1>Árva oldal</h1>${filler(4, 'Árva')}</main>` }) },
  '/tovabb': { body: page({ title: 'Tovább', body: `<main><h1>Tovább</h1>${filler(1, 'X')}</main>` }) },
});

const comp = (): Record<string, { status?: number; headers?: Record<string, string>; body?: string }> => ({
  '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
  '/': { body: page({ title: 'Versenytárs Kft.', body: '<nav><a href="/geo-audit-arak/">GEO audit árak</a></nav><main><h1>Versenytárs Kft.</h1><p>Mi is készítünk GEO auditot és SEO auditot cégeknek, részletes jelentéssel és ütemtervvel.</p></main>' }) },
  '/geo-audit-arak/': { body: page({ title: 'GEO audit árak', head: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Versenytárs Kft.","url":"https://versenytars.example/"}</script>', body: '<main><h1>GEO audit: mennyibe kerül?</h1><p>A GEO audit ára 199 000 Ft, és 8 munkanap alatt elkészül. A GEO audit mennyibe kerül kérdésre ez a pontos válasz: a csomag tartalmazza a crawl-elemzést, a strukturált adatok vizsgálatát és a javaslatlistát.</p><h2>GEO audit: hogyan működik, milyen lépésekből áll?</h2><ol><li>Crawl és technikai vizsgálat 2 nap alatt.</li><li>Tartalmi elemzés 3 nap alatt.</li><li>Riport és konzultáció 3 nap alatt.</li></ol><p>A GEO audit működése lépésekből áll: előbb a technikai crawl, majd a tartalmi elemzés, végül a riport, összesen 8 munkanap.</p><table><tr><td>Csomag</td><td>Ár</td></tr><tr><td>Alap</td><td>199 000 Ft</td></tr></table></main>' }) },
});

let closeAll: (() => Promise<void>)[] = [];
after(async () => {
  for (const c of closeAll) await c();
});

test('E2E: teljes audit két helyi tesztoldalon', { timeout: 120000 }, async () => {
  memoryDb();
  const ownSrv = await serve(own, 'localhost');
  const compSrv = await serve(comp, '127.0.0.1');
  closeAll = [ownSrv.close, compSrv.close];

  const input = normalizeInput({
    url: ownSrv.base,
    products: ['SEO audit', 'GEO audit'],
    competitors: [compSrv.base],
    crawl: { maxPages: 40, maxDepth: 5, timeoutMs: 5000, concurrency: 3, delayMs: 0, render: 'off', renderMax: 0, includeSubdomains: false, queryParams: 'strip-tracking', retries: 0 },
    competitorMaxPages: 10,
    llm: { enabled: false, maxCalls: 0 },
    visibility: { platforms: [], maxQueries: 5 },
  });
  const est = estimate(input, []);
  assert.equal(est.llmCalls, 0);
  assert.equal(est.competitorPages, 10);

  // MOCK adapter (csak teszt): a "mennyibe kerül" kérdésre a versenytársat idézi
  const compHost = '127.0.0.1';
  const mock: PlatformAdapter = {
    id: 'mock-ai',
    name: 'MOCK AI (csak teszt)',
    kind: 'ai',
    docs: '',
    method: 'mock',
    configured: () => true,
    query: async (q) => (/mennyibe/i.test(q) ? { text: 'A Versenytárs Kft. szerint 199 000 Ft.', citations: [{ url: `${compSrv.base}/geo-audit-arak/` }], sources: [] } : { text: 'Általános válasz.', citations: [], sources: [] }),
  };

  const audit = repo.createAudit(input);
  await runAudit(audit.id, { adapters: [mock], policy: { ...defaultPolicy(), allowPrivate: true }, renderer: () => undefined, llm: () => undefined });
  const a = repo.getAudit(audit.id);
  const failedSteps = a.steps.filter((s) => s.status === 'failed');
  assert.deepEqual(failedSteps.map((s) => `${s.id}: ${s.error}`), [], 'egyetlen lépés sem bukhat el');
  assert.equal(a.status, 'done');
  assert.equal(a.partial, false);

  // crawl és oldalbesorolás
  const pages = repo.listPages(audit.id, { site: 'own', limit: 500 }).rows;
  const by = (p: string) => pages.find((x) => x.url === `${ownSrv.base}${p}`);
  assert.equal(by('/old')?.pageClass, 'redirect');
  assert.equal(by('/missing')?.pageClass, 'error');
  assert.equal(by('/noindex/')?.pageClass, 'noindex');
  assert.equal(by('/private/titok')?.pageClass, 'blocked', 'robots.txt Disallow betartva – nincs lekérés');
  assert.ok(!ownSrv.hits.some((h) => h.startsWith('GET /private/')), 'a tiltott útvonalat nem kértük le');
  assert.ok(by('/orphan/')?.flags.includes('orphan'));
  assert.ok(by('/dup/')?.flags.includes('duplicate') || by('/szolgaltatasok/seo-audit/')?.flags.includes('duplicate'));
  assert.equal(by('/')?.depth, 0);

  // problémák konkrét URL-lel és bizonyítékkal
  const issues = repo.listIssues(audit.id);
  const codes = new Set(issues.filter((i) => i.site === 'own').map((i) => i.code));
  for (const c of ['redirect_chain', 'http_errors', 'sd_syntax', 'sd_not_visible', 'sd_no_org', 'canonical_missing', 'search_bot_blocked', 'orphan_pages', 'duplicate_content', 'generic_anchor', 'sitemap_bad_urls']) assert.ok(codes.has(c), `várt probléma: ${c}`);
  assert.ok(!codes.has('robots_block_all'), 'nincs teljes tiltás – nem lehet ilyen probléma (false positive)');
  for (const i of issues) {
    assert.ok(i.evidence.length > 0, `${i.code}: bizonyíték nélkül`);
    assert.ok(['P0', 'P1', 'P2', 'P3'].includes(i.priority));
  }
  // a GPTBot (tanító) tiltása nem hiba, az OAI-SearchBot (keresés) tiltása döntést igényel
  const sb = issues.find((i) => i.code === 'search_bot_blocked')!;
  assert.ok(sb.evidence.some((e) => e.detail.includes('OAI-SearchBot')));
  assert.ok(!sb.evidence.some((e) => e.detail.includes('GPTBot')));

  // query-k és megválaszolhatóság
  const queries = repo.listQueries(audit.id);
  assert.ok(queries.length >= 10);
  assert.ok(queries.every((q) => q.hypothesis), 'a generált kérdések hipotézisként jelölve');
  const price = queries.find((q) => q.text === 'SEO audit: mennyibe kerül?')!;
  assert.equal(price.coverage, 'full');
  assert.equal(price.bestUrl?.endsWith('/szolgaltatasok/seo-audit/') || price.bestUrl?.endsWith('/dup/'), true);
  const geoPrice = queries.find((q) => q.text === 'GEO audit: mennyibe kerül?')!;
  assert.notEqual(geoPrice.coverage, 'full');
  assert.equal(geoPrice.competitors.find((c) => c.domain === compHost)?.coverage, 'full');

  // versenytárs, gapek (megfigyelt citation és tartalmi következtetés külön)
  const comps = repo.listCompetitors(audit.id);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].crawlStatus, 'done');
  assert.ok(comps[0].types.includes('direct'));
  const gaps = repo.getArtifact<{ basis: string; query: string }[]>(audit.id, 'gaps')!;
  assert.ok(gaps.some((g) => g.basis === 'observed_citation' && /mennyibe/.test(g.query)));
  assert.ok(gaps.some((g) => g.basis === 'content_inferred'));
  const vis = repo.getArtifact<{ measured: boolean; metrics: { isOwn: boolean; citations: number }[] }>(audit.id, 'visibility')!;
  assert.equal(vis.measured, true);
  assert.equal(vis.metrics.find((m) => m.isOwn)!.citations, 0);

  // pontszám: komponensek, nem mért AI-komponens nem nulla
  const score = repo.getArtifact<{ overall: number | null; components: { id: string; status: string; score: number | null }[] }>(audit.id, 'score')!;
  assert.ok(score.overall !== null && score.overall > 0 && score.overall < 100);
  assert.equal(score.components.length, 13);

  // ajánlások: validált JSON-LD, tesztelt robots-javaslat, nincs kitalált szerző
  const recs = repo.listRecommendations(audit.id);
  const org = recs.find((r) => r.type === 'jsonld' && r.title.startsWith('Organization'))!;
  assert.equal(org.validation, 'tested');
  assert.ok(org.proposed.includes('Teszt Ügynökség'));
  assert.ok(org.proposed.includes('+3611234567'), 'csak megfigyelt telefonszám');
  const robotsRec = recs.find((r) => r.type === 'robots' && r.proposed.includes('OAI-SearchBot'))!;
  assert.equal(robotsRec.validation, 'tested');
  assert.ok(!robotsRec.proposed.includes('User-agent: GPTBot\nAllow'), 'a tanító robotot nem engedélyezzük automatikusan');
  assert.ok(recs.some((r) => r.type === 'content_brief'));
  assert.ok(recs.filter((r) => r.type === 'faq').every((r) => r.proposed.includes('[a tartalomgazda')), 'GYIK-válasz nincs kitalálva');

  // backlog és export
  const tasks = repo.listTasks(audit.id);
  assert.ok(tasks.length > 5);
  assert.ok(tasks.every((t) => t.acceptance.length && t.id.startsWith('GEO-')));
  const html = htmlReport(audit.id);
  assert.ok(html.includes('Executive Summary') && html.includes('Developer Backlog') && html.includes('Topic Coverage Matrix'));
  assert.ok(!html.includes('<script>'), 'a riport nem tartalmaz végrehajtható szkriptet');
  const issuesCsv = csv(audit.id, 'issues');
  assert.ok(issuesCsv.split('\r\n').length > 5);
  const full = bundle(audit.id);
  assert.equal(full.audit.id, audit.id);
  assert.ok(full.pages.length > 5);
});
