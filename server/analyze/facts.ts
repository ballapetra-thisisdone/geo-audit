// HTML → PageFacts. Ugyanazt a kinyerést futtatjuk a nyers, a renderelt és a mentett HTML-re.
import * as cheerio from 'cheerio';
import type { PageFacts } from '../../shared/types.ts';

const GENERIC_ANCHORS = /^(tovább|tovább olvasom|részletek|bővebben|kattints ide|kattintson ide|ide|itt|read more|more|learn more|click here|megnézem|>|»|→)$/i;
const CONSENT = [
  ['Cookiebot', /cookiebot/i],
  ['OneTrust', /onetrust|optanon/i],
  ['Complianz', /complianz|cmplz/i],
  ['CookieYes', /cookieyes|cky-consent/i],
  ['Borlabs', /borlabs/i],
  ['Usercentrics', /usercentrics/i],
  ['Iubenda', /iubenda/i],
  ['Cookie Notice', /cookie-notice|cn-notice/i],
  ['Termly', /termly/i],
] as const;

function collectTypes(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out));
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const t = o['@type'];
    if (typeof t === 'string') out.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && out.add(x));
    for (const v of Object.values(o)) if (v && typeof v === 'object') collectTypes(v, out);
  }
}

export function extractFacts(html: string, pageUrl: string): PageFacts {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const host = base.hostname.replace(/^www\./, '');
  const meta = (sel: string) => $(sel).first().attr('content')?.trim();

  const robotsMeta: Record<string, string> = {};
  $('meta[name]').each((_, el) => {
    const name = ($(el).attr('name') ?? '').toLowerCase();
    if (['robots', 'bingbot', 'googlebot', 'msnbot', 'oai-searchbot', 'gptbot', 'chatgpt-user'].includes(name)) {
      robotsMeta[name] = ($(el).attr('content') ?? '').toLowerCase();
    }
  });

  const og: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    og[$(el).attr('property')!] = $(el).attr('content') ?? '';
  });

  const headings: PageFacts['headings'] = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    headings.push({ level: Number(el.tagName.slice(1)), text: $(el).text().replace(/\s+/g, ' ').trim() });
  });

  const jsonld: PageFacts['jsonld'] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    try {
      const parsed = JSON.parse(raw);
      const types = new Set<string>();
      collectTypes(parsed, types);
      jsonld.push({ raw, parsed, types: [...types] });
    } catch (e) {
      jsonld.push({ raw, error: (e as Error).message, types: [] });
    }
  });

  const links = { internal: 0, external: 0, empty: 0, generic: [] as string[], params: 0 };
  const pdfs = new Set<string>();
  let tel = 0;
  let mailto = 0;
  let impressum = false;
  let about = false;
  let contactPage = false;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const label = text || $(el).attr('aria-label') || $(el).find('img').attr('alt') || '';
    if (href.startsWith('tel:')) return void tel++;
    if (href.startsWith('mailto:')) return void mailto++;
    const lowText = text.toLowerCase();
    if (/impresszum|impressum|imprint/.test(lowText)) impressum = true;
    if (/rólunk|rolunk|about|bemutatkoz|csapat|team|kik vagyunk/.test(lowText)) about = true;
    if (/kapcsolat|contact|elérhetőség/.test(lowText)) contactPage = true;
    if (href.startsWith('#') || href.startsWith('javascript:')) return;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    const internal = u.hostname.replace(/^www\./, '') === host;
    if (internal) links.internal++;
    else links.external++;
    if (!label.trim()) links.empty++;
    else if (GENERIC_ANCHORS.test(label.trim()) && links.generic.length < 30) links.generic.push(label.trim());
    if (internal && u.search && !/^\?(p|page_id)=\d+$/.test(u.search)) links.params++;
    if (/\.pdf($|\?)/i.test(u.pathname)) pdfs.add(u.toString());
    const hay = `${u.pathname} ${text}`.toLowerCase();
    if (/impresszum|impressum|imprint/.test(hay)) impressum = true;
    if (/rolunk|rólunk|about|bemutatkoz|csapat|team|kik-vagyunk/.test(hay)) about = true;
    if (/kapcsolat|contact|elerhetoseg|elérhetőség/.test(hay)) contactPage = true;
  });

  const iframes: string[] = [];
  $('iframe').each((_, el) => {
    iframes.push($(el).attr('src') ?? $(el).attr('data-src') ?? '(src nélkül)');
  });
  const maps =
    iframes.filter((s) => /google\.[a-z.]+\/maps|maps\.google|openstreetmap|mapbox|bing\.com\/maps/i.test(s)).length +
    $('.leaflet-container, .gm-style, [class*="mapsvg"], .acf-map').length;
  const sliders = $('.swiper, .swiper-container, .slick-slider, .owl-carousel, .splide, .flickity-enabled, .glide, [class*="carousel"]').length;
  const videos = $('video').length + iframes.filter((s) => /youtube|vimeo|wistia/i.test(s)).length;

  const imgs = $('img');
  let missingAlt = 0;
  let emptyAlt = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt === undefined) missingAlt++;
    else if (!alt.trim()) emptyAlt++;
  });

  const scriptsExternal = new Set<string>();
  let scriptsTotal = 0;
  $('script').each((_, el) => {
    scriptsTotal++;
    const src = $(el).attr('src');
    if (!src) return;
    try {
      const h = new URL(src, base).hostname;
      if (h.replace(/^www\./, '') !== host) scriptsExternal.add(h);
    } catch {
      /* hibás src */
    }
  });

  const consent = CONSENT.filter(([, re]) => re.test(html)).map(([name]) => name);
  const adminBar = $('#wpadminbar').length > 0 || /\badmin-bar\b/.test($('body').attr('class') ?? '');
  const footerText = $('footer').last().text().replace(/\s+/g, ' ').trim().slice(0, 600) || undefined;

  // Szöveg a robotok szemszögéből: szkript/stílus nélkül.
  const $text = cheerio.load(html);
  $text('script,style,noscript,template,svg').remove();
  const text = $text('body').text().replace(/\s+/g, ' ').trim();

  const dates = [
    ...new Set(
      (text.match(/(?:frissítve|módosítva|utolsó módosítás|updated|last updated)[:\s]+[^.|]{0,40}/gi) ?? []).map((s) => s.trim()),
    ),
  ].slice(0, 10);

  const address = $('address').length > 0 || /\b\d{4}\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+,?\s/.test(footerText ?? '');

  return {
    title: $('title').first().text().replace(/\s+/g, ' ').trim() || undefined,
    metaDescription: meta('meta[name="description"]'),
    canonical: $('link[rel="canonical"]').map((_, el) => $(el).attr('href') ?? '').get(),
    robotsMeta,
    lang: $('html').attr('lang')?.trim(),
    hreflang: $('link[rel="alternate"][hreflang]')
      .map((_, el) => ({ lang: $(el).attr('hreflang') ?? '', href: $(el).attr('href') ?? '' }))
      .get(),
    og,
    viewport: meta('meta[name="viewport"]'),
    generator: meta('meta[name="generator"]'),
    msvalidate: $('meta[name="msvalidate.01"]').length > 0,
    headings,
    landmarks: {
      main: $('main, [role="main"]').length,
      header: $('header').length,
      nav: $('nav').length,
      footer: $('footer').length,
      article: $('article').length,
    },
    links,
    images: { total: imgs.length, missingAlt, emptyAlt },
    iframes,
    videos,
    sliders,
    maps,
    pdfs: [...pdfs],
    tables: $('table').length,
    dls: $('dl').length,
    jsonld,
    microdata: $('[itemscope]').length,
    textLength: text.length,
    text: text.slice(0, 200000),
    adminBar,
    scripts: { total: scriptsTotal, external: [...scriptsExternal].sort() },
    consent,
    footerText,
    contact: { tel, mailto, impressum, about, contactPage, address },
    dates,
  };
}

/** Normalizált keresés: kis-nagybetű, szóközök és nem törő szóközök egységesítése. */
export function normalize(s: string) {
  return s.toLowerCase().replace(/[\s  ]+/g, ' ').trim();
}

export function containsValue(haystack: string, value: string) {
  const h = normalize(haystack);
  const v = normalize(value);
  if (h.includes(v)) return true;
  // számoknál szóköz/pont nélkül is (89 900 ↔ 89.900 ↔ 89900)
  if (/\d/.test(v)) {
    const strip = (s: string) => s.replace(/[\s.,]/g, '');
    return strip(h).includes(strip(v));
  }
  return false;
}
