// Tartalmi GEO audit és Citation Potential becslés oldalanként.
// Determinisztikus jelekből dolgozik (minden jelhez bizonyíték tartozik); az LLM-értékelés opcionális kiegészítés.
// A Citation Potential algoritmikus becslés, NEM tényleges AI-idézés mérése.
import type { BusinessContext, ExtractedPage, PageRow } from '../../../shared/site.ts';
import { IssueCollector, type IssueDef } from './issues.ts';
import type { SiteModel } from './model.ts';
import { tokens, truncate } from './text.ts';

export type PageKind = 'home' | 'service' | 'product' | 'article' | 'category' | 'about' | 'contact' | 'legal' | 'other';

export interface PageContentEval {
  url: string;
  kind: PageKind;
  topic: string;
  words: number;
  signals: {
    answerFirst: boolean;
    firstParagraph?: string;
    definitions: number;
    numbers: number;
    examples: number;
    lists: number;
    tables: number;
    questionHeadings: number;
    faq: number;
    externalRefs: number;
    authors: string[];
    datePublished?: string;
    dateModified?: string;
    ageDays: number | null;
    originality: number;
    boilerplateShare: number;
    h2: number;
  };
  scores: { clarity: number; answerability: number; evidence: number; structure: number; authorship: number; freshness: number | null; originality: number };
  citationPotential: number;
  strengths: string[];
  missing: string[];
  llm?: { summary: string; mainQuestion: string; answered: 'yes' | 'partial' | 'no'; missing: string[]; claimsWithoutEvidence: string[] };
}

const ORIGINAL = /\b(saját (?:kutatás|felmérés|adat|mérés|tapasztalat)|felmérésünk|kutatásunk|méréseink|tapasztalataink|ügyfeleink|esettanulmány|eredményeink|mértük|our (?:research|survey|data|study|clients|customers)|we (?:found|measured|surveyed|tested)|case study|in our experience)\b/gi;

export function pageKind(r: PageRow, e: ExtractedPage, isHome: boolean): PageKind {
  if (isHome) return 'home';
  const u = r.url.toLowerCase();
  if (/kapcsolat|contact|elerhetoseg/.test(u)) return 'contact';
  if (/adatvedelem|adatkezel|privacy|aszf|terms|cookie|impresszum|impressum|jogi/.test(u)) return 'legal';
  if (/rolunk|about|bemutatkoz|csapat|team|kik-vagyunk/.test(u)) return 'about';
  if (/\/(blog|hirek|news|cikk|article|magazin|tudastar|post)s?\/[^/?#]+/.test(u) || (e.datePublished && e.author.length)) return 'article';
  if (/\/(termek|product|shop|bolt)s?\//.test(u) || e.jsonld.some((b) => /"Product"/.test(b.raw))) return 'product';
  if (/\/(szolgaltatas|services?|kezeles|megoldas|solutions?|kepzes|csomag)/.test(u) || e.jsonld.some((b) => /"Service"/.test(b.raw))) return 'service';
  if (/\/(kategoria|category|tag|cimke)\//.test(u) || e.links.filter((l) => l.internal && l.zone === 'main').length > 40) return 'category';
  return 'other';
}

function ageDays(...dates: (string | undefined)[]): number | null {
  const ts = dates.map((d) => (d ? Date.parse(d) : NaN)).filter((t) => !Number.isNaN(t) && t < Date.now() + 86400000);
  if (!ts.length) return null;
  return Math.round((Date.now() - Math.max(...ts)) / 86400000);
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const D = (x: IssueDef) => x;
export const CONTENT: Record<string, IssueDef> = {
  no_answer_first: D({ category: 'content', title: 'A fontos oldalak nem kezdődnek közvetlen, összefoglaló válasszal', why: 'Az AI-válaszrendszerek jellemzően rövid, önállóan érthető szövegrészeket emelnek ki. Ha az oldal elején nincs 1–3 mondatos, egyértelmű összefoglaló, nehezebb belőle választ készíteni.', fix: 'A H1 alatt az első bekezdés 40–60 szóban mondja ki, mi ez, kinek szól és mi a lényeg (konkrét tényekkel).', acceptance: 'Az érintett oldalak első bekezdése önállóan megválaszolja az oldal fő kérdését.', impact: 3, effort: 'S', owner: 'content', evidenceKind: 'observed', confidence: 0.55 }),
  no_specifics: D({ category: 'content', title: 'Általános, konkrétumok nélküli tartalom', why: 'Konkrét adatok, definíciók és példák nélkül a szöveg nehezen ellenőrizhető és kevésbé idézhető.', fix: 'Egészítsd ki igazolható tényekkel (számok, árak, határidők, folyamatlépések), definíciókkal és valós példákkal.', acceptance: 'Az érintett oldalakon van legalább egy definíció/összefoglaló és több ellenőrizhető tény.', impact: 3, effort: 'M', owner: 'content', evidenceKind: 'observed', confidence: 0.6 }),
  no_sources: D({ category: 'trust', title: 'Állítások forrásmegjelölés nélkül', why: 'A számokat és szakmai állításokat tartalmazó oldalakon a hivatkozott források növelik az ellenőrizhetőséget és a bizalmat.', fix: 'Hivatkozz elsődleges forrásokra (jogszabály, szakmai szervezet, kutatás) a releváns állításoknál.', acceptance: 'A számokat/szakmai állításokat tartalmazó oldalakon legalább egy releváns külső forrás szerepel.', impact: 2, effort: 'M', owner: 'content', evidenceKind: 'observed', confidence: 0.55 }),
  no_author: D({ category: 'trust', title: 'Cikkek azonosítható szerző nélkül', why: 'A szerző és szakértelme a tartalom hitelességének egyik legfontosabb jele.', fix: 'Tüntesd fel a valós szerzőt (név, szerep, rövid szakmai bemutatkozás, profiloldal link).', acceptance: 'Minden cikkoldalon látható a szerző neve és profilja.', impact: 3, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.8 }),
  no_dates: D({ category: 'freshness', title: 'Cikkek publikálási/frissítési dátum nélkül', why: 'Dátum nélkül nem ítélhető meg, mennyire friss és érvényes az információ.', fix: 'Jelenítsd meg a megjelenés és az érdemi frissítés dátumát, és add meg a JSON-LD-ben is.', acceptance: 'A cikkoldalakon látható és jelölt a datePublished/dateModified.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.8 }),
  stale: D({ category: 'freshness', title: 'Régen frissített tartalom (24+ hónap)', why: 'Az elavult információt a válaszrendszerek kevésbé valószínűen használják forrásként; az ügyfél felé is félrevezető lehet.', fix: 'Vizsgáld felül a tartalmat, frissítsd a tényeket, és jelöld a frissítés dátumát.', acceptance: 'Az érintett oldalak tartalma felülvizsgált, a dateModified aktuális.', impact: 2, effort: 'M', owner: 'content', evidenceKind: 'measured', confidence: 0.6 }),
  boilerplate: D({ category: 'content', title: 'Sablonszöveg dominálja az oldalt', why: 'Ha a szöveg nagy része más oldalakon is szó szerint ismétlődik, az oldal egyedi információtartalma alacsony.', fix: 'Az ismétlődő blokkokat rövidítsd, és bővítsd az oldalt egyedi, az adott témára vonatkozó tartalommal.', acceptance: 'Az oldal fő tartalmának legalább 60%-a egyedi.', impact: 2, effort: 'M', owner: 'content', evidenceKind: 'measured', confidence: 0.7 }),
  no_structure: D({ category: 'content', title: 'Hosszú szöveg tagolás nélkül', why: 'A címsorok, listák és táblázatok segítik a szöveg szakaszokra bontását és a releváns rész kiemelését.', fix: 'Tagold H2/H3 címsorokkal (lehetőleg kérdés formában), a lépéseket számozott listába, az összehasonlításokat táblázatba.', acceptance: 'A 600 szó feletti oldalakon legalább 3 H2 és legalább egy lista vagy táblázat van.', impact: 2, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.7 }),
};

export interface ContentReport {
  pages: PageContentEval[];
  averages: Record<string, number | null>;
  note: string;
}

export function contentAudit(m: SiteModel, ctx: BusinessContext, limit = 60): { issues: IssueCollector; report: ContentReport } {
  const ic = new IssueCollector(m.site);
  const lang = ctx.language.value;
  const pages = m.content.slice(0, limit);
  // ismétlődő szakaszok (sablonszöveg) felismerése
  const passFreq = new Map<string, number>();
  for (const r of m.content) {
    const e = m.best(r.url)!;
    for (const p of new Set(e.passages.map((x) => x.text.slice(0, 200)))) passFreq.set(p, (passFreq.get(p) ?? 0) + 1);
  }
  const threshold = Math.max(3, m.content.length * 0.3);
  const offeringTerms = new Set(ctx.offerings.value.flatMap((o) => tokens(o, lang)));

  const evals: PageContentEval[] = [];
  for (const r of pages) {
    const e = m.best(r.url)!;
    const kind = pageKind(r, e, r === m.home);
    const topic = e.headings.find((h) => h.level === 1)?.text ?? e.title ?? '';
    const topicTerms = new Set(tokens(topic, lang));
    const fp = e.firstParagraph;
    const fpTerms = fp ? new Set(tokens(fp, lang)) : new Set<string>();
    const overlap = [...topicTerms].filter((t) => fpTerms.has(t)).length;
    const fpWords = fp ? fp.split(/\s+/).length : 0;
    const answerFirst = !!fp && fpWords >= 12 && fpWords <= 90 && (overlap >= 1 || topicTerms.size === 0);
    const boilerWords = e.passages.filter((p) => (passFreq.get(p.text.slice(0, 200)) ?? 0) >= threshold).reduce((s, p) => s + p.text.split(/\s+/).length, 0);
    const boilerplateShare = e.wordCount ? Math.min(1, boilerWords / e.wordCount) : 0;
    const originality = (e.mainText.match(ORIGINAL) ?? []).length;
    const age = ageDays(e.dateModified, e.datePublished, ...e.visibleDates.slice(0, 3));
    const h2 = e.headings.filter((h) => h.level === 2).length;
    const signals: PageContentEval['signals'] = {
      answerFirst,
      firstParagraph: fp ? truncate(fp, 300) : undefined,
      definitions: e.definitions.length,
      numbers: e.numbers,
      examples: e.examples,
      lists: e.lists + e.orderedLists + e.definitionLists,
      tables: e.tables,
      questionHeadings: e.questionHeadings.length,
      faq: e.faqBlocks,
      externalRefs: e.externalRefs.length,
      authors: e.author.map((a) => a.name),
      datePublished: e.datePublished,
      dateModified: e.dateModified,
      ageDays: age,
      originality,
      boilerplateShare: Math.round(boilerplateShare * 100) / 100,
      h2,
    };
    const lengthScore = e.wordCount >= 800 ? 100 : e.wordCount >= 400 ? 80 : e.wordCount >= 200 ? 55 : e.wordCount >= 80 ? 30 : 10;
    const offeringNamed = !offeringTerms.size || [...topicTerms].some((t) => offeringTerms.has(t)) || kind !== 'service';
    const scores = {
      clarity: clamp((topic ? 30 : 0) + (e.title ? 15 : 0) + (e.metaDescription ? 10 : 0) + (answerFirst ? 30 : 0) + (offeringNamed ? 15 : 0)),
      answerability: clamp((answerFirst ? 30 : 0) + Math.min(25, e.questionHeadings.length * 8) + Math.min(20, e.definitions.length * 10) + Math.min(15, e.faqBlocks * 8) + lengthScore * 0.1),
      evidence: clamp(Math.min(40, e.numbers * 6) + Math.min(30, e.externalRefs.length * 10) + Math.min(30, e.examples * 10)),
      structure: clamp(Math.min(35, h2 * 9) + Math.min(25, (e.lists + e.orderedLists) * 10) + Math.min(20, e.tables * 15) + (e.landmarks.main ? 10 : 0) + (e.headings.filter((h) => h.level === 1).length === 1 ? 10 : 0)),
      authorship: clamp((e.author.length ? 60 : 0) + (e.author.some((a) => a.url) ? 20 : 0) + (kind === 'article' ? 0 : 20)),
      freshness: age === null ? null : clamp(age <= 180 ? 100 : age <= 365 ? 80 : age <= 730 ? 55 : age <= 1460 ? 30 : 10),
      originality: clamp(Math.min(50, originality * 15) + (1 - boilerplateShare) * 50),
    };
    const citationPotential = clamp(
      scores.answerability * 0.25 + scores.evidence * 0.2 + scores.originality * 0.15 + scores.structure * 0.15 + scores.clarity * 0.1 + scores.authorship * 0.1 + (scores.freshness ?? 50) * 0.05,
    );
    const strengths: string[] = [];
    const missing: string[] = [];
    if (answerFirst) strengths.push('Közvetlen, összefoglaló nyitóbekezdés');
    else missing.push('Az első bekezdés nem foglalja össze a választ');
    if (e.definitions.length) strengths.push(`${e.definitions.length} definíció jellegű mondat`);
    if (e.numbers >= 3) strengths.push(`${e.numbers} konkrét számadat`);
    else missing.push('Kevés konkrét számadat/tény');
    if (e.externalRefs.length) strengths.push(`${e.externalRefs.length} külső forráshivatkozás a tartalomban`);
    else if (e.numbers >= 3 || kind === 'article') missing.push('Nincs külső forráshivatkozás');
    if (e.questionHeadings.length) strengths.push(`${e.questionHeadings.length} kérdés formájú címsor`);
    if (e.tables) strengths.push(`${e.tables} táblázat`);
    if (originality) strengths.push('Saját tapasztalatra/adatra utaló tartalom');
    if (kind === 'article' && !e.author.length) missing.push('Nincs azonosítható szerző');
    if (kind === 'article' && !e.datePublished && !e.dateModified) missing.push('Nincs dátum');
    if (boilerplateShare > 0.5) missing.push(`A szöveg ${Math.round(boilerplateShare * 100)}%-a sablonszöveg`);
    if (e.wordCount > 600 && h2 < 2 && !e.lists && !e.tables) missing.push('Tagolatlan hosszú szöveg');
    evals.push({ url: r.url, kind, topic, words: e.wordCount, signals, scores, citationPotential, strengths, missing });

    // problémák a fontos tartalmi oldalakon (jogi/kapcsolat oldalakat nem terheljük)
    if (kind === 'legal' || kind === 'contact') continue;
    // közvetlen nyitóválaszt a kérdésre válaszoló oldaltípusoktól várunk (nem lista-, karrier- vagy egyéb oldalaktól)
    const key = kind === 'service' || kind === 'product' || kind === 'home' || kind === 'article';
    if (key && !answerFirst && e.wordCount >= 80) ic.add('no_answer_first', CONTENT.no_answer_first, { url: r.url, detail: fp ? `Első bekezdés (${fpWords} szó): „${truncate(fp, 160)}”` : 'Nem található érdemi nyitóbekezdés a H1 után.' });
    if (e.wordCount >= 300 && e.numbers === 0 && e.definitions.length === 0 && e.examples === 0) ic.add('no_specifics', CONTENT.no_specifics, { url: r.url, detail: `${e.wordCount} szó, de 0 számadat, 0 definíció, 0 példa.` });
    if ((kind === 'article' || e.numbers >= 5) && !e.externalRefs.length && e.wordCount >= 300) ic.add('no_sources', CONTENT.no_sources, { url: r.url, detail: `${e.numbers} számadat, külső forrás nélkül.` });
    if (kind === 'article' && !e.author.length) ic.add('no_author', CONTENT.no_author, { url: r.url, detail: 'Nincs meta author, rel=author, byline vagy JSON-LD author.' });
    if (kind === 'article' && !e.datePublished && !e.dateModified && !e.visibleDates.length) ic.add('no_dates', CONTENT.no_dates, { url: r.url, detail: 'Nincs datePublished/dateModified és látható dátum sem.' });
    if (age !== null && age > 730 && (kind === 'article' || kind === 'service')) ic.add('stale', CONTENT.stale, { url: r.url, detail: `Legutóbbi azonosított dátum ${Math.round(age / 30)} hónapja (${e.dateModified ?? e.datePublished ?? e.visibleDates[0]}).` });
    if (boilerplateShare > 0.5 && e.wordCount >= 100) ic.add('boilerplate', CONTENT.boilerplate, { url: r.url, detail: `A fő tartalom ${Math.round(boilerplateShare * 100)}%-a legalább ${Math.round(threshold)} oldalon ismétlődik.` });
    if (e.wordCount > 600 && h2 < 2 && !e.lists && !e.orderedLists && !e.tables) ic.add('no_structure', CONTENT.no_structure, { url: r.url, detail: `${e.wordCount} szó, ${h2} H2, lista/táblázat nélkül.` });
  }
  const avg = (k: keyof PageContentEval['scores'] | 'citationPotential') => {
    const vals = evals.map((x) => (k === 'citationPotential' ? x.citationPotential : x.scores[k])).filter((v): v is number => v !== null);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };
  return {
    issues: ic,
    report: {
      pages: evals,
      averages: { clarity: avg('clarity'), answerability: avg('answerability'), evidence: avg('evidence'), structure: avg('structure'), authorship: avg('authorship'), freshness: avg('freshness'), originality: avg('originality'), citationPotential: avg('citationPotential') },
      note: 'A tartalmi pontok determinisztikus, szövegből mért jeleken alapulnak (pl. számadatok, definíciók, forráslinkek, címsorok). A Citation Potential algoritmikus becslés, nem tényleges AI-idézés mérése. Plágiumot vagy internetes duplikációt külső összehasonlítás nélkül nem állítunk.',
    },
  };
}
