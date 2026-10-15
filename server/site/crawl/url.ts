// URL-normalizálás és domainhatárok.

const TRACKING = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|dclid|yclid|mc_cid|mc_eid|_ga|_gl|igshid|ref|ref_src|spm|srsltid|_hsenc|_hsmi|hsCtaTracking|mkt_tok|trk|cmpid|campaign)$/i;
const SESSION = /^(sid|sessionid|session_id|phpsessid|jsessionid|aspsessionid\w*|cfid|cftoken)$/i;
const NON_HTML = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|map|json|xml|txt|zip|rar|7z|gz|tar|mp3|mp4|m4a|wav|ogg|webm|mov|avi|wmv|flv|woff2?|ttf|otf|eot|exe|dmg|apk|docx?|xlsx?|pptx?|csv|rss|atom)$/i;

export type ParamMode = 'strip-tracking' | 'drop-all' | 'keep';

export function hostKey(host: string): string {
  return host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/** Normalizált URL: kisbetűs hoszt, alapport nélkül, fragment nélkül, rendezett és szűrt query. */
export function normalizeUrl(raw: string, base?: string, mode: ParamMode = 'strip-tracking'): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, '');
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  // dupla perjelek és /./ szegmensek; a kis-nagybetűt az útvonalban megtartjuk (szerverfüggő)
  u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/\.\//g, '/') || '/';
  if (mode === 'drop-all') u.search = '';
  else {
    const params = [...u.searchParams.entries()].filter(([k]) => mode === 'keep' || (!TRACKING.test(k) && !SESSION.test(k)));
    params.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
    u.search = params.length ? '?' + new URLSearchParams(params).toString() : '';
  }
  return u.toString();
}

export function isSameSite(url: string, rootHost: string, includeSubdomains: boolean): boolean {
  let h: string;
  try {
    h = hostKey(new URL(url).hostname);
  } catch {
    return false;
  }
  const root = hostKey(rootHost);
  return h === root || (includeSubdomains && h.endsWith('.' + root));
}

export function looksNonHtml(url: string): boolean {
  try {
    return NON_HTML.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

export function isPdf(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Lapozási paraméter vagy útvonal (?page=3, /page/3/). */
export function paginationIndex(url: string): number | null {
  try {
    const u = new URL(url);
    for (const k of ['page', 'paged', 'p', 'pg', 'oldal']) {
      const v = u.searchParams.get(k);
      if (v && /^\d+$/.test(v)) return Number(v);
    }
    const m = /\/(?:page|oldal)\/(\d+)\/?$/i.exec(u.pathname);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export function domainOf(url: string): string {
  try {
    return hostKey(new URL(url).hostname);
  } catch {
    return url;
  }
}

/** Felhasználói bemenet (domain vagy URL) → abszolút https URL. */
export function toStartUrl(input: string): string {
  const t = input.trim();
  if (!t) throw new Error('Üres domain/URL.');
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  const u = new URL(withProto);
  if (!u.pathname) u.pathname = '/';
  return u.toString();
}
