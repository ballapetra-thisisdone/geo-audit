// Query-generálás (hipotézis!), deduplikálás, klaszterezés, súlyozás és megválaszolhatósági elemzés.
// A lefedettséget szakasz-szintű BM25 kereséssel mérjük; minden eredményhez URL és szövegrészlet tartozik.
import type { BusinessContext, Coverage, QueryRow, QueryType, SiteAuditInput, TopicRow } from '../../../shared/site.ts';
import type { SiteModel } from './model.ts';
import { Bm25, tokens, truncate } from './text.ts';
import { IssueCollector, type IssueDef } from './issues.ts';

interface Seed {
  label: string;
  kind: 'offering' | 'topic' | 'user';
  weight: number;
}

type Tpl = [QueryType, string, number];
const TPL: Record<'hu' | 'en', { offering: Tpl[]; topic: Tpl[]; brand: Tpl[]; local: Tpl[] }> = {
  hu: {
    offering: [
      ['definitional', '{x}: mit jelent, mit tartalmaz?', 0.6],
      ['how_to', '{x}: hogyan működik, milyen lépésekből áll?', 0.7],
      ['informational', '{x}: kinek ajánlott?', 0.65],
      ['commercial', '{x}: mennyibe kerül?', 0.95],
      ['commercial', '{x}: mire figyeljek a szolgáltató kiválasztásánál?', 0.8],
      ['transactional', '{x}: ajánlatkérés vagy időpontfoglalás', 0.9],
      ['problem_solving', '{x}: milyen problémára jelent megoldást?', 0.7],
      ['expert', '{x}: milyen szakértelem, képesítés szükséges hozzá?', 0.6],
      ['comparison', '{x}: milyen alternatívái vannak, és miben különböznek?', 0.75],
    ],
    topic: [
      ['definitional', '{x}: mit jelent?', 0.55],
      ['informational', '{x}: mit érdemes tudni róla?', 0.5],
      ['how_to', '{x}: hogyan kezdjek hozzá?', 0.55],
      ['problem_solving', '{x}: melyek a leggyakoribb hibák, problémák?', 0.55],
    ],
    brand: [
      ['navigational', '{b}: elérhetőség, cím, nyitvatartás', 0.5],
      ['navigational', '{b}: vélemények, tapasztalatok', 0.6],
      ['informational', '{b}: mivel foglalkozik?', 0.55],
    ],
    local: [['local', '{x} {l}', 0.85]],
  },
  en: {
    offering: [
      ['definitional', 'What is {x}?', 0.6],
      ['how_to', 'How does {x} work?', 0.7],
      ['informational', 'Who is {x} for?', 0.65],
      ['commercial', 'How much does {x} cost?', 0.95],
      ['commercial', 'How to choose a {x} provider?', 0.8],
      ['transactional', '{x} quote or booking', 0.9],
      ['problem_solving', 'What problems does {x} solve?', 0.7],
      ['expert', 'What qualifications are needed for {x}?', 0.6],
      ['comparison', '{x} alternatives and differences', 0.75],
    ],
    topic: [
      ['definitional', 'What does {x} mean?', 0.55],
      ['informational', 'What should I know about {x}?', 0.5],
      ['how_to', 'How to get started with {x}?', 0.55],
      ['problem_solving', 'Common {x} problems and mistakes', 0.55],
    ],
    brand: [
      ['navigational', '{b} contact, address, opening hours', 0.5],
      ['navigational', '{b} reviews', 0.6],
      ['informational', 'What does {b} do?', 0.55],
    ],
    local: [['local', '{x} in {l}', 0.85]],
  },
};

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'x';
const normQ = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function generateQueries(ctx: BusinessContext, input: SiteAuditInput, max = 90): QueryRow[] {
  const lang: 'hu' | 'en' = ctx.language.value === 'en' ? 'en' : 'hu';
  const t = TPL[lang];
  const brand = ctx.organization.value;
  const loc = ctx.geo.value.find((g) => !g.endsWith('TLD') && g.length > 2);
  const seeds: Seed[] = [
    ...ctx.offerings.value.slice(0, 8).map((label) => ({ label, kind: 'offering' as const, weight: 1 })),
    ...ctx.topics.value
      .filter((x) => !ctx.offerings.value.some((o) => o.toLowerCase().includes(x.toLowerCase()) || x.toLowerCase().includes(o.toLowerCase())))
      .slice(0, 8)
      .map((label) => ({ label, kind: 'topic' as const, weight: input.topics.includes(label) ? 0.9 : 0.6 })),
  ];
  const out: QueryRow[] = [];
  const seen = new Set<string>();
  const push = (text: string, type: QueryType, seed: Seed | null, w: number, origin: QueryRow['origin'], branded: boolean) => {
    const k = normQ(text);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const topic = seed?.label ?? (brand ?? 'márka');
    out.push({
      id: `q${out.length + 1}`,
      text,
      type,
      branded,
      topic,
      cluster: slug(topic),
      weight: Math.round(w * 100) / 100,
      origin,
      hypothesis: origin !== 'user',
      coverage: 'missing',
      matchScore: 0,
      hasEvidence: false,
      specificity: 'low',
      action: 'new_content',
      judgedBy: 'lexical',
      competitors: [],
    });
  };
  for (const q of input.queries) push(q, guessType(q), null, 1.2, 'user', !!brand && q.toLowerCase().includes(brand.toLowerCase()));
  for (const s of seeds) {
    const tpls = s.kind === 'offering' ? t.offering : t.topic;
    for (const [type, tpl, w] of tpls) push(tpl.replace('{x}', s.label), type, s, w * s.weight, 'generated', false);
    if (loc && s.kind === 'offering') for (const [type, tpl, w] of t.local) push(tpl.replace('{x}', s.label).replace('{l}', loc), type, s, w * s.weight, 'generated', false);
  }
  if (brand) {
    for (const [type, tpl, w] of t.brand) push(tpl.replace('{b}', brand), type, null, w, 'generated', true);
    for (const s of seeds.filter((s) => s.kind === 'offering').slice(0, 3)) push(`${brand} ${s.label}`, 'commercial', s, 0.7, 'generated', true);
  }
  // üzleti relevancia szerint, a felhasználói kérdések elöl
  return out.sort((a, b) => (b.origin === 'user' ? 1 : 0) - (a.origin === 'user' ? 1 : 0) || b.weight - a.weight).slice(0, max).map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

export function guessType(q: string): QueryType {
  const s = q.toLowerCase();
  if (/mennyibe|ár\b|árak|price|cost|olcsó/.test(s)) return 'commercial';
  if (/foglal|rendel|vásárol|ajánlatkér|book|buy|order|quote/.test(s)) return 'transactional';
  if (/hogyan|how to|how do|lépés/.test(s)) return 'how_to';
  if (/mi az|mit jelent|what is|what does|meaning/.test(s)) return 'definitional';
  if (/\bvs\b|vagy|különbség|összehasonlít|compare|difference|alternatív/.test(s)) return 'comparison';
  if (/elérhetőség|cím|nyitva|contact|login|belépés/.test(s)) return 'navigational';
  if (/probléma|hiba|nem működik|mit tegyek|problem|fix|error/.test(s)) return 'problem_solving';
  if (/budapest|debrecen|szeged|pécs|győr|közel|near me|\bin [A-Z]/i.test(s)) return 'local';
  return 'informational';
}

export interface PassageRef {
  url: string;
  pageTitle: string;
  /** Teaser/kártya: a szakasz címsora egy MÁSIK belső oldalra mutató link szövege (blogösszesítő, kapcsolódó szolgáltatások). Nem adhat teljes választ. */
  listing: boolean;
  heading: string;
  text: string;
  numbers: boolean;
  definition: boolean;
}

export function buildPassageIndex(m: SiteModel, lang: string | null): Bm25<PassageRef> {
  const passages: PassageRef[] = [];
  // Sablonszakaszok (pl. "további szolgáltatások" kártyák) több oldalon szó szerint ismétlődnek: ezek nem az adott
  // oldal válaszai, és rossz URL-hez kötnék a kérdést. 3+ oldalon ismétlődő szakasz kimarad, 2 oldalon csak egyszer szerepel.
  const key = (p: { heading: string; text: string }) => `${p.heading}|${p.text.slice(0, 200)}`.toLowerCase();
  const freq = new Map<string, number>();
  for (const r of m.content) for (const k of new Set(m.best(r.url)!.passages.map(key))) freq.set(k, (freq.get(k) ?? 0) + 1);
  const used = new Set<string>();
  for (const r of m.content) {
    const e = m.best(r.url)!;
    const linkedElsewhere = new Set(e.links.filter((l) => l.internal && l.text && !l.href.startsWith(r.url.replace(/\/$/, '') + '#') && l.href.replace(/[#?].*$/, '') !== r.url).map((l) => l.text.trim().toLowerCase()));
    for (const p of e.passages) {
      if (p.text.split(/\s+/).length < 6) continue;
      const k = key(p);
      if ((freq.get(k) ?? 0) >= 3 && m.content.length >= 4) continue;
      if (used.has(k)) continue;
      used.add(k);
      passages.push({
        url: r.url,
        listing: !!p.heading && linkedElsewhere.has(p.heading.trim().toLowerCase()),
        pageTitle: `${e.headings.find((h) => h.level === 1)?.text ?? ''} ${e.title ?? ''}`,
        heading: p.heading || e.headings.find((h) => h.level === 1)?.text || e.title || '',
        text: p.text,
        numbers: /\d/.test(p.text) && /(%|Ft|HUF|EUR|€|\$|perc|óra|nap|hét|hónap|év|db|\d{2,})/.test(p.text),
        definition: e.definitions.some((d) => p.text.includes(d.slice(0, 40))),
      });
    }
  }
  return new Bm25(passages, (p) => `${p.heading} ${p.heading} ${p.text}`, lang);
}

export interface AnswerResult {
  coverage: Coverage;
  url?: string;
  snippet?: string;
  score: number;
  hasEvidence: boolean;
  specificity: QueryRow['specificity'];
}

/** Egy kérdés lefedettsége egy webhelyen (lexikai heurisztika; a bizonyosság közepes). */
export function answerQuery(index: Bm25<PassageRef>, q: Pick<QueryRow, 'text' | 'type' | 'topic'> & { branded?: boolean }, lang: string | null, brandTerms: Set<string> = new Set()): AnswerResult {
  // márkázott kérdésnél a téma maga a márka – a márkanév egyezését nem követeljük meg a szakaszban
  const topicTerms = new Set(tokens(q.topic, lang).filter((t) => !(q.branded && brandTerms.has(t))));
  const hits = index.search(q.text, 6);
  if (!hits.length) return { coverage: 'missing', score: 0, hasEvidence: false, specificity: 'low' };
  // újrarangsorolás: előnyt kap az az oldal, amelynek címe/H1-e maga a téma (a más oldalakon lévő kártyák helyett)
  const pageFocus = (h: (typeof hits)[number]) => {
    const pt = new Set(tokens(h.item.pageTitle, lang));
    return (topicTerms.size && [...topicTerms].every((t) => pt.has(t)) ? 1.5 : 1) * (h.item.listing ? 0.6 : 1);
  };
  const top = [...hits].sort((a, b) => b.score * pageFocus(b) - a.score * pageFocus(a))[0];
  const terms = top.terms.filter((t) => !brandTerms.has(t));
  const covered = terms.length ? top.matched.filter((t) => !brandTerms.has(t)).length / terms.length : 0;
  const topicCovered = topicTerms.size ? [...topicTerms].filter((t) => top.matched.includes(t)).length / topicTerms.size : 1;
  const words = top.item.text.split(/\s+/).length;
  // szándékspecifikus feltétel a teljes válaszhoz (egy évszám nem ár, egy teaser nem ajánlatkérés)
  const intentOk =
    q.type === 'commercial' && /mennyibe|\bár\b|árak|cost|price/i.test(q.text)
      ? /\d[\d\s.]*\s?(Ft|HUF|forint|EUR|€|\$|USD)|\bár(a|ak)?\b[^.]{0,40}\d/i.test(top.item.text)
      : q.type === 'transactional'
        ? /ajánlat|kapcsolat|foglal|időpont|űrlap|jelentkez|rendel|quote|book|contact|form|order/i.test(top.item.text)
        : q.type === 'local'
          ? top.terms.filter((t) => !topicTerms.has(t)).every((t) => top.matched.includes(t))
          : true;
  // teljes válasz csak olyan szakaszban lehet, amelynek címsora (vagy oldala) ténylegesen a témáról szól –
  // egy összesítő/teaser bekezdés, amely csak említi a témát, legfeljebb részleges
  const headTokens = new Set(tokens(`${top.item.heading} ${top.item.pageTitle}`, lang));
  const focused = !topicTerms.size || [...topicTerms].every((t) => headTokens.has(t));
  let coverage: Coverage = 'missing';
  if (focused && intentOk && !top.item.listing && topicCovered >= 0.99 && covered >= 0.6 && words >= 25) coverage = 'full';
  else if (topicCovered >= 0.5 && covered >= 0.4) coverage = 'partial';
  const specificity: QueryRow['specificity'] = top.item.numbers || top.item.definition ? 'high' : words >= 40 ? 'medium' : 'low';
  return {
    coverage,
    url: top.item.url,
    snippet: truncate(`${top.item.heading ? top.item.heading + ' — ' : ''}${top.item.text}`, 320),
    score: Math.round(top.score * 100) / 100,
    hasEvidence: top.item.numbers,
    specificity,
  };
}

/** Lehetséges ellentmondások: ugyanarra a kínálati elemre több eltérő ár különböző oldalakon. */
export function priceContradictions(m: SiteModel, offerings: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const PRICE = /(\d{1,3}(?:[ . ]\d{3})+|\d{4,})\s?(?:Ft|HUF|forint)/gi;
  for (const o of offerings.slice(0, 12)) {
    const found = new Map<string, Set<string>>();
    for (const r of m.content) {
      for (const p of m.best(r.url)!.passages) {
        if (!p.text.toLowerCase().includes(o.toLowerCase())) continue;
        for (const mm of p.text.matchAll(PRICE)) {
          const v = mm[1].replace(/[ . ]/g, '');
          (found.get(v) ?? found.set(v, new Set()).get(v)!).add(r.url);
        }
      }
    }
    const urls = new Set([...found.values()].flatMap((s) => [...s]));
    if (found.size > 1 && urls.size > 1) out.set(o, `Eltérő árak a(z) „${o}” kapcsán: ${[...found.entries()].slice(0, 4).map(([v, u]) => `${Number(v).toLocaleString('hu-HU')} Ft (${[...u][0]})`).join('; ')} – ellenőrizd, hogy nem ellentmondás-e (lehet több csomag is).`);
  }
  return out;
}

export function answerability(m: SiteModel, ctx: BusinessContext, queries: QueryRow[]): { queries: QueryRow[]; acs: number | null } {
  const lang = ctx.language.value;
  const index = buildPassageIndex(m, lang);
  const brandTerms = new Set(tokens(ctx.organization.value ?? '', lang));
  const contradictions = priceContradictions(m, ctx.offerings.value);
  for (const q of queries) {
    const r = answerQuery(index, q, lang, brandTerms);
    q.coverage = r.coverage;
    q.bestUrl = r.url;
    q.snippet = r.snippet;
    q.matchScore = r.score;
    q.hasEvidence = r.hasEvidence;
    q.specificity = r.specificity;
    q.contradiction = contradictions.get(q.topic);
    q.action = r.coverage === 'full' ? (q.contradiction ? 'improve' : 'none') : r.coverage === 'partial' ? 'improve' : r.url && r.score > 2 ? 'improve' : 'new_content';
  }
  return { queries, acs: coverageScore(queries) };
}

export function coverageScore(queries: { coverage: Coverage; weight: number }[]): number | null {
  const total = queries.reduce((s, q) => s + q.weight, 0);
  if (!total) return null;
  const got = queries.reduce((s, q) => s + q.weight * (q.coverage === 'full' ? 1 : q.coverage === 'partial' ? 0.5 : 0), 0);
  return Math.round((got / total) * 100);
}

/** Versenytárs lefedettsége ugyanarra a kérdéskészletre (azonos módszerrel). */
export function competitorAnswerability(cm: SiteModel, domain: string, queries: QueryRow[], lang: string | null) {
  const index = buildPassageIndex(cm, lang);
  for (const q of queries) {
    const r = answerQuery(index, q, lang);
    q.competitors = q.competitors.filter((c) => c.domain !== domain);
    q.competitors.push({ domain, coverage: r.coverage, url: r.url });
  }
}

const D = (x: IssueDef) => x;
const QI: Record<string, IssueDef> = {
  unanswered_high_value: D({ category: 'answerability', title: 'Üzletileg fontos kérdésekre nincs (teljes) válasz a webhelyen', why: 'Ha a webhely nem ad egyértelmű, teljes választ a célközönség kérdéseire, a válaszrendszerek más forrásokat használnak.', fix: 'A meglévő releváns oldalt egészítsd ki egy, a kérdést címsorban megfogalmazó és azonnal megválaszoló szakasszal, vagy készíts új tartalmat (content brief a javaslatoknál).', acceptance: 'A felsorolt kérdések mindegyikére van egy oldal, ahol a kérdés H2/H3-ban szerepel, és 40–80 szavas közvetlen válasz követi.', impact: 4, effort: 'M', owner: 'content', evidenceKind: 'estimate', confidence: 0.5, business: 1.2 }),
  contradiction: D({ category: 'answerability', title: 'Lehetséges ellentmondó információ (pl. eltérő árak)', why: 'Az egymásnak ellentmondó adatok miatt a gépi rendszerek nem tudják eldönteni, melyik a helyes, és a felhasználó is bizonytalanná válik.', fix: 'Egységesítsd az adatot, vagy tedd egyértelművé, mire vonatkozik az egyes érték (pl. csomagonként).', acceptance: 'Az adat minden oldalon egységes vagy egyértelműen megkülönböztetett.', impact: 3, effort: 'S', owner: 'content', evidenceKind: 'observed', confidence: 0.5 }),
};

export function queryIssues(site: string, queries: QueryRow[]): IssueCollector {
  const ic = new IssueCollector(site);
  const important = queries.filter((q) => q.weight >= 0.75 && q.coverage !== 'full');
  if (important.length) ic.add('unanswered_high_value', QI.unanswered_high_value, important.slice(0, 40).map((q) => ({ url: q.bestUrl, detail: `[${q.coverage === 'missing' ? 'hiányzó' : 'részleges'}] ${q.text}${q.hypothesis ? ' (generált hipotézis)' : ''}` })));
  const seen = new Set<string>();
  for (const q of queries.filter((q) => q.contradiction)) {
    if (seen.has(q.contradiction!)) continue;
    seen.add(q.contradiction!);
    ic.add('contradiction', QI.contradiction, { url: q.bestUrl, detail: q.contradiction! });
  }
  return ic;
}

/** Topic Coverage Matrix: téma → saját URL-ek → lefedettség → hiány → versenytárs lefedettség → javaslat. */
export function topicMatrix(m: SiteModel, ctx: BusinessContext, queries: QueryRow[], competitorDomains: string[]): TopicRow[] {
  const lang = ctx.language.value;
  const byCluster = new Map<string, QueryRow[]>();
  for (const q of queries) (byCluster.get(q.cluster) ?? byCluster.set(q.cluster, []).get(q.cluster)!).push(q);
  const rows: TopicRow[] = [];
  for (const [id, qs] of byCluster) {
    const label = qs[0].topic;
    const terms = [...new Set(tokens(label, lang))];
    const ownUrls = [...new Set([
      ...m.content.filter((r) => {
        const e = m.best(r.url)!;
        const hay = tokens(`${e.title} ${e.headings.filter((h) => h.level <= 2).map((h) => h.text).join(' ')}`, lang);
        return terms.length && terms.every((t) => hay.includes(t));
      }).map((r) => r.url),
      ...qs.filter((q) => q.coverage !== 'missing' && q.bestUrl).map((q) => q.bestUrl!),
    ])].slice(0, 15);
    const s = coverageScore(qs) ?? 0;
    const coverage: Coverage = s >= 70 ? 'full' : s >= 35 ? 'partial' : 'missing';
    const depthWords = ownUrls.reduce((sum, u) => sum + (m.byUrl.get(u)?.wordCount ?? 0), 0);
    const missingQueries = qs.filter((q) => q.coverage !== 'full').map((q) => q.text);
    const competitorCoverage = competitorDomains.map((d) => {
      const cs = qs.map((q) => ({ weight: q.weight, coverage: q.competitors.find((c) => c.domain === d)?.coverage ?? ('missing' as Coverage), url: q.competitors.find((c) => c.domain === d)?.url }));
      const cscore = coverageScore(cs) ?? 0;
      return { domain: d, coverage: (cscore >= 70 ? 'full' : cscore >= 35 ? 'partial' : 'missing') as Coverage, urls: [...new Set(cs.map((c) => c.url).filter((u): u is string => !!u))].slice(0, 5) };
    });
    const stronger = competitorCoverage.filter((c) => rank(c.coverage) > rank(coverage)).map((c) => c.domain);
    const recommendation =
      coverage === 'full'
        ? stronger.length ? `Jó lefedettség; a(z) ${stronger.join(', ')} ennél is teljesebb – vizsgáld meg a válaszaik szerkezetét.` : 'Jó lefedettség – tartsd frissen, és erősítsd bizonyítékokkal (adatok, források).'
        : coverage === 'partial'
          ? `Bővítsd a meglévő oldal(ak)at a hiányzó kérdésekre adott közvetlen válaszokkal${ownUrls[0] ? ` (kiindulás: ${ownUrls[0]})` : ''}.`
          : `Nincs érdemi tartalom a témában – új, a kérdésekre felépített tartalom javasolt${stronger.length ? ` (a(z) ${stronger.join(', ')} lefedi)` : ''}.`;
    rows.push({ id, label, terms, ownUrls, coverage, depthWords, queryCount: qs.length, missingQueries, competitorCoverage, recommendation });
  }
  return rows.sort((a, b) => rank(a.coverage) - rank(b.coverage));
}

const rank = (c: Coverage) => (c === 'full' ? 2 : c === 'partial' ? 1 : 0);
