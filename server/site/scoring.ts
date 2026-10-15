// Scoring engine: a mért tényekből és elemzésekből komponensenként számol, konfigurálható súlyokkal.
// Hiányos adatnál a komponens "insufficient" / "not_measured" – nem nulla pont, kimarad a súlyozásból.
import fs from 'node:fs';
import path from 'node:path';
import type { GeoScore, Issue, QueryRow, ScoreComponent, TopicRow, VisibilitySummary } from '../../shared/site.ts';
import { env } from '../env.ts';
import type { SiteModel } from './analyze/model.ts';
import type { ContentReport } from './analyze/content.ts';
import type { StructuredReport } from './analyze/structured.ts';
import type { TrustReport } from './analyze/trust.ts';
import type { EntityReport } from './analyze/entities.ts';
import type { AiBotReport } from './analyze/aibots.ts';
import type { LinkGraphSummary } from '../../shared/site.ts';
import { coverageScore } from './analyze/queries.ts';

export interface ScoringConfig {
  version: string;
  minMeasuredShare: number;
  components: Record<string, { label: string; weight: number }>;
}

export function loadScoringConfig(dir = env.configDir): ScoringConfig {
  return JSON.parse(fs.readFileSync(path.join(dir, 'scoring.json'), 'utf8')) as ScoringConfig;
}

export interface ScoringInput {
  model: SiteModel;
  issues: Issue[];
  content?: ContentReport;
  structured?: StructuredReport;
  trust?: TrustReport;
  entities?: EntityReport;
  aiBots?: AiBotReport;
  links?: LinkGraphSummary;
  queries: QueryRow[];
  topics: TopicRow[];
  visibility?: VisibilitySummary;
  orgDetected: boolean;
  offeringsDetected: boolean;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const SEARCH_BOTS = ['Googlebot', 'bingbot', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot'];

export function computeScore(inp: ScoringInput, cfg: ScoringConfig = loadScoringConfig()): GeoScore {
  const m = inp.model;
  const indexable = m.rows.filter((r) => r.pageClass === 'indexable');
  const nIdx = Math.max(1, indexable.length);
  const comps: ScoreComponent[] = [];
  const add = (id: string, c: Omit<ScoreComponent, 'id' | 'label' | 'weight' | 'max'>) => {
    const def = cfg.components[id];
    if (!def) return;
    comps.push({ id, label: def.label, weight: def.weight, max: 100, ...c, score: c.score === null ? null : clamp(c.score) });
  };
  const issuesIn = (cats: string[]) => inp.issues.filter((i) => cats.includes(i.category) && i.site === m.site);
  const ev = (iss: Issue[]) => iss.slice(0, 6).map((i) => ({ url: i.urls[0], detail: `${i.priority} · ${i.title} (${i.urls.length} URL)` }));

  // 1. Technical crawlability
  {
    const iss = issuesIn(['crawl', 'indexing', 'rendering', 'html', 'metadata']);
    let penalty = 0;
    for (const i of iss) {
      const share = Math.min(1, i.urls.length / nIdx);
      const pw = i.priority === 'P0' ? 30 : i.priority === 'P1' ? 10 : i.priority === 'P2' ? 5 : 2;
      penalty += pw * (0.3 + 0.7 * Math.min(1, share * 2));
    }
    add('technical_crawlability', {
      score: m.rows.length ? 100 - penalty : null,
      confidence: 0.9,
      explanation: `${iss.length} technikai problémacsoport, ${indexable.length} indexelhető oldal a ${m.rows.length} bejártból.`,
      method: '100 − Σ(prioritássúly × kiterjedés) a crawl/indexelés/renderelés/HTML/metaadat problémákra. P0=30, P1=10, P2=5, P3=2 pont, az érintett oldalak arányával skálázva.',
      source: 'measured',
      evidence: ev(iss),
      urls: iss.flatMap((i) => i.urls).slice(0, 20),
      status: m.rows.length ? 'ok' : 'insufficient',
    });
  }
  // 2. AI accessibility
  if (inp.aiBots) {
    const rows = inp.aiBots.rows.filter((r) => SEARCH_BOTS.some((t) => t.toLowerCase() === r.token.toLowerCase()));
    const allowed = rows.filter((r) => r.allowedHome !== false && !r.blockedSample.length).length;
    const jsDep = m.rows.filter((r) => r.flags.includes('js_dependent')).length;
    const rendered = m.rows.filter((r) => r.rendered).length;
    const uaFail = inp.aiBots.uaTests.filter((u) => u.sameAsBrowser === false).length;
    const robotsPart = rows.length ? (allowed / rows.length) * 70 : 70;
    const rawPart = rendered ? (1 - jsDep / rendered) * 30 : null;
    add('ai_accessibility', {
      score: robotsPart + (rawPart ?? 22) - uaFail * 10,
      confidence: rendered ? 0.85 : 0.6,
      explanation: `Keresési célú robotok: ${allowed}/${rows.length} engedélyezett a robots.txt szerint. ${rendered ? `JS-függő oldalak: ${jsDep}/${rendered} renderelt oldalból.` : 'Renderelés nem futott – a JS-függőség nem mért (közepes alapértéket használtunk, alacsonyabb bizonyossággal).'} ${uaFail ? `${uaFail} robot UA eltérő választ kapott.` : ''}`,
      method: '70 pont: keresési/AI-válasz robotok (Googlebot, Bingbot, OAI-SearchBot, PerplexityBot, Claude-SearchBot) robots.txt-engedélye; 30 pont: a tartalom nyers HTML-ben elérhető (nem JS-függő); −10 pont robotonként, ha a robot UA-ja eltérő választ kap. A tanító célú robotok tiltása nem csökkenti a pontot.',
      source: 'measured',
      evidence: rows.filter((r) => r.allowedHome === false || r.blockedSample.length).map((r) => ({ url: m.crawl.robots.url, detail: `${r.name}: tiltott (${r.rule ?? `${r.blockedSample.length} oldal`})` })),
      urls: m.rows.filter((r) => r.flags.includes('js_dependent')).map((r) => r.url).slice(0, 20),
      status: 'ok',
    });
  }
  // 3–4. Content clarity, answerability (oldalszintű)
  const cr = inp.content;
  const enough = (cr?.pages.length ?? 0) >= 3;
  const lowPages = (k: 'clarity' | 'answerability') => (cr?.pages ?? []).filter((p) => (p.scores[k] ?? 100) < 50).slice(0, 10);
  add('content_clarity', {
    score: enough ? cr!.averages.clarity : null,
    confidence: 0.6,
    explanation: enough ? `${cr!.pages.length} fontos oldal átlaga. ${lowPages('clarity').length} oldal 50 pont alatt.` : 'Kevesebb mint 3 elemezhető tartalmi oldal.',
    method: 'Oldalanként: H1/téma (30) + title (15) + meta description (10) + közvetlen nyitóbekezdés (30) + a kínálat megnevezése (15); átlag a fontosság szerinti első 60 oldalon.',
    source: 'observed',
    evidence: lowPages('clarity').map((p) => ({ url: p.url, detail: `clarity ${p.scores.clarity}: ${p.missing.slice(0, 2).join('; ')}` })),
    urls: lowPages('clarity').map((p) => p.url),
    status: enough ? 'ok' : 'insufficient',
  });
  add('answerability', {
    score: enough ? cr!.averages.answerability : null,
    confidence: 0.55,
    explanation: enough ? 'Oldalszintű megválaszolhatósági jelek átlaga.' : 'Kevés elemezhető oldal.',
    method: 'Közvetlen nyitóválasz (30) + kérdés-formájú címsorok (max 25) + definíciók (max 20) + GYIK-blokkok (max 15) + tartalomhossz (max 10).',
    source: 'observed',
    evidence: lowPages('answerability').map((p) => ({ url: p.url, detail: `answerability ${p.scores.answerability}` })),
    urls: lowPages('answerability').map((p) => p.url),
    status: enough ? 'ok' : 'insufficient',
  });
  // 5. Entity clarity
  if (inp.entities) {
    const org = inp.entities.nodes.find((n) => n.type === 'Organization');
    const people = inp.entities.nodes.filter((n) => n.type === 'Person');
    const linkedPeople = people.filter((p) => inp.entities!.edges.some((e) => e.from === p.id && e.type === 'worksFor') || p.sameAs.length);
    const nameIssue = inp.issues.some((i) => i.code === 'name_inconsistent' && i.site === m.site);
    const parts = [
      [inp.orgDetected ? 25 : 0, 'szervezet azonosítva'],
      [org?.inSchema ? 25 : 0, 'Organization strukturált adat'],
      [org?.sameAs.length ? 15 : 0, 'sameAs/külső profilok'],
      [nameIssue ? 0 : 15, 'egységes név'],
      [people.length ? (linkedPeople.length / people.length) * 10 : 10, 'személyek kapcsolatai'],
      [inp.offeringsDetected ? 10 : 0, 'kínálat azonosítható'],
    ] as const;
    add('entity_clarity', {
      score: parts.reduce((s, [v]) => s + v, 0),
      confidence: 0.7,
      explanation: parts.map(([v, l]) => `${l}: ${Math.round(v)}`).join(' · '),
      method: 'Szervezet azonosítható (25) + Organization jelölés (25) + sameAs (15) + egységes névhasználat (15) + személyek szervezeti kapcsolata (10) + kínálat azonosítható (10).',
      source: 'measured',
      evidence: inp.entities.nameVariants.slice(0, 5).map((v) => ({ detail: `Névváltozat: ${v.name} (${v.sources.join(', ')})` })),
      urls: org?.urls.slice(0, 5) ?? [],
      status: 'ok',
    });
  }
  // 6. Structured data
  if (inp.structured) {
    const s = inp.structured;
    const syntaxErr = s.records.filter((r) => !r.syntaxValid).length;
    const richMissing = s.records.filter((r) => r.richResults.some((x) => x.eligibleType && x.missingRequired.length)).length;
    const mismatch = s.records.filter((r) => r.visibilityMismatches.length).length;
    const hasOrg = s.orgNodes.length > 0;
    const hasWebsite = (s.typeCounts['WebSite'] ?? 0) > 0;
    add('structured_data', {
      score: s.pagesTotal ? (s.pagesWithSd / s.pagesTotal) * 40 + (syntaxErr ? 0 : 20) + (richMissing ? 5 : 15) + (hasOrg ? 10 : 0) + (hasWebsite ? 5 : 0) + (mismatch ? 0 : 10) : null,
      confidence: 0.85,
      explanation: `${s.pagesWithSd}/${s.pagesTotal} oldalon van strukturált adat; ${syntaxErr} szintaktikai hiba; ${richMissing} blokkban hiányzik rich result-kötelező mező; ${mismatch} blokk nem látható tartalmat jelöl.`,
      method: 'Lefedettség (40) + szintaktikai hibamentesség (20) + rich result kötelező mezők (15) + Organization (10) + WebSite (5) + láthatóság-egyezés (10). A schema.org érvényesség, a Google rich result és az AI-feldolgozás külön kérdés.',
      source: 'measured',
      evidence: s.records.filter((r) => !r.syntaxValid || r.errors.length).slice(0, 5).map((r) => ({ url: r.url, detail: r.errors[0] ?? 'hiba' })),
      urls: [],
      status: s.pagesTotal ? 'ok' : 'insufficient',
    });
  }
  // 7. Trust
  if (inp.trust) {
    const known = inp.trust.signals.filter((x) => x.present !== null);
    const present = known.filter((x) => x.present);
    add('trust_signals', {
      score: known.length ? (present.length / known.length) * 100 : null,
      confidence: 0.6,
      explanation: `${present.length}/${known.length} vizsgált bizalmi jel azonosítható. Hiányzik: ${known.filter((x) => !x.present).map((x) => x.label).join(', ') || '—'}.`,
      method: 'Az azonosítható bizalmi jelek aránya (kapcsolat, cégadatok, rólunk, szakértők, szerzők, referenciák, források, dátumok stb.). Nem az E-E-A-T közvetlen mérése.',
      source: 'observed',
      evidence: known.filter((x) => !x.present).map((x) => ({ detail: `Hiányzó jel: ${x.label}` })),
      urls: [],
      status: known.length ? 'ok' : 'insufficient',
    });
  }
  // 8. Citation potential
  add('citation_potential', {
    score: enough ? cr!.averages.citationPotential : null,
    confidence: 0.45,
    explanation: 'Algoritmikus becslés – NEM tényleges AI-idézés mérése.',
    method: 'Oldalanként: megválaszolhatóság 25% + bizonyíték 20% + eredetiség 15% + struktúra 15% + érthetőség 10% + szerzőség 10% + frissesség 5%; átlag.',
    source: 'estimate',
    evidence: (cr?.pages ?? []).sort((a, b) => b.citationPotential - a.citationPotential).slice(0, 3).map((p) => ({ url: p.url, detail: `legmagasabb becslés: ${p.citationPotential}` })),
    urls: [],
    status: enough ? 'ok' : 'insufficient',
  });
  // 9. Topical coverage
  add('topical_coverage', {
    score: inp.topics.length ? (inp.topics.reduce((s, t) => s + (t.coverage === 'full' ? 1 : t.coverage === 'partial' ? 0.5 : 0), 0) / inp.topics.length) * 100 : null,
    confidence: 0.5,
    explanation: `${inp.topics.filter((t) => t.coverage === 'full').length} teljes, ${inp.topics.filter((t) => t.coverage === 'partial').length} részleges, ${inp.topics.filter((t) => t.coverage === 'missing').length} hiányzó téma.`,
    method: 'Témaklaszterenként a kérdés-lefedettség (teljes=1, részleges=0,5); a témák a felismert kínálatból és kulcskifejezésekből származnak (hipotézis).',
    source: 'estimate',
    evidence: inp.topics.filter((t) => t.coverage === 'missing').slice(0, 5).map((t) => ({ detail: `Hiányzó téma: ${t.label}` })),
    urls: [],
    status: inp.topics.length ? 'ok' : 'insufficient',
  });
  // 10. Internal linking
  if (inp.links) {
    const l = inp.links;
    const orphanShare = l.orphans.length / nIdx;
    const deepShare = l.deep.length / nIdx;
    const lowShare = l.lowInlinks.length / nIdx;
    add('internal_linking', {
      score: 100 - orphanShare * 40 - deepShare * 30 - lowShare * 20 - Math.min(10, l.broken.length) - Math.min(5, l.genericAnchors.length / 5),
      confidence: m.crawl.limitReached ? 0.55 : 0.8,
      explanation: `Orphan: ${l.orphans.length}, mély (4+): ${l.deep.length}, gyengén linkelt: ${l.lowInlinks.length}, hibás belső link: ${l.broken.length}.${m.crawl.limitReached ? ' A crawl elérte az oldalkorlátot – a linkgráf részleges.' : ''}`,
      method: '100 − orphan arány×40 − mély oldalak aránya×30 − gyengén linkelt arány×20 − hibás linkek (max 10) − semmitmondó anchorok (max 5).',
      source: 'measured',
      evidence: [...l.orphans.slice(0, 3).map((u) => ({ url: u, detail: 'orphan' })), ...l.broken.slice(0, 3).map((b) => ({ url: b.from, detail: `hibás link → ${b.to}` }))],
      urls: l.orphans.slice(0, 10),
      status: 'ok',
    });
  }
  // 11. Freshness
  const dated = (cr?.pages ?? []).filter((p) => p.scores.freshness !== null);
  add('content_freshness', {
    score: dated.length >= 3 ? dated.reduce((s, p) => s + (p.scores.freshness ?? 0), 0) / dated.length : null,
    confidence: 0.5,
    explanation: dated.length >= 3 ? `${dated.length} oldalon azonosítható dátum.` : `Csak ${dated.length} oldalon azonosítható dátum – elégtelen adat (nem nulla pont).`,
    method: 'Legutóbbi azonosított dátum (dateModified, datePublished, látható dátum) kora: ≤6 hó 100, ≤1 év 80, ≤2 év 55, ≤4 év 30, felette 10.',
    source: 'measured',
    evidence: dated.filter((p) => (p.scores.freshness ?? 100) < 55).slice(0, 5).map((p) => ({ url: p.url, detail: `${p.signals.ageDays} napos` })),
    urls: [],
    status: dated.length >= 3 ? 'ok' : 'insufficient',
  });
  // 12. Query coverage
  const acs = coverageScore(inp.queries);
  add('query_coverage', {
    score: acs,
    confidence: inp.queries.some((q) => q.judgedBy === 'llm') ? 0.65 : 0.5,
    explanation: `Answer Coverage Score ${acs ?? '—'} a ${inp.queries.length} kérdésen (${inp.queries.filter((q) => q.coverage === 'full').length} teljes, ${inp.queries.filter((q) => q.coverage === 'partial').length} részleges, ${inp.queries.filter((q) => q.coverage === 'missing').length} hiányzó). A generált kérdések hipotézisek.`,
    method: 'Súlyozott arány: Σ(súly × [teljes=1, részleges=0,5]) / Σ súly. A lefedettséget szakasz-szintű BM25 egyezés (és ha bekapcsolt, LLM-ellenőrzés idézet-validálással) adja.',
    source: inp.queries.some((q) => q.judgedBy === 'llm') ? 'ai' : 'estimate',
    evidence: inp.queries.filter((q) => q.coverage === 'missing').slice(0, 5).map((q) => ({ detail: `Hiányzó: ${q.text}` })),
    urls: [],
    status: acs === null ? 'insufficient' : 'ok',
  });
  // 13. AI visibility
  const v = inp.visibility;
  const own = v?.metrics.find((x) => x.isOwn);
  add('ai_visibility', {
    score: v?.measured && own && v.queryCount ? (own.queriesWithCitation / v.queryCount) * 70 + (own.queriesWithMention / v.queryCount) * 30 : null,
    confidence: v?.measured ? 0.8 : 0,
    explanation: v?.measured && own ? `${own.queriesWithCitation}/${v.queryCount} kérdésnél idézett, ${own.queriesWithMention}/${v.queryCount} kérdésnél említett (${v.platforms.filter((p) => p.status === 'used').map((p) => p.name).join(', ')}).` : 'Nem mérhető: nincs konfigurált AI/search API, vagy nem volt sikeres válasz. A többi komponens ettől függetlenül érvényes.',
    method: 'Ténylegesen megfigyelt AI/search válaszok alapján: idézett kérdések aránya ×70 + említett kérdések aránya ×30.',
    source: v?.measured ? 'external' : 'unverifiable',
    evidence: [],
    urls: [],
    status: v?.measured ? 'ok' : 'not_measured',
  });

  const ok = comps.filter((c) => c.status === 'ok' && c.score !== null);
  const totalW = comps.filter((c) => c.status !== 'not_measured').reduce((s, c) => s + c.weight, 0);
  const okW = ok.reduce((s, c) => s + c.weight, 0);
  const overall = okW ? Math.round(ok.reduce((s, c) => s + c.score! * c.weight, 0) / okW) : null;
  const share = totalW ? okW / totalW : 0;
  const conf = okW ? ok.reduce((s, c) => s + c.confidence * c.weight, 0) / okW : 0;
  return {
    overall: share >= cfg.minMeasuredShare ? overall : null,
    measuredWeightShare: Math.round(share * 100) / 100,
    confidence: Math.round(conf * 100) / 100,
    components: comps,
    note: `Belső, dokumentált értékelési rendszer (${cfg.version}), nem univerzális AI-rangsorolási mérőszám. A mért súlyok aránya: ${Math.round(share * 100)}%.${share < cfg.minMeasuredShare ? ' Elégtelen adat az összpontszámhoz.' : ''} Nem garantál AI-megjelenést vagy idézést.`,
  };
}
