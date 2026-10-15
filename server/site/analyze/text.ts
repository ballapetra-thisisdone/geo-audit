// Nyelvfüggetlen szövegsegédek: tokenizálás, stopszavak (hu/en/de), nyelvfelismerés, egyszerű tővágás, BM25.

const STOP: Record<string, Set<string>> = {
  hu: new Set(
    'a az és egy is nem hogy de ha meg mint már csak még vagy volt van lesz lehet kell minden ez ezt azt ezek azok itt ott mi mit ki kik mely melyik amely amelyek ami amit aki akik pedig vagyunk vagyok vannak mert így úgy igen szerint után előtt alatt felett között között által miatt kívül nélkül számára való valamint illetve sem se tehát akkor amikor ahol hol hogyan miért mennyi milyen mikor sok több kevés nagyon jól jó új régi egyik másik saját minden mindig soha most majd újra már ön önök te ti mi ők neki nekik őt őket rá rajta róla benne vele velük hozzá tőle oda ide fel le ki be el át vissza össze rész része teljes egész tovább további továbbá olyan ilyen azonban mivel valami semmi bármi bármely ennek annak ebben abban ezzel azzal erre arra ezért azért minket nekünk velünk nálunk tőlünk hozzánk bennünket önnek keress írj kérj nézd olvass tervezz lépj kattints megnézem'
      .split(' '),
  ),
  en: new Set(
    'a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that these those there here we you they he she i me my our your their them his her not no yes can could will would should shall may might must do does did done have has had having about into over under more most less least very also just only than too so such what which who whom whose when where why how all any each few other some own same both up down out off again further once per via our us'
      .split(' '),
  ),
  de: new Set('der die das und oder aber wenn dann von zu im in am an auf mit für aus als ist sind war waren sein es dies diese dieser wir sie er ich nicht kein ja kann wird werden hat haben über unter mehr sehr auch nur so was wer wie wo warum alle jede einige'.split(' ')),
};

export function detectLanguage(text: string, htmlLang?: string): { lang: string | null; confidence: number; source: string } {
  const sample = text.toLowerCase().slice(0, 20000).split(/[^\p{L}]+/u).filter(Boolean);
  const scores = Object.entries(STOP).map(([l, s]) => [l, sample.filter((w) => s.has(w)).length / Math.max(1, sample.length)] as const);
  scores.sort((a, b) => b[1] - a[1]);
  const [best, score] = scores[0];
  const declared = htmlLang?.toLowerCase().slice(0, 2);
  if (sample.length < 30) return { lang: declared ?? null, confidence: declared ? 0.5 : 0, source: declared ? 'html lang attribútum' : 'nincs elég szöveg' };
  if (declared && declared === best) return { lang: best, confidence: 0.95, source: 'html lang + szövegstatisztika egyezik' };
  if (score < 0.05) return { lang: declared ?? null, confidence: 0.4, source: 'html lang (a szövegstatisztika bizonytalan)' };
  return { lang: best, confidence: declared ? 0.7 : 0.8, source: declared ? `szövegstatisztika (a html lang="${htmlLang}" eltér)` : 'szövegstatisztika' };
}

export function stopwords(lang: string | null | undefined): Set<string> {
  return STOP[lang ?? 'hu'] ?? new Set([...STOP.hu, ...STOP.en]);
}

const HU_SUFFIX = /(oknak|eknek|aknak|ainak|einek|jainak|jeinek|ának|ének|okat|eket|akat|öket|okban|ekben|akban|okból|ekből|okkal|ekkel|ában|ében|ából|éből|ával|ével|ának|ént|ként|ról|ről|ból|ből|ban|ben|nak|nek|val|vel|hoz|hez|höz|tól|től|nál|nél|ra|re|ba|be|on|en|ön|ok|ek|ak|ök|ai|ei|ja|je|át|ét|ot|et|at|öt|t)$/;

/** Durva tővágás – lekérdezés–szöveg egyeztetéshez elég, nyelvészeti pontosságot nem állítunk. */
export function stem(w: string, lang?: string | null): string {
  if (w.length <= 4 || /\d/.test(w)) return w;
  if (lang === 'en') return w.replace(/(ingly|edly|ing|ed|ies|es|s)$/, (m) => (m === 'ies' ? 'y' : '')) || w;
  if (lang === 'de') return w.replace(/(en|er|es|e|n|s)$/, '') || w;
  const s = w.replace(HU_SUFFIX, '');
  return s.length >= 3 ? s : w;
}

export function tokens(text: string, lang?: string | null, keepStop = false): string[] {
  const stop = stopwords(lang);
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && (keepStop || !stop.has(w)))
    .map((w) => stem(w, lang));
}

export class Bm25<T> {
  private docs: { item: T; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avg = 0;
  constructor(
    items: T[],
    text: (t: T) => string,
    private lang?: string | null,
  ) {
    for (const item of items) {
      const toks = tokens(text(item), lang);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ item, tf, len: toks.length });
    }
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }
  search(query: string, k = 5): { item: T; score: number; matched: string[]; terms: string[] }[] {
    const q = [...new Set(tokens(query, this.lang))];
    const N = this.docs.length;
    const res = this.docs.map((d) => {
      let score = 0;
      const matched: string[] = [];
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        matched.push(t);
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / (this.avg || 1))));
      }
      return { item: d.item, score, matched, terms: q };
    });
    return res.filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/** TF-IDF kulcskifejezések (uni- és bigramok) dokumentumkészletből. */
export function keyPhrases(docs: { text: string; weight?: number }[], lang: string | null, limit = 30): { phrase: string; score: number; df: number }[] {
  const stop = stopwords(lang);
  const df = new Map<string, number>();
  const tf = new Map<string, number>();
  for (const d of docs) {
    const words = d.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !/^\d+$/.test(w));
    const seen = new Set<string>();
    const grams: string[] = [];
    for (let i = 0; i < words.length; i++) {
      if (!stop.has(words[i])) grams.push(words[i]);
      if (i + 1 < words.length && !stop.has(words[i]) && !stop.has(words[i + 1])) grams.push(`${words[i]} ${words[i + 1]}`);
    }
    for (const g of grams) {
      tf.set(g, (tf.get(g) ?? 0) + (d.weight ?? 1));
      if (!seen.has(g)) {
        seen.add(g);
        df.set(g, (df.get(g) ?? 0) + 1);
      }
    }
  }
  const N = docs.length || 1;
  const out = [...tf.entries()]
    .filter(([g]) => (df.get(g) ?? 0) >= Math.min(2, N) || g.includes(' '))
    .map(([g, f]) => {
      const d = df.get(g) ?? 1;
      // a minden oldalon szereplő (sablon) kifejezések lefelé súlyozva
      const spread = d / N > 0.8 && N > 3 ? 0.2 : 1;
      return { phrase: g, score: f * Math.log(1 + N / d) * spread * (g.includes(' ') ? 1.6 : 1), df: d };
    })
    .sort((a, b) => b.score - a.score);
  // átfedő unigramok kiszűrése, ha a bigram erősebb
  const picked: typeof out = [];
  for (const o of out) {
    if (picked.length >= limit) break;
    if (picked.some((p) => p.phrase.includes(o.phrase) || o.phrase.includes(p.phrase))) continue;
    picked.push(o);
  }
  return picked;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function tfVector(text: string, lang?: string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens(text, lang)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
