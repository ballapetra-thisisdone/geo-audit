// XML sitemap és sitemap index feldolgozása (gzip is). Korlátos: legfeljebb maxSitemaps fájl és maxUrls URL.
import zlib from 'node:zlib';
import * as cheerio from 'cheerio';
import { safeFetch, type NetPolicy } from '../security.ts';

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export interface SitemapResult {
  files: { url: string; status?: number; type: 'index' | 'urlset' | 'invalid' | 'error'; urls: number; error?: string }[];
  entries: SitemapEntry[];
}

export function parseSitemapXml(xml: string): { type: 'index' | 'urlset' | 'invalid'; locs: SitemapEntry[] } {
  const $ = cheerio.load(xml, { xml: true });
  if ($('sitemapindex').length) {
    return { type: 'index', locs: $('sitemap').map((_, el) => ({ loc: $(el).find('loc').first().text().trim(), lastmod: $(el).find('lastmod').first().text().trim() || undefined })).get().filter((x) => x.loc) };
  }
  if ($('urlset').length) {
    return { type: 'urlset', locs: $('url').map((_, el) => ({ loc: $(el).find('loc').first().text().trim(), lastmod: $(el).find('lastmod').first().text().trim() || undefined })).get().filter((x) => x.loc) };
  }
  return { type: 'invalid', locs: [] };
}

export async function loadSitemaps(
  seeds: string[],
  opts: { ua: string; timeoutMs: number; policy?: NetPolicy; maxSitemaps?: number; maxUrls?: number; sameSite: (u: string) => boolean },
): Promise<SitemapResult> {
  const out: SitemapResult = { files: [], entries: [] };
  const queue = [...new Set(seeds)];
  const seen = new Set<string>();
  const maxS = opts.maxSitemaps ?? 25;
  const maxU = opts.maxUrls ?? 5000;
  while (queue.length && out.files.length < maxS && out.entries.length < maxU) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    // Külső domainre mutató sitemapet nem töltünk le (domainhatár).
    if (!opts.sameSite(url)) {
      out.files.push({ url, type: 'error', urls: 0, error: 'Más domainre mutat – kihagyva' });
      continue;
    }
    const r = await safeFetch(url, { ua: opts.ua, timeoutMs: opts.timeoutMs, policy: opts.policy, accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5' });
    if (!r.ok || !r.status || r.status >= 400) {
      out.files.push({ url, status: r.status, type: 'error', urls: 0, error: r.error ?? `HTTP ${r.status}` });
      continue;
    }
    let xml = r.text ?? '';
    if (/\.gz($|\?)/i.test(url) && r.body && r.body[0] === 0x1f && r.body[1] === 0x8b) {
      try {
        xml = zlib.gunzipSync(r.body).toString('utf8');
      } catch (e) {
        out.files.push({ url, status: r.status, type: 'error', urls: 0, error: `gzip: ${(e as Error).message}` });
        continue;
      }
    }
    const parsed = parseSitemapXml(xml);
    out.files.push({ url, status: r.status, type: parsed.type, urls: parsed.locs.length });
    if (parsed.type === 'index') queue.push(...parsed.locs.map((l) => l.loc));
    else for (const e of parsed.locs) if (out.entries.length < maxU) out.entries.push(e);
  }
  return out;
}
