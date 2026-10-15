// Webhely-crawler: robots.txt-t és Crawl-delay-t betart, sitemapből és linkekből tölti fel a sort,
// mélység- és oldalszámkorláttal, hosztonkénti sebességkorláttal, újrapróbálással.
import type { CrawlConfig, ExtractedPage } from '../../../shared/site.ts';
import { parseRobots, isAllowed, type ParsedRobots } from '../../collect/robots.ts';
import { safeFetch, type NetPolicy, type SafeResponse } from '../security.ts';
import { extractPage } from '../extract/page.ts';
import { loadSitemaps, type SitemapResult } from './sitemap.ts';
import { hostKey, isPdf, isSameSite, looksNonHtml, normalizeUrl, paginationIndex } from './url.ts';
import type { Renderer } from './render.ts';

export const CRAWLER_TOKEN = 'GEOAuditBot';
export const CRAWLER_UA = `Mozilla/5.0 (compatible; ${CRAWLER_TOKEN}/1.0; +https://thisisdone.com)`;

export interface CrawledPage {
  url: string;
  finalUrl?: string;
  status?: number;
  error?: string;
  headers: Record<string, string>;
  redirects: SafeResponse['redirects'];
  depth: number;
  via: 'seed' | 'link' | 'sitemap' | 'redirect';
  inSitemap: boolean;
  sitemapLastmod?: string;
  contentType?: string;
  robotsBlocked?: string;
  ttfbMs?: number;
  bytes?: number;
  truncated?: boolean;
  extracted?: ExtractedPage;
  rendered?: { ok: boolean; error?: string; extracted?: ExtractedPage; visibleText?: string; loadMs?: number; blockedRequests: number };
  attempts: number;
  /** Ha ez az oldal egy átirányítás célja, és a forrás URL-ről került be. */
  redirectedFrom?: string;
}

export interface CrawlResult {
  site: string;
  startUrl: string;
  homeUrl: string;
  rootHost: string;
  robots: { url: string; status?: number; text?: string; error?: string; parsed?: ParsedRobots; crawlDelay?: number };
  sitemaps: SitemapResult;
  pages: CrawledPage[];
  skipped: { url: string; reason: string }[];
  limitReached: boolean;
  renderer?: string;
  renderUnavailable?: string;
  startedAt: string;
  finishedAt: string;
}

export interface CrawlOptions {
  site: string;
  startUrl: string;
  config: CrawlConfig;
  ua?: string;
  policy?: NetPolicy;
  renderer?: Renderer;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  progress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  phase?: (p: 'robots_sitemap' | 'crawl' | 'render', state: 'start' | 'done' | 'skipped', note?: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A robots.txt Crawl-delay értéke a tokenre (vagy *) – a meglévő értelmező nem tárolja, ezért itt olvassuk ki. */
export function crawlDelayFor(text: string, token: string): number | undefined {
  let applies = false;
  let lastAgent = false;
  let specific: number | undefined;
  let star: number | undefined;
  let group: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastAgent) group = [];
      group.push(val.toLowerCase());
      lastAgent = true;
      applies = true;
      continue;
    }
    lastAgent = false;
    if (key === 'crawl-delay' && applies) {
      const n = Number(val);
      if (!Number.isFinite(n)) continue;
      if (group.some((g) => g !== '*' && token.toLowerCase().startsWith(g))) specific = n;
      else if (group.includes('*')) star = n;
    }
  }
  return specific ?? star;
}

class RateLimiter {
  private next = 0;
  constructor(private minGapMs: number) {}
  async wait() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.minGapMs;
    if (at > now) await sleep(at - now);
  }
}

async function fetchWithRetry(url: string, o: { ua: string; timeoutMs: number; retries: number; policy?: NetPolicy; limiter: RateLimiter }) {
  let attempt = 0;
  let res: SafeResponse;
  while (true) {
    await o.limiter.wait();
    res = await safeFetch(url, { ua: o.ua, timeoutMs: o.timeoutMs, policy: o.policy });
    attempt++;
    const retryable = !res.blocked && (!res.ok || res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504);
    if (!retryable || attempt > o.retries) break;
    const ra = Number(res.headers['retry-after']);
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30000) : 800 * 2 ** (attempt - 1));
  }
  return { res, attempts: attempt };
}

export async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  const cfg = opts.config;
  const ua = opts.ua ?? CRAWLER_UA;
  const log = opts.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const mode = cfg.queryParams;
  const start = normalizeUrl(opts.startUrl, undefined, mode);
  if (!start) throw new Error(`Érvénytelen kezdő URL: ${opts.startUrl}`);

  // 1. Kezdőoldal → a valódi gyökérhoszt (www / https átirányítás után)
  const first = await safeFetch(start, { ua, timeoutMs: cfg.timeoutMs, policy: opts.policy });
  if (first.blocked) throw new Error(first.error);
  const homeUrl = normalizeUrl(first.finalUrl, undefined, mode) ?? start;
  const rootHost = hostKey(new URL(homeUrl).hostname);
  const sameSite = (u: string) => isSameSite(u, rootHost, cfg.includeSubdomains);
  if (!sameSite(homeUrl)) log('warn', `A kezdő URL más domainre irányít át: ${homeUrl}`);

  // 2. robots.txt
  opts.phase?.('robots_sitemap', 'start');
  const origin = new URL(homeUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;
  const robotsRes = await safeFetch(robotsUrl, { ua, timeoutMs: cfg.timeoutMs, policy: opts.policy, accept: 'text/plain,*/*;q=0.5' });
  const robots: CrawlResult['robots'] = { url: robotsUrl, status: robotsRes.status, error: robotsRes.error };
  let parsed: ParsedRobots | undefined;
  if (robotsRes.ok && robotsRes.status && robotsRes.status < 400 && !/<html/i.test((robotsRes.text ?? '').slice(0, 500))) {
    robots.text = (robotsRes.text ?? '').slice(0, 200000);
    parsed = parseRobots(robots.text);
    robots.parsed = parsed;
    robots.crawlDelay = crawlDelayFor(robots.text, CRAWLER_TOKEN);
  }
  // RFC 9309: 5xx esetén teljes tiltásként kell kezelni; 4xx esetén minden engedélyezett.
  const robots5xx = !!robotsRes.status && robotsRes.status >= 500;
  if (robots5xx) log('warn', `robots.txt HTTP ${robotsRes.status} – az RFC 9309 szerint a crawl ilyenkor nem folytatható.`);
  const robotsCheck = (u: string): string | undefined => {
    if (robots5xx) return `robots.txt HTTP ${robotsRes.status}`;
    if (!parsed) return undefined;
    const p = new URL(u);
    const d = isAllowed(parsed, CRAWLER_TOKEN, p.pathname + p.search);
    return d.allowed ? undefined : d.rule ?? 'Disallow';
  };

  const gap = Math.max(cfg.delayMs, Math.min((robots.crawlDelay ?? 0) * 1000, 30000));
  if (robots.crawlDelay) log('info', `robots.txt Crawl-delay: ${robots.crawlDelay}s – ehhez igazodunk (max. 30 s).`);
  const limiter = new RateLimiter(gap);

  // 3. sitemapek
  const sitemapSeeds = [...(parsed?.sitemaps ?? [])];
  if (!sitemapSeeds.length) sitemapSeeds.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);
  const sitemaps = await loadSitemaps(sitemapSeeds, { ua, timeoutMs: cfg.timeoutMs, policy: opts.policy, sameSite, maxUrls: Math.max(500, cfg.maxPages * 10) });
  const sitemapMap = new Map<string, string | undefined>();
  for (const e of sitemaps.entries) {
    const n = normalizeUrl(e.loc, homeUrl, mode);
    if (n && sameSite(n)) sitemapMap.set(n, e.lastmod);
  }
  log('info', `Sitemap: ${sitemaps.files.length} fájl, ${sitemapMap.size} URL.`);
  opts.phase?.('robots_sitemap', 'done', `robots.txt: ${robots.status ?? robots.error}; sitemap: ${sitemapMap.size} URL`);
  opts.phase?.('crawl', 'start');

  // 4. bejárás
  const pages: CrawledPage[] = [];
  const byUrl = new Map<string, CrawledPage>();
  const seen = new Set<string>();
  const skipped: CrawlResult['skipped'] = [];
  const queue: { url: string; depth: number; via: CrawledPage['via'] }[] = [{ url: homeUrl, depth: 0, via: 'seed' }];
  seen.add(homeUrl);
  let limitReached = false;
  const pdfs: string[] = [];

  const enqueue = (url: string, depth: number, via: CrawledPage['via']) => {
    if (seen.has(url)) return;
    seen.add(url);
    if (!sameSite(url)) return;
    if (isPdf(url)) return void (pdfs.length < 30 && pdfs.push(url));
    if (looksNonHtml(url)) return;
    if (depth > cfg.maxDepth) return void (skipped.length < 500 && skipped.push({ url, reason: `crawl depth > ${cfg.maxDepth}` }));
    const pi = paginationIndex(url);
    if (pi !== null && pi > 5) return void (skipped.length < 500 && skipped.push({ url, reason: 'lapozás: 5. oldal utáni elemek kihagyva' }));
    queue.push({ url, depth, via });
  };

  const record = (p: CrawledPage) => {
    if (byUrl.has(p.url)) return;
    byUrl.set(p.url, p);
    pages.push(p);
  };

  const processOne = async (item: { url: string; depth: number; via: CrawledPage['via'] }) => {
    const blockedRule = robotsCheck(item.url);
    if (blockedRule) {
      record({ url: item.url, headers: {}, redirects: [], depth: item.depth, via: item.via, inSitemap: sitemapMap.has(item.url), sitemapLastmod: sitemapMap.get(item.url), robotsBlocked: blockedRule, attempts: 0 });
      return;
    }
    const { res, attempts } = await fetchWithRetry(item.url, { ua, timeoutMs: cfg.timeoutMs, retries: cfg.retries, policy: opts.policy, limiter });
    const base: CrawledPage = {
      url: item.url,
      finalUrl: res.finalUrl,
      status: res.status,
      error: res.error,
      headers: res.headers,
      redirects: res.redirects,
      depth: item.depth,
      via: item.via,
      inSitemap: sitemapMap.has(item.url),
      sitemapLastmod: sitemapMap.get(item.url),
      contentType: res.headers['content-type'],
      ttfbMs: res.ttfbMs,
      bytes: res.bytes,
      truncated: res.truncated,
      attempts,
    };
    const finalNorm = res.finalUrl ? normalizeUrl(res.finalUrl, undefined, mode) : undefined;
    if (res.redirects.length && finalNorm && finalNorm !== item.url) {
      // Az eredeti URL átirányításként kerül be; a célt egyszer, a már letöltött törzzsel rögzítjük.
      record({ ...base, contentType: undefined, bytes: undefined });
      if (!sameSite(finalNorm) || byUrl.has(finalNorm)) return;
      seen.add(finalNorm);
      base.url = finalNorm;
      base.via = 'redirect';
      base.redirects = [];
      base.redirectedFrom = item.url;
      base.inSitemap = sitemapMap.has(finalNorm);
      base.sitemapLastmod = sitemapMap.get(finalNorm);
      const rb = robotsCheck(finalNorm);
      if (rb) return record({ ...base, robotsBlocked: rb, contentType: undefined });
    }
    const ct = (res.headers['content-type'] ?? '').toLowerCase();
    if (res.ok && res.text !== undefined && (ct.includes('html') || (!ct && /<html/i.test(res.text.slice(0, 1000))))) {
      base.extracted = extractPage(res.text, base.url, res.headers);
      if (res.status && res.status < 400) {
        for (const l of base.extracted.links) {
          if (!l.internal) continue;
          const n = normalizeUrl(l.href, undefined, mode);
          if (n) enqueue(n, item.depth + 1, 'link');
        }
      }
    }
    record(base);
  };

  const running = new Set<Promise<void>>();
  let sitemapPhase = false;
  while (true) {
    if (opts.signal?.aborted) throw new Error('A crawl megszakítva.');
    while (queue.length && running.size < cfg.concurrency && pages.length + running.size < cfg.maxPages) {
      // mélység szerinti sorrend (BFS): a legkisebb mélységű elem előbb
      queue.sort((a, b) => a.depth - b.depth);
      const item = queue.shift()!;
      const p = processOne(item)
        .catch((e) => log('error', `${item.url}: ${(e as Error).message}`))
        .finally(() => {
          running.delete(p);
          opts.progress?.(pages.length, Math.min(cfg.maxPages, pages.length + queue.length + running.size));
        });
      running.add(p);
    }
    if (pages.length + running.size >= cfg.maxPages && queue.length) limitReached = true;
    if (!running.size) {
      // A linkekből el nem ért sitemap-URL-ek (nehezen felfedezhető / orphan jelöltek)
      if (!sitemapPhase && pages.length < cfg.maxPages) {
        sitemapPhase = true;
        for (const u of sitemapMap.keys()) enqueue(u, cfg.maxDepth, 'sitemap');
        if (queue.length) continue;
      }
      break;
    }
    await Promise.race(running);
  }
  if (queue.length) {
    limitReached = true;
    for (const q of queue.slice(0, 300)) skipped.push({ url: q.url, reason: `oldalszámkorlát (${cfg.maxPages})` });
  }

  // PDF-ek: csak fejléc (HEAD), legfeljebb 30
  for (const u of pdfs) {
    if (robotsCheck(u)) continue;
    await limiter.wait();
    const r = await safeFetch(u, { ua, timeoutMs: cfg.timeoutMs, policy: opts.policy, method: 'HEAD' });
    record({ url: u, finalUrl: r.finalUrl, status: r.status, error: r.error, headers: r.headers, redirects: r.redirects, depth: -1, via: 'link', inSitemap: sitemapMap.has(u), contentType: r.headers['content-type'] ?? 'application/pdf', bytes: Number(r.headers['content-length'] ?? 0) || undefined, attempts: 1 });
  }

  opts.phase?.('crawl', 'done', `${pages.length} URL${limitReached ? ' (oldalkorlát elérve)' : ''}`);
  // 5. renderelés
  let renderer: string | undefined;
  let renderUnavailable: string | undefined;
  if (!opts.renderer || cfg.render === 'off') opts.phase?.('render', 'skipped', 'A renderelés ki van kapcsolva.');
  if (opts.renderer && cfg.render !== 'off') {
    opts.phase?.('render', 'start');
    const html = pages.filter((p) => p.extracted && p.status && p.status < 400);
    const inlinkCount = new Map<string, number>();
    for (const p of html) for (const l of p.extracted!.links) if (l.internal) {
      const n = normalizeUrl(l.href, undefined, mode);
      if (n) inlinkCount.set(n, (inlinkCount.get(n) ?? 0) + 1);
    }
    const suspicious = (p: CrawledPage) => p.extracted!.wordCount < 80 && p.extracted!.scripts > 3;
    let candidates: CrawledPage[];
    if (cfg.render === 'all') candidates = html;
    else {
      const ranked = [...html].sort((a, b) => (inlinkCount.get(b.url) ?? 0) - (inlinkCount.get(a.url) ?? 0) || a.depth - b.depth);
      candidates = [...new Set([...html.filter((p) => p.depth === 0), ...html.filter(suspicious), ...ranked])];
    }
    candidates = candidates.slice(0, cfg.renderMax);
    let i = 0;
    for (const p of candidates) {
      if (opts.signal?.aborted) break;
      await limiter.wait();
      const r = await opts.renderer.render(p.url, cfg.timeoutMs);
      if (!r.ok && opts.renderer.unavailable) {
        renderUnavailable = opts.renderer.unavailable;
        log('warn', `Renderelés nem elérhető: ${renderUnavailable}`);
        break;
      }
      p.rendered = { ok: r.ok, error: r.error, loadMs: r.loadMs, blockedRequests: r.blockedRequests, visibleText: r.visibleText, extracted: r.ok && r.html ? extractPage(r.html, p.url, p.headers) : undefined };
      opts.progress?.(++i, candidates.length);
    }
    renderer = opts.renderer.engineName || undefined;
    opts.phase?.('render', renderUnavailable ? 'skipped' : 'done', renderUnavailable ?? `renderelt oldalak: ${i}`);
  }

  return { site: opts.site, startUrl: start, homeUrl, rootHost, robots, sitemaps, pages, skipped, limitReached, renderer, renderUnavailable, startedAt, finishedAt: new Date().toISOString() };
}
