// Key competitor snapshot, összehasonlítás, Competitor Query Gap és Opportunity elemzés.
// Saját domain és versenytársak: azonos kérdéskészlet, azonos értékelési szabályok. Egyszeri pillanatfelvétel.
import type { AIResponseRow, CompetitorRow, CompetitorType, Coverage, EffortLevel, Opportunity, PriorityLevel, QueryGap, QueryRow, TopicRow } from '../../../shared/site.ts';
import type { ContentReport } from './content.ts';
import type { StructuredReport } from './structured.ts';
import type { TrustReport } from './trust.ts';
import type { SiteModel } from './model.ts';
import { coverageScore } from './queries.ts';

export interface SiteSnapshot {
  domain: string;
  model?: SiteModel;
  content?: ContentReport;
  structured?: StructuredReport;
  trust?: TrustReport;
  error?: string;
}

export function snapshotMetrics(s: SiteSnapshot, queries: QueryRow[], isOwn: boolean): Record<string, number | null> {
  const m = s.model;
  if (!m) return {};
  const idx = m.rows.filter((r) => r.pageClass === 'indexable');
  const words = idx.map((r) => r.wordCount);
  const cov = isOwn ? coverageScore(queries) : coverageScore(queries.map((q) => ({ weight: q.weight, coverage: q.competitors.find((c) => c.domain === s.domain)?.coverage ?? ('missing' as Coverage) })));
  return {
    pages: m.rows.length,
    indexable: idx.length,
    avgWords: words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : null,
    sdPagesPct: s.structured && s.structured.pagesTotal ? Math.round((s.structured.pagesWithSd / s.structured.pagesTotal) * 100) : null,
    orgSchema: s.structured ? (s.structured.orgNodes.length ? 1 : 0) : null,
    answerCoverage: cov,
    citationPotential: s.content?.averages.citationPotential ?? null,
    answerFirstPct: s.content?.pages.length ? Math.round((s.content.pages.filter((p) => p.signals.answerFirst).length / s.content.pages.length) * 100) : null,
    evidence: s.content?.averages.evidence ?? null,
    trustSignals: s.trust ? s.trust.signals.filter((x) => x.present).length : null,
    faqOrQuestionHeadings: s.content ? s.content.pages.filter((p) => p.signals.questionHeadings > 0 || p.signals.faq > 0).length : null,
    tables: s.content ? s.content.pages.filter((p) => p.signals.tables > 0).length : null,
  };
}

const LABELS: Record<string, string> = {
  answerCoverage: 'kérdés-lefedettség (azonos kérdéskészleten)',
  citationPotential: 'Citation Potential becslés',
  answerFirstPct: 'közvetlen válasszal induló oldalak aránya',
  evidence: 'bizonyíték-pont (számok, források, példák)',
  sdPagesPct: 'strukturált adattal rendelkező oldalak aránya',
  trustSignals: 'azonosított bizalmi jelek száma',
  avgWords: 'átlagos tartalomhossz',
  faqOrQuestionHeadings: 'kérdés-formájú szakaszokat/GYIK-ot tartalmazó oldalak',
  tables: 'táblázatot tartalmazó oldalak',
};

export function compareToOwn(own: Record<string, number | null>, comp: Record<string, number | null>) {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const k of Object.keys(LABELS)) {
    const a = own[k];
    const b = comp[k];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    const margin = Math.max(5, Math.abs(a) * 0.15);
    if (b - a >= margin) strengths.push(`Erősebb: ${LABELS[k]} (${b} vs. saját ${a})`);
    else if (a - b >= margin) weaknesses.push(`Gyengébb: ${LABELS[k]} (${b} vs. saját ${a})`);
  }
  return { strengths, weaknesses };
}

export function buildCompetitorRows(own: SiteSnapshot, comps: SiteSnapshot[], queries: QueryRow[], topics: TopicRow[], responses: AIResponseRow[], userDomains: string[]): CompetitorRow[] {
  const ownM = snapshotMetrics(own, queries, true);
  return comps.map((c) => {
    const metrics = snapshotMetrics(c, queries, false);
    const { strengths, weaknesses } = c.model ? compareToOwn(ownM, metrics) : { strengths: [], weaknesses: [] };
    const covered = topics.filter((t) => t.competitorCoverage.find((x) => x.domain === c.domain)?.coverage === 'full').map((t) => t.label);
    const weakTopics = topics.filter((t) => t.competitorCoverage.find((x) => x.domain === c.domain)?.coverage === 'missing').map((t) => t.label);
    if (covered.length) strengths.push(`Jól lefedett témák: ${covered.slice(0, 6).join(', ')}`);
    if (weakTopics.length) weaknesses.push(`Hiányos témák: ${weakTopics.slice(0, 6).join(', ')}`);
    const cites = responses.filter((r) => !r.error && r.citations.some((x) => x.domain === c.domain || x.domain.endsWith('.' + c.domain)));
    const types: CompetitorType[] = userDomains.includes(c.domain) ? ['direct'] : [];
    if (covered.length) types.push('content');
    if (cites.some((r) => r.platform === 'brave')) types.push('serp');
    if (cites.some((r) => r.platform !== 'brave')) types.push('ai_search');
    return {
      id: c.domain,
      domain: c.domain,
      types: [...new Set(types)],
      source: userDomains.includes(c.domain) ? 'user' : cites.some((r) => r.platform === 'brave') ? 'serp' : 'ai',
      confirmed: userDomains.includes(c.domain),
      crawlStatus: c.error ? 'failed' : c.model ? 'done' : 'skipped',
      error: c.error,
      pages: c.model?.rows.length ?? 0,
      metrics: { ...metrics, aiCitations: responses.length ? cites.filter((r) => r.platform !== 'brave').length : null, serpAppearances: responses.some((r) => r.platform === 'brave') ? cites.filter((r) => r.platform === 'brave').length : null },
      strengths,
      weaknesses,
      topics: covered,
      seenInQueries: new Set(cites.map((r) => r.queryId)).size,
      citedUrls: [...new Set(cites.flatMap((r) => r.citations.filter((x) => x.domain === c.domain || x.domain.endsWith('.' + c.domain)).map((x) => x.url)))].slice(0, 20),
    };
  });
}

const prio = (impact: number, effort: EffortLevel, confidence: number): PriorityLevel => {
  const v = (impact * confidence) / (effort === 'S' ? 1 : effort === 'M' ? 1.4 : 2);
  return v >= 3 ? 'P1' : v >= 1.8 ? 'P2' : 'P3';
};

/** Competitor Query Gap: ahol versenytárs megjelenik/lefed, a saját domain nem. Három külön alapon. */
export function queryGaps(queries: QueryRow[], responses: AIResponseRow[], comps: SiteSnapshot[], ownDomain: string): QueryGap[] {
  const gaps: QueryGap[] = [];
  const isDom = (d: string, x: string) => x === d || x.endsWith('.' + d);
  // 1) ténylegesen megfigyelt citation gap (AI) és 2) SERP gap
  for (const q of queries) {
    const rs = responses.filter((r) => r.queryId === q.id && !r.error);
    for (const r of rs) {
      const ownCited = r.citations.some((c) => isDom(ownDomain, c.domain));
      if (ownCited) continue;
      for (const comp of comps) {
        const hit = r.citations.find((c) => isDom(comp.domain, c.domain));
        if (!hit) continue;
        const basis = r.platform === 'brave' ? 'serp' : 'observed_citation';
        const impact = Math.min(5, Math.round(q.weight * 4 + (basis === 'observed_citation' ? 1 : 0)));
        const effort: EffortLevel = q.coverage === 'missing' ? 'M' : 'S';
        gaps.push({
          id: `${basis}:${q.id}:${comp.domain}:${r.platform}`,
          query: q.text,
          topic: q.topic,
          intent: q.type,
          competitor: comp.domain,
          competitorUrl: hit.url,
          competitorTraits: competitorTraits(comp, hit.url),
          ownUrl: q.bestUrl,
          ownGap: q.coverage === 'missing' ? 'Nincs releváns, választ adó oldal.' : q.coverage === 'partial' ? 'Csak részleges válasz.' : 'Van válasz, mégsem idézett – a válasz szerkezete/bizonyítékai vizsgálandók.',
          suggestion: q.coverage === 'missing' ? 'Új, a kérdésre felépített tartalom (lásd content brief).' : `A(z) ${q.bestUrl} kiegészítése közvetlen válaszblokkal és bizonyítékokkal.`,
          impact,
          effort,
          confidence: basis === 'observed_citation' ? 0.85 : 0.75,
          priority: prio(impact, effort, basis === 'observed_citation' ? 0.85 : 0.75),
          basis,
        });
      }
    }
  }
  // 3) tartalmi összehasonlításból következtetett gap
  for (const q of queries) {
    if (q.coverage === 'full') continue;
    for (const c of q.competitors) {
      if (c.coverage !== 'full') continue;
      if (gaps.some((g) => g.query === q.text && g.competitor === c.domain)) continue;
      const comp = comps.find((x) => x.domain === c.domain);
      const impact = Math.min(5, Math.max(1, Math.round(q.weight * 4)));
      const effort: EffortLevel = q.coverage === 'missing' ? 'M' : 'S';
      gaps.push({
        id: `content:${q.id}:${c.domain}`,
        query: q.text,
        topic: q.topic,
        intent: q.type,
        competitor: c.domain,
        competitorUrl: c.url,
        competitorTraits: comp ? competitorTraits(comp, c.url) : [],
        ownUrl: q.bestUrl,
        ownGap: q.coverage === 'missing' ? 'Nincs releváns, választ adó szakasz.' : 'Csak részleges válasz.',
        suggestion: q.coverage === 'missing' ? 'Új tartalom vagy új szakasz a legközelebbi releváns oldalon.' : `A(z) ${q.bestUrl} bővítése a hiányzó válaszelemekkel.`,
        impact,
        effort,
        confidence: 0.5,
        priority: prio(impact, effort, 0.5),
        basis: 'content_inferred',
      });
    }
  }
  return gaps.sort((a, b) => a.priority.localeCompare(b.priority) || b.impact - a.impact).slice(0, 300);
}

function competitorTraits(comp: SiteSnapshot, url?: string): string[] {
  if (!url || !comp.content) return [];
  const p = comp.content.pages.find((x) => x.url === url);
  if (!p) return ['A versenytárs oldala nem szerepelt a bejárt mintában.'];
  const t: string[] = [];
  if (p.signals.answerFirst) t.push('közvetlen válasszal indul');
  if (p.signals.questionHeadings) t.push(`${p.signals.questionHeadings} kérdés-formájú címsor`);
  if (p.signals.tables) t.push(`${p.signals.tables} táblázat`);
  if (p.signals.numbers >= 3) t.push(`${p.signals.numbers} konkrét számadat`);
  if (p.signals.externalRefs) t.push(`${p.signals.externalRefs} forráshivatkozás`);
  if (p.signals.authors.length) t.push(`szerző: ${p.signals.authors[0]}`);
  if (p.signals.dateModified || p.signals.datePublished) t.push(`dátum: ${p.signals.dateModified ?? p.signals.datePublished}`);
  t.push(`${p.words} szó`);
  return t;
}

export function opportunities(topics: TopicRow[], gaps: QueryGap[], competitors: CompetitorRow[], ownTopicsUrls: Map<string, string[]>): Opportunity[] {
  const out: Opportunity[] = [];
  for (const t of topics) {
    const strongerComps = t.competitorCoverage.filter((c) => (c.coverage === 'full' && t.coverage !== 'full') || (c.coverage === 'partial' && t.coverage === 'missing'));
    if (!strongerComps.length) continue;
    const tg = gaps.filter((g) => g.topic === t.label);
    const observed = tg.filter((g) => g.basis === 'observed_citation');
    const comp = strongerComps[0];
    const ownUrls = ownTopicsUrls.get(t.id) ?? t.ownUrls;
    out.push({
      id: `opp-${t.id}`,
      title: `${t.label}: ${t.coverage === 'missing' ? 'új tartalom' : 'meglévő tartalom bővítése'}`,
      competitor: comp.domain,
      competitorSide: [
        `${comp.domain} ${comp.coverage === 'full' ? 'jól' : 'részben'} lefedi a témát (${t.queryCount} kérdésből álló klaszter).`,
        ...(observed.length ? [`Ténylegesen megfigyelt idézés: ${observed.length} AI-válaszban (pl. ${observed[0].competitorUrl}).`] : []),
        ...(comp.urls.length ? [`Releváns URL-ek: ${comp.urls.slice(0, 3).join(', ')}`] : []),
      ],
      ownSide: [
        ownUrls.length ? `Kapcsolódó saját oldalak: ${ownUrls.slice(0, 3).join(', ')}` : 'Nincs kapcsolódó saját oldal.',
        `Lefedettség: ${t.coverage === 'missing' ? 'hiányzó' : 'részleges'}; ${t.missingQueries.length} kérdésre nincs teljes válasz.`,
      ],
      action: t.coverage === 'missing' ? `Új guide/szolgáltatásoldal a(z) „${t.label}” témában, a hiányzó kérdésekre felépítve.` : `A meglévő oldal(ak) kiegészítése a hiányzó kérdésekre adott közvetlen válaszokkal, bizonyítékokkal.`,
      expectedImpact: observed.length
        ? 'Közepes–magas: a versenytárs ebben a témában ténylegesen idézett forrás; egy teljes, jól strukturált válasz növelheti az esélyt, de az idézés nem garantált.'
        : 'Közepes: tartalmi összehasonlításon alapuló becslés; tényleges AI-megjelenési adat nélkül.',
      uncertainty: observed.length ? 'A mérés egyetlen időpontú minta; a válaszok változékonyak.' : 'A kérdések generált hipotézisek; keresési volumen- és AI-adat nem támasztja alá.',
      priority: observed.length ? 'P1' : t.coverage === 'missing' ? 'P2' : 'P2',
      urls: [...ownUrls.slice(0, 3), ...comp.urls.slice(0, 3)],
    });
  }
  // gyengeségek kihasználása: ahol a versenytárs hiányos és mi erősek vagyunk
  for (const c of competitors) {
    const weakTopics = topics.filter((t) => t.coverage === 'full' && t.competitorCoverage.find((x) => x.domain === c.domain)?.coverage === 'missing');
    if (!weakTopics.length) continue;
    out.push({
      id: `diff-${c.domain}`,
      title: `Megkülönböztető erősség a(z) ${c.domain} versenytárssal szemben`,
      competitor: c.domain,
      competitorSide: [`Hiányos lefedettség: ${weakTopics.map((t) => t.label).slice(0, 5).join(', ')}`],
      ownSide: [`Teljes lefedettség ezekben a témákban (${weakTopics.flatMap((t) => t.ownUrls).slice(0, 3).join(', ')})`],
      action: 'Erősítsd ezeket az oldalakat bizonyítékokkal (saját adatok, esettanulmányok, szerzői szakértelem), és linkeld őket hubokról – ez a jelenlegi előny megtartását szolgálja.',
      expectedImpact: 'Alacsony–közepes: meglévő előny védelme.',
      uncertainty: 'Tartalmi összehasonlításon alapul.',
      priority: 'P3',
      urls: weakTopics.flatMap((t) => t.ownUrls).slice(0, 5),
    });
  }
  return out;
}
