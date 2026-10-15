// AI/search visibility mérés: QUERY → AI RESPONSE → MENTION / CITATION → SOURCE URL → DOMAIN → (TOPIC, COMPETITOR).
// Csak a ténylegesen visszakapott válaszokból számolunk. A Share of Voice nevezője dokumentált.
import type { AIResponseRow, PlatformStatus, QueryRow, VisibilityMetric, VisibilitySummary } from '../../../shared/site.ts';
import { hostKey } from '../crawl/url.ts';
import { truncate } from '../analyze/text.ts';
import { platformStatuses, type PlatformAdapter } from './adapters.ts';

const GENERIC_DOMAINS = /(^|\.)(wikipedia\.org|wikidata\.org|youtube\.com|facebook\.com|instagram\.com|linkedin\.com|reddit\.com|x\.com|twitter\.com|tiktok\.com|pinterest\.com|quora\.com|medium\.com|google\.com|bing\.com|apple\.com|amazon\.[a-z.]+)$/;

export const domainOfUrl = (u: string) => {
  try {
    return hostKey(new URL(u).hostname);
  } catch {
    return '';
  }
};

export interface TrackedDomain {
  domain: string;
  names: string[]; // márkanév-változatok a mention-felismeréshez
  isOwn: boolean;
}

/** Említés: a domain vagy egy márkanév szóhatáron szerepel a válasz szövegében. */
export function findMentions(text: string, tracked: TrackedDomain[]): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const d of tracked) {
    const needles = [d.domain, ...d.names.filter((n) => n.length >= 3)].map((n) => n.toLowerCase());
    if (needles.some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(t))) out.push(d.domain);
  }
  return out;
}

export interface VisibilityRunResult {
  responses: AIResponseRow[];
  summary: VisibilitySummary;
  suggestedCompetitors: { domain: string; kind: 'ai_search' | 'serp'; queries: number; urls: string[] }[];
}

export async function runVisibility(opts: {
  adapters: PlatformAdapter[];
  selected: string[];
  queries: QueryRow[];
  maxQueries: number;
  tracked: TrackedDomain[];
  country?: string;
  language?: string;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  progress?: (done: number, total: number) => void;
}): Promise<VisibilityRunResult> {
  const statuses: PlatformStatus[] = platformStatuses(opts.adapters, opts.selected);
  const active = opts.adapters.filter((a) => statuses.find((s) => s.id === a.id)?.status === 'used');
  const qs = [...opts.queries].sort((a, b) => b.weight - a.weight).slice(0, opts.maxQueries);
  const responses: AIResponseRow[] = [];
  const total = active.length * qs.length;
  let done = 0;
  for (const a of active) {
    let failures = 0;
    for (const q of qs) {
      const at = new Date().toISOString();
      try {
        const r = await a.query(q.text, { country: opts.country, language: opts.language });
        const cites = r.citations.map((c) => ({ url: c.url, domain: domainOfUrl(c.url), title: c.title })).filter((c) => c.domain);
        // SERP-nél a találati lista = "megjelenés"; AI-nál a forráslista nem idézet, csak ha inline citation nincs, akkor jelöljük forrásként
        responses.push({
          id: `${a.id}:${q.id}`,
          queryId: q.id,
          query: q.text,
          platform: a.id,
          at,
          excerpt: truncate(r.text, 1500),
          mentions: findMentions(r.text, opts.tracked),
          citations: cites,
          method: a.method + (r.model ? ` (${r.model})` : ''),
          confidence: a.kind === 'serp' ? 0.95 : 0.9,
          source: 'external',
        });
      } catch (e) {
        failures++;
        responses.push({ id: `${a.id}:${q.id}`, queryId: q.id, query: q.text, platform: a.id, at, excerpt: '', mentions: [], citations: [], method: a.method, confidence: 0, source: 'external', error: (e as Error).message.slice(0, 300) });
        opts.log?.('warn', `${a.name} – „${q.text}”: ${(e as Error).message.slice(0, 200)}`);
        if (failures >= 3 && failures === responses.filter((x) => x.platform === a.id).length) {
          const st = statuses.find((s) => s.id === a.id)!;
          st.status = 'failed';
          st.note = `Az első 3 kérés sikertelen: ${(e as Error).message.slice(0, 160)}`;
          opts.log?.('error', `${a.name}: leállítva 3 egymást követő hiba után.`);
          done += qs.length - responses.filter((x) => x.platform === a.id).length;
          break;
        }
      }
      opts.progress?.(++done, total);
    }
  }
  const ok = responses.filter((r) => !r.error);
  const metrics = computeMetrics(ok, opts.tracked);
  const state: VisibilitySummary['state'] = !active.length ? 'not_configured' : !ok.length ? (responses.length ? 'failed' : 'no_data') : 'measured';
  const suggested = suggestCompetitors(ok, opts.tracked, opts.adapters);
  return {
    responses,
    suggestedCompetitors: suggested,
    summary: {
      measured: state === 'measured',
      state,
      platforms: statuses,
      queryCount: qs.length,
      responseCount: ok.length,
      metrics,
      methodology: [
        `Minta: a ${qs.length} legnagyobb üzleti súlyú kérdés (a generált kérdések hipotézisek), platformonként egy lekérdezés, egyetlen időpontban (pillanatfelvétel).`,
        `Platformok: ${active.map((a) => a.name).join(', ') || 'nincs konfigurált platform'}.`,
        'MENTION: a domain vagy egy márkanév-változat szóhatáron szerepel a válasz szövegében. CITATION: a szolgáltató által visszaadott, ellenőrizhető forráshivatkozás (URL) a domainre. SERP esetén a top 10 találat számít megjelenésnek.',
        'Mention share = a domain említéseinek száma / az összes követett domain (saját + key competitorok) említéseinek száma. Citation share = ugyanez citationökre. A kettőt nem vonjuk össze.',
        'Az AI-válaszok nem determinisztikusak, és helytől, időtől, fióktól függhetnek: az eredmény egy minta, nem általános rangsor.',
      ].join(' '),
    },
  };
}

export function computeMetrics(ok: AIResponseRow[], tracked: TrackedDomain[]): VisibilityMetric[] {
  const totalMentions = ok.reduce((s, r) => s + r.mentions.filter((m) => tracked.some((t) => t.domain === m)).length, 0);
  const citedTracked = (r: AIResponseRow, d: string) => r.citations.some((c) => c.domain === d || c.domain.endsWith('.' + d));
  const totalCitations = ok.reduce((s, r) => s + tracked.filter((t) => citedTracked(r, t.domain)).length, 0);
  return tracked.map((t) => {
    const mentions = ok.filter((r) => r.mentions.includes(t.domain)).length;
    const citations = ok.filter((r) => citedTracked(r, t.domain)).length;
    return {
      domain: t.domain,
      isOwn: t.isOwn,
      mentions,
      citations,
      queriesWithMention: new Set(ok.filter((r) => r.mentions.includes(t.domain)).map((r) => r.queryId)).size,
      queriesWithCitation: new Set(ok.filter((r) => citedTracked(r, t.domain)).map((r) => r.queryId)).size,
      mentionShare: totalMentions ? Math.round((mentions / totalMentions) * 1000) / 10 : null,
      citationShare: totalCitations ? Math.round((citations / totalCitations) * 1000) / 10 : null,
    };
  });
}

function suggestCompetitors(ok: AIResponseRow[], tracked: TrackedDomain[], adapters: PlatformAdapter[]) {
  const kindOf = (p: string) => (adapters.find((a) => a.id === p)?.kind === 'serp' ? 'serp' : 'ai_search') as 'serp' | 'ai_search';
  const m = new Map<string, { kind: 'ai_search' | 'serp'; queries: Set<string>; urls: Set<string> }>();
  for (const r of ok) {
    for (const c of r.citations) {
      if (!c.domain || GENERIC_DOMAINS.test(c.domain) || tracked.some((t) => c.domain === t.domain || c.domain.endsWith('.' + t.domain))) continue;
      const cur = m.get(c.domain) ?? { kind: kindOf(r.platform), queries: new Set(), urls: new Set() };
      cur.queries.add(r.queryId);
      if (cur.urls.size < 5) cur.urls.add(c.url);
      m.set(c.domain, cur);
    }
  }
  return [...m.entries()]
    .filter(([, v]) => v.queries.size >= 2)
    .map(([domain, v]) => ({ domain, kind: v.kind, queries: v.queries.size, urls: [...v.urls] }))
    .sort((a, b) => b.queries - a.queries)
    .slice(0, 10);
}
