// Üzleti kontextus automatikus felismerése a crawl adataiból. Minden értékhez forrás és bizonyosság tartozik;
// a felhasználói input elsőbbséget élvez. Ami üzletileg fontos, de nem következtethető ki, pontosítást kér.
import type { BusinessContext, SiteAuditInput } from '../../../shared/site.ts';
import type { SiteModel } from './model.ts';
import { detectLanguage, keyPhrases } from './text.ts';

const ORG_TYPES = /^(Organization|Corporation|LocalBusiness|ProfessionalService|MedicalBusiness|MedicalClinic|MedicalOrganization|Store|OnlineStore|Restaurant|LegalService|FinancialService|EducationalOrganization|NGO|HomeAndConstructionBusiness|Dentist|Physician|Hotel|LodgingBusiness|AutomotiveBusiness|HealthAndBeautyBusiness|TravelAgency|RealEstateAgent|SportsOrganization|NewsMediaOrganization|GovernmentOrganization)$/;
const OFFER_PATH = /\/(szolgaltatas|szolgáltatás|services?|termek|termékek|products?|kezeles|kezelesek|megoldas|megoldasok|solutions?|arak|pricing|csomag|kepzes|kurzus|courses?)/i;

export function walkLd(node: unknown, fn: (o: Record<string, unknown>) => void, depth = 0) {
  if (depth > 8 || !node) return;
  if (Array.isArray(node)) return node.forEach((n) => walkLd(n, fn, depth + 1));
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o['@type']) fn(o);
    for (const [k, v] of Object.entries(o)) if (k !== '@context' && v && typeof v === 'object') walkLd(v, fn, depth + 1);
  }
}

export const typesOf = (o: Record<string, unknown>) => {
  const t = o['@type'];
  return typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
};

const ctxBrandWords = (names: string[]) => names.flatMap((n) => n.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));

function vote(cands: { v: string; w: number; src: string }[]) {
  const m = new Map<string, { w: number; src: Set<string>; display: string }>();
  for (const c of cands) {
    const k = c.v.trim().toLowerCase();
    if (!k || k.length > 80) continue;
    const cur = m.get(k) ?? { w: 0, src: new Set(), display: c.v.trim() };
    cur.w += c.w;
    cur.src.add(c.src);
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.w - a.w);
}

export function detectContext(m: SiteModel, input: SiteAuditInput): BusinessContext {
  const pages = m.content.slice(0, 60);
  const home = m.home ? m.best(m.home.url) : undefined;
  const allText = pages.map((r) => m.best(r.url)?.mainText ?? '').join(' ').slice(0, 60000);
  const lang = input.language
    ? { lang: input.language, confidence: 1, source: 'felhasználói input' }
    : detectLanguage(allText, home?.lang);

  // szervezet / márka
  const orgCands: { v: string; w: number; src: string }[] = [];
  const people = new Set<string>();
  const offerFromSchema = new Set<string>();
  const geo = new Set<string>();
  let orgDescription: string | undefined;
  for (const r of pages) {
    const e = m.best(r.url)!;
    for (const b of e.jsonld) {
      walkLd(b.parsed, (o) => {
        const types = typesOf(o);
        const name = typeof o.name === 'string' ? o.name : undefined;
        if (types.some((t) => ORG_TYPES.test(t)) && name) {
          orgCands.push({ v: name, w: 3, src: 'JSON-LD Organization' });
          if (!orgDescription && typeof o.description === 'string') orgDescription = o.description;
          const addr = o.address as Record<string, unknown> | undefined;
          if (addr && typeof addr === 'object') {
            for (const k of ['addressLocality', 'addressCountry', 'addressRegion']) {
              const v = addr[k];
              if (typeof v === 'string') geo.add(v);
              else if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).name === 'string') geo.add((v as Record<string, string>).name);
            }
          }
        }
        if (types.includes('Person') && name) people.add(name);
        if ((types.includes('Service') || types.includes('Product')) && name) offerFromSchema.add(name);
      });
    }
    for (const md of [...e.microdata, ...e.rdfa]) {
      if (ORG_TYPES.test(md.type) && md.props.name?.[0]) orgCands.push({ v: md.props.name[0], w: 2, src: 'Microdata/RDFa' });
    }
    for (const a of e.author) people.add(a.name);
  }
  if (home?.og['og:site_name']) orgCands.push({ v: home.og['og:site_name'], w: 2.5, src: 'og:site_name' });
  // title-utótag: a legtöbb oldalon ismétlődő "… | Márka" rész
  const suffixes = new Map<string, number>();
  for (const r of pages) {
    const t = m.best(r.url)?.title;
    const parts = t?.split(/\s[|–—-]\s|\s·\s/);
    if (parts && parts.length > 1) {
      const s = parts[parts.length - 1].trim();
      suffixes.set(s, (suffixes.get(s) ?? 0) + 1);
    }
  }
  for (const [s, n] of suffixes) if (n >= Math.max(2, pages.length * 0.3)) orgCands.push({ v: s, w: 2, src: `title-utótag (${n} oldalon)` });
  const orgVotes = vote(orgCands);
  const org = orgVotes[0];

  // kínálat
  const offerPages = m.content.filter((r) => OFFER_PATH.test(new URL(r.url).pathname)).slice(0, 25);
  const offerFromPages = offerPages.map((r) => m.best(r.url)?.headings.find((h) => h.level === 1)?.text ?? '').filter((t) => t && t.length < 80);
  const offerings = input.products.length
    ? { value: input.products, confidence: 1, source: 'felhasználói input', evidence: [] }
    : offerFromSchema.size || offerFromPages.length
      ? {
          value: [...new Set([...offerFromSchema, ...offerFromPages])].slice(0, 20),
          confidence: offerFromSchema.size ? 0.75 : 0.55,
          source: offerFromSchema.size ? 'JSON-LD Service/Product + szolgáltatás-oldalak H1-je' : 'szolgáltatás/termék URL-mintájú oldalak H1-je',
          evidence: offerPages.map((r) => r.url).slice(0, 10),
        }
      : { value: [], confidence: 0, source: 'nem azonosítható', evidence: [] };

  // célközönség (gyenge jel)
  const aud = /(?:számára|nekik szól|célcsoport|for (?:small|medium|large)? ?(?:businesses|companies|teams|professionals|families|patients))[^.]{0,80}/i.exec(allText);
  // földrajz
  if (input.country) geo.add(input.country);
  const host = m.crawl.rootHost;
  const tld = host.split('.').pop()!;
  if (/^[a-z]{2}$/.test(tld) && !['io', 'co', 'ai', 'me', 'tv'].includes(tld)) geo.add(`.${tld} TLD`);
  for (const mm of allText.matchAll(/\b\d{4}\s(Budapest|Debrecen|Szeged|Miskolc|Pécs|Győr|Nyíregyháza|Kecskemét|Székesfehérvár|Szombathely|Szolnok|Tatabánya|Kaposvár|Érd|Veszprém|Zalaegerszeg|Sopron|Eger|Nagykanizsa|Dunaújváros|Hódmezővásárhely|Salgótarján|Cegléd|Baja|Vác|Gödöllő)\b/g)) geo.add(mm[1]);
  const hreflangs = new Set(pages.flatMap((r) => m.best(r.url)?.hreflang.map((h) => h.lang) ?? []));

  // témák
  // Témák csak title-ből és H1–H2 címsorokból (a törzsszöveg és a kártyacímkék túl zajosak), a sablonszerű
  // (az oldalak több mint felén ismétlődő) kifejezések nélkül; elsősorban többszavas kifejezések.
  const brandTitle = new RegExp(`\\s[|–—-]\\s*${(orgVotes[0]?.display ?? '§').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const phraseDocs = pages.map((r) => {
    const e = m.best(r.url)!;
    // csak a fő tartalom szakaszcímei (a lábléc/CTA-blokkok címsorai – „írj nekünk” – nem témák)
    const mainHeads = [...new Set(e.passages.map((p) => p.heading).filter(Boolean))];
    return { text: [(e.title ?? '').replace(brandTitle, ''), e.headings.find((h) => h.level === 1)?.text ?? '', ...mainHeads].join(' . '), weight: 1 + r.importance };
  });
  const N = phraseDocs.length;
  const ranked = keyPhrases(phraseDocs, lang.lang, 40).filter((p) => N < 6 || p.df / N <= 0.5);
  const phrases = [...ranked.filter((p) => p.phrase.includes(' ')), ...ranked.filter((p) => !p.phrase.includes(' ') && p.df >= 2).slice(0, 4)].slice(0, 15).map((p) => p.phrase);
  // a márkanév (és szavai) nem téma – írásjelek nélkül hasonlítunk ("DONE." → "done")
  const brandWords = new Set(ctxBrandWords(orgVotes.map((o) => o.display)));
  const topics = [...new Set([...input.topics, ...phrases.filter((p) => !p.split(' ').every((w) => brandWords.has(w)))])].slice(0, 15);

  // keresési szándékok
  const intents = new Set<string>(['informational']);
  if (pages.some((r) => /ár|árak|price|pricing|ajánlat|quote|kosár|cart|vásárl|buy|foglal|book|időpont/i.test(`${r.url} ${r.title}`))) intents.add('transactional');
  if (offerings.value.length) intents.add('commercial');
  if (geo.size) intents.add('local');
  if (org) intents.add('navigational');

  const clarifications: string[] = [];
  if (!offerings.value.length) clarifications.push('Nem azonosíthatók megbízhatóan a fő termékek/szolgáltatások – add meg őket az audit beállításainál.');
  if (!input.country && !geo.size) clarifications.push('A célország/piac nem következtethető ki – add meg, ha a lokális kérdések fontosak.');
  if (!org) clarifications.push('A szervezet neve nem azonosítható egyértelműen (nincs Organization schema, og:site_name vagy egységes title-utótag).');
  if (!input.competitors.length) clarifications.push('Nincs megadott key competitor: a versenytárs-összehasonlítás csak akkor fut, ha megadsz 3–10 domaint (vagy SERP/AI API-ból javaslunk).');

  return {
    language: { value: lang.lang, confidence: lang.confidence, source: lang.source },
    organization: org
      ? { value: org.display, confidence: Math.min(0.95, 0.4 + org.w / 10 + (org.src.size > 1 ? 0.2 : 0)), source: [...org.src].join(', '), evidence: orgVotes.slice(0, 5).map((o) => `${o.display} (${[...o.src].join(', ')})`) }
      : { value: null, confidence: 0, source: 'nem azonosítható' },
    brandVariants: orgVotes.map((o) => o.display).slice(0, 6),
    activity: orgDescription
      ? { value: orgDescription.slice(0, 400), confidence: 0.75, source: 'JSON-LD Organization.description' }
      : home?.metaDescription
        ? { value: home.metaDescription, confidence: 0.6, source: 'kezdőoldal meta description' }
        : home?.firstParagraph
          ? { value: home.firstParagraph.slice(0, 400), confidence: 0.4, source: 'kezdőoldal első bekezdése' }
          : { value: input.category ?? null, confidence: input.category ? 1 : 0, source: input.category ? 'felhasználói input' : 'nem azonosítható' },
    offerings,
    audience: aud ? { value: aud[0].slice(0, 160), confidence: 0.3, source: 'szöveges minta (gyenge jel)' } : { value: null, confidence: 0, source: 'nem azonosítható' },
    geo: { value: [...geo], confidence: input.country ? 1 : geo.size ? 0.6 : 0, source: input.country ? 'felhasználói input + webhely' : 'cím, TLD, JSON-LD', evidence: hreflangs.size ? [`hreflang: ${[...hreflangs].join(', ')}`] : [] },
    topics: { value: topics, confidence: input.topics.length ? 0.9 : 0.6, source: input.topics.length ? 'felhasználói input + TF-IDF' : 'TF-IDF kulcskifejezések (title, címsorok, fő szöveg)' },
    importantPages: { value: m.content.slice(0, 10).map((r) => r.url), confidence: 0.8, source: 'belső PageRank + kattintási mélység' },
    people: { value: [...people].slice(0, 30), confidence: people.size ? 0.7 : 0, source: 'JSON-LD Person, szerzői metaadatok, byline' },
    intents: { value: [...intents], confidence: 0.5, source: 'URL- és title-minták' },
    clarifications,
  };
}
