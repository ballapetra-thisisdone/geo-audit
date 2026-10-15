// Egységtesztek: URL-normalizálás, SSRF-védelem, robots, HTML-kinyerés, JSON-LD, scoring, prioritás, export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, isSameSite, paginationIndex, toStartUrl, looksNonHtml } from '../server/site/crawl/url.ts';
import { assertSafeUrl, assertPublicHost, isPrivateAddress, safeFetch, defaultPolicy } from '../server/site/security.ts';
import { parseRobots, isAllowed } from '../server/collect/robots.ts';
import { crawlDelayFor } from '../server/site/crawl/crawler.ts';
import { parseSitemapXml } from '../server/site/crawl/sitemap.ts';
import { extractPage, simhash, hamming } from '../server/site/extract/page.ts';
import { checkNode } from '../server/site/analyze/structured.ts';
import { prioritize, IssueCollector } from '../server/site/analyze/issues.ts';
import { toCsv } from '../server/site/export.ts';
import { detectLanguage, Bm25, keyPhrases } from '../server/site/analyze/text.ts';
import { coverageScore, guessType } from '../server/site/analyze/queries.ts';
import { serve, page } from './helpers.ts';

test('URL-normalizálás: fragment, alapport, tracking paraméterek, rendezés', () => {
  assert.equal(normalizeUrl('HTTPS://Example.COM:443/a//b/?utm_source=x&b=2&a=1#top'), 'https://example.com/a/b/?a=1&b=2');
  assert.equal(normalizeUrl('/x?gclid=1', 'https://e.com/y'), 'https://e.com/x');
  assert.equal(normalizeUrl('/x?q=1', 'https://e.com', 'drop-all'), 'https://e.com/x');
  assert.equal(normalizeUrl('mailto:a@b.hu'), null);
  assert.equal(normalizeUrl('javascript:void(0)', 'https://e.com'), null);
});

test('Domainhatár, lapozás, nem HTML erőforrások', () => {
  assert.ok(isSameSite('https://www.e.com/a', 'e.com', false));
  assert.ok(!isSameSite('https://blog.e.com/a', 'e.com', false));
  assert.ok(isSameSite('https://blog.e.com/a', 'e.com', true));
  assert.ok(!isSameSite('https://e.com.evil.io/', 'e.com', true));
  assert.equal(paginationIndex('https://e.com/blog/page/7/'), 7);
  assert.equal(paginationIndex('https://e.com/blog?page=3'), 3);
  assert.ok(looksNonHtml('https://e.com/a.jpg'));
  assert.equal(toStartUrl('example.com'), 'https://example.com/');
});

test('SSRF: belső címek, portok, hitelesítő adatok tiltva', () => {
  const p = { ...defaultPolicy(), allowPrivate: false };
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '0.0.0.0']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2a00:1450:4001::1']) assert.ok(!isPrivateAddress(ip), ip);
  assert.throws(() => assertSafeUrl('http://localhost/', p));
  assert.throws(() => assertSafeUrl('http://169.254.169.254/latest/meta-data', p));
  assert.throws(() => assertSafeUrl('http://user:pw@example.com/', p));
  assert.throws(() => assertSafeUrl('http://example.com:6379/', p));
  assert.throws(() => assertSafeUrl('file:///etc/passwd', p));
  assert.throws(() => assertSafeUrl('http://intranet/', p));
  assert.doesNotThrow(() => assertSafeUrl('https://example.com/a', p));
});

test('SSRF: a helyi szerver lekérése alapértelmezett szabályokkal blokkolt, átirányításnál is', async () => {
  const s = await serve(() => ({ '/': { body: 'ok' }, '/r': { status: 302, headers: { location: 'http://127.0.0.1:1/' } } }));
  try {
    const blocked = await safeFetch(`${s.base}/`, { ua: 't', policy: { ...defaultPolicy(), allowPrivate: false } });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocked, true);
    const allowed = await safeFetch(`${s.base}/`, { ua: 't', policy: { ...defaultPolicy(), allowPrivate: true } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.text, 'ok');
    // átirányítás belső címre: minden ugrást újra ellenőrzünk (itt a cél a tiltott 1-es port és belső IP)
    const viaRedirect = await safeFetch(`${s.base}/r`, { ua: 't', policy: { ...defaultPolicy(), allowPrivate: true, allowedPorts: [80, 443] } });
    assert.equal(viaRedirect.redirects.length, 1);
    assert.equal(viaRedirect.ok, false);
    await assert.rejects(assertPublicHost('127.0.0.1', { ...defaultPolicy(), allowPrivate: false }));
  } finally {
    await s.close();
  }
});

test('safeFetch: méretkorlát és időtúllépés', async () => {
  const big = 'x'.repeat(50000);
  const s = await serve(() => ({ '/big': { body: big } }));
  try {
    const r = await safeFetch(`${s.base}/big`, { ua: 't', policy: { ...defaultPolicy(), allowPrivate: true, maxBytes: 1000 } });
    assert.equal(r.truncated, true);
    assert.ok((r.text ?? '').length <= 1000);
    const t = await safeFetch('http://10.255.255.1/', { ua: 't', timeoutMs: 300, policy: { ...defaultPolicy(), allowPrivate: true } });
    assert.equal(t.ok, false);
  } finally {
    await s.close();
  }
});

test('robots.txt: leghosszabb egyezés, saját csoport, Crawl-delay', () => {
  const txt = 'User-agent: *\nDisallow: /private/\nAllow: /private/public\nCrawl-delay: 2\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: GEOAuditBot\nCrawl-delay: 5\nSitemap: https://e.com/sitemap.xml';
  const r = parseRobots(txt);
  assert.equal(isAllowed(r, 'GEOAuditBot', '/private/x').allowed, true, 'saját csoport, nincs Disallow');
  assert.equal(isAllowed(r, 'Googlebot', '/private/x').allowed, false);
  assert.equal(isAllowed(r, 'Googlebot', '/private/public/a').allowed, true);
  assert.equal(isAllowed(r, 'GPTBot', '/').allowed, false);
  assert.equal(isAllowed(r, 'OAI-SearchBot', '/').allowed, true);
  assert.deepEqual(r.sitemaps, ['https://e.com/sitemap.xml']);
  assert.equal(crawlDelayFor(txt, 'GEOAuditBot'), 5);
  assert.equal(crawlDelayFor(txt, 'Other'), 2);
});

test('Sitemap: urlset és index', () => {
  const u = parseSitemapXml('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://e.com/a</loc><lastmod>2026-01-01</lastmod></url></urlset>');
  assert.equal(u.type, 'urlset');
  assert.deepEqual(u.locs, [{ loc: 'https://e.com/a', lastmod: '2026-01-01' }]);
  const i = parseSitemapXml('<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>');
  assert.equal(i.type, 'index');
  assert.equal(parseSitemapXml('<html></html>').type, 'invalid');
});

test('HTML-kinyerés: fő tartalom, szakaszok, linkzónák, strukturált adat, szerző, dátum', () => {
  const html = page({
    title: 'GEO audit | Teszt Kft.',
    head: '<meta name="description" content="Leírás"><link rel="canonical" href="/geo/"><meta name="author" content="Kiss Anna"><meta property="article:published_time" content="2026-01-10"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"X","author":{"@type":"Person","name":"Kiss Anna"}}</script><script type="application/ld+json">{ hibás json</script>',
    body: `<header><nav><a href="/">Kezdőlap</a><a href="/kapcsolat/">Kapcsolat</a></nav></header>
      <main><h1>GEO audit</h1><p>A GEO audit egy olyan vizsgálat, amely megmutatja, mennyire érthető a weboldal az AI-rendszerek számára.</p>
      <h2>Mennyibe kerül?</h2><p>Az ár 149 000 Ft, az átfutási idő 10 nap. Például egy 50 oldalas webhelynél.</p>
      <ul><li>Egy</li><li>Kettő</li></ul><a href="https://forras.example/kutatas">kutatás</a> <a href="/tovabb">tovább</a>
      <div itemscope itemtype="https://schema.org/Organization"><span itemprop="name">Teszt Kft.</span></div>
      <details><summary>Kérdés?</summary><p>Rejtett válasz szöveg, amely elég hosszú ahhoz, hogy számítson.</p></details></main>
      <footer><a href="tel:+3611234567">Hívjon</a> <a href="mailto:info@teszt.hu">E-mail</a> <a href="/impresszum">Impresszum</a> <a href="https://www.linkedin.com/company/teszt">LinkedIn</a></footer>`,
  });
  const e = extractPage(html, 'https://teszt.hu/geo/', { 'x-robots-tag': 'noarchive' });
  assert.equal(e.title, 'GEO audit | Teszt Kft.');
  assert.deepEqual(e.canonical, ['https://teszt.hu/geo/']);
  assert.equal(e.headings[0].text, 'GEO audit');
  assert.ok(!e.mainText.includes('Kezdőlap'), 'a navigáció nem része a fő tartalomnak');
  assert.ok(e.mainText.includes('149 000 Ft'));
  assert.ok(e.firstParagraph?.startsWith('A GEO audit egy olyan'));
  assert.ok(e.passages.some((p) => p.heading === 'Mennyibe kerül?'));
  assert.equal(e.jsonld.length, 2);
  assert.ok(e.jsonld[1].error, 'hibás JSON-LD jelölve');
  assert.equal(e.microdata[0].type, 'Organization');
  assert.equal(e.microdata[0].props.name[0], 'Teszt Kft.');
  assert.ok(e.author.some((a) => a.name === 'Kiss Anna'));
  assert.equal(e.datePublished, '2026-01-10');
  assert.ok(e.numbers >= 2);
  assert.ok(e.examples >= 1);
  assert.ok(e.definitions.length >= 1);
  assert.deepEqual(e.externalRefs, ['https://forras.example/kutatas']);
  assert.ok(e.contactSignals.tel.includes('+3611234567'));
  assert.ok(e.contactSignals.email.includes('info@teszt.hu'));
  assert.ok(e.contactSignals.impressum);
  assert.ok(e.socialProfiles[0].includes('linkedin.com'));
  assert.equal(e.links.find((l) => l.text === 'Kapcsolat')?.zone, 'nav');
  assert.equal(e.links.find((l) => l.text === 'tovább')?.zone, 'main');
  assert.ok(e.hiddenBlocks.some((h) => h.kind.startsWith('details')));
  assert.deepEqual(e.xRobotsTag, ['noarchive']);
});

test('Simhash: azonos/közel azonos/eltérő szöveg', () => {
  const a = 'A GEO audit megmutatja, mennyire érthető a weboldal az AI rendszerek számára és mit kell javítani rajta. '.repeat(5);
  const b = a.replace('javítani', 'módosítani');
  const c = 'Teljesen más tartalom az időjárásról, a hétvégi programokról és a főzésről szóló hosszabb szöveg. '.repeat(5);
  assert.equal(hamming(simhash(a), simhash(a)), 0);
  assert.ok(hamming(simhash(a), simhash(b)) <= 8);
  assert.ok(hamming(simhash(a), simhash(c)) > 10);
});

test('JSON-LD ellenőrzés: rich result kötelező mezők, dátumformátum, ismeretlen property, galérián kívüli típus', () => {
  const p = checkNode({ '@type': 'Product', name: 'X' });
  assert.ok(p.rich.find((r) => r.type === 'Product')!.missingRequired.includes('review | aggregateRating | offers'));
  const ok = checkNode({ '@type': 'Product', name: 'X', offers: { '@type': 'Offer', price: 1 } });
  assert.deepEqual(ok.rich.find((r) => r.type === 'Product')!.missingRequired, []);
  const a = checkNode({ '@type': 'Article', headline: 'X', datePublished: 'tegnap', autor: 'typo' });
  assert.ok(a.errors.some((x) => x.includes('datePublished')));
  assert.ok(a.warnings.some((x) => x.includes('"autor"')));
  const f = checkNode({ '@type': 'FAQPage', mainEntity: [] });
  assert.equal(f.rich.find((r) => r.type === 'FAQPage')?.eligibleType, false);
  const lb = checkNode({ '@type': 'LocalBusiness', name: 'X' });
  assert.ok(lb.rich.find((r) => r.type === 'LocalBusiness')!.missingRequired.includes('address'));
  const bc = checkNode({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', name: 'A' }] });
  assert.ok(bc.errors.some((x) => x.includes('position')));
});

test('Nyelvfelismerés és BM25', () => {
  assert.equal(detectLanguage('Ez egy magyar nyelvű szöveg, amely arról szól, hogy hogyan lehet és kell a weboldalt javítani, és mi az a GEO. '.repeat(3)).lang, 'hu');
  assert.equal(detectLanguage('This is an English text about how the website should be improved and what it is for the users. '.repeat(3)).lang, 'en');
  const bm = new Bm25([{ t: 'A GEO audit ára 149 000 Ft' }, { t: 'Kapcsolat és elérhetőség' }], (x) => x.t, 'hu');
  assert.equal(bm.search('GEO audit ár')[0].item.t, 'A GEO audit ára 149 000 Ft');
  const kp = keyPhrases([{ text: 'geo audit szolgáltatás geo audit' }, { text: 'geo audit árak' }], 'hu', 5);
  assert.ok(kp.some((k) => k.phrase === 'geo audit'));
});

test('Answer Coverage Score és kérdéstípus', () => {
  assert.equal(coverageScore([{ coverage: 'full', weight: 1 }, { coverage: 'partial', weight: 1 }, { coverage: 'missing', weight: 2 }]), 38);
  assert.equal(coverageScore([]), null);
  assert.equal(guessType('Mennyibe kerül a GEO audit?'), 'commercial');
  assert.equal(guessType('Hogyan működik?'), 'how_to');
});

test('Prioritás: blokkoló hiba P0, kis hatású P3, bizonyosság számít', () => {
  const ic = new IssueCollector('own');
  ic.add('a', { category: 'crawl', title: 'x', why: '', fix: '', acceptance: '', impact: 5, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.95, blocker: true }, { url: 'u', detail: 'd' });
  ic.add('b', { category: 'html', title: 'y', why: '', fix: '', acceptance: '', impact: 1, effort: 'M', owner: 'dev', evidenceKind: 'measured', confidence: 0.9 }, { url: 'u', detail: 'd' });
  ic.add('c', { category: 'content', title: 'z', why: '', fix: '', acceptance: '', impact: 4, effort: 'S', owner: 'dev', evidenceKind: 'estimate', confidence: 0.3 }, { url: 'u', detail: 'd' });
  const [a, b, c] = ic.list();
  assert.equal(prioritize(a, 10), 'P0');
  assert.equal(prioritize(b, 10), 'P3');
  assert.notEqual(prioritize(c, 10), 'P1', 'alacsony bizonyosságú becslés nem lehet P1');
});

test('CSV export: idézés, sortörés, BOM', () => {
  const s = toCsv([{ a: 'x,"y"', b: 'sor1\nsor2', c: ['p', 'q'] }], [['a', 'A'], ['b', 'B'], ['c', 'C']]);
  assert.ok(s.startsWith('﻿'));
  assert.ok(s.includes('"x,""y"""'));
  assert.ok(s.includes('"sor1\nsor2"'));
  assert.ok(s.includes('p | q'));
});
