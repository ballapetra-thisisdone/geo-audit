// A crawl eredményéből épített webhelymodell: oldalbesorolás, linkgráf, kattintási mélység, fontosság, duplikátumok.
import type { ExtractedPage, PageClass, PageRow } from '../../../shared/site.ts';
import type { CrawlResult, CrawledPage } from '../crawl/crawler.ts';
import { normalizeUrl, hostKey } from '../crawl/url.ts';
import { hamming } from '../extract/page.ts';

export interface Edge {
  from: string;
  to: string;
  anchor: string;
  zone: string;
  nofollow: boolean;
}

export interface SiteModel {
  site: string;
  crawl: CrawlResult;
  rows: PageRow[];
  byUrl: Map<string, PageRow>;
  crawled: Map<string, CrawledPage>;
  edges: Edge[];
  /** Tartalmi elemzéshez: a renderelt változat, ha van, különben a nyers. */
  best: (url: string) => ExtractedPage | undefined;
  raw: (url: string) => ExtractedPage | undefined;
  /** Indexelhető HTML-oldalak fontosság szerint csökkenő sorrendben. */
  content: PageRow[];
  home?: PageRow;
}

export function isNoindex(e: ExtractedPage): boolean {
  return [...e.metaRobots.map((m) => m.split(':').slice(1).join(':')), ...e.xRobotsTag].some((v) => /\bnoindex\b|\bnone\b/.test(v));
}

function classify(p: CrawledPage, mode: Parameters<typeof normalizeUrl>[2]): { cls: PageClass; canonical?: string } {
  if (p.robotsBlocked) return { cls: 'blocked' };
  if (p.redirects.length && p.finalUrl && normalizeUrl(p.finalUrl, undefined, mode) !== p.url) return { cls: 'redirect' };
  if (!p.status || p.error || p.status >= 400) return { cls: 'error' };
  if (!p.extracted) return { cls: 'non_html' };
  const e = p.extracted;
  if (isNoindex(e)) return { cls: 'noindex' };
  const canon = e.canonical[0] ? normalizeUrl(e.canonical[0], p.url, mode) ?? undefined : undefined;
  if (canon && canon !== p.url) return { cls: 'canonicalized', canonical: canon };
  return { cls: 'indexable', canonical: canon };
}

export function buildModel(crawl: CrawlResult, mode: 'strip-tracking' | 'drop-all' | 'keep' = 'strip-tracking'): SiteModel {
  const crawled = new Map(crawl.pages.map((p) => [p.url, p]));
  const rows: PageRow[] = [];
  const byUrl = new Map<string, PageRow>();
  let id = 1;
  for (const p of crawl.pages) {
    const { cls, canonical } = classify(p, mode);
    const e = p.rendered?.extracted ?? p.extracted;
    const row: PageRow = {
      id: id++,
      site: crawl.site,
      url: p.url,
      finalUrl: p.finalUrl,
      status: p.status,
      error: p.error ?? p.robotsBlocked,
      depth: p.depth,
      discoveredVia: p.via,
      inSitemap: p.inSitemap,
      contentType: p.contentType,
      pageClass: cls,
      flags: [],
      title: e?.title,
      h1: e?.headings.find((h) => h.level === 1)?.text,
      metaDescription: e?.metaDescription,
      wordCount: e?.wordCount ?? 0,
      canonical,
      lang: e?.lang,
      inlinks: 0,
      outlinks: 0,
      rendered: !!p.rendered?.ok,
      ttfbMs: p.ttfbMs,
      bytes: p.bytes,
      lastModified: p.headers['last-modified'] ?? p.sitemapLastmod,
      importance: 0,
    };
    rows.push(row);
    byUrl.set(row.url, row);
  }

  // linkgráf (csak belső, létező forrásoldalakról)
  const edges: Edge[] = [];
  for (const p of crawl.pages) {
    if (!p.extracted || !p.status || p.status >= 400 || byUrl.get(p.url)?.pageClass === 'redirect') continue;
    const seenPair = new Set<string>();
    for (const l of p.extracted.links) {
      if (!l.internal) continue;
      const to = normalizeUrl(l.href, undefined, mode);
      if (!to || to === p.url) continue;
      edges.push({ from: p.url, to, anchor: l.text, zone: l.zone, nofollow: l.nofollow });
      if (seenPair.has(to)) continue;
      seenPair.add(to);
      const target = byUrl.get(to);
      if (target) target.inlinks++;
    }
    const r = byUrl.get(p.url);
    if (r) r.outlinks = seenPair.size;
  }

  // kattintási mélység (BFS a kezdőoldaltól, átirányításokon át)
  const home = byUrl.get(crawl.homeUrl) ?? rows.find((r) => r.depth === 0);
  const adj = new Map<string, string[]>();
  for (const e of edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  for (const p of crawl.pages) if (p.redirectedFrom) (adj.get(p.redirectedFrom) ?? adj.set(p.redirectedFrom, []).get(p.redirectedFrom)!).push(p.url);
  const depth = new Map<string, number>();
  if (home) {
    depth.set(home.url, 0);
    const q = [home.url];
    while (q.length) {
      const u = q.shift()!;
      for (const v of adj.get(u) ?? []) if (!depth.has(v)) {
        depth.set(v, depth.get(u)! + 1);
        q.push(v);
      }
    }
  }
  for (const r of rows) r.depth = depth.get(r.url) ?? -1;

  // fontosság: PageRank a belső linkgráfon + mélységbónusz
  const nodes = rows.filter((r) => r.pageClass === 'indexable' || r.pageClass === 'canonicalized' || r.pageClass === 'noindex');
  const idx = new Map(nodes.map((r, i) => [r.url, i]));
  const outs = nodes.map(() => new Set<number>());
  for (const e of edges) {
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) outs[a].add(b);
  }
  let pr = nodes.map(() => 1 / Math.max(1, nodes.length));
  for (let it = 0; it < 25; it++) {
    const next = nodes.map(() => (1 - 0.85) / Math.max(1, nodes.length));
    outs.forEach((o, i) => {
      if (!o.size) return nodes.forEach((_, j) => (next[j] += (0.85 * pr[i]) / nodes.length));
      for (const j of o) next[j] += (0.85 * pr[i]) / o.size;
    });
    pr = next;
  }
  const maxPr = Math.max(...pr, 1e-9);
  nodes.forEach((r, i) => {
    const depthBonus = r.depth === 0 ? 0.3 : r.depth === 1 ? 0.15 : r.depth === 2 ? 0.05 : 0;
    r.importance = Math.round(Math.min(1, (pr[i] / maxPr) * 0.7 + depthBonus) * 1000) / 1000;
  });

  // jelzők
  const indexable = rows.filter((r) => r.pageClass === 'indexable');
  const byHash = new Map<string, PageRow[]>();
  for (const r of indexable) {
    const e = crawled.get(r.url)?.extracted;
    if (!e || e.wordCount < 50) continue;
    (byHash.get(e.textHash) ?? byHash.set(e.textHash, []).get(e.textHash)!).push(r);
  }
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.importance - a.importance);
    for (const r of group.slice(1)) {
      r.flags.push('duplicate');
      r.duplicateOf = group[0].url;
    }
  }
  const cands = indexable.filter((r) => (crawled.get(r.url)?.extracted?.wordCount ?? 0) >= 100 && !r.flags.includes('duplicate'));
  for (let i = 0; i < cands.length; i++) {
    for (let k = i + 1; k < cands.length; k++) {
      const a = crawled.get(cands[i].url)!.extracted!;
      const b = crawled.get(cands[k].url)!.extracted!;
      if (hamming(a.simhash, b.simhash) <= 3) {
        const [keep, dup] = cands[i].importance >= cands[k].importance ? [cands[i], cands[k]] : [cands[k], cands[i]];
        if (!dup.flags.includes('near_duplicate')) {
          dup.flags.push('near_duplicate');
          dup.duplicateOf ??= keep.url;
        }
      }
    }
  }
  for (const r of rows) {
    const p = crawled.get(r.url)!;
    if (r.pageClass === 'indexable' && r.wordCount < 200) r.flags.push('thin');
    if (r.depth > 3) r.flags.push('deep');
    if (r.depth === -1 && r.pageClass !== 'non_html') r.flags.push('hard_to_discover');
    if (r.inSitemap && r.inlinks === 0 && r !== home && r.pageClass !== 'redirect') r.flags.push('orphan');
    if (r.pageClass === 'indexable' && r.inlinks <= 1 && r !== home) r.flags.push('low_inlinks');
    const raw = p.extracted?.wordCount ?? 0;
    const ren = p.rendered?.extracted?.wordCount;
    if (ren !== undefined && ((ren > raw * 1.5 && ren - raw > 100) || (raw < 50 && ren >= 150))) r.flags.push('js_dependent');
  }

  const content = rows.filter((r) => r.pageClass === 'indexable' && crawled.get(r.url)?.extracted).sort((a, b) => b.importance - a.importance);
  return {
    site: crawl.site,
    crawl,
    rows,
    byUrl,
    crawled,
    edges,
    best: (u) => crawled.get(u)?.rendered?.extracted ?? crawled.get(u)?.extracted,
    raw: (u) => crawled.get(u)?.extracted,
    content,
    home,
  };
}

export const hostOf = (u: string) => {
  try {
    return hostKey(new URL(u).hostname);
  } catch {
    return u;
  }
};
