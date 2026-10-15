// LLM-alapú szemantikai feladatok. Minden kimenetet ellenőrzünk: az idézett szövegrészeknek szó szerint
// szerepelniük kell a megadott forrásszövegben, különben az állítást elvetjük.
import * as z from 'zod/v4';
import type { Coverage } from '../../../shared/site.ts';
import { untrusted, type LlmProvider } from './provider.ts';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const isQuoteOf = (quote: string, source: string) => !!quote && norm(source).includes(norm(quote).slice(0, 200));

const PageEvalSchema = z.object({
  summary: z.string().describe('Az oldal fő témája egy mondatban.'),
  mainQuestion: z.string().describe('A fő felhasználói kérdés, amelyre az oldal válaszolni hivatott.'),
  answered: z.enum(['yes', 'partial', 'no']),
  missing: z.array(z.string()).describe('Legfeljebb 5 konkrét hiányzó információ, amely a teljes válaszhoz kellene.'),
  claimsWithoutEvidence: z.array(z.string()).describe('Legfeljebb 3 szó szerinti idézet az oldalról: állítás, amely mögött nincs bizonyíték/forrás.'),
});
export type PageEval = z.infer<typeof PageEvalSchema>;

export async function llmPageEval(p: LlmProvider, url: string, title: string, text: string, lang: string): Promise<PageEval> {
  const res = await p.json(
    'page_eval.v1',
    PageEvalSchema,
    `Tartalmi GEO-auditor vagy. Feladat: egy weboldal tartalmának értékelése abból a szempontból, mennyire ad egyértelmű, ellenőrizhető választ a célközönség fő kérdésére. A válasz nyelve: ${lang === 'en' ? 'angol' : 'magyar'}. Ne találj ki tényeket; a hiányzó információnál azt írd le, MI hiányzik, ne azt, hogy mi a helyes érték.`,
    `URL: ${url}\nCím: ${title}\n\n${untrusted(url, text)}`,
    'low',
  );
  res.claimsWithoutEvidence = res.claimsWithoutEvidence.filter((c) => isQuoteOf(c, text)).slice(0, 3);
  res.missing = res.missing.slice(0, 5);
  return res;
}

const JudgeSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      coverage: z.enum(['full', 'partial', 'missing']),
      passageIndex: z.number().int().describe('A legjobb válaszrészlet indexe (0-tól), vagy -1, ha egyik sem válaszol.'),
      quote: z.string().describe('Szó szerinti idézet a választ adó részletből; üres, ha nincs.'),
      reason: z.string().describe('Rövid indoklás (max. 1 mondat).'),
    }),
  ),
});

export interface JudgeItem {
  id: string;
  query: string;
  passages: { url: string; text: string }[];
}

export async function llmJudgeQueries(p: LlmProvider, items: JudgeItem[], lang: string) {
  const body = items
    .map((it) => `### Kérdés id=${it.id}: ${it.query}\n${it.passages.map((ps, i) => `[${i}] ${ps.url}\n${untrusted(ps.url, ps.text, 1800)}`).join('\n')}`)
    .join('\n\n');
  const res = await p.json(
    'judge_queries.v1',
    JudgeSchema,
    `Megválaszolhatósági értékelő vagy. Minden kérdésnél döntsd el, hogy a megadott szövegrészletek teljesen (full), részben (partial) vagy egyáltalán nem (missing) válaszolják-e meg a kérdést. Teljes válasz: a kérdésre egyértelmű, konkrét választ ad, nem csak említi a témát. Az idézet szó szerint a részletből származzon. Nyelv: ${lang === 'en' ? 'angol' : 'magyar'}.`,
    body,
    'low',
  );
  const out = new Map<string, { coverage: Coverage; url?: string; quote?: string; reason: string }>();
  for (const r of res.results) {
    const it = items.find((x) => x.id === r.id);
    if (!it) continue;
    const ps = it.passages[r.passageIndex];
    // ellenőrzés: ha az idézet nem szerepel a részletben, az ítéletet nem fogadjuk el teljesnek
    const quoteOk = ps ? isQuoteOf(r.quote, ps.text) : false;
    const coverage: Coverage = r.coverage !== 'missing' && !quoteOk ? 'partial' : r.coverage;
    out.set(r.id, { coverage: r.coverage === 'missing' ? 'missing' : coverage, url: ps?.url, quote: quoteOk ? r.quote : undefined, reason: r.reason + (r.coverage !== 'missing' && !quoteOk ? ' [az idézet nem volt ellenőrizhető – részlegesre módosítva]' : '') });
  }
  return out;
}

const DraftSchema = z.object({
  answer: z.string().describe('40–80 szavas közvetlen válasz, CSAK a megadott szövegben szereplő tényekkel.'),
  factsUsed: z.array(z.string()).describe('A válaszban felhasznált tények szó szerinti idézetei a forrásszövegből.'),
  gaps: z.array(z.string()).describe('Amit a teljes válaszhoz a tartalomgazdától kell beszerezni.'),
});

export async function llmAnswerDraft(p: LlmProvider, query: string, url: string, text: string, lang: string) {
  const res = await p.json(
    'answer_draft.v1',
    DraftSchema,
    `Tartalomszerkesztő vagy. Írj egy rövid, önállóan érthető válaszblokkot a kérdésre, kizárólag a megadott oldal szövegében szereplő tényekből. Ha egy szükséges adat nincs a szövegben, ne találd ki: írd a "gaps" listába. Nyelv: ${lang === 'en' ? 'angol' : 'magyar'}.`,
    `Kérdés: ${query}\nForrásoldal: ${url}\n\n${untrusted(url, text, 9000)}`,
    'medium',
  );
  const verified = res.factsUsed.filter((f) => isQuoteOf(f, text));
  return { ...res, verified: verified.length === res.factsUsed.length && verified.length > 0, factsUsed: res.factsUsed, unverifiedFacts: res.factsUsed.filter((f) => !isQuoteOf(f, text)) };
}
