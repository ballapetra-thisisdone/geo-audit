// HTML → ExtractedPage. Determinisztikus kinyerés; ugyanezt futtatjuk a nyers és a renderelt HTML-re.
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { ExtractedPage, Passage } from '../../../shared/site.ts';
import { hostKey } from '../crawl/url.ts';

const BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,td,th,blockquote,figcaption,summary,pre';
const NOISE_SEL =
  'script,style,noscript,template,svg,iframe,form,button,[role="navigation"],nav,header,footer,aside,' +
  '#cookie-notice,.cookie,.cookies,[class*="cookie-banner"],[id*="cookie"],[class*="consent"],[aria-modal="true"]';
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|linkedin\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|pinterest\.com|wikipedia\.org|wikidata\.org|github\.com|threads\.net|bsky\.app)$/i;
const NUMBER_FACT =
  /\b\d{1,3}(?:[ . ]\d{3})*(?:[.,]\d+)?\s?(?:%|százalék|Ft|HUF|forint|EUR|€|\$|USD|km|m2|m²|kg|g|perc|óra|nap|hét|hónap|év|db|fő|ügyfél|projekt|years?|days?|hours?|minutes?|customers?|clients?|users?)\b/gi;
const EXAMPLES = /\b(például|pl\.|példa|esettanulmány|for example|e\.g\.|for instance|case study|example)\b/gi;
const DEF_PATTERNS = [
  /\b([A-ZÁÉÍÓÖŐÚÜŰ][\wÁÉÍÓÖŐÚÜŰáéíóöőúüű -]{2,60}?)\s+(?:egy|olyan|az a|nem más, mint)\s+[^.?!]{10,220}[.!]/g,
  /\b([A-ZÁÉÍÓÖŐÚÜŰ][\wÁÉÍÓÖŐÚÜŰáéíóöőúüű -]{2,60}?)\s+jelentése\s+[^.?!]{10,220}[.!]/g,
  /\b([A-Z][\w -]{2,60}?)\s+(?:is an?|is the|refers to|is defined as|means)\s+[^.?!]{10,220}[.!]/g,
];
const DATE_RE =
  /\b(20\d{2}|19\d{2})[-./ ]\s?(0?[1-9]|1[0-2])[-./ ]\s?(0?[1-9]|[12]\d|3[01])\.?|\b(20\d{2})\.\s?(január|február|március|április|május|június|július|augusztus|szeptember|október|november|december)\s?\d{1,2}\.?|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s\d{1,2},\s(20\d{2})/gi;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function zoneOf($: CheerioAPI, el: Element): ExtractedPage['links'][number]['zone'] {
  const $el = $(el);
  if ($el.closest('nav,[role="navigation"]').length) return 'nav';
  if ($el.closest('footer,[role="contentinfo"]').length) return 'footer';
  if ($el.closest('header,[role="banner"]').length) return 'header';
  if ($el.closest('aside,[role="complementary"]').length) return 'aside';
  return 'main';
}

function mainContainer($: CheerioAPI): Cheerio<AnyNode> {
  const main = $('main, [role="main"]').first();
  if (main.length && clean(main.text()).length > 200) return main;
  const articles = $('article');
  if (articles.length === 1 && clean(articles.text()).length > 200) return articles.first();
  return $('body').length ? $('body') : $.root();
}

function fnv1a64(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

/** 64 bites simhash szó-3-shingle-ökből (közel duplikált tartalom felismeréséhez). */
export function simhash(text: string): string {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (words.length < 3) return '0'.repeat(16);
  const v = new Array(64).fill(0);
  for (let i = 0; i + 2 < words.length; i++) {
    const h = fnv1a64(words.slice(i, i + 3).join(' '));
    for (let b = 0; b < 64; b++) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b);
  return out.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

function collectSchemaValues(node: unknown, key: string, out: unknown[], depth = 0) {
  if (depth > 6 || !node) return;
  if (Array.isArray(node)) return node.forEach((n) => collectSchemaValues(n, key, out, depth + 1));
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key) out.push(v);
      if (v && typeof v === 'object') collectSchemaValues(v, key, out, depth + 1);
    }
  }
}

function nameFrom(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(nameFrom);
  if (typeof v === 'object') {
    const n = (v as Record<string, unknown>).name;
    return typeof n === 'string' ? [n] : [];
  }
  return [];
}

function itemProps($: CheerioAPI, scope: Element, attr: 'itemprop' | 'property', scopeSel: string) {
  const props: Record<string, string[]> = {};
  $(scope)
    .find(`[${attr}]`)
    .each((_, el) => {
      if ($(el).parent().closest(scopeSel).get(0) !== scope) return;
      const $e = $(el);
      const val = clean($e.attr('content') ?? $e.attr('href') ?? $e.attr('src') ?? $e.attr('datetime') ?? $e.text()).slice(0, 300);
      for (const name of ($e.attr(attr) ?? '').split(/\s+/).filter(Boolean)) (props[name] ??= []).push(val);
    });
  return props;
}

export function extractPage(html: string, pageUrl: string, headers: Record<string, string> = {}): ExtractedPage {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const host = hostKey(base.hostname);
  const meta = (sel: string) => $(sel).first().attr('content')?.trim();

  // --- fej ---
  const metaRobots: string[] = [];
  $('meta[name]').each((_, el) => {
    const n = ($(el).attr('name') ?? '').toLowerCase();
    if (['robots', 'googlebot', 'bingbot'].includes(n)) metaRobots.push(`${n}: ${($(el).attr('content') ?? '').toLowerCase()}`);
  });
  const xRobotsTag = (headers['x-robots-tag'] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const og: Record<string, string> = {};
  $('meta[property^="og:"], meta[property^="article:"]').each((_, el) => void (og[$(el).attr('property')!] = $(el).attr('content') ?? ''));
  const twitter: Record<string, string> = {};
  $('meta[name^="twitter:"]').each((_, el) => void (twitter[$(el).attr('name')!] = $(el).attr('content') ?? ''));
  const headings: ExtractedPage['headings'] = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const text = clean($(el).text());
    if (text) headings.push({ level: Number(el.tagName.slice(1)), text: text.slice(0, 300) });
  });

  // --- strukturált adat ---
  const jsonld: ExtractedPage['jsonld'] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      jsonld.push({ raw: raw.slice(0, 50000), parsed: JSON.parse(raw) });
    } catch (e) {
      jsonld.push({ raw: raw.slice(0, 50000), error: (e as Error).message });
    }
  });
  const microdata: ExtractedPage['microdata'] = [];
  $('[itemscope][itemtype]').each((_, el) => {
    if (microdata.length >= 50) return;
    const type = ($(el).attr('itemtype') ?? '').split(/\s+/)[0].replace(/^https?:\/\/schema\.org\//i, '');
    microdata.push({ type, props: itemProps($, el, 'itemprop', '[itemscope]') });
  });
  const rdfa: ExtractedPage['rdfa'] = [];
  $('[typeof]').each((_, el) => {
    if (rdfa.length >= 50) return;
    const type = ($(el).attr('typeof') ?? '').split(/\s+/)[0].replace(/^(schema:|https?:\/\/schema\.org\/)/i, '');
    rdfa.push({ type, props: itemProps($, el, 'property', '[typeof]') });
  });

  // --- linkek ---
  const links: ExtractedPage['links'] = [];
  const pdfLinks = new Set<string>();
  const tel = new Set<string>();
  const email = new Set<string>();
  const socialProfiles = new Set<string>();
  const sig = { impressum: false, about: false, contact: false, privacy: false };
  $('a[href]').each((_, el) => {
    const hrefRaw = ($(el).attr('href') ?? '').trim();
    const text = clean($(el).text()) || clean($(el).attr('aria-label') ?? '') || clean($(el).find('img').attr('alt') ?? '');
    if (hrefRaw.startsWith('tel:')) return void tel.add(hrefRaw.slice(4).replace(/[^\d+]/g, ''));
    if (hrefRaw.startsWith('mailto:')) return void email.add(hrefRaw.slice(7).split('?')[0].toLowerCase());
    if (!hrefRaw || hrefRaw.startsWith('#') || /^(javascript|data):/i.test(hrefRaw)) return;
    let u: URL;
    try {
      u = new URL(hrefRaw, base);
    } catch {
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    const h = hostKey(u.hostname);
    const internal = h === host;
    const hay = `${u.pathname} ${text}`.toLowerCase();
    if (/impresszum|impressum|imprint|cégadatok|cegadatok/.test(hay)) sig.impressum = true;
    if (/rólunk|rolunk|about|bemutatkoz|csapat|team|kik-vagyunk|kik vagyunk/.test(hay)) sig.about = true;
    if (/kapcsolat|contact|elérhetőség|elerhetoseg/.test(hay)) sig.contact = true;
    if (/adatvédel|adatvedel|privacy|gdpr|adatkezel/.test(hay)) sig.privacy = true;
    if (!internal && SOCIAL.test(h)) socialProfiles.add(u.toString());
    if (/\.pdf$/i.test(u.pathname)) pdfLinks.add(u.toString());
    if (links.length < 1500) {
      links.push({ href: u.toString(), text: text.slice(0, 200), internal, zone: zoneOf($, el), nofollow: /nofollow/i.test($(el).attr('rel') ?? '') });
    }
  });

  // --- képek ---
  const main = mainContainer($);
  const mainEl = main.get(0);
  const images: ExtractedPage['images'] = [];
  $('img').each((_, el) => {
    if (images.length >= 300) return;
    const src = $(el).attr('src') ?? $(el).attr('data-src') ?? '';
    const alt = $(el).attr('alt');
    images.push({
      src: src.slice(0, 500),
      alt: alt === undefined ? null : alt,
      inMain: !!mainEl && (mainEl === el || $(el).parents().toArray().includes(mainEl as Element)) && zoneOf($, el) === 'main',
      textLikely: /banner|infogra|szoveg|text|slide|plakat|poster|flyer/i.test(src),
    });
  });

  // --- rejtett/dinamikus blokkok (a nyers DOM-ban) ---
  const hiddenBlocks: ExtractedPage['hiddenBlocks'] = [];
  const countText = (sel: string) => $(sel).filter((_, el) => clean($(el).text()).length > 40).length;
  const hb: [string, number][] = [
    ['details (összecsukott)', $('details:not([open])').filter((_, el) => clean($(el).text()).length > 40).length],
    ['[hidden] / aria-hidden', countText('[hidden], [aria-hidden="true"]')],
    ['inline display:none', countText('[style*="display:none"], [style*="display: none"]')],
    ['tab panel', countText('[role="tabpanel"], .tab-pane, .tabs-panel')],
    ['accordion / collapse', countText('.accordion-collapse, .collapse, .accordion-content, .elementor-tab-content')],
  ];
  for (const [kind, count] of hb) if (count) hiddenBlocks.push({ kind, count });
  const iframes = $('iframe').map((_, el) => $(el).attr('src') ?? $(el).attr('data-src') ?? '').get().filter(Boolean).slice(0, 30);
  const videos = $('video').length + iframes.filter((s) => /youtube|vimeo|wistia|videos?\./i.test(s)).length;

  // --- fő tartalom és szakaszok ---
  const $m = cheerio.load($.html(main) ?? '');
  // A <main>/<article> belsejében lévő <header> gyakran a cikk fejléce (H1) – azt ott nem dobjuk el.
  const scopedMain = main.is('main, [role="main"], article');
  $m(scopedMain ? 'script,style,noscript,template,svg,nav,[role="navigation"],footer,aside,form,button' : NOISE_SEL).remove();

  const passages: Passage[] = [];
  let current: Passage = { heading: '', text: '' };
  let firstParagraph: string | undefined;
  let sawH1 = false;
  $m(BLOCK_SEL).each((_, el) => {
    const $el = $m(el);
    if (el.tagName !== 'summary' && $el.find(BLOCK_SEL).length) return; // csak a levél-blokkok
    const text = clean($el.text());
    if (!text) return;
    if (/^h[1-6]$/.test(el.tagName)) {
      if (el.tagName === 'h1') sawH1 = true;
      if (current.text) passages.push(current);
      current = { heading: text.slice(0, 200), text: '' };
      return;
    }
    if (!firstParagraph && el.tagName === 'p' && text.length >= 40 && (sawH1 || !headings.some((h) => h.level === 1))) firstParagraph = text.slice(0, 600);
    current.text += (current.text ? ' ' : '') + text;
  });
  if (current.text) passages.push(current);
  let mainText = clean($m.root().text());
  if (!passages.length && mainText) passages.push({ heading: '', text: mainText.slice(0, 5000) });
  // Hosszú szakaszok darabolása (~120 szó), hogy a megválaszolhatósági keresés pontos legyen.
  const chunked: Passage[] = [];
  for (const p of passages) {
    const words = p.text.split(' ');
    if (words.length <= 160) chunked.push(p);
    else for (let i = 0; i < words.length; i += 120) chunked.push({ heading: p.heading, text: words.slice(i, i + 140).join(' ') });
  }
  mainText = mainText.slice(0, 120000);
  const wordCount = mainText ? mainText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;

  // --- szerző, dátumok ---
  const parsedLd = jsonld.filter((b) => b.parsed).map((b) => b.parsed);
  const author: ExtractedPage['author'] = [];
  const addAuthor = (name: string | undefined, source: string, url?: string) => {
    const n = clean(name ?? '');
    if (n && n.length < 80 && !author.some((a) => a.name.toLowerCase() === n.toLowerCase())) author.push({ name: n, source, url });
  };
  addAuthor(meta('meta[name="author"]'), 'meta author');
  $('a[rel~="author"]').each((_, el) => addAuthor($(el).text(), 'rel=author', $(el).attr('href')));
  $('[itemprop="author"]').each((_, el) => addAuthor($(el).find('[itemprop="name"]').text() || $(el).text(), 'microdata author'));
  $('.author-name, .byline .author, .post-author, .entry-author, [class*="author-name"]').slice(0, 5).each((_, el) => addAuthor($(el).text(), 'byline'));
  const ldAuthors: unknown[] = [];
  collectSchemaValues(parsedLd, 'author', ldAuthors);
  for (const a of ldAuthors) for (const n of nameFrom(a)) addAuthor(n, 'JSON-LD author');

  const ldPub: unknown[] = [];
  const ldMod: unknown[] = [];
  collectSchemaValues(parsedLd, 'datePublished', ldPub);
  collectSchemaValues(parsedLd, 'dateModified', ldMod);
  const firstStr = (arr: unknown[]) => arr.find((x): x is string => typeof x === 'string');
  const datePublished = og['article:published_time'] || firstStr(ldPub) || $('time[datetime]').first().attr('datetime') || undefined;
  const dateModified = og['article:modified_time'] || meta('meta[property="og:updated_time"]') || firstStr(ldMod) || undefined;
  const visibleDates = [...new Set((mainText.match(DATE_RE) ?? []).map(clean))].slice(0, 10);

  // --- breadcrumb ---
  let breadcrumb: string[] = [];
  const crumbs: unknown[] = [];
  collectSchemaValues(parsedLd, 'itemListElement', crumbs);
  for (const block of parsedLd) {
    const all: unknown[] = [];
    collectSchemaValues(block, '@type', all);
    if (all.includes('BreadcrumbList')) {
      const items = crumbs.flatMap((c) => (Array.isArray(c) ? c : [c])) as Record<string, unknown>[];
      breadcrumb = items.map((i) => (typeof i?.name === 'string' ? i.name : nameFrom(i?.item)[0] ?? '')).filter(Boolean).slice(0, 10);
      if (breadcrumb.length) break;
    }
  }
  if (!breadcrumb.length) {
    const bc = $('nav[aria-label*="breadcrumb" i], .breadcrumb, .breadcrumbs, [class*="breadcrumb"], #breadcrumbs').first();
    breadcrumb = bc.find('a, span[aria-current], li').map((_, el) => clean($(el).text())).get().filter((t) => t && t.length < 80).slice(0, 10);
    breadcrumb = [...new Set(breadcrumb)];
  }

  // --- tartalmi jelek ---
  const definitions: string[] = [];
  for (const re of DEF_PATTERNS) {
    for (const m of mainText.matchAll(re)) {
      if (definitions.length >= 10) break;
      definitions.push(m[0].slice(0, 260));
    }
  }
  const externalRefs = [
    ...new Set(links.filter((l) => !l.internal && l.zone === 'main' && !SOCIAL.test(hostKey(new URL(l.href).hostname))).map((l) => l.href)),
  ].slice(0, 50);
  const bodyText = clean($('body').text());
  for (const m of bodyText.matchAll(/(?:\+36|06)[\s-]?\(?\d{1,2}\)?[\s-]?\d{3}[\s-]?\d{3,4}/g)) tel.add(m[0].replace(/[^\d+]/g, ''));
  for (const m of bodyText.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) if (!/\.(png|jpe?g|webp|svg)$/i.test(m[0])) email.add(m[0].toLowerCase());
  const address = $('address').length > 0 || /\b\d{4}\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+,?\s+[A-ZÁÉÍÓÖŐÚÜŰ][\wáéíóöőúüű.\s-]{2,40}\s(utca|út|tér|krt\.?|körút|u\.|sétány|köz)\b/.test(bodyText);
  const faqBlocks =
    $('details').length +
    $('[class*="faq"], [id*="faq"], [class*="gyik"], [id*="gyik"]').length +
    (jsonld.some((b) => /"FAQPage"/.test(b.raw)) ? 1 : 0);

  const normalizedForHash = mainText.toLowerCase().replace(/\d+/g, '0');
  return {
    url: pageUrl,
    title: clean($('title').first().text()) || undefined,
    metaDescription: meta('meta[name="description"]'),
    metaRobots,
    xRobotsTag,
    canonical: $('link[rel="canonical"]').map((_, el) => $(el).attr('href') ?? '').get().filter(Boolean).map((h) => {
      try {
        return new URL(h, base).toString();
      } catch {
        return h;
      }
    }),
    lang: $('html').attr('lang')?.trim() || undefined,
    hreflang: $('link[rel="alternate"][hreflang]').map((_, el) => ({ lang: $(el).attr('hreflang') ?? '', href: $(el).attr('href') ?? '' })).get(),
    og,
    twitter,
    headings,
    landmarks: {
      main: $('main, [role="main"]').length,
      article: $('article').length,
      section: $('section').length,
      nav: $('nav, [role="navigation"]').length,
      header: $('header').length,
      footer: $('footer').length,
      aside: $('aside').length,
    },
    mainText,
    wordCount,
    passages: chunked.slice(0, 400),
    firstParagraph,
    links,
    images,
    jsonld,
    microdata,
    rdfa,
    breadcrumb,
    author,
    datePublished,
    dateModified,
    visibleDates,
    lists: $m('ul').length,
    orderedLists: $m('ol').length,
    tables: $m('table').length,
    definitionLists: $m('dl').length,
    faqBlocks,
    questionHeadings: headings.filter((h) => /\?\s*$/.test(h.text)).map((h) => h.text).slice(0, 40),
    definitions,
    numbers: (mainText.match(NUMBER_FACT) ?? []).length,
    examples: (mainText.match(EXAMPLES) ?? []).length,
    externalRefs,
    iframes,
    videos,
    pdfLinks: [...pdfLinks].slice(0, 100),
    hiddenBlocks,
    contactSignals: { tel: [...tel].filter((t) => t.length >= 8).slice(0, 10), email: [...email].slice(0, 10), address, ...sig },
    socialProfiles: [...socialProfiles].slice(0, 20),
    textHash: crypto.createHash('sha1').update(normalizedForHash).digest('hex'),
    simhash: simhash(mainText),
    scripts: $('script').length,
    generator: meta('meta[name="generator"]'),
  };
}
