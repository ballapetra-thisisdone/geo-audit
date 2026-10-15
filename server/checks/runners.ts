// Automatikus ellenőrzés-futtatók. A kulcs a config/checks.json "impl" mezője.
// Minden futtató csak a begyűjtött adatokból dolgozik (nincs hálózati hívás), így egy check bármikor újrafuttatható.
import type { FetchResult, PageFacts, Snippet, Status } from '../../shared/types.ts';
import { containsValue, extractFacts } from '../analyze/facts.ts';
import { candidateTypes, flattenNodes, nameOf, ORG_TYPES, PAGE_TYPES, refsIn, STRUCTURAL_TYPES, typesOf } from '../analyze/jsonld.ts';
import { groupsFor, isAllowed } from '../collect/robots.ts';
import { sameUrl } from '../collect/util.ts';
import { r, worst, type CheckContext, type Runner } from './context.ts';
import * as cheerio from 'cheerio';

const fmtBytes = (b?: number) => (b === undefined ? '?' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const botName = (ctx: CheckContext, id: string) => ctx.bots.find((b) => b.id === id)?.name ?? id;
const browserFetch = (ctx: CheckContext) => ctx.a.fetches.find((f) => f.botId === 'browser');
const noRaw = () => r('unverifiable', 'A nyers HTML nem érhető el (a lekérés sikertelen).');
const noRender = () => r('unverifiable', 'A renderelt DOM nem érhető el (headless böngésző hiba).', { evidence: 'unverifiable' });

function robotsDecision(ctx: CheckContext, token: string) {
  if (!ctx.robots) return undefined;
  return isAllowed(ctx.robots, token, ctx.pagePath);
}

function robotsSnippet(ctx: CheckContext, token: string): Snippet[] {
  if (!ctx.robots) return [];
  const { groups } = groupsFor(ctx.robots, token);
  if (!groups.length) return [];
  const code = groups
    .map((g) => [...g.agents.map((a) => `User-agent: ${a}`), ...g.rules.map((x) => `${x.allow ? 'Allow' : 'Disallow'}: ${x.path}`)].join('\n'))
    .join('\n\n');
  return [{ label: `robots.txt – a(z) ${token} tokenre vonatkozó csoport`, code, lang: 'text' }];
}

function robotsBotRunner(token: string, label: string, failStatus: Status): Runner {
  return (ctx) => {
    if (ctx.a.robots?.status === 404) return r('pass', `Nincs robots.txt (404): a(z) ${label} mindent lekérhet.`);
    if (!ctx.robots) return r('unverifiable', `A robots.txt nem olvasható (${ctx.a.robots?.status ?? ctx.a.robots?.error ?? 'ismeretlen'}).`);
    const d = robotsDecision(ctx, token)!;
    const where = d.specific ? `saját csoport (${d.group})` : "a '*' csoport";
    return d.allowed
      ? r('pass', `A(z) ${label} engedélyezett a vizsgált útvonalon (${where}${d.rule ? `, ${d.rule}` : ''}).`, { snippets: robotsSnippet(ctx, token), data: d })
      : r(failStatus, `A(z) ${label} TILTVA a vizsgált útvonalon: ${d.rule} (${where}).`, { snippets: robotsSnippet(ctx, token), data: d });
  };
}

function hasNoindex(ctx: CheckContext, facts?: PageFacts) {
  const vals = Object.values(facts?.robotsMeta ?? {}).join(',');
  const xr = (browserFetch(ctx)?.headers['x-robots-tag'] ?? '').toLowerCase();
  return /noindex|none/.test(vals) || /noindex|none/.test(xr);
}

function keyValues(ctx: CheckContext) {
  return ctx.input.keyData.filter((k) => k.value && k.value.trim());
}

function altTexts(html?: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $('img[alt]').map((_, el) => $(el).attr('alt')).get().join(' | ');
}

function rawText(ctx: CheckContext, botId = 'browser') {
  const body = ctx.bodies.byBot[botId];
  if (!body) return undefined;
  return botId === 'browser' && ctx.raw ? ctx.raw.text : extractFacts(body, ctx.input.url).text;
}

export const runners: Record<string, Runner> = {
  // ---------------- 1. Feltérképezés ----------------
  savedHtml(ctx) {
    const saved = ctx.a.facts.saved;
    if (!saved) return r('na', 'Nem töltöttél fel mentett HTML-t.');
    const issues: string[] = [];
    let status: Status = 'pass';
    const rawBody = ctx.bodies.byBot['browser'];
    if (rawBody && ctx.bodies.saved && rawBody.trim() === ctx.bodies.saved.trim()) {
      issues.push('A mentett fájl byte-ra egyezik a szerver nyers válaszával: ez NEM a JS utáni DOM.');
      status = 'warn';
    } else if (ctx.raw && saved.textLength < ctx.raw.textLength * 0.9) {
      issues.push(`A mentett fájlban kevesebb a szöveg (${saved.textLength}), mint a nyers válaszban (${ctx.raw.textLength}): hiányozhatnak JS-sel betöltött elemek.`);
      status = 'warn';
    } else {
      issues.push(`Szöveghossz: mentett ${saved.textLength} · nyers ${ctx.raw?.textLength ?? '?'} · renderelt ${ctx.rendered?.textLength ?? '?'} karakter.`);
    }
    const canon = saved.canonical[0] ?? saved.og['og:url'];
    if (canon && !sameUrl(canon, ctx.input.url) && !sameUrl(canon, browserFetch(ctx)?.finalUrl ?? '')) {
      issues.push(`A mentett fájl canonical/og:url-je más oldalra mutat: ${canon}. Lehet, hogy nem a megnevezett oldal.`);
      status = 'warn';
    }
    if (ctx.raw?.title && saved.title && ctx.raw.title !== saved.title) {
      issues.push(`Eltérő title: mentett „${saved.title}” vs. élő „${ctx.raw.title}”.`);
      status = 'warn';
    }
    if (saved.adminBar) {
      issues.push('A fájlt bejelentkezett felhasználó mentette (WordPress admin sáv).');
      status = 'warn';
    }
    return r(status, status === 'pass' ? 'A mentett fájl a renderelt DOM-nak tűnik, és a megnevezett oldalé.' : 'A mentett fájllal kapcsolatban eltérések vannak.', {
      details: issues,
    });
  },

  httpStatus(ctx) {
    const core = ctx.a.fetches;
    if (!core.length) return noRaw();
    const details = core.map((f) => {
      const chain = f.redirects.map((x) => `${x.status} ${x.url}`).join(' → ');
      return `${botName(ctx, f.botId)}: ${f.ok ? f.status : 'hiba – ' + f.error}${chain ? ` (lánc: ${chain} → ${f.finalUrl})` : ''}`;
    });
    const bad = core.filter((f) => !f.ok || f.status !== 200);
    const longChain = core.filter((f) => f.redirects.length > 1);
    if (bad.length) return r('fail', `${bad.length} user-agent nem kap 200-as választ.`, { details });
    if (longChain.length) return r('warn', `Minden UA 200-at kap, de az átirányítási lánc ${longChain[0].redirects.length} lépéses.`, { details });
    return r('pass', `Minden vizsgált UA 200-as választ kap${core[0].redirects.length ? ' egy átirányítás után' : ''}.`, { details });
  },

  uaParity(ctx) {
    const base = browserFetch(ctx);
    if (!base?.ok || !ctx.raw) return noRaw();
    const details: string[] = [];
    let status: Status = 'pass';
    for (const f of ctx.a.fetches.filter((x) => x.botId !== 'browser')) {
      const name = botName(ctx, f.botId);
      if (!f.ok) {
        details.push(`${name}: hiba – ${f.error}`);
        status = worst(status, 'fail');
        continue;
      }
      if (f.challenge) {
        details.push(`${name}: ${f.challenge}`);
        status = worst(status, 'fail');
        continue;
      }
      if (f.status !== base.status) {
        details.push(`${name}: státusz ${f.status} (böngésző: ${base.status})`);
        status = worst(status, 'fail');
        continue;
      }
      const body = ctx.bodies.byBot[f.botId];
      const facts = body ? extractFacts(body, ctx.input.url) : undefined;
      const ratio = facts && ctx.raw.textLength ? facts.textLength / ctx.raw.textLength : 1;
      const titleDiff = facts?.title !== ctx.raw.title;
      details.push(`${name}: ${f.status} · ${fmtBytes(f.bytes)} · szöveg ${Math.round(ratio * 100)}%${titleDiff ? ` · eltérő title: „${facts?.title}”` : ''}`);
      if (ratio < 0.7 || titleDiff) status = worst(status, 'warn');
    }
    if (base.challenge) status = 'fail';
    const summary =
      status === 'pass'
        ? 'A bot UA-k ugyanazt a tartalmat kapják, mint a böngésző. (A valódi robot-IP-ről érkező kérés eltérhet – ez innen nem ellenőrizhető.)'
        : status === 'fail'
          ? 'Legalább egy robot blokkolt vagy eltérő státuszú választ kap.'
          : 'Legalább egy robot érdemben eltérő tartalmat kap.';
    return r(status, summary, { details });
  },

  title(ctx) {
    const raw = ctx.raw?.title;
    const ren = ctx.rendered?.title;
    if (!ctx.raw) return noRaw();
    if (!raw) return r('fail', 'Nincs <title> a nyers HTML-ben.', { details: ren ? [`Csak JS után jelenik meg: „${ren}”`] : [] });
    const details = [`Nyers: „${raw}” (${raw.length} karakter)`];
    if (ren && ren !== raw) details.push(`Renderelt: „${ren}” – eltér a nyerstől.`);
    if (raw.length < 15 || raw.length > 70) return r('warn', `A title hossza ${raw.length} karakter (javasolt kb. 30–65).`, { details });
    if (ren && ren !== raw) return r('warn', 'A title a JS lefutása után megváltozik.', { details });
    return r('pass', `Title rendben: „${raw}”.`, { details });
  },

  metaDescription(ctx) {
    if (!ctx.raw) return noRaw();
    const d = ctx.raw.metaDescription;
    if (!d) return r('warn', 'Nincs meta description a nyers HTML-ben.');
    if (d.length < 50 || d.length > 170) return r('warn', `A meta description ${d.length} karakter (javasolt 70–160).`, { details: [d] });
    return r('pass', `Meta description rendben (${d.length} karakter).`, { details: [d] });
  },

  canonical(ctx) {
    if (!ctx.raw) return noRaw();
    const c = ctx.raw.canonical;
    const ren = ctx.rendered?.canonical ?? [];
    const snippets: Snippet[] = c.length ? [{ label: 'Jelenlegi (nyers HTML)', code: c.map((x) => `<link rel="canonical" href="${x}">`).join('\n'), lang: 'html' }] : [];
    if (!c.length) {
      return r(ren.length ? 'warn' : 'warn', ren.length ? `Canonical csak JS után jelenik meg: ${ren[0]}` : 'Nincs canonical.', {
        snippets: [{ label: 'Javasolt', code: `<link rel="canonical" href="${browserFetch(ctx)?.finalUrl ?? ctx.input.url}">`, lang: 'html' }],
      });
    }
    if (c.length > 1) return r('fail', `${c.length} canonical tag van – a keresők figyelmen kívül hagyhatják.`, { snippets });
    if (!/^https?:\/\//.test(c[0])) return r('warn', `Relatív canonical: ${c[0]}`, { snippets });
    if (ren.length && ren[0] !== c[0]) return r('warn', `A JS átírja a canonicalt: ${c[0]} → ${ren[0]}`, { snippets });
    const final = browserFetch(ctx)?.finalUrl ?? ctx.input.url;
    if (!sameUrl(c[0], final)) return r('warn', `A canonical más URL-re mutat: ${c[0]} (vizsgált: ${final}). Ellenőrizd, szándékos-e.`, { snippets });
    return r('pass', 'Egy, abszolút, önmagára mutató canonical.', { snippets });
  },

  robotsMeta(ctx) {
    if (!ctx.raw) return noRaw();
    const meta = ctx.raw.robotsMeta;
    const xr = browserFetch(ctx)?.headers['x-robots-tag'];
    const details = [
      ...Object.entries(meta).map(([k, v]) => `<meta name="${k}" content="${v}">`),
      xr ? `X-Robots-Tag: ${xr}` : 'X-Robots-Tag: nincs',
    ];
    const renMeta = ctx.rendered?.robotsMeta ?? {};
    const all = [...Object.values(meta), xr ?? ''].join(',').toLowerCase();
    const renAll = Object.values(renMeta).join(',');
    if (/noindex|none/.test(all)) return r('fail', 'Az oldal noindex-szel van jelölve.', { details });
    if (/noindex|none/.test(renAll)) return r('fail', 'A JS a renderelés után noindexet ad az oldalhoz.', { details });
    if (/nofollow/.test(all)) return r('warn', 'nofollow van az oldalon: a belső linkek nem adnak jelet.', { details });
    return r('pass', 'Nincs indexelést tiltó robots meta vagy X-Robots-Tag.', { details });
  },

  robotsTxt(ctx) {
    const rb = ctx.a.robots;
    if (!rb || rb.error) return r('unverifiable', `A robots.txt nem kérhető le: ${rb?.error ?? 'ismeretlen hiba'}`);
    if (rb.status === 404) return r('warn', 'Nincs robots.txt (404). Minden engedélyezett, de nincs Sitemap-hivatkozás.');
    if ((rb.status ?? 0) >= 500) return r('fail', `A robots.txt ${rb.status}-at ad. 5xx esetén a robotok átmenetileg a teljes webhelyet tiltottnak tekinthetik.`, { evidence: 'likely' });
    if (rb.status !== 200 || !ctx.robots) return r('warn', `A robots.txt státusza ${rb.status}.`);
    const details = [`${ctx.robots.groups.length} csoport, ${ctx.robots.sitemaps.length} Sitemap-sor.`, ...ctx.robots.errors.slice(0, 5)];
    const snippets = [{ label: 'robots.txt', code: (rb.text ?? '').slice(0, 4000), lang: 'text' }];
    if (ctx.robots.errors.length) return r('warn', `A robots.txt-ben ${ctx.robots.errors.length} értelmezhetetlen sor van.`, { details, snippets });
    if (!ctx.robots.sitemaps.length) return r('warn', 'A robots.txt nem hivatkozik sitemapre.', { details, snippets });
    return r('pass', 'A robots.txt elérhető és értelmezhető, sitemapre hivatkozik.', { details, snippets });
  },

  sitemap(ctx) {
    const sms = ctx.a.sitemaps.filter((s) => s.status === 200 && (s.urls || s.children));
    if (!sms.length) return r('fail', 'Nem található XML sitemap.', { details: ctx.a.sitemaps.map((s) => `${s.url}: ${s.status ?? s.error}`) });
    const contains = sms.some((s) => s.containsPage);
    const lastmods = sms.flatMap((s) => s.lastmods);
    const days = lastmods.map((l) => l.slice(0, 10));
    const top = Object.entries(days.reduce<Record<string, number>>((acc, d) => ((acc[d] = (acc[d] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1])[0];
    const details = sms.map((s) => `${s.url}: ${s.urls} URL${s.children ? ` (${s.children} al-sitemap)` : ''}${s.containsPage ? ' · tartalmazza az oldalt' : ''}`);
    const pageLm = sms.find((s) => s.pageLastmod)?.pageLastmod;
    if (pageLm) details.push(`Az oldal lastmod-ja: ${pageLm}`);
    let status: Status = 'pass';
    const notes: string[] = [];
    if (!contains) {
      status = 'warn';
      notes.push('a vizsgált URL nincs benne (vagy egy nem beolvasott al-sitemapben van)');
    }
    if (!lastmods.length) {
      status = worst(status, 'warn');
      notes.push('nincs lastmod');
    } else if (lastmods.length >= 20 && top && top[1] / lastmods.length > 0.9) {
      status = worst(status, 'warn');
      notes.push(`a lastmod nem hihető: az URL-ek ${Math.round((top[1] / lastmods.length) * 100)}%-a ugyanazt a napot (${top[0]}) mutatja`);
    }
    return r(status, notes.length ? `Sitemap van, de ${notes.join('; ')}.` : 'A sitemap tartalmazza az oldalt, a lastmod értékek változatosak.', {
      details,
      evidence: !contains ? 'likely' : 'observed',
    });
  },

  soft404(ctx) {
    const s = ctx.a.soft404;
    if (!s || s.error) return r('unverifiable', `A teszt nem futott le: ${s?.error ?? ''}`);
    const d = [`${s.url} → ${s.status}`];
    if (s.status === 404 || s.status === 410) return r('pass', `Nem létező URL-re ${s.status} a válasz.`, { details: d });
    if (s.status === 200) return r('fail', 'Nem létező URL-re 200-as válasz jön (soft 404).', { details: d });
    if (s.status && s.status >= 300 && s.status < 400) return r('warn', `Nem létező URL átirányít (${s.status}) – ha a főoldalra, a Bing soft 404-nek tekintheti.`, { details: d, evidence: 'likely' });
    return r('info', `Nem létező URL-re ${s.status} a válasz.`, { details: d });
  },

  urlParams(ctx) {
    if (!ctx.facts) return noRaw();
    const u = new URL(ctx.input.url);
    const details = [`Paraméteres belső linkek: ${ctx.facts.links.params} / ${ctx.facts.links.internal}`];
    if (u.search) {
      const c = ctx.raw?.canonical[0];
      if (!c || c.includes('?')) return r('warn', 'A vizsgált URL paraméteres, és a canonical nem a paraméter nélküli változatra mutat.', { details });
    }
    if (ctx.facts.links.params > 10) return r('warn', `${ctx.facts.links.params} paraméteres belső link – duplikált URL-ek keletkezhetnek.`, { details, evidence: 'likely' });
    return r('pass', 'Nincs számottevő paraméteres belső link.', { details });
  },

  bwt(ctx) {
    const meta = ctx.raw?.msvalidate;
    const file = ctx.a.bingSiteAuth?.status === 200;
    if (meta || file) return r('pass', `Bing Webmaster Tools ellenőrzés látható (${[meta && 'msvalidate.01 meta', file && 'BingSiteAuth.xml'].filter(Boolean).join(', ')}).`);
    return r('unverifiable', 'Kívülről nem látszik BWT-ellenőrzés. DNS- vagy Google Search Console-importos ellenőrzés esetén ez normális – kérdezd meg az ügyfelet.', {
      evidence: 'unverifiable',
    });
  },

  // ---------------- 5. Robotok ----------------
  robotsBingbot: robotsBotRunner('bingbot', 'bingbot', 'fail'),
  robotsOaiSearch: robotsBotRunner('OAI-SearchBot', 'OAI-SearchBot', 'fail'),
  robotsGptbot(ctx) {
    const res = robotsBotRunner('GPTBot', 'GPTBot', 'info')(ctx);
    if (res.status === 'pass' || res.status === 'info') {
      res.status = 'info';
      res.details = [
        ...(res.details ?? []),
        'Üzleti döntés: a GPTBot a modelltanításhoz gyűjt. Független az OAI-SearchBottól; ha mindkettő engedélyezett, az OpenAI egy lekérést mindkét célra felhasználhat.',
      ];
    }
    return res;
  },

  chatgptUser(ctx) {
    const f = ctx.a.fetches.find((x) => x.botId === 'chatgpt-user');
    if (!f) return r('unverifiable', 'A ChatGPT-User lekérés nem futott.');
    if (!f.ok) return r('fail', `A ChatGPT-User UA hibát kap: ${f.error}`);
    if (f.challenge) return r('fail', `A ChatGPT-User UA challenge-oldalt kap: ${f.challenge}`);
    if (f.status !== 200) return r('fail', `A ChatGPT-User UA ${f.status}-as választ kap.`);
    const text = rawText(ctx, 'chatgpt-user') ?? '';
    const kv = keyValues(ctx);
    const found = kv.filter((k) => containsValue(text, k.value!));
    const details = [
      `Státusz ${f.status} · ${fmtBytes(f.bytes)} · ${text.length} karakter szöveg JS nélkül.`,
      ...kv.map((k) => `${containsValue(text, k.value!) ? '✓' : '✗'} ${k.label}: „${k.value}”`),
    ];
    const consent = ctx.raw?.consent ?? [];
    if (consent.length) details.push(`Consent-platform: ${consent.join(', ')} – a tartalom a nyers HTML-ben ${text.length > 800 ? 'benne van' : 'alig látszik'}.`);
    if (!kv.length) {
      return r(text.length > 800 ? 'info' : 'warn', 'Kulcsadat-minták nélkül csak a szöveg mennyisége ellenőrizhető. Add meg a kulcsadatok mintaértékeit a bemenetben.', { details });
    }
    if (found.length === kv.length) return r('pass', 'A ChatGPT-User JS nélkül is megkapja az összes megadott kulcsadatot.', { details });
    if (found.length === 0) return r('fail', 'A ChatGPT-User JS nélkül egyik megadott kulcsadatot sem kapja meg.', { details });
    return r('warn', `A ChatGPT-User JS nélkül ${found.length}/${kv.length} kulcsadatot kap meg.`, { details });
  },

  noindexConflict(ctx) {
    if (!ctx.robots) return r('na', 'Nincs értelmezhető robots.txt, így ellentmondás sincs.');
    const noindex = hasNoindex(ctx, ctx.raw);
    const blocked = ['bingbot', 'OAI-SearchBot'].filter((t) => !isAllowed(ctx.robots!, t, ctx.pagePath).allowed);
    if (blocked.length && noindex) {
      return r('warn', `A robots.txt tiltja: ${blocked.join(', ')}, ÉS az oldal noindexes. A robot nem tudja lekérni a noindexet, így az oldal címmel és linkkel még megjelenhet.`);
    }
    if (blocked.length) {
      return r('info', `A robots.txt tiltja: ${blocked.join(', ')}, noindex nincs. Az OpenAI szerint az oldal így is megjelenhet navigációs linkként / címmel (pl. Atlasban).`);
    }
    return r('pass', 'Nincs robots.txt-tiltás és noindex ellentmondás.');
  },

  nocache(ctx) {
    if (!ctx.raw) return noRaw();
    const xr = (browserFetch(ctx)?.headers['x-robots-tag'] ?? '').toLowerCase();
    const vals = ['robots', 'bingbot', 'msnbot'].map((k) => ctx.raw!.robotsMeta[k] ?? '').join(',') + ',' + xr;
    const hits = ['nocache', 'noarchive'].filter((v) => vals.includes(v));
    if (!hits.length) return r('pass', 'Nincs nocache/noarchive: a Copilot a teljes tartalmat felhasználhatja.');
    return r('warn', `${hits.join(' + ')} van az oldalon. ${hits.includes('noarchive') ? 'noarchive: a tartalom nem jelenik meg a Copilot-válaszokban.' : 'nocache: a Copilot csak URL-t, címet és kivonatot használ.'}`, {
      details: [vals],
    });
  },

  waf(ctx) {
    const base = browserFetch(ctx);
    if (!base) return noRaw();
    const h = base.headers;
    const providers = new Set<string>();
    if (h['cf-ray'] || /cloudflare/i.test(h['server'] ?? '')) providers.add('Cloudflare');
    if (h['x-sucuri-id'] || /sucuri/i.test(h['server'] ?? '')) providers.add('Sucuri');
    if (/incap_ses|visid_incap/i.test(h['set-cookie'] ?? '') || h['x-iinfo']) providers.add('Imperva/Incapsula');
    if (/akamai/i.test(h['server'] ?? '') || Object.keys(h).some((k) => k.startsWith('x-akamai'))) providers.add('Akamai');
    if (h['x-amz-cf-id'] || /cloudfront/i.test(h['via'] ?? '')) providers.add('Amazon CloudFront');
    if (h['x-served-by']?.includes('cache-') || h['x-fastly-request-id']) providers.add('Fastly');
    if (h['x-vercel-id']) providers.add('Vercel');
    if (h['x-nf-request-id']) providers.add('Netlify');
    if (h['x-kinsta-cache']) providers.add('Kinsta');
    if (h['wpe-backend'] || /wp engine/i.test(h['x-powered-by'] ?? '')) providers.add('WP Engine');
    if (h['x-sg-cache'] || /siteground/i.test(h['host-header'] ?? '')) providers.add('SiteGround');
    const blocked = ctx.a.fetches.filter((f) => f.challenge || (f.ok && base.status === 200 && (f.status === 403 || f.status === 429 || f.status === 503)));
    const details = [
      `Felismert CDN/WAF: ${providers.size ? [...providers].join(', ') : 'nincs felismerhető jel a fejlécekben'}`,
      ...blocked.map((f) => `${botName(ctx, f.botId)}: ${f.status}${f.challenge ? ` · ${f.challenge}` : ''}`),
      'Az UA-hamisítás nem helyettesíti a valódi robot-IP-ről érkező kérést: a WAF IP alapján dönthet. Ezt a szervernaplóból vagy a WAF eseménynaplójából kell ellenőrizni.',
    ];
    if (blocked.length) return r('fail', `A botvédelem ${blocked.length} robot UA-t blokkol vagy challenge-et ad.`, { details });
    if (providers.size) return r('info', `${[...providers].join(', ')} van az oldal előtt. UA alapján nem blokkol, de az IP-alapú szűrés innen nem ellenőrizhető.`, { details, evidence: 'likely' });
    return r('pass', 'Nem látszik botvédelem, és egyik robot UA sem kap blokkolást.', { details });
  },

  otherAi(ctx) {
    const bots = ctx.bots.filter((b) => b.module === 'ext-otherbots');
    if (!ctx.robots) {
      return r(ctx.a.robots?.status === 404 ? 'info' : 'unverifiable', ctx.a.robots?.status === 404 ? 'Nincs robots.txt: minden bot engedélyezett.' : 'A robots.txt nem olvasható.');
    }
    const rows = bots.map((b) => {
      const d = isAllowed(ctx.robots!, b.token, ctx.pagePath);
      return { bot: b.name, owner: b.owner, purpose: b.purpose, allowed: d.allowed, specific: d.specific, rule: d.rule };
    });
    const purposeHu: Record<string, string> = { search: 'keresés/válasz', training: 'tanítás', user: 'felhasználói lekérés' };
    return r('info', `${rows.filter((x) => x.allowed).length}/${rows.length} további AI-bot engedélyezett. Üzleti döntés: a keresési célú botok tiltása csökkenti a láthatóságot, a tanító célúaké nem.`, {
      details: rows.map((x) => `${x.allowed ? '✓' : '✗'} ${x.bot} (${x.owner}, ${purposeHu[x.purpose] ?? x.purpose})${x.specific ? ' – saját szabály' : ''}${x.rule ? `: ${x.rule}` : ''}`),
      data: rows,
    });
  },

  consent(ctx) {
    if (!ctx.raw) return noRaw();
    const c = ctx.raw.consent;
    if (!c.length) return r('pass', 'Nem ismerhető fel consent-platform a nyers HTML-ben.');
    const ok = ctx.raw.textLength > 800;
    return r(ok ? 'pass' : 'warn', ok ? `${c.join(', ')} consent-platform van, de a tartalom a nyers HTML-ben is olvasható.` : `${c.join(', ')} van, és a nyers HTML-ben alig van szöveg: a tartalom a consent mögött lehet.`, {
      evidence: ok ? 'observed' : 'likely',
    });
  },

  botPerf(ctx) {
    const fs = ctx.a.fetches.filter((f) => f.ok);
    if (!fs.length) return noRaw();
    const details = fs.map((f) => `${botName(ctx, f.botId)}: TTFB ${f.ttfbMs} ms · ${fmtBytes(f.bytes)}`);
    const maxTtfb = Math.max(...fs.map((f) => f.ttfbMs ?? 0));
    const maxBytes = Math.max(...fs.map((f) => f.bytes ?? 0));
    let status: Status = 'pass';
    const notes: string[] = [];
    if (maxTtfb > 1500) {
      status = 'warn';
      notes.push(`lassú válasz (max TTFB ${maxTtfb} ms)`);
    }
    if (maxBytes > 1.5 * 1024 * 1024) {
      status = 'warn';
      notes.push(`nagy HTML (${fmtBytes(maxBytes)})`);
    }
    const body = ctx.bodies.byBot['browser'] ?? '';
    for (const k of keyValues(ctx)) {
      const idx = body.toLowerCase().indexOf(k.value!.toLowerCase());
      if (idx > 100 * 1024) {
        status = 'warn';
        notes.push(`„${k.label}” csak ${fmtBytes(idx)} után szerepel`);
      }
      details.push(`${k.label}: ${idx >= 0 ? `${fmtBytes(idx)} pozíción` : 'nem található a nyers HTML-ben'}`);
    }
    return r(status, notes.length ? `Figyelmeztetés: ${notes.join('; ')}.` : 'Gyors válasz, kezelhető HTML-méret, a kulcsadatok az első 100 KB-ban.', { details });
  },

  // ---------------- 2. HTML ----------------
  h1(ctx) {
    if (!ctx.raw) return noRaw();
    const rawH1 = ctx.raw.headings.filter((h) => h.level === 1);
    const renH1 = ctx.rendered?.headings.filter((h) => h.level === 1);
    const details = [`Nyers: ${rawH1.length} db ${rawH1.map((h) => `„${h.text}”`).join(', ')}`];
    if (renH1) details.push(`Renderelt: ${renH1.length} db ${renH1.map((h) => `„${h.text}”`).join(', ')}`);
    if (!rawH1.length) return r(renH1?.length ? 'warn' : 'fail', renH1?.length ? 'H1 csak JS után jelenik meg.' : 'Nincs H1.', { details });
    if (rawH1.length > 1) return r('warn', `${rawH1.length} H1 van az oldalon.`, { details });
    if (renH1 && renH1.length !== 1) return r('warn', 'A renderelés után a H1-ek száma megváltozik.', { details });
    return r('pass', `Pontosan egy H1: „${rawH1[0].text}”.`, { details });
  },

  headingOrder(ctx) {
    const f = ctx.facts;
    if (!f) return noRaw();
    const skips: string[] = [];
    let prev = 0;
    for (const h of f.headings) {
      if (prev && h.level > prev + 1) skips.push(`H${prev} → H${h.level} („${h.text.slice(0, 50)}”)`);
      prev = h.level;
    }
    const empty = f.headings.filter((h) => !h.text).length;
    const outline = f.headings.slice(0, 40).map((h) => `${'  '.repeat(h.level - 1)}H${h.level} ${h.text.slice(0, 80)}`).join('\n');
    const snippets = [{ label: 'Címsor-vázlat (renderelt)', code: outline || '(nincs címsor)', lang: 'text' }];
    if (skips.length || empty) return r('warn', `${skips.length} kihagyott szint, ${empty} üres címsor.`, { details: skips.slice(0, 10), snippets });
    return r('pass', `${f.headings.length} címsor, folytonos hierarchia.`, { snippets });
  },

  semantic(ctx) {
    const f = ctx.facts;
    if (!f) return noRaw();
    const l = f.landmarks;
    const details = [`main: ${l.main} · header: ${l.header} · nav: ${l.nav} · footer: ${l.footer} · article: ${l.article}`];
    if (!l.main) return r('warn', 'Nincs <main> elem: a fő tartalom gépileg nem válik el a kerettől.', { details });
    return r('pass', 'Szemantikus landmarkok rendben.', { details });
  },

  imgAlt(ctx) {
    const f = ctx.facts;
    if (!f) return noRaw();
    const { total, missingAlt, emptyAlt } = f.images;
    if (!total) return r('na', 'Nincs kép az oldalon.');
    const details = [`${total} kép · ${missingAlt} alt nélkül · ${emptyAlt} üres alttal (dekoratív képnél helyes)`];
    if (missingAlt / total > 0.2) return r('warn', `A képek ${Math.round((missingAlt / total) * 100)}%-ának nincs alt attribútuma.`, { details });
    return r('pass', 'Az alt attribútumok többnyire megvannak.', { details });
  },

  anchors(ctx) {
    const f = ctx.facts;
    if (!f) return noRaw();
    const { generic, empty, internal, external } = f.links;
    const details = [`${internal} belső, ${external} külső link · ${empty} üres horgony · ${generic.length} általános horgony`];
    if (generic.length) details.push(`Példák: ${[...new Set(generic)].slice(0, 8).join(', ')}`);
    if (generic.length > 5 || empty > 5) return r('warn', 'Sok az üres vagy általános („tovább”, „részletek”) horgonyszöveg.', { details });
    return r('pass', 'A horgonyszövegek többnyire leíróak.', { details });
  },

  lockedContent(ctx) {
    const f = ctx.facts;
    if (!f) return noRaw();
    const items: string[] = [];
    if (f.maps) items.push(`${f.maps} térkép-widget`);
    if (f.sliders) items.push(`${f.sliders} slider/karusszel`);
    if (f.videos) items.push(`${f.videos} videó`);
    const otherIframes = f.iframes.filter((s) => !/maps|youtube|vimeo/i.test(s));
    if (otherIframes.length) items.push(`${otherIframes.length} egyéb iframe`);
    if (f.pdfs.length) items.push(`${f.pdfs.length} PDF-link`);
    if (!items.length) return r('pass', 'Nincs képbe, PDF-be, iframe-be vagy widgetbe zárt tartalomra utaló elem.');
    return r('warn', `Bezárt tartalomra utaló elemek: ${items.join(', ')}. Ellenőrizd, hogy az ott lévő információ szövegként is kint van-e.`, {
      evidence: 'hypothesis',
      details: [...f.iframes.slice(0, 10).map((s) => `iframe: ${s}`), ...f.pdfs.slice(0, 10).map((p) => `PDF: ${p}`)],
    });
  },

  jsDependency(ctx) {
    if (!ctx.raw) return noRaw();
    if (!ctx.rendered) return noRender();
    const ratio = ctx.rendered.textLength ? ctx.raw.textLength / ctx.rendered.textLength : 1;
    const details = [
      `Szöveg: nyers ${ctx.raw.textLength} · renderelt ${ctx.rendered.textLength} karakter (${Math.round(ratio * 100)}%)`,
      `Címsorok: nyers ${ctx.raw.headings.length} · renderelt ${ctx.rendered.headings.length}`,
      `Belső linkek: nyers ${ctx.raw.links.internal} · renderelt ${ctx.rendered.links.internal}`,
      `JSON-LD blokkok: nyers ${ctx.raw.jsonld.length} · renderelt ${ctx.rendered.jsonld.length}`,
    ];
    // Csak a renderelt szövegben lévő címsorok – ezek tipikusan JS-sel betöltött blokkok.
    const rawHeads = new Set(ctx.raw.headings.map((h) => h.text));
    const onlyJs = ctx.rendered.headings.filter((h) => h.text && !rawHeads.has(h.text)).slice(0, 10);
    if (onlyJs.length) details.push(`Csak JS után megjelenő címsorok: ${onlyJs.map((h) => `„${h.text}”`).join(', ')}`);
    if (ratio < 0.5) return r('fail', `A szöveg ${Math.round((1 - ratio) * 100)}%-a csak a JavaScript lefutása után jelenik meg.`, { details });
    if (ratio < 0.8 || onlyJs.length > 2) return r('warn', `A tartalom egy része (${Math.round((1 - ratio) * 100)}%) csak JS után jelenik meg.`, { details });
    return r('pass', 'A tartalom a nyers HTML-ben is benne van.', { details });
  },

  keyData(ctx) {
    const kd = ctx.input.keyData;
    if (!kd.length) return r('unverifiable', 'Nincs megadva kulcsadat a bemenetben.');
    const rawT = ctx.raw?.text ?? '';
    const renT = ctx.rendered?.text ?? '';
    const ldRaw = (ctx.rendered ?? ctx.raw)?.jsonld.map((j) => j.raw).join('\n') ?? '';
    const alts = altTexts(ctx.bodies.rendered ?? ctx.bodies.byBot['browser']);
    const cuT = rawText(ctx, 'chatgpt-user') ?? '';
    const rows = kd.map((k) => {
      if (!k.value?.trim()) return { label: k.label, value: '', raw: null, rendered: null, jsonld: null, alt: null, chatgptUser: null };
      return {
        label: k.label,
        value: k.value,
        raw: containsValue(rawT, k.value),
        rendered: ctx.rendered ? containsValue(renT, k.value) : null,
        jsonld: containsValue(ldRaw, k.value),
        alt: containsValue(alts, k.value),
        chatgptUser: cuT ? containsValue(cuT, k.value) : null,
      };
    });
    const withVal = rows.filter((x) => x.value);
    if (!withVal.length) return r('unverifiable', 'A kulcsadatokhoz nincs mintaérték megadva, így nem kereshetők. Add meg, ahogy az oldalon szerepelnek (pl. „89 900 Ft”).', { data: rows });
    const missing = withVal.filter((x) => !x.raw && !x.rendered && !x.jsonld);
    const jsOnly = withVal.filter((x) => !x.raw && x.rendered);
    const altOnly = withVal.filter((x) => !x.raw && !x.rendered && x.alt);
    const details = [
      ...jsOnly.map((x) => `Csak JS után: ${x.label}`),
      ...altOnly.map((x) => `Csak képen/alt szövegben: ${x.label}`),
      ...missing.map((x) => `Nem található: ${x.label} („${x.value}”) – vagy nincs az oldalon, vagy más formában szerepel.`),
    ];
    if (missing.length || altOnly.length) return r('fail', `${missing.length + altOnly.length}/${withVal.length} kulcsadat nem olvasható ki szövegként.`, { details, data: rows });
    if (jsOnly.length) return r('warn', `${jsOnly.length}/${withVal.length} kulcsadat csak a JavaScript után jelenik meg.`, { details, data: rows });
    return r('pass', `Mind a ${withVal.length} kulcsadat benne van a nyers HTML-ben.`, { details, data: rows });
  },

  keyStructure(ctx) {
    const f = ctx.facts;
    if (!f) return noRaw();
    if (f.tables || f.dls) return r('pass', `${f.tables} táblázat és ${f.dls} definíciós lista van az oldalon.`);
    return r('warn', 'Nincs táblázat vagy definíciós lista: a kulcsadatok címke–érték párjai gépileg nem egyértelműek.', { evidence: 'hypothesis' });
  },

  pdfInventory(ctx) {
    const p = ctx.a.pdfHeads;
    if (!p.length) return r('na', 'Nincs linkelt PDF.');
    const norm = (u: string) => decodeURIComponent(u.split('/').pop() ?? '').toLowerCase().replace(/[-_ ]?(v?\d+|20\d\d[-_.]?\d*[-_.]?\d*|final|uj|új|regi|régi)/g, '').replace(/\.pdf.*$/, '');
    const groups = p.reduce<Record<string, string[]>>((acc, x) => ((acc[norm(x.url)] ??= []).push(x.url), acc), {});
    const dupes = Object.values(groups).filter((g) => g.length > 1);
    const old = p.filter((x) => x.lastModified && Date.now() - Date.parse(x.lastModified) > 2 * 365 * 864e5);
    const details = p.map((x) => `${x.url.split('/').pop()} · ${x.status} · ${x.lastModified ?? 'dátum nélkül'} · ${fmtBytes(x.bytes)}`);
    if (dupes.length) return r('warn', `${dupes.length} csoportban hasonló nevű PDF-ek: ellentmondó változatok gyanúja.`, { details, evidence: 'hypothesis' });
    if (old.length) return r('warn', `${old.length} PDF két évnél régebbi.`, { details });
    return r('info', `${p.length} PDF linkelve.`, { details });
  },

  // ---------------- 3. Strukturált adat ----------------
  jsonldInventory(ctx) {
    const f = ctx.facts;
    if (!f) return noRaw();
    if (!f.jsonld.length) return r('fail', `Nincs JSON-LD az oldalon${f.microdata ? ` (${f.microdata} microdata elem van)` : ''}.`);
    const errors = f.jsonld.filter((j) => j.error);
    const nodes = flattenNodes(f);
    const counts = nodes.reduce<Record<string, number>>((acc, n) => (typesOf(n).forEach((t) => (acc[t] = (acc[t] ?? 0) + 1)), acc), {});
    const details = [`${f.jsonld.length} blokk · típusok: ${Object.entries(counts).map(([t, c]) => `${t}×${c}`).join(', ')}`];
    if (f.microdata) details.push(`${f.microdata} microdata (itemscope) elem is van.`);
    const snippets = f.jsonld.slice(0, 4).map((j, i) => ({ label: `JSON-LD #${i + 1}${j.error ? ' (HIBÁS)' : ''}`, code: j.parsed ? JSON.stringify(j.parsed, null, 2).slice(0, 6000) : j.raw.slice(0, 3000), lang: 'json' }));
    if (errors.length) return r('fail', `${errors.length} JSON-LD blokk nem érvényes JSON.`, { details: [...details, ...errors.map((e) => e.error!)], snippets });
    const orgNames = new Set(nodes.filter((n) => typesOf(n).some((t) => ORG_TYPES.has(t))).map(nameOf).filter(Boolean));
    if (orgNames.size > 1) return r('warn', `Több eltérő nevű szervezet-node: ${[...orgNames].join(' / ')}.`, { details, snippets });
    return r('pass', 'A JSON-LD érvényes.', { details, snippets });
  },

  organization(ctx) {
    const nodes = flattenNodes(ctx.facts);
    const orgs = nodes.filter((n) => typesOf(n).some((t) => ORG_TYPES.has(t)));
    if (!orgs.length) return r('fail', 'Nincs Organization (vagy altípus) a JSON-LD-ben.');
    const o = orgs.find((n) => n['@id']) ?? orgs[0];
    const has = (k: string) => o[k] !== undefined && o[k] !== '';
    const missing = ['@id', 'name', 'url', 'logo', 'sameAs'].filter((k) => !has(k));
    const details = [`Típus: ${typesOf(o).join(', ')} · név: ${nameOf(o) ?? '—'} · @id: ${o['@id'] ?? '—'}`];
    if (missing.length) return r(missing.includes('name') || missing.includes('@id') ? 'warn' : 'warn', `Organization van, de hiányzik: ${missing.join(', ')}.`, { details });
    return r('pass', 'Organization @id-vel, névvel, URL-lel, logóval és sameAs-szel.', { details });
  },

  mainEntity(ctx) {
    const nodes = flattenNodes(ctx.facts);
    const candidates = candidateTypes(ctx.input.entityType);
    const main = nodes.filter((n) => {
      const ts = typesOf(n);
      if (candidates) return ts.some((t) => candidates.includes(t));
      return ts.some((t) => !ORG_TYPES.has(t) && !PAGE_TYPES.has(t) && !STRUCTURAL_TYPES.has(t));
    });
    const details = [`Fő entitás típusa (bemenet): ${ctx.input.entityType || '—'}`, `Szóba jövő típusok: ${candidates?.join(', ') ?? 'nincs leképezés – bármilyen nem strukturális típust elfogadunk'}`];
    if (!main.length) {
      const orgs = nodes.filter((n) => typesOf(n).some((t) => ORG_TYPES.has(t)));
      // Entitástípus nélkül nem tudjuk, mi a fő entitás; cég főoldalán maga az Organization lehet az.
      if (!ctx.input.entityType) {
        return orgs.length
          ? r('info', `Csak szervezet-séma van (${typesOf(orgs[0]).join(', ')}). Ha ez egy cég saját oldala, az Organization lehet a fő entitás – add meg a fő entitás típusát a pontos értékeléshez.`, { details })
          : r('unverifiable', 'A fő entitás típusa nincs megadva, és nincs nem strukturális séma az oldalon – add meg az entitástípust.', { details });
      }
      if (orgs.length && candidates?.some((t) => ORG_TYPES.has(t))) return r('pass', `A fő entitás a szervezet: ${typesOf(orgs[0]).join(', ')}.`, { details });
      return r('fail', 'Nincs a fő entitás típusához illő séma.', { details });
    }
    const orgIds = nodes.filter((n) => typesOf(n).some((t) => ORG_TYPES.has(t)) && n['@id']).map((n) => n['@id'] as string);
    const m = main[0];
    details.push(`Talált: ${typesOf(m).join(', ')} – „${nameOf(m) ?? 'név nélkül'}”`);
    const linked = refsIn(m).some((id) => orgIds.includes(id));
    if (!linked) return r('warn', `${typesOf(m).join(', ')} séma van, de nincs @id-vel az Organizationhöz kötve (provider/organizer/brand/seller).`, { details });
    return r('pass', `${typesOf(m).join(', ')} séma, @id-vel összekötve a szervezettel.`, { details });
  },

  nameConsistency(ctx) {
    const f = ctx.facts;
    if (!f) return noRaw();
    const nodes = flattenNodes(f);
    const titleParts = (f.title ?? '').split(/\s[|–—-]\s/);
    const sources: [string, string | undefined][] = [
      ['title (utolsó tag)', titleParts.length > 1 ? titleParts[titleParts.length - 1] : undefined],
      ['og:site_name', f.og['og:site_name']],
      ['JSON-LD Organization', nodes.filter((n) => typesOf(n).some((t) => ORG_TYPES.has(t))).map(nameOf).find(Boolean)],
      ['JSON-LD WebSite', nodes.filter((n) => typesOf(n).includes('WebSite')).map(nameOf).find(Boolean)],
    ];
    const ref = ctx.input.org?.trim();
    const footer = f.footerText ?? '';
    const details = sources.map(([k, v]) => `${k}: ${v ?? '—'}`);
    details.push(`Lábléc tartalmazza a(z) „${ref || '?'}” nevet: ${ref ? (containsValue(footer, ref) ? 'igen' : 'nem') : '—'}`);
    const vals = sources.map(([, v]) => v?.trim()).filter((v): v is string => !!v);
    if (!vals.length) return r('warn', 'A szervezet neve sehol nincs gépileg jelölve (title-suffix, og:site_name, JSON-LD).', { details });
    const distinct = new Set(vals.map((v) => v.toLowerCase()));
    if (ref && vals.some((v) => !containsValue(v, ref) && !containsValue(ref, v))) return r('warn', `A szervezetnév nem egységes: ${[...distinct].join(' / ')} (bemenet: ${ref}).`, { details });
    if (distinct.size > 1) return r('warn', `Többféle névforma: ${[...distinct].join(' / ')}.`, { details });
    return r('pass', `Egységes szervezetnév: ${vals[0]}.`, { details });
  },

  breadcrumb(ctx) {
    if (new URL(ctx.input.url).pathname === '/') return r('na', 'Főoldalon a BreadcrumbList nem releváns.');
    const has = flattenNodes(ctx.facts).some((n) => typesOf(n).includes('BreadcrumbList'));
    return has ? r('pass', 'Van BreadcrumbList.') : r('warn', 'Nincs BreadcrumbList.');
  },

  webpage(ctx) {
    const pages = flattenNodes(ctx.facts).filter((n) => typesOf(n).some((t) => PAGE_TYPES.has(t)));
    if (!pages.length) return r('warn', 'Nincs WebPage node.');
    const p = pages[0];
    const details = [`${typesOf(p).join(', ')} · dateModified: ${p['dateModified'] ?? '—'} · mainEntity/about: ${p['mainEntity'] || p['about'] ? 'van' : 'nincs'}`];
    if (!p['dateModified']) return r('warn', 'WebPage van, de dateModified nélkül.', { details });
    return r('pass', 'WebPage dateModified-dal.', { details });
  },

  faqValidity(ctx) {
    const f = ctx.facts;
    const nodes = flattenNodes(f);
    if (!nodes.some((n) => typesOf(n).includes('FAQPage'))) return r('na', 'Nincs FAQPage séma.');
    const qs = nodes.filter((n) => typesOf(n).includes('Question')).map(nameOf).filter((x): x is string => !!x);
    const missing = qs.filter((q) => !containsValue(f?.text ?? '', q));
    if (missing.length) return r('fail', `${missing.length}/${qs.length} FAQ-kérdés nem látható az oldalon – félrevezető jelölés.`, { details: missing.slice(0, 10) });
    return r('pass', `Mind a ${qs.length} FAQ-kérdés látható az oldalon.`);
  },

  jsonldJsOnly(ctx) {
    if (!ctx.raw) return noRaw();
    if (!ctx.rendered) return noRender();
    const a = ctx.raw.jsonld.length;
    const b = ctx.rendered.jsonld.length;
    if (!a && !b) return r('na', 'Nincs JSON-LD sem nyersen, sem renderelve.');
    if (!a && b) return r('fail', `A JSON-LD (${b} blokk) csak JavaScripttel kerül az oldalra (pl. Tag Manager).`);
    if (b > a) return r('warn', `${b - a} JSON-LD blokk csak JS után jelenik meg.`);
    return r('pass', 'A JSON-LD a nyers HTML-ben van.');
  },

  sameAs(ctx) {
    const orgs = flattenNodes(ctx.facts).filter((n) => typesOf(n).some((t) => ORG_TYPES.has(t)));
    if (!orgs.length) return r('na', 'Nincs Organization node.');
    const s = orgs.flatMap((o) => (Array.isArray(o['sameAs']) ? o['sameAs'] : o['sameAs'] ? [o['sameAs']] : [])) as string[];
    if (!s.length) return r('warn', 'Az Organizationben nincs sameAs.');
    return r('pass', `${s.length} sameAs link.`, { details: s.slice(0, 15) });
  },

  // ---------------- 4. AI ----------------
  factBlock(ctx) {
    const html = ctx.bodies.byBot['browser'];
    if (!html) return noRaw();
    const kv = keyValues(ctx);
    const dates = ctx.raw?.dates ?? [];
    if (!kv.length) {
      return r('unverifiable', 'Kulcsadat-minták nélkül a tényblokk nem azonosítható. Add meg a kulcsadatok mintaértékeit.', { details: dates.length ? [`Látható dátum: ${dates.join('; ')}`] : [] });
    }
    if (kv.length < 2) {
      return r('unverifiable', 'A tényblokk felismeréséhez legalább 2 kulcsadat-minta kell a bemenetben.', { details: dates.length ? [`Látható dátum: ${dates.join('; ')}`] : [] });
    }
    const $ = cheerio.load(html);
    $('script,style,noscript').remove();
    const need = Math.min(kv.length, Math.max(2, Math.ceil(kv.length * 0.6)));
    let best: { tag: string; text: string; hits: number } | undefined;
    $('table, dl, ul, ol, section, aside, div, p').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length > 2500 || text.length < 20) return;
      const hits = kv.filter((k) => containsValue(text, k.value!)).length;
      if (hits >= need && (!best || hits > best.hits || (hits === best.hits && text.length < best.text.length))) {
        best = { tag: el.tagName, text, hits };
      }
    });
    const details = [`Látható frissítési dátum: ${dates.length ? dates.join('; ') : 'nincs'}`];
    if (!best) return r('warn', `Nincs olyan rövid blokk a nyers HTML-ben, amely a kulcsadatok legalább ${need}/${kv.length} részét együtt tartalmazza.`, { details });
    const found = best as { tag: string; text: string; hits: number };
    details.unshift(`<${found.tag}> blokk ${found.hits}/${kv.length} kulcsadattal: „${found.text.slice(0, 300)}${found.text.length > 300 ? '…' : ''}”`);
    if (!dates.length) return r('warn', 'Van kulcsadat-blokk, de nincs látható „frissítve” dátum.', { details });
    return r('pass', 'Van tömör, dátummal ellátott kulcsadat-blokk.', { details });
  },

  questionCoverage(ctx) {
    const qs = ctx.questions.filter((q) => q.coverage !== 'unknown');
    if (!qs.length) return r('unverifiable', 'Még nincs értékelt kérdés (a kérdéslistában meg kell adni, melyik kérdésre ad választ az oldal).', { evidence: 'unverifiable' });
    const score = qs.reduce((s, q) => s + (q.coverage === 'yes' ? 1 : q.coverage === 'partial' ? 0.5 : 0), 0) / qs.length;
    const details = [`${qs.length} értékelt kérdés: ${qs.filter((q) => q.coverage === 'yes').length} igen, ${qs.filter((q) => q.coverage === 'partial').length} részben, ${qs.filter((q) => q.coverage === 'no').length} nem.`];
    const status: Status = score >= 0.7 ? 'pass' : score >= 0.4 ? 'warn' : 'fail';
    return r(status, `Kérdés-lefedettség: ${Math.round(score * 100)}%.`, { details, data: { score } });
  },

  freshness(ctx) {
    const dates = ctx.facts?.dates ?? [];
    const dm = flattenNodes(ctx.facts).map((n) => n['dateModified']).find((x) => typeof x === 'string') as string | undefined;
    const lm = ctx.a.sitemaps.find((s) => s.pageLastmod)?.pageLastmod;
    const details = [`Látható: ${dates.join('; ') || '—'}`, `JSON-LD dateModified: ${dm ?? '—'}`, `Sitemap lastmod: ${lm ?? '—'}`, `HTTP Last-Modified: ${browserFetch(ctx)?.headers['last-modified'] ?? '—'}`];
    const present = [dates.length > 0, !!dm, !!lm].filter(Boolean).length;
    if (!present) return r('warn', 'Sehol nincs frissítési dátum.', { details });
    if (dm && lm && dm.slice(0, 10) !== lm.slice(0, 10)) return r('warn', `A dateModified (${dm.slice(0, 10)}) és a sitemap lastmod (${lm.slice(0, 10)}) eltér.`, { details });
    if (!dates.length) return r('warn', 'Gépi dátum van, de látható „frissítve” jelölés nincs.', { details });
    return r('pass', 'Látható és gépi frissítési dátum is van.', { details });
  },

  entityTrust(ctx) {
    const c = ctx.facts?.contact;
    if (!c) return noRaw();
    const items = [
      ['impresszum', c.impressum],
      ['kapcsolat oldal', c.contactPage],
      ['rólunk oldal', c.about],
      ['telefon (tel:)', c.tel > 0],
      ['e-mail (mailto:)', c.mailto > 0],
      ['postacím', c.address],
    ] as const;
    const have = items.filter(([, v]) => v).length;
    const details = items.map(([k, v]) => `${v ? '✓' : '✗'} ${k}`);
    if (have >= 5) return r('pass', 'Az üzemeltető jól azonosítható.', { details });
    if (have >= 3) return r('warn', `Az azonosítás hiányos (${have}/6).`, { details });
    return r('fail', `Az üzemeltető alig azonosítható (${have}/6).`, { details });
  },

  llmsTxt(ctx) {
    const l = ctx.a.llmsTxt;
    if (l?.status === 200 && l.bytes) return r('info', `Van llms.txt (${fmtBytes(l.bytes)}). Egyik vizsgált szolgáltató sem dokumentálja, hogy használná.`, { evidence: 'observed' });
    return r('info', 'Nincs llms.txt. Nem javasoljuk aktívan: nincs dokumentált hatása a Bing/ChatGPT láthatóságra.');
  },

  // ---------------- 6. Technikai ----------------
  https(ctx) {
    const final = browserFetch(ctx)?.finalUrl ?? ctx.input.url;
    const h = ctx.a.httpToHttps;
    const details = [`Végső URL: ${final}`, h ? `http:// → ${h.status ?? h.error} ${h.location ?? ''}` : ''].filter(Boolean);
    if (!final.startsWith('https://')) return r('fail', 'Az oldal nem HTTPS-en érhető el.', { details });
    if (h && h.status && ![301, 308].includes(h.status)) return r('warn', `A http:// változat ${h.status}-at ad (javasolt: 301/308 a https-re).`, { details });
    return r('pass', 'HTTPS, a http:// állandó átirányítással.', { details });
  },

  viewport(ctx) {
    if (!ctx.raw) return noRaw();
    return ctx.raw.viewport ? r('pass', `Viewport: ${ctx.raw.viewport}`) : r('fail', 'Nincs viewport meta – mobilon nem reszponzív.');
  },

  lang(ctx) {
    if (!ctx.raw) return noRaw();
    const l = ctx.raw.lang;
    const want = ctx.input.languages[0]?.slice(0, 2).toLowerCase();
    if (!l) return r('warn', 'Nincs lang attribútum az <html> elemen.');
    if (want && !l.toLowerCase().startsWith(want)) return r('warn', `lang="${l}", de a megadott nyelv ${want}.`);
    return r('pass', `lang="${l}"`);
  },

  hreflang(ctx) {
    const h = ctx.raw?.hreflang ?? [];
    const multi = ctx.input.languages.length > 1;
    const details = h.map((x) => `${x.lang}: ${x.href}`);
    if (!multi) return h.length ? r('info', `${h.length} hreflang link (egynyelvűnek jelölt oldalon).`, { details }) : r('na', 'Egynyelvű oldal.');
    if (!h.length) return r('warn', 'Több nyelvi változat van megadva, de nincs hreflang.');
    const self = h.some((x) => sameUrl(x.href, browserFetch(ctx)?.finalUrl ?? ctx.input.url));
    if (!self) return r('warn', 'A hreflang-készletből hiányzik az önhivatkozás.', { details });
    return r('pass', `${h.length} hreflang link, önhivatkozással.`, { details });
  },

  openGraph(ctx) {
    const og = ctx.raw?.og;
    if (!og) return noRaw();
    const req = ['og:title', 'og:description', 'og:image', 'og:url'];
    const missing = req.filter((k) => !og[k]);
    const img = ctx.a.ogImage;
    const details = [...req.map((k) => `${k}: ${og[k] ?? '—'}`), `og:site_name: ${og['og:site_name'] ?? '—'}`];
    if (img) details.push(`og:image elérhetősége: ${img.status ?? '?'} ${img.type ?? ''}`);
    if (missing.length) return r('warn', `Hiányzó OG-mezők: ${missing.join(', ')}.`, { details });
    if (img && img.status !== 200) return r('warn', `Az og:image nem érhető el (${img.status}).`, { details });
    return r('pass', 'Teljes Open Graph készlet, elérhető képpel.', { details });
  },

  cwv(ctx) {
    const rd = ctx.a.render;
    if (!rd?.ok) return noRender();
    if (rd.lcpMs === undefined && rd.cls === undefined) {
      return r('unverifiable', 'A renderelés mérőszámok nélkül futott (playwright-core nincs telepítve). Mérd a PageSpeed Insights-szal: https://pagespeed.web.dev/', {
        evidence: 'unverifiable',
      });
    }
    const details = [`LCP:${rd.lcpMs ?? '?'} ms · CLS: ${rd.cls ?? '?'} · betöltés: ${rd.loadMs} ms · ${rd.requestCount} kérés · ${fmtBytes(rd.transferBytes)}`, 'Egyetlen asztali, laboratóriumi betöltés – nem terepi adat.'];
    let status: Status = 'pass';
    if ((rd.lcpMs ?? 0) > 4000 || (rd.cls ?? 0) > 0.25) status = 'fail';
    else if ((rd.lcpMs ?? 0) > 2500 || (rd.cls ?? 0) > 0.1) status = 'warn';
    return r(status, status === 'pass' ? 'A laborméréses LCP és CLS a jó tartományban.' : `Lassú vagy ugráló betöltés (LCP ${rd.lcpMs} ms, CLS ${rd.cls}).`, { details, evidence: 'likely' });
  },

  thirdParty(ctx) {
    const rd = ctx.a.render;
    const domains = rd?.thirdPartyDomains ?? ctx.raw?.scripts.external ?? [];
    const details = [`${domains.length} külső domén`, ...domains.slice(0, 30)];
    if (rd?.consoleErrors?.length) details.push(`Konzolhibák: ${rd.consoleErrors.length}`);
    if (domains.length > 20) return r('warn', `${domains.length} külső doménről tölt be az oldal.`, { details });
    return r('pass', `${domains.length} külső domén.`, { details });
  },

  compression(ctx) {
    const h = browserFetch(ctx)?.headers;
    if (!h) return noRaw();
    const enc = h['content-encoding'];
    const details = [`Content-Encoding: ${enc ?? '—'}`, `Cache-Control: ${h['cache-control'] ?? '—'}`];
    if (!enc) return r('warn', 'A HTML tömörítés nélkül érkezik.', { details });
    return r('pass', `Tömörítés: ${enc}.`, { details });
  },

  // ---------------- 7. Teszt ----------------
  testChatgpt: (ctx) => manualTest(ctx, 'chatgpt'),
  testCopilot: (ctx) => manualTest(ctx, 'copilot'),
};

function manualTest(ctx: CheckContext, surface: 'chatgpt' | 'copilot') {
  const label = surface === 'chatgpt' ? 'ChatGPT' : 'Copilot';
  const results = ctx.questions.flatMap((q) => q.results.filter((x) => x.surface === surface).map((x) => ({ q, x })));
  if (!results.length) return r('unverifiable', `Még nincs rögzített ${label}-teszt – a kézi teendők között lévő promptokkal futtatható.`, { evidence: 'unverifiable' });
  const appears = results.filter((x) => x.x.appears === 'yes');
  const wrong = results.filter((x) => x.x.accurate === 'no');
  const details = [
    `${results.length} kérdés · forrásként megjelent: ${appears.length} · pontatlan idézet: ${wrong.length}`,
    ...wrong.map((w) => `Pontatlan: „${w.q.text}” – ${w.x.quotedFact ?? ''} ${w.x.note ?? ''}`),
    'Pillanatfelvétel: az eredmények munkamenetenként, helyenként és időben változnak. Ha az oldal nem jelenik meg, abból nem következik, hogy nincs indexelve.',
  ];
  if (wrong.length) return r('fail', `${wrong.length} esetben a ${label} pontatlan tényt idéz.`, { details });
  if (appears.length) return r('pass', `Az oldal ${appears.length}/${results.length} kérdésnél forrásként megjelent a ${label}-ben.`, { details });
  return r('info', `Az oldal egyik kérdésnél sem jelent meg forrásként a ${label}-ben.`, { details });
}

export function hasRunner(impl?: string) {
  return !!impl && impl in runners;
}

/** Bot-mátrix a frontend hőtérképéhez: botonként státusz, robots.txt, tartalom-egyezés, kulcsadatok. */
export function botMatrix(ctx: CheckContext) {
  const base = browserFetch(ctx);
  const kv = keyValues(ctx);
  return ctx.bots
    .filter((b) => b.module === 'core' || ctx.input.modules.includes(b.module))
    .map((b) => {
      const f: FetchResult | undefined = ctx.a.fetches.find((x) => x.botId === b.id);
      const robots =
        b.id === 'browser' ? null : ctx.robots ? isAllowed(ctx.robots, b.token, ctx.pagePath) : ctx.a.robots?.status === 404 ? { allowed: true, specific: false } : null;
      let textPct: number | null = null;
      let titleMatch: boolean | null = null;
      let keyFound: number | null = null;
      const body = ctx.bodies.byBot[b.id];
      if (f?.ok && body) {
        const facts = b.id === 'browser' && ctx.raw ? ctx.raw : extractFacts(body, ctx.input.url);
        textPct = ctx.raw?.textLength ? Math.round((facts.textLength / ctx.raw.textLength) * 100) : null;
        titleMatch = facts.title === ctx.raw?.title;
        keyFound = kv.length ? kv.filter((k) => containsValue(facts.text, k.value!)).length : null;
      }
      return {
        id: b.id,
        name: b.name,
        owner: b.owner,
        purpose: b.purpose,
        fetched: !!f,
        status: f?.status ?? null,
        error: f?.error ?? null,
        challenge: f?.challenge ?? null,
        redirects: f?.redirects.length ?? null,
        bytes: f?.bytes ?? null,
        ttfbMs: f?.ttfbMs ?? null,
        sameStatus: f && base ? f.status === base.status : null,
        robotsAllowed: robots ? robots.allowed : null,
        robotsRule: robots && 'rule' in robots ? (robots.rule ?? null) : null,
        robotsSpecific: robots ? robots.specific : null,
        robotsApplies: b.robotsApplies,
        textPct,
        titleMatch,
        keyFound,
        keyTotal: kv.length,
      };
    });
}
