// Adatgyűjtés egy körhöz: bot UA-s lekérések, renderelés, robots.txt, sitemap, soft 404, kiegészítők.
import * as cheerio from 'cheerio';
import type { Artifacts, AuditInput, BotDef, FetchResult, LogEntry } from '../../shared/types.ts';
import { httpGet, detectChallenge } from './http.ts';
import { renderPage } from './render.ts';
import { parseRobots } from './robots.ts';
import { extractFacts } from '../analyze/facts.ts';
import { sameUrl } from './util.ts';

export { sameUrl };

export interface Bodies {
  byBot: Record<string, string>;
  rendered?: string;
  saved?: string;
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export async function collect(opts: {
  input: AuditInput;
  bots: BotDef[];
  savedHtml?: { fileName: string; html: string };
  /** Nyers válasz mentése; a visszaadott (relatív) útvonal kerül az artifactokba. */
  saveBody: (name: string, body: string) => Promise<string>;
  log: (level: LogEntry['level'], msg: string) => Promise<void>;
  browserChannel?: string;
}): Promise<{ artifacts: Artifacts; bodies: Bodies }> {
  const { input, log, saveBody } = opts;
  const url = input.url;
  const origin = new URL(url).origin;
  const bodies: Bodies = { byBot: {} };
  const artifacts: Artifacts = { fetches: [], sitemaps: [], pdfHeads: [], facts: {} };
  const fetchBots = opts.bots.filter((b) => b.fetch && b.ua && (b.module === 'core' || input.modules.includes(b.module)));

  // 1. Nyers HTML bot UA-kkal (párhuzamosan)
  await log('info', `Nyers HTML lekérése ${fetchBots.length} user-agenttel…`);
  const results = await Promise.all(
    fetchBots.map(async (bot): Promise<FetchResult> => {
      const r = await httpGet(url, { ua: bot.ua! });
      const fr: FetchResult = {
        botId: bot.id,
        ua: bot.ua!,
        ok: r.ok,
        status: r.status,
        finalUrl: r.finalUrl,
        redirects: r.redirects,
        headers: r.headers,
        bytes: r.bytes,
        ttfbMs: r.ttfbMs,
        totalMs: r.totalMs,
        error: r.error,
        challenge: r.ok ? detectChallenge(r.status, r.headers, r.body) : undefined,
      };
      if (r.body !== undefined) {
        bodies.byBot[bot.id] = r.body;
        fr.bodyFile = await saveBody(`raw-${bot.id}.html`, r.body);
      }
      return fr;
    }),
  );
  artifacts.fetches = results;
  for (const f of results) {
    await log(f.ok ? 'info' : 'warn', `  ${f.botId}: ${f.ok ? `${f.status} · ${f.bytes ?? '?'} B · ${f.ttfbMs} ms` : `hiba: ${f.error}`}${f.challenge ? ` · ${f.challenge}` : ''}`);
  }

  const rawBody = bodies.byBot['browser'] ?? Object.values(bodies.byBot)[0];
  const finalUrl = results.find((f) => f.botId === 'browser')?.finalUrl ?? url;
  if (rawBody) artifacts.facts.raw = extractFacts(rawBody, finalUrl);

  // 2. Renderelés
  await log('info', 'Renderelt DOM (headless böngésző)…');
  const render = await renderPage(url, BROWSER_UA, opts.browserChannel);
  if (render.ok && render.html) {
    bodies.rendered = render.html;
    artifacts.facts.rendered = extractFacts(render.html, finalUrl);
    const { html: _html, ...rest } = render;
    artifacts.render = { ...rest, bodyFile: await saveBody('rendered.html', render.html) };
    await log('info', `  ${[render.engine, render.status, `${render.loadMs} ms`, render.requestCount !== undefined && `${render.requestCount} kérés`].filter(Boolean).join(' · ')}`);
  } else {
    artifacts.render = { ok: false, error: render.error };
    await log('warn', `  Renderelés sikertelen: ${render.error}`);
  }

  // 3. Mentett HTML
  if (opts.savedHtml) {
    bodies.saved = opts.savedHtml.html;
    artifacts.saved = {
      fileName: opts.savedHtml.fileName,
      bodyFile: await saveBody('saved.html', opts.savedHtml.html),
    };
    artifacts.facts.saved = extractFacts(opts.savedHtml.html, finalUrl);
  }

  // 4. robots.txt
  await log('info', 'robots.txt, sitemap, soft 404…');
  const robots = await httpGet(`${origin}/robots.txt`, { ua: BROWSER_UA });
  artifacts.robots = robots.ok
    ? { status: robots.status, text: robots.status === 200 ? robots.body?.slice(0, 200000) : undefined }
    : { error: robots.error };

  // 5. Sitemap(ok)
  const declared = robots.status === 200 && robots.body ? parseRobots(robots.body).sitemaps : [];
  const candidates = declared.length ? declared : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  for (const sm of candidates.slice(0, 5)) {
    const entry = await readSitemap(sm, finalUrl);
    artifacts.sitemaps.push(entry);
    if (!declared.length && entry.status === 200 && entry.urls + (entry.children ?? 0) > 0) break;
  }

  // 6. Soft 404
  const probe = `${origin}/geo-audit-nem-letezo-${Math.random().toString(36).slice(2, 8)}/`;
  const s404 = await httpGet(probe, { ua: BROWSER_UA, readBody: false, method: 'GET' });
  artifacts.soft404 = { url: probe, status: s404.status, error: s404.error };

  // 7. HTTP → HTTPS
  if (url.startsWith('https://')) {
    const h = await httpGet(url.replace(/^https:/, 'http:'), { ua: BROWSER_UA, maxRedirects: 0, readBody: false });
    artifacts.httpToHttps = { status: h.status, location: h.headers['location'], error: h.error };
  }

  // 8. Kiegészítők
  const [llms, bsa] = await Promise.all([
    httpGet(`${origin}/llms.txt`, { ua: BROWSER_UA }),
    httpGet(`${origin}/BingSiteAuth.xml`, { ua: BROWSER_UA }),
  ]);
  artifacts.llmsTxt = { status: llms.status, bytes: llms.status === 200 && looksLikeText(llms) ? llms.bytes : undefined };
  artifacts.bingSiteAuth = { status: bsa.status === 200 && /<users>/i.test(bsa.body ?? '') ? 200 : bsa.status === 200 ? 0 : bsa.status };

  const facts = artifacts.facts.rendered ?? artifacts.facts.raw;
  if (facts?.og['og:image']) {
    try {
      const imgUrl = new URL(facts.og['og:image'], finalUrl).toString();
      const img = await httpGet(imgUrl, { ua: BROWSER_UA, method: 'HEAD' });
      artifacts.ogImage = { url: imgUrl, status: img.status, type: img.headers['content-type'] };
    } catch {
      artifacts.ogImage = { url: facts.og['og:image'] };
    }
  }

  if (input.modules.includes('ext-pdf') && facts?.pdfs.length) {
    artifacts.pdfHeads = await Promise.all(
      facts.pdfs.slice(0, 15).map(async (p) => {
        const h = await httpGet(p, { ua: BROWSER_UA, method: 'HEAD' });
        return { url: p, status: h.status, lastModified: h.headers['last-modified'], bytes: h.bytes };
      }),
    );
  }

  await log('info', 'Adatgyűjtés kész.');
  return { artifacts, bodies };
}

function looksLikeText(r: { headers: Record<string, string>; body?: string }) {
  return /text\/plain|markdown/i.test(r.headers['content-type'] ?? '') || !/<html/i.test(r.body?.slice(0, 500) ?? '');
}

async function readSitemap(smUrl: string, pageUrl: string): Promise<Artifacts['sitemaps'][number]> {
  const r = await httpGet(smUrl, { ua: BROWSER_UA });
  if (!r.ok || r.status !== 200 || !r.body) return { url: smUrl, status: r.status, urls: 0, containsPage: false, lastmods: [], error: r.error };
  const $ = cheerio.load(r.body, { xml: true });
  const children = $('sitemapindex > sitemap > loc').map((_, el) => $(el).text().trim()).get();
  let urls = 0;
  let containsPage = false;
  let pageLastmod: string | undefined;
  const lastmods: string[] = [];
  const scan = (xml: string) => {
    const $$ = cheerio.load(xml, { xml: true });
    $$('urlset > url').each((_, el) => {
      urls++;
      const loc = $$(el).find('loc').text().trim();
      const lm = $$(el).find('lastmod').text().trim();
      if (sameUrl(loc, pageUrl)) {
        containsPage = true;
        pageLastmod = lm || undefined;
      }
      if (lm && lastmods.length < 3000) lastmods.push(lm);
    });
  };
  if (children.length) {
    for (const child of children.slice(0, 15)) {
      const c = await httpGet(child, { ua: BROWSER_UA });
      if (c.status === 200 && c.body) scan(c.body);
      if (containsPage && urls > 500) break;
    }
  } else {
    scan(r.body);
  }
  return { url: smUrl, status: r.status, urls, containsPage, pageLastmod, lastmods, children: children.length || undefined };
}
