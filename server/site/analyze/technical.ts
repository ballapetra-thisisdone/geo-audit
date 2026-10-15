// Technikai GEO audit: elérhetőség, robots, sitemap, indexelhetőség, canonical, átirányítás, metaadatok,
// szemantikus HTML, URL-struktúra, renderelés. Minden megállapítás konkrét URL-hez és bizonyítékhoz kötött.
import type { IssueDef } from './issues.ts';
import { IssueCollector } from './issues.ts';
import type { SiteModel } from './model.ts';
import { isNoindex } from './model.ts';
import { normalizeUrl } from '../crawl/url.ts';
import { truncate } from './text.ts';

const d = (x: IssueDef) => x;
export const TECH: Record<string, IssueDef> = {
  home_unreachable: d({ category: 'crawl', title: 'A kezdőoldal nem érhető el', why: 'Ha a kezdőoldal nem tölthető le, a keresők és AI-rendszerek sem tudják feldolgozni a webhelyet.', fix: 'Állítsd helyre a kezdőoldal 200-as válaszát (szerver, DNS, TLS, WAF ellenőrzése).', acceptance: 'A kezdőoldal HTTP 200-zal, HTML-tartalommal válaszol.', impact: 5, effort: 'M', owner: 'dev', evidenceKind: 'measured', confidence: 0.95, blocker: true }),
  robots_5xx: d({ category: 'crawl', title: 'A robots.txt szerverhibát ad', why: 'RFC 9309 szerint 5xx robots.txt esetén a crawlerek a teljes webhelyet tiltottnak tekinthetik.', fix: 'A /robots.txt adjon 200-as választ (vagy 404-et, ha nincs szabály).', acceptance: 'GET /robots.txt → 200 vagy 404.', impact: 5, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.95, blocker: true }),
  robots_block_all: d({ category: 'crawl', title: 'A robots.txt minden crawlert kizár a teljes webhelyről', why: 'A "User-agent: * / Disallow: /" szabály minden olyan robotot kizár, amelynek nincs saját engedélyező csoportja.', fix: 'Szűkítsd a tiltást a valóban nem publikus útvonalakra; a keresési robotok számára engedélyezd a tartalmat.', acceptance: 'A "*" csoport nem tiltja a "/" útvonalat, a fontos oldalak engedélyezettek.', impact: 5, effort: 'S', owner: 'both', evidenceKind: 'measured', confidence: 0.95, blocker: true }),
  robots_blocked_pages: d({ category: 'crawl', title: 'Belső linkekkel elérhető oldalak robots.txt-tiltás alatt', why: 'A tiltott oldalak tartalmát a szabályt betartó robotok nem olvassák, így nem lehetnek forrásai a válaszoknak.', fix: 'Ellenőrizd, hogy a tiltás szándékos-e. Ha nem, módosítsd a Disallow szabályt; ha igen, ne linkeld feleslegesen.', acceptance: 'A fontos oldalak egyike sem esik Disallow alá.', impact: 3, effort: 'S', owner: 'both', evidenceKind: 'measured', confidence: 0.8 }),
  sitemap_missing: d({ category: 'crawl', title: 'Nincs elérhető XML sitemap', why: 'A sitemap segíti a keresőket és AI-crawlereket az oldalak teljes körű felfedezésében és a frissítések észlelésében.', fix: 'Készíts XML sitemapet (a CMS-ek többsége beépítetten tud), és hivatkozd a robots.txt-ben: "Sitemap: https://…/sitemap.xml".', acceptance: 'A robots.txt Sitemap sora érvényes, 200-as, urlset/sitemapindex XML-re mutat.', impact: 3, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.9 }),
  sitemap_not_in_robots: d({ category: 'crawl', title: 'A sitemap nincs megadva a robots.txt-ben', why: 'A Sitemap sor a legegyszerűbb módja, hogy minden crawler megtalálja a sitemapet.', fix: 'Add hozzá a robots.txt-hez: "Sitemap: <sitemap abszolút URL>".', acceptance: 'A robots.txt tartalmaz Sitemap sort.', impact: 1, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.9 }),
  sitemap_bad_urls: d({ category: 'indexing', title: 'A sitemap nem indexelhető URL-eket tartalmaz', why: 'Átirányító, hibás, noindex vagy máshova kanonizált URL a sitemapben ellentmondásos jelzés a crawlereknek.', fix: 'A sitemapben csak 200-as, indexelhető, önmagára kanonizált URL-ek szerepeljenek.', acceptance: 'A sitemap összes vizsgált URL-je 200-as és indexelhető.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.9 }),
  sitemap_missing_pages: d({ category: 'indexing', title: 'Indexelhető oldalak hiányoznak a sitemapből', why: 'A sitemapből hiányzó oldalak felfedezése csak a belső linkeken múlik.', fix: 'Vedd fel az indexelhető oldalakat a sitemapbe (CMS-beállítás vagy generátor).', acceptance: 'Minden indexelhető, 200-as oldal szerepel a sitemapben.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.75 }),
  http_errors: d({ category: 'crawl', title: 'Hibás (4xx/5xx) belső oldalak', why: 'A belső linkekkel elérhető hibás oldalak pazarolják a crawl-keretet és rontják a felhasználói élményt.', fix: 'Javítsd vagy irányítsd át (301) a hibás URL-eket a megfelelő oldalra, és frissítsd a rájuk mutató linkeket.', acceptance: 'Nincs belső link 4xx/5xx célra.', impact: 3, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.95 }),
  fetch_errors: d({ category: 'crawl', title: 'Lekérési hibák (időtúllépés, kapcsolat)', why: 'Az időtúllépő vagy kapcsolódási hibát adó oldalak a crawlerek számára is elérhetetlenek lehetnek.', fix: 'Vizsgáld meg a szerver válaszidejét és a hálózati/WAF-beállításokat az érintett URL-eknél.', acceptance: 'Az érintett URL-ek ismételt lekérése 200-zal sikerül a timeouton belül.', impact: 3, effort: 'M', owner: 'dev', evidenceKind: 'measured', confidence: 0.7 }),
  redirect_chain: d({ category: 'crawl', title: 'Többlépcsős átirányítási láncok', why: 'Minden további átirányítási lépés késlelteti a feldolgozást, és a crawlerek egy határ után feladják.', fix: 'Az átirányítás közvetlenül a végső URL-re mutasson (egy lépés).', acceptance: 'Minden átirányítás legfeljebb 1 lépésből áll.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.95 }),
  internal_links_to_redirects: d({ category: 'linking', title: 'Belső linkek átirányító URL-ekre mutatnak', why: 'A közvetlen link a végső URL-re gyorsabb felfedezést és egyértelműbb jelzést ad.', fix: 'Frissítsd a belső linkeket a végső (200-as) URL-re.', acceptance: 'Belső link nem mutat 3xx URL-re.', impact: 1, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.9 }),
  noindex_linked: d({ category: 'indexing', title: 'Noindex oldalak, amelyek a sitemapben vagy fontos linkekben szerepelnek', why: 'Ha egy oldal szándékosan noindex, ne szerepeljen a sitemapben; ha nem szándékos, kimarad a keresési és AI-indexből.', fix: 'Döntsd el oldalanként: indexelendő (noindex eltávolítása) vagy nem (kivétel a sitemapből).', acceptance: 'Minden noindex oldal szándékos, és nincs a sitemapben.', impact: 3, effort: 'S', owner: 'both', evidenceKind: 'measured', confidence: 0.75 }),
  canonical_missing: d({ category: 'indexing', title: 'Hiányzó canonical az indexelhető oldalakon', why: 'Önhivatkozó canonical nélkül a paraméteres vagy duplikált változatok közül a kereső maga választ.', fix: 'Adj önhivatkozó <link rel="canonical" href="…"> taget minden indexelhető oldalhoz.', acceptance: 'Minden indexelhető oldalon pontosan egy abszolút, önhivatkozó canonical van.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.9 }),
  canonical_multiple: d({ category: 'indexing', title: 'Több canonical tag egy oldalon', why: 'Ellentmondó canonical jelzés esetén a keresők figyelmen kívül hagyhatják mindkettőt.', fix: 'Oldalanként egy canonical maradjon (gyakran a téma és egy SEO-bővítmény is kiírja).', acceptance: 'Egy oldalon legfeljebb egy rel=canonical.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.95 }),
  canonical_bad_target: d({ category: 'indexing', title: 'A canonical nem indexelhető célra mutat', why: 'A hibás, átirányító vagy noindex célra mutató canonical ellentmondásos jelzés.', fix: 'A canonical 200-as, indexelhető URL-re mutasson.', acceptance: 'Minden canonical cél 200-as és indexelhető.', impact: 3, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  title_missing: d({ category: 'metadata', title: 'Hiányzó <title>', why: 'A title az oldal elsődleges azonosítója a találati listákban és a forrásmegjelölésekben.', fix: 'Adj egyedi, a tartalmat pontosan leíró title-t (kb. 30–60 karakter).', acceptance: 'Minden indexelhető oldalnak van egyedi title-je.', impact: 3, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.95 }),
  title_duplicate: d({ category: 'metadata', title: 'Ismétlődő title több oldalon', why: 'Az azonos title-ök megnehezítik az oldalak megkülönböztetését és a megfelelő forrás kiválasztását.', fix: 'Írj oldalanként egyedi title-t, amely a fő témát és a márkát is megnevezi.', acceptance: 'Nincs két indexelhető oldal azonos title-lel.', impact: 2, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.9 }),
  title_length: d({ category: 'metadata', title: 'Túl rövid vagy túl hosszú title', why: 'A túl rövid title kevés kontextust ad, a túl hosszút a találati felületek levágják.', fix: 'A title kb. 30–60 karakteres legyen, elöl a fő témával.', acceptance: 'Az érintett title-ök 30–65 karakter közöttiek.', impact: 1, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.8 }),
  meta_missing: d({ category: 'metadata', title: 'Hiányzó meta description', why: 'A meta description gyakran a találati kivonat alapja; hiányában a rendszer maga választ szövegrészt.', fix: 'Írj 120–160 karakteres, konkrét, az oldal fő állítását összefoglaló leírást.', acceptance: 'Minden fontos indexelhető oldalnak van egyedi meta description-je.', impact: 1, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.9 }),
  meta_duplicate: d({ category: 'metadata', title: 'Ismétlődő meta description', why: 'Az azonos leírások nem segítik az oldalak megkülönböztetését.', fix: 'Oldalanként egyedi leírás.', acceptance: 'Nincs ismétlődő meta description.', impact: 1, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.9 }),
  h1_missing: d({ category: 'html', title: 'Hiányzó H1', why: 'A H1 jelzi egyértelműen az oldal fő témáját a gépi feldolgozás számára.', fix: 'Minden tartalmi oldal kapjon egy, a fő témát megnevező H1-et.', acceptance: 'Minden indexelhető oldalon pontosan egy H1 van.', impact: 2, effort: 'S', owner: 'both', evidenceKind: 'measured', confidence: 0.9 }),
  h1_multiple: d({ category: 'html', title: 'Több H1 egy oldalon', why: 'Több H1 esetén a fő téma kevésbé egyértelmű (nem szabálysértés, de rontja a struktúra érthetőségét).', fix: 'Egy H1 maradjon, a többi legyen H2.', acceptance: 'Oldalanként egy H1.', impact: 1, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.7 }),
  heading_skip: d({ category: 'html', title: 'Kihagyott címsorszintek (pl. H1 → H3)', why: 'A logikus címsor-hierarchia segíti a tartalom szakaszokra bontását és a válaszrészletek kiemelését.', fix: 'A címsorok szintjei sorrendben kövessék egymást; dizájn miatt ne válassz szintet.', acceptance: 'A tartalmi részben nincs kihagyott címsorszint.', impact: 1, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.8 }),
  no_main: d({ category: 'html', title: 'Nincs <main> elem', why: 'A <main> egyértelműen elválasztja a fő tartalmat a navigációtól és a lábléctől; ez segíti a tartalomkinyerést.', fix: 'Csomagold a fő tartalmat <main> elembe (sablonszinten, egyszer).', acceptance: 'Minden oldalon pontosan egy <main> van, benne a fő tartalommal.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  lang_missing: d({ category: 'html', title: 'Hiányzó lang attribútum', why: 'A nyelv megadása segíti a helyes nyelvi feldolgozást és a nyelvspecifikus válaszokat.', fix: 'Állítsd be: <html lang="hu"> (illetve a tényleges nyelvet).', acceptance: 'Minden oldal <html> elemén szerepel a tényleges nyelvnek megfelelő lang.', impact: 1, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.95 }),
  img_alt_missing: d({ category: 'html', title: 'Alt szöveg nélküli képek a fő tartalomban', why: 'A képek tartalma alt szöveg nélkül a gépi feldolgozás számára nem érhető el (és akadálymentességi hiba).', fix: 'Adj tartalmat leíró alt szöveget; a díszítő képek alt="" értéket kapjanak.', acceptance: 'A fő tartalom minden informatív képének van leíró altja.', impact: 1, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.85 }),
  thin_content: d({ category: 'content', title: 'Kevés tartalmú (thin) indexelhető oldalak', why: 'A nagyon rövid oldalak ritkán adnak teljes választ, ezért kicsi az esélyük, hogy forrásként használják őket.', fix: 'Bővítsd az oldalakat érdemi tartalommal, vagy vond össze a rokon oldalakat; a funkció nélkülieket állítsd noindexre.', acceptance: 'Az érintett oldalak vagy legalább ~300 szavas érdemi tartalmat kapnak, vagy összevonásra/noindexre kerülnek.', impact: 2, effort: 'M', owner: 'content', evidenceKind: 'measured', confidence: 0.7 }),
  duplicate_content: d({ category: 'content', title: 'Duplikált vagy közel duplikált oldalak', why: 'Az azonos tartalmú oldalak versengenek egymással, és nem egyértelmű, melyik a hiteles forrás.', fix: 'Vond össze az oldalakat, vagy kanonizáld a másolatokat a fő változatra.', acceptance: 'A duplikált oldalak canonicalja a fő változatra mutat, vagy egyedi tartalmat kapnak.', impact: 2, effort: 'M', owner: 'both', evidenceKind: 'measured', confidence: 0.8 }),
  deep_pages: d({ category: 'linking', title: 'Mélyen (4+ kattintásra) elhelyezkedő oldalak', why: 'A kezdőoldaltól távoli oldalakat a crawlerek ritkábban és később érik el.', fix: 'Linkeld a fontos oldalakat hub/kategória oldalakról, hogy legfeljebb 3 kattintásra legyenek.', acceptance: 'A fontos oldalak kattintási mélysége ≤ 3.', impact: 2, effort: 'M', owner: 'both', evidenceKind: 'measured', confidence: 0.85 }),
  orphan_pages: d({ category: 'linking', title: 'Orphan oldalak: a sitemapben vannak, de belső link nem mutat rájuk', why: 'Belső link nélkül az oldal a webhely tudásszerkezetén kívül marad; csak a sitemap teszi felfedezhetővé.', fix: 'Linkeld az oldalakat releváns tartalmi oldalakról vagy hubokról, vagy ha elavultak, vedd ki őket.', acceptance: 'Minden indexelhető oldalra legalább 2 belső link mutat.', impact: 2, effort: 'S', owner: 'content', evidenceKind: 'observed', confidence: 0.7 }),
  url_params: d({ category: 'crawl', title: 'Paraméteres belső URL-ek', why: 'A query paraméteres változatok duplikált URL-eket hoznak létre és szórják a jelzéseket.', fix: 'Belső linkekben paraméter nélküli, kanonikus URL-eket használj.', acceptance: 'A belső linkek nem tartalmaznak szűrő/követő paramétert (kivéve a funkcionálisakat).', impact: 1, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.7 }),
  url_structure: d({ category: 'crawl', title: 'Nehezen olvasható URL-ek (nagybetű, aláhúzás, túl hosszú)', why: 'A beszédes, rövid URL egyértelműbb jelzés a témáról, és kisebb a duplikáció kockázata.', fix: 'Új oldalaknál használj kisbetűs, kötőjeles, rövid URL-t; meglévőknél csak 301-es átirányítással módosíts.', acceptance: 'Az új URL-ek kisbetűsek, kötőjelesek, 100 karakter alattiak.', impact: 1, effort: 'M', owner: 'dev', evidenceKind: 'measured', confidence: 0.6 }),
  slow_ttfb: d({ category: 'crawl', title: 'Lassú szerverválasz (TTFB > 1,5 s)', why: 'A lassú válasz csökkenti a crawl-hatékonyságot, és az időkorlátos AI-lekérések elbukhatnak.', fix: 'Gyorsítótárazás (oldal-cache, CDN), szerveroldali optimalizálás.', acceptance: 'A mért TTFB az érintett oldalakon 800 ms alatt.', impact: 2, effort: 'M', owner: 'dev', evidenceKind: 'measured', confidence: 0.6 }),
  js_dependent: d({ category: 'rendering', title: 'Lényeges tartalom csak JavaScript futtatása után jelenik meg', why: 'Több AI-crawler a dokumentációja szerint nem futtat JavaScriptet. Ami csak renderelés után látszik, az ezeknek a robotoknak nem érhető el.', fix: 'A fő tartalmat szerveroldalon (SSR/SSG) vagy a kezdeti HTML-ben szolgáld ki. Elég, ha a lényeges szöveg a nyers HTML-ben benne van.', acceptance: 'A nyers HTML fő tartalmának szószáma eléri a renderelt változat legalább 80%-át.', impact: 4, effort: 'L', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  js_only_metadata: d({ category: 'rendering', title: 'Metaadat vagy strukturált adat csak renderelés után jelenik meg', why: 'A JS-sel beszúrt title/canonical/JSON-LD a nem renderelő crawlerek számára nem létezik.', fix: 'A title, canonical, meta robots és JSON-LD a szerver által küldött HTML-ben legyen.', acceptance: 'A nyers és a renderelt HTML ezen elemei megegyeznek.', impact: 3, effort: 'M', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  og_missing: d({ category: 'metadata', title: 'Hiányzó Open Graph metaadatok a fontos oldalakon', why: 'Az og:title/og:description/og:image a megosztásokban és több aggregátorban a tartalom leírását adja.', fix: 'Add meg legalább az og:title, og:description, og:image és og:url értékét.', acceptance: 'A fontos oldalakon mind a négy OG-mező szerepel.', impact: 1, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  hreflang_invalid: d({ category: 'indexing', title: 'Hibás hreflang hivatkozások', why: 'A hibás hreflang-célok miatt a nyelvi változatok összerendelése nem működik.', fix: 'A hreflang értékek érvényes nyelvkódok legyenek, és 200-as, egymásra visszahivatkozó oldalakra mutassanak.', acceptance: 'Minden hreflang cél 200-as, és tartalmaz visszahivatkozást.', impact: 2, effort: 'M', owner: 'dev', evidenceKind: 'measured', confidence: 0.75 }),
  x_robots_noindex: d({ category: 'indexing', title: 'X-Robots-Tag: noindex HTTP-fejléc', why: 'A HTTP-fejlécben küldött noindex a HTML-ben nem látszik, ezért könnyű nem észrevenni.', fix: 'Ellenőrizd a szerver- és CDN-beállításokat; ha nem szándékos, távolítsd el.', acceptance: 'Az érintett URL-ek nem küldenek X-Robots-Tag: noindex fejlécet.', impact: 4, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.9 }),
};

export interface TechnicalReport {
  statusCounts: Record<string, number>;
  classCounts: Record<string, number>;
  renderComparisons: { url: string; rawWords: number; renderedWords: number; titleDiffers: boolean; canonicalDiffers: boolean; jsonldRaw: number; jsonldRendered: number; hiddenBlocks: { kind: string; count: number }[]; visibleWords?: number }[];
  hiddenContent: { url: string; kind: string; count: number }[];
  sitemapFiles: { url: string; status?: number; type: string; urls: number; error?: string }[];
  robots: { url: string; status?: number; present: boolean; crawlDelay?: number; sitemaps: string[]; text?: string };
  skipped: number;
  limitReached: boolean;
  renderer?: string;
  renderUnavailable?: string;
}

export function technicalAudit(m: SiteModel): { issues: IssueCollector; report: TechnicalReport } {
  const ic = new IssueCollector(m.site);
  const c = m.crawl;
  const home = m.home;
  const html = m.rows.filter((r) => m.raw(r.url) && r.status && r.status < 400 && r.pageClass !== 'redirect');
  const indexable = m.rows.filter((r) => r.pageClass === 'indexable');

  if (!home || !home.status || home.status >= 400 || !m.raw(home.url)) {
    ic.add('home_unreachable', TECH.home_unreachable, { url: c.homeUrl, detail: `Válasz: ${home?.status ?? '—'} ${home?.error ?? ''}`.trim() });
  }
  if (c.robots.status && c.robots.status >= 500) ic.add('robots_5xx', TECH.robots_5xx, { url: c.robots.url, detail: `HTTP ${c.robots.status}` });
  const star = c.robots.parsed?.groups.find((g) => g.agents.includes('*'));
  if (star?.rules.some((r) => !r.allow && r.path === '/') && !star.rules.some((r) => r.allow && r.path === '/')) {
    ic.add('robots_block_all', TECH.robots_block_all, { url: c.robots.url, detail: 'User-agent: * → Disallow: /', snippet: truncate(c.robots.text ?? '', 400) });
  }
  const blocked = m.rows.filter((r) => r.pageClass === 'blocked');
  for (const r of blocked.slice(0, 100)) ic.add('robots_blocked_pages', TECH.robots_blocked_pages, { url: r.url, detail: `robots.txt szabály: ${r.error}` });

  const validSitemaps = c.sitemaps.files.filter((f) => f.type === 'urlset' || f.type === 'index');
  if (!validSitemaps.length) {
    ic.add('sitemap_missing', TECH.sitemap_missing, { url: c.sitemaps.files[0]?.url ?? `${new URL(c.homeUrl).origin}/sitemap.xml`, detail: c.sitemaps.files.map((f) => `${f.url}: ${f.error ?? f.type}`).join('; ') || 'Nem található sitemap.' });
  } else if (c.robots.parsed && !c.robots.parsed.sitemaps.length) {
    ic.add('sitemap_not_in_robots', TECH.sitemap_not_in_robots, { url: c.robots.url, detail: `A sitemap elérhető (${validSitemaps[0].url}), de a robots.txt nem hivatkozik rá.` });
  }
  for (const r of m.rows.filter((r) => r.inSitemap && r.pageClass !== 'indexable' && r.pageClass !== 'blocked').slice(0, 200)) {
    ic.add('sitemap_bad_urls', TECH.sitemap_bad_urls, { url: r.url, detail: `Sitemap-URL besorolása: ${r.pageClass}${r.status ? ` (HTTP ${r.status})` : ''}${r.canonical ? ` → canonical: ${r.canonical}` : ''}` });
  }
  if (validSitemaps.length && !c.limitReached) {
    for (const r of indexable.filter((r) => !r.inSitemap).slice(0, 200)) ic.add('sitemap_missing_pages', TECH.sitemap_missing_pages, { url: r.url, detail: 'Indexelhető, 200-as oldal, de nincs a sitemapben.' });
  }

  // hibás oldalak és a rájuk mutató linkek
  const errors = m.rows.filter((r) => r.pageClass === 'error');
  for (const r of errors) {
    const sources = m.edges.filter((e) => e.to === r.url).slice(0, 3).map((e) => e.from);
    const def = r.status ? TECH.http_errors : TECH.fetch_errors;
    ic.add(r.status ? 'http_errors' : 'fetch_errors', def, { url: r.url, detail: `${r.status ? `HTTP ${r.status}` : r.error ?? 'nincs válasz'}${sources.length ? ` – hivatkozó oldal: ${sources.join(', ')}` : ''}` });
  }
  for (const r of m.rows.filter((r) => r.pageClass === 'redirect')) {
    const p = m.crawled.get(r.url)!;
    if (p.redirects.length > 1) ic.add('redirect_chain', TECH.redirect_chain, { url: r.url, detail: `${p.redirects.length} lépés: ${p.redirects.map((x) => `${x.status} → ${x.location}`).join(' → ')}` });
    const sources = m.edges.filter((e) => e.to === r.url);
    if (sources.length) ic.add('internal_links_to_redirects', TECH.internal_links_to_redirects, { url: sources[0].from, detail: `Link erre: ${r.url} → végső cél: ${r.finalUrl} (${sources.length} hivatkozás)` });
  }

  // indexelhetőség, canonical
  for (const r of m.rows.filter((r) => r.pageClass === 'noindex')) {
    const e = m.raw(r.url)!;
    if (e.xRobotsTag.some((v) => /noindex/.test(v))) ic.add('x_robots_noindex', TECH.x_robots_noindex, { url: r.url, detail: `X-Robots-Tag: ${e.xRobotsTag.join(', ')}` });
    if (r.inSitemap || r.inlinks >= 3) ic.add('noindex_linked', TECH.noindex_linked, { url: r.url, detail: `${e.metaRobots.join('; ') || 'X-Robots-Tag'} – ${r.inSitemap ? 'sitemapben szerepel' : ''}${r.inSitemap && r.inlinks >= 3 ? ', ' : ''}${r.inlinks >= 3 ? `${r.inlinks} belső link mutat rá` : ''}` });
  }
  for (const r of html) {
    const e = m.raw(r.url)!;
    if (e.canonical.length > 1 && new Set(e.canonical).size > 1) ic.add('canonical_multiple', TECH.canonical_multiple, { url: r.url, detail: `canonical értékek: ${e.canonical.join(' | ')}` });
  }
  for (const r of indexable) {
    const e = m.raw(r.url)!;
    if (!e.canonical.length) ic.add('canonical_missing', TECH.canonical_missing, { url: r.url, detail: 'Nincs <link rel="canonical"> a nyers HTML-ben.' });
  }
  for (const r of m.rows.filter((r) => r.pageClass === 'canonicalized' && r.canonical)) {
    const t = m.byUrl.get(r.canonical!);
    if (t && t.pageClass !== 'indexable') ic.add('canonical_bad_target', TECH.canonical_bad_target, { url: r.url, detail: `canonical → ${r.canonical} (${t.pageClass}${t.status ? `, HTTP ${t.status}` : ''})` });
  }

  // metaadatok (csak indexelhető oldalakon)
  const titles = new Map<string, string[]>();
  const metas = new Map<string, string[]>();
  for (const r of indexable) {
    const e = m.raw(r.url)!;
    if (!e.title) ic.add('title_missing', TECH.title_missing, { url: r.url, detail: 'Nincs <title> a nyers HTML-ben.' });
    else {
      (titles.get(e.title.toLowerCase()) ?? titles.set(e.title.toLowerCase(), []).get(e.title.toLowerCase())!).push(r.url);
      if (e.title.length < 15 || e.title.length > 70) ic.add('title_length', TECH.title_length, { url: r.url, detail: `${e.title.length} karakter: „${truncate(e.title, 90)}”` });
    }
    if (!e.metaDescription) ic.add('meta_missing', TECH.meta_missing, { url: r.url, detail: 'Nincs meta description.' });
    else (metas.get(e.metaDescription.toLowerCase()) ?? metas.set(e.metaDescription.toLowerCase(), []).get(e.metaDescription.toLowerCase())!).push(r.url);
    const h1 = e.headings.filter((h) => h.level === 1);
    if (!h1.length) ic.add('h1_missing', TECH.h1_missing, { url: r.url, detail: 'Nincs H1 a nyers HTML-ben.' });
    else if (h1.length > 1) ic.add('h1_multiple', TECH.h1_multiple, { url: r.url, detail: `${h1.length} db H1: ${h1.map((h) => `„${truncate(h.text, 50)}”`).join(', ')}` });
    let prev = 0;
    for (const h of e.headings) {
      if (prev && h.level > prev + 1) {
        ic.add('heading_skip', TECH.heading_skip, { url: r.url, detail: `H${prev} után H${h.level}: „${truncate(h.text, 60)}”` });
        break;
      }
      prev = h.level;
    }
    if (!e.landmarks.main) ic.add('no_main', TECH.no_main, { url: r.url, detail: `Landmarkok: ${Object.entries(e.landmarks).filter(([, v]) => v).map(([k, v]) => `${k}×${v}`).join(', ') || 'nincs'}` });
    if (!e.lang) ic.add('lang_missing', TECH.lang_missing, { url: r.url, detail: '<html> lang attribútum nélkül.' });
    const noAlt = e.images.filter((i) => i.inMain && i.alt === null);
    if (noAlt.length) ic.add('img_alt_missing', TECH.img_alt_missing, { url: r.url, detail: `${noAlt.length} kép alt nélkül, pl. ${truncate(noAlt[0].src, 80)}` });
    if (r.importance >= 0.3 && (!e.og['og:title'] || !e.og['og:description'] || !e.og['og:image'])) {
      ic.add('og_missing', TECH.og_missing, { url: r.url, detail: `Hiányzik: ${['og:title', 'og:description', 'og:image', 'og:url'].filter((k) => !e.og[k]).join(', ')}` });
    }
    if (r.ttfbMs && r.ttfbMs > 1500) ic.add('slow_ttfb', TECH.slow_ttfb, { url: r.url, detail: `TTFB ${r.ttfbMs} ms (egyszeri mérés a crawl során)` });
    for (const h of e.hreflang) {
      const target = normalizeUrl(h.href, r.url);
      const t = target ? m.byUrl.get(target) : undefined;
      if (!/^([a-z]{2,3}(-[A-Za-z]{2,4})?|x-default)$/i.test(h.lang) || (t && t.pageClass !== 'indexable')) {
        ic.add('hreflang_invalid', TECH.hreflang_invalid, { url: r.url, detail: `hreflang="${h.lang}" → ${h.href}${t ? ` (${t.pageClass})` : ''}` });
      }
    }
  }
  for (const [t, urls] of titles) if (urls.length > 1) ic.add('title_duplicate', TECH.title_duplicate, urls.map((u) => ({ url: u, detail: `Azonos title (${urls.length} oldalon): „${truncate(t, 80)}”` })));
  for (const [t, urls] of metas) if (urls.length > 1) ic.add('meta_duplicate', TECH.meta_duplicate, urls.map((u) => ({ url: u, detail: `Azonos leírás (${urls.length} oldalon): „${truncate(t, 80)}”` })));

  // tartalom-struktúra jelzők
  for (const r of m.rows) {
    if (r.flags.includes('thin')) ic.add('thin_content', TECH.thin_content, { url: r.url, detail: `${r.wordCount} szó a fő tartalomban` });
    if (r.flags.includes('duplicate') || r.flags.includes('near_duplicate')) ic.add('duplicate_content', TECH.duplicate_content, { url: r.url, detail: `${r.flags.includes('duplicate') ? 'Azonos' : 'Közel azonos (simhash ≤ 3 bit eltérés)'} tartalom, mint: ${r.duplicateOf}` });
    if (r.flags.includes('deep') && r.pageClass === 'indexable') ic.add('deep_pages', TECH.deep_pages, { url: r.url, detail: `Kattintási mélység: ${r.depth}` });
    if (r.flags.includes('orphan') && r.pageClass === 'indexable') ic.add('orphan_pages', TECH.orphan_pages, { url: r.url, detail: 'A sitemapben szerepel, de a bejárt oldalakról nem mutat rá belső link.' }, { confidence: c.limitReached ? 0.45 : 0.75 });
  }
  const paramLinks = new Map<string, string>();
  for (const e of m.edges) {
    try {
      const u = new URL(e.to);
      if (u.search && !paramLinks.has(e.to)) paramLinks.set(e.to, e.from);
    } catch {
      /* érvénytelen */
    }
  }
  for (const [to, from] of [...paramLinks].slice(0, 50)) ic.add('url_params', TECH.url_params, { url: from, detail: `Paraméteres belső link: ${to}` });
  for (const r of indexable) {
    const p = new URL(r.url).pathname;
    if (/[A-Z]/.test(p) || /_/.test(p) || r.url.length > 115) ic.add('url_structure', TECH.url_structure, { url: r.url, detail: [/[A-Z]/.test(p) && 'nagybetű', /_/.test(p) && 'aláhúzás', r.url.length > 115 && `${r.url.length} karakter`].filter(Boolean).join(', ') });
  }

  // renderelés: nyers vs. renderelt
  const renderComparisons: TechnicalReport['renderComparisons'] = [];
  const hiddenContent: TechnicalReport['hiddenContent'] = [];
  for (const r of html) {
    const p = m.crawled.get(r.url)!;
    const raw = p.extracted!;
    for (const h of raw.hiddenBlocks) hiddenContent.push({ url: r.url, ...h });
    const ren = p.rendered?.extracted;
    if (!ren) continue;
    const titleDiffers = (raw.title ?? '') !== (ren.title ?? '');
    const canonicalDiffers = (raw.canonical[0] ?? '') !== (ren.canonical[0] ?? '');
    const jr = raw.jsonld.length;
    const jre = ren.jsonld.length;
    renderComparisons.push({ url: r.url, rawWords: raw.wordCount, renderedWords: ren.wordCount, titleDiffers, canonicalDiffers, jsonldRaw: jr, jsonldRendered: jre, hiddenBlocks: raw.hiddenBlocks, visibleWords: p.rendered?.visibleText?.split(/\s+/).length });
    if (r.flags.includes('js_dependent')) ic.add('js_dependent', TECH.js_dependent, { url: r.url, detail: `Nyers HTML: ${raw.wordCount} szó → renderelve: ${ren.wordCount} szó` });
    const diffs = [titleDiffers && !raw.title && 'title', canonicalDiffers && !raw.canonical.length && 'canonical', jre > jr && `JSON-LD (${jr} → ${jre} blokk)`, !isNoindex(raw) && isNoindex(ren) && 'noindex (csak renderelve)'].filter(Boolean);
    if (diffs.length) ic.add('js_only_metadata', TECH.js_only_metadata, { url: r.url, detail: `Csak renderelés után: ${diffs.join(', ')}` });
  }

  const statusCounts: Record<string, number> = {};
  for (const r of m.rows) {
    const k = r.status ? `${Math.floor(r.status / 100)}xx` : r.pageClass === 'blocked' ? 'robots' : 'hiba';
    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
  }
  const classCounts: Record<string, number> = {};
  for (const r of m.rows) classCounts[r.pageClass] = (classCounts[r.pageClass] ?? 0) + 1;
  for (const f of ['thin', 'duplicate', 'near_duplicate', 'orphan', 'deep', 'hard_to_discover', 'js_dependent', 'low_inlinks']) classCounts[f] = m.rows.filter((r) => r.flags.includes(f)).length;

  return {
    issues: ic,
    report: {
      statusCounts,
      classCounts,
      renderComparisons,
      hiddenContent: hiddenContent.slice(0, 200),
      sitemapFiles: c.sitemaps.files,
      robots: { url: c.robots.url, status: c.robots.status, present: !!c.robots.text, crawlDelay: c.robots.crawlDelay, sitemaps: c.robots.parsed?.sitemaps ?? [], text: c.robots.text?.slice(0, 20000) },
      skipped: c.skipped.length,
      limitReached: c.limitReached,
      renderer: c.renderer,
      renderUnavailable: c.renderUnavailable,
    },
  };
}
