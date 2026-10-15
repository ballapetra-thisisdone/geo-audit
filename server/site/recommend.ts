// False-positive ellenőrzés, prioritás, konkrét javítási javaslatok, fejlesztői backlog és vezetői összefoglaló.
// A javaslatok csak megfigyelt adatokból épülnek; ahol adat hiányzik, kitöltendő sablont adunk (validation: 'template').
// A javasolt kódot automatikusan validáljuk, ahol lehet (JSON.parse + séma-ellenőrzés, robots-értelmező).
import type {
  BusinessContext, DeveloperTask, EvidenceKind, ExecutiveSummary, GeoScore, Issue, LinkSuggestion, Opportunity, PriorityLevel, QueryGap, QueryRow, Recommendation, TopicRow,
} from '../../shared/site.ts';
import { parseRobots, isAllowed } from '../collect/robots.ts';
import type { SiteModel } from './analyze/model.ts';
import { prioritize } from './analyze/issues.ts';
import { checkNode, suggestArticle, suggestBreadcrumb, suggestOrgJsonLd } from './analyze/structured.ts';
import { walkLd } from './analyze/context.ts';
import { truncate } from './analyze/text.ts';
import type { AiBotReport } from './analyze/aibots.ts';

type RawIssue = Issue & { _blocker?: boolean; _business?: number };

/** False-positive szűrés és prioritás. Visszaadja a végleges issue-listát. */
export function qualityCheck(issues: RawIssue[], m: SiteModel, opts: { limitReached: boolean; renderRan: boolean }): Issue[] {
  const important = new Set(m.content.slice(0, 10).map((r) => r.url));
  const total = m.rows.filter((r) => r.pageClass === 'indexable').length;
  const out: Issue[] = [];
  for (const raw of issues) {
    const notes: string[] = [];
    // 1. bizonyíték nélküli megállapítás nem marad
    const seen = new Set<string>();
    raw.evidence = raw.evidence.filter((e) => {
      const k = `${e.url}|${e.detail}`;
      if (seen.has(k) || !e.detail) return false;
      seen.add(k);
      return true;
    });
    if (!raw.evidence.length) continue;
    // 2. hiányos adat → csökkentett bizonyosság
    if (opts.limitReached && ['orphan_pages', 'sitemap_missing_pages', 'missing_links'].includes(raw.code)) {
      raw.confidence = Math.round(raw.confidence * 0.6 * 100) / 100;
      notes.push('A crawl elérte az oldalkorlátot: a linkgráf részleges, ezért a bizonyosság csökkentve.');
    }
    if (!opts.renderRan && raw.category === 'rendering') notes.push('Renderelés nélkül nem ellenőrizhető teljesen.');
    // 3. üzleti fontosság: fontos oldalakat érint
    if (raw.urls.some((u) => important.has(u))) raw._business = Math.max(raw._business ?? 1, 1.2);
    if (raw.owner === 'business' && raw.category === 'ai_access') notes.push('Üzleti döntést igényel – nem automatikusan hiba.');
    raw.priority = prioritize(raw, total);
    raw.qa = notes.join(' ') || undefined;
    const { _blocker, _business, ...clean } = raw;
    void _blocker;
    void _business;
    out.push(clean);
  }
  const order: Record<PriorityLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return out.sort((a, b) => order[a.priority] - order[b.priority] || b.impact - a.impact || b.urls.length - a.urls.length);
}

let recSeq = 0;
const rid = () => `REC-${String(++recSeq).padStart(3, '0')}`;

function validateJsonLd(json: object): { validation: Recommendation['validation']; note: string } {
  try {
    const text = JSON.stringify(json, null, 2);
    JSON.parse(text);
    const errors: string[] = [];
    const missingReq: string[] = [];
    walkLd(json, (o) => {
      const c = checkNode(o);
      errors.push(...c.errors);
      for (const r of c.rich) if (r.eligibleType && r.missingRequired.length) missingReq.push(`${r.type}: ${r.missingRequired.join(', ')}`);
    });
    if (errors.length) return { validation: 'unverified', note: `Validációs hiba: ${errors.join('; ')}` };
    return { validation: 'tested', note: `Automatikusan validálva: JSON szintaxis ✓, schema.org típus/property-készlet ✓${missingReq.length ? `; rich result kötelező mező hiányzik: ${missingReq.join('; ')}` : ''}. Élesítés előtt: Schema Markup Validator és Rich Results Test.` };
  } catch (e) {
    return { validation: 'unverified', note: `JSON-hiba: ${(e as Error).message}` };
  }
}

const brandOf = (ctx: BusinessContext) => ctx.organization.value ?? '';
const cutAt = (s: string, n: number) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1) > n * 0.6 ? s.lastIndexOf(' ', n - 1) : n - 1).trimEnd() + '…');

export function buildRecommendations(issues: Issue[], m: SiteModel, ctx: BusinessContext, extra: { links: LinkSuggestion[]; queries: QueryRow[]; topics: TopicRow[]; gaps: QueryGap[]; aiBots?: AiBotReport }): Recommendation[] {
  recSeq = 0;
  const recs: Recommendation[] = [];
  const byCode = new Map(issues.filter((i) => i.site === m.site).map((i) => [i.code, i]));
  const push = (r: Omit<Recommendation, 'id'>) => recs.push({ id: rid(), ...r });
  const brand = brandOf(ctx);
  const lang = ctx.language.value ?? 'hu';
  const ev = (url: string, detail: string) => [{ url, detail }];

  for (const code of ['title_missing', 'title_length', 'title_duplicate']) {
    const iss = byCode.get(code);
    if (!iss) continue;
    for (const url of iss.urls.slice(0, 25)) {
      const e = m.best(url);
      if (!e) continue;
      const h1 = e.headings.find((h) => h.level === 1)?.text ?? e.headings[0]?.text;
      if (!h1) continue;
      const base = cutAt(h1, brand ? 60 - brand.length - 3 : 60);
      const proposed = brand && !h1.toLowerCase().includes(brand.toLowerCase()) ? `${base} | ${brand}` : base;
      if (proposed === e.title) continue;
      push({ issueId: iss.id, type: 'title', url, title: 'Javasolt title', original: e.title ?? '(nincs)', proposed, rationale: 'Az oldal H1-éből és a felismert márkanévből; egyedi, a fő témával kezdődik, ~60 karakter alatt.', evidence: ev(url, `H1: „${truncate(h1, 80)}”`), confidence: 0.55, validation: 'template', validationNote: 'Szabályalapú vázlat – szerkesztői ellenőrzés szükséges.', priority: iss.priority, origin: 'rule' });
    }
  }
  const meta = byCode.get('meta_missing');
  if (meta) {
    for (const url of meta.urls.slice(0, 25)) {
      const e = m.best(url);
      if (!e?.firstParagraph) continue;
      push({ issueId: meta.id, type: 'meta_description', url, title: 'Javasolt meta description', original: '(nincs)', proposed: cutAt(e.firstParagraph, 155), rationale: 'Az oldal első érdemi bekezdéséből kivonatolva (csak az oldalon szereplő szöveg).', evidence: ev(url, 'Forrás: első bekezdés'), confidence: 0.5, validation: 'unverified', validationNote: 'Kivonat – fogalmazd át, hogy cselekvésre ösztönző és pontos legyen.', priority: meta.priority, origin: 'rule' });
    }
  }
  const h1m = byCode.get('h1_missing');
  if (h1m) {
    for (const url of h1m.urls.slice(0, 20)) {
      const e = m.best(url);
      const t = e?.title?.split(/\s[|–—-]\s/)[0]?.trim();
      if (!t) continue;
      push({ issueId: h1m.id, type: 'h1', url, title: 'Javasolt H1', original: '(nincs H1)', proposed: `<h1>${t}</h1>`, lang: 'html', rationale: 'A title fő része alapján; a H1 a fő témát nevezze meg.', evidence: ev(url, `title: „${e?.title}”`), confidence: 0.55, validation: 'template', priority: h1m.priority, origin: 'rule' });
    }
  }
  const hs = byCode.get('heading_skip') ?? byCode.get('no_structure');
  if (hs) {
    for (const url of hs.urls.slice(0, 10)) {
      const e = m.best(url);
      if (!e) continue;
      let prev = 0;
      const fixed = e.headings.slice(0, 30).map((h) => {
        const lvl = prev ? Math.min(h.level, prev + 1) : h.level;
        prev = lvl;
        return `${'  '.repeat(lvl - 1)}H${lvl}: ${truncate(h.text, 80)}`;
      });
      const orig = e.headings.slice(0, 30).map((h) => `${'  '.repeat(h.level - 1)}H${h.level}: ${truncate(h.text, 80)}`);
      push({ issueId: hs.id, type: 'heading_outline', url, title: 'Javított címsor-hierarchia', original: orig.join('\n'), proposed: fixed.join('\n'), lang: 'text', rationale: 'A szintek kihagyás nélkül követik egymást; a szöveg változatlan.', evidence: ev(url, hs.evidence.find((x) => x.url === url)?.detail ?? ''), confidence: 0.75, validation: 'tested', validationNote: 'Automatikus ellenőrzés: nincs kihagyott szint.', priority: hs.priority, origin: 'rule' });
    }
  }
  const canon = byCode.get('canonical_missing');
  if (canon) {
    for (const url of canon.urls.slice(0, 15)) {
      push({ issueId: canon.id, type: 'html', url, title: 'Önhivatkozó canonical', original: '(nincs)', proposed: `<link rel="canonical" href="${url}">`, lang: 'html', rationale: 'Az oldal normalizált, 200-as, indexelhető URL-je.', evidence: ev(url, 'HTTP 200, indexelhető'), confidence: 0.9, validation: 'tested', validationNote: 'Az URL a crawl során 200-as, indexelhető volt.', priority: canon.priority, origin: 'rule' });
    }
  }
  const lg = byCode.get('lang_missing');
  if (lg && ctx.language.value) push({ issueId: lg.id, type: 'html', title: 'lang attribútum', original: '<html>', proposed: `<html lang="${ctx.language.value}">`, lang: 'html', rationale: `Felismert nyelv: ${ctx.language.value} (${ctx.language.source}).`, evidence: lg.evidence.slice(0, 3), confidence: ctx.language.confidence, validation: 'tested', priority: lg.priority, origin: 'rule' });
  const nm = byCode.get('no_main');
  if (nm) push({ issueId: nm.id, type: 'html', url: nm.urls[0], title: 'Szemantikus oldalváz', proposed: '<header>…logó, fő navigáció…</header>\n<main id="main">\n  <article>\n    <h1>…</h1>\n    …fő tartalom…\n  </article>\n</main>\n<footer>…</footer>', lang: 'html', rationale: 'A <main> egyértelműen elválasztja a fő tartalmat a navigációtól és a lábléctől (sablonszintű módosítás).', evidence: nm.evidence.slice(0, 3), confidence: 0.8, validation: 'template', validationNote: 'Sablonminta – a konkrét téma template-jébe illesztendő.', priority: nm.priority, origin: 'rule' });
  const alt = byCode.get('img_alt_missing');
  if (alt) {
    for (const url of alt.urls.slice(0, 5)) {
      const img = m.best(url)?.images.find((i) => i.inMain && i.alt === null);
      if (img) push({ issueId: alt.id, type: 'html', url, title: 'Alt szöveg pótlása', original: `<img src="${truncate(img.src, 80)}">`, proposed: `<img src="${truncate(img.src, 80)}" alt="[a kép tartalmának leírása]">`, lang: 'html', rationale: 'Informatív képnél a tartalmat írd le; díszítő képnél alt="".', evidence: ev(url, `kép: ${truncate(img.src, 80)}`), confidence: 0.8, validation: 'template', priority: alt.priority, origin: 'rule' });
    }
  }

  // robots.txt javaslatok – az értelmezővel tesztelve
  const sb = byCode.get('search_bot_blocked');
  if (sb && extra.aiBots && m.crawl.robots.text) {
    const blocked = extra.aiBots.rows.filter((r) => (r.purpose === 'search' || r.purpose === 'crawler') && (r.allowedHome === false || r.blockedSample.length));
    const add = blocked.map((r) => `User-agent: ${r.token}\nAllow: /`).join('\n\n');
    const proposed = `${add}\n\n${m.crawl.robots.text.trim()}`;
    const parsed = parseRobots(proposed);
    const ok = blocked.every((r) => isAllowed(parsed, r.token, '/').allowed);
    push({ issueId: sb.id, type: 'robots', url: m.crawl.robots.url, title: 'robots.txt: keresési robotok engedélyezése (ha az üzleti döntés ez)', original: truncate(m.crawl.robots.text, 1500), proposed, lang: 'text', rationale: `Csak a keresési/AI-válasz célú robotokat engedélyezi (${blocked.map((r) => r.name).join(', ')}); a tanító célú robotok szabályai változatlanok.`, evidence: sb.evidence, confidence: 0.85, validation: ok ? 'tested' : 'unverified', validationNote: ok ? 'Az RFC 9309 értelmezővel ellenőrizve: a felsorolt robotok számára a "/" engedélyezett.' : 'Az értelmező szerint nem minden robot engedélyezett – ellenőrizd.', priority: sb.priority, origin: 'rule' });
  }
  const snr = byCode.get('sitemap_not_in_robots');
  if (snr) {
    const sm = m.crawl.sitemaps.files.find((f) => f.type === 'urlset' || f.type === 'index');
    if (sm) push({ issueId: snr.id, type: 'robots', url: m.crawl.robots.url, title: 'Sitemap sor a robots.txt-be', proposed: `Sitemap: ${sm.url}`, lang: 'text', rationale: 'A sitemap elérhető, de a robots.txt nem hivatkozik rá.', evidence: snr.evidence, confidence: 0.95, validation: 'tested', validationNote: `A sitemap a crawl során HTTP ${sm.status}, érvényes ${sm.type}.`, priority: snr.priority, origin: 'rule' });
  }

  // strukturált adat – csak megfigyelt értékekkel, validálva
  const org = byCode.get('sd_no_org');
  if (org) {
    const s = suggestOrgJsonLd(m, ctx);
    if (s) {
      const v = validateJsonLd(s.json);
      push({ issueId: org.id, type: 'jsonld', url: m.crawl.homeUrl, title: 'Organization + WebSite JSON-LD', original: '(nincs)', proposed: `<script type="application/ld+json">\n${JSON.stringify(s.json, null, 2)}\n</script>`, lang: 'html', rationale: `Csak a webhelyen megfigyelt értékek: ${s.sources.join('; ')}. Kitöltendő/ellenőrizendő: ${s.missing.join('; ')}.`, evidence: org.evidence, confidence: 0.7, validation: v.validation, validationNote: v.note, priority: org.priority, origin: 'rule' });
    }
  }
  const bc = byCode.get('sd_no_breadcrumb');
  if (bc) {
    for (const url of bc.urls.slice(0, 10)) {
      const e = m.best(url);
      const j = e && suggestBreadcrumb(e);
      if (!j) continue;
      const v = validateJsonLd(j);
      push({ issueId: bc.id, type: 'jsonld', url, title: 'BreadcrumbList JSON-LD', original: '(nincs)', proposed: `<script type="application/ld+json">\n${JSON.stringify(j, null, 2)}\n</script>`, lang: 'html', rationale: `A látható breadcrumb alapján: ${e!.breadcrumb.join(' › ')}.`, evidence: ev(url, `breadcrumb: ${e!.breadcrumb.join(' › ')}`), confidence: 0.75, validation: v.validation, validationNote: v.note, priority: bc.priority, origin: 'rule' });
    }
  }
  const art = byCode.get('sd_no_article');
  if (art) {
    const origin = new URL(m.crawl.homeUrl).origin;
    for (const url of art.urls.slice(0, 10)) {
      const e = m.best(url);
      if (!e) continue;
      const s = suggestArticle(e, `${origin}/#organization`);
      const v = validateJsonLd(s.json);
      push({ issueId: art.id, type: 'jsonld', url, title: 'Article JSON-LD', original: '(nincs)', proposed: `<script type="application/ld+json">\n${JSON.stringify(s.json, null, 2)}\n</script>`, lang: 'html', rationale: `A látható adatokból (cím, szerző, dátum, og:image).${s.missing.length ? ` Hiányzik: ${s.missing.join('; ')}.` : ''}`, evidence: ev(url, art.evidence.find((x) => x.url === url)?.detail ?? ''), confidence: 0.7, validation: v.validation, validationNote: v.note, priority: art.priority, origin: 'rule' });
    }
  }

  // tartalom: válaszblokk-brief (LLM nélkül nem írunk tényállítást)
  const naf = byCode.get('no_answer_first');
  if (naf) {
    for (const url of naf.urls.slice(0, 12)) {
      const e = m.best(url);
      if (!e) continue;
      const topic = e.headings.find((h) => h.level === 1)?.text ?? e.title ?? '';
      const facts = e.passages.flatMap((p) => p.text.match(/[^.!?]*\d[^.!?]*[.!?]/g) ?? []).slice(0, 4).map((s) => `„${truncate(s.trim(), 140)}”`);
      push({
        issueId: naf.id,
        type: 'answer_block',
        url,
        title: `Válaszblokk a H1 alá: „${truncate(topic, 60)}”`,
        original: e.firstParagraph ? truncate(e.firstParagraph, 400) : '(nincs nyitóbekezdés)',
        proposed: [
          `Cél: 40–60 szavas, önállóan érthető összefoglaló közvetlenül a H1 alatt.`,
          `1. mondat: mi ez (${topic}) – egyértelmű definíció/megnevezés.`,
          `2. mondat: kinek szól és milyen problémát old meg.`,
          `3. mondat: a legfontosabb konkrétum (ár/időtartam/eredmény/feltétel) – csak igazolt adat.`,
          facts.length ? `Az oldalon már szereplő, felhasználható tények:\n${facts.map((f) => `  • ${f}`).join('\n')}` : 'Az oldalon nem található konkrét számadat – a tartalomgazdától kell beszerezni.',
        ].join('\n'),
        lang: 'text',
        rationale: 'A válaszrendszerek önállóan érthető szövegrészeket emelnek ki; a nyitó összefoglaló növeli az esélyt, hogy az oldal fő állítása helyesen kerüljön kivonatolásra (nem garancia).',
        evidence: naf.evidence.filter((x) => x.url === url),
        confidence: 0.55,
        validation: 'template',
        validationNote: 'Szerkesztői brief – a szöveget a tartalomgazda írja meg valós adatokkal.',
        priority: naf.priority,
        origin: 'rule',
      });
    }
  }
  // content brief + FAQ témánként a hiányzó kérdésekből
  for (const t of extra.topics.filter((t) => t.coverage !== 'full').slice(0, 12)) {
    const qs = extra.queries.filter((q) => q.cluster === t.id && q.coverage !== 'full');
    if (!qs.length) continue;
    const gaps = extra.gaps.filter((g) => g.topic === t.label);
    const target = t.ownUrls[0];
    const linkFrom = extra.links.filter((l) => l.to === target).map((l) => l.from).slice(0, 3);
    const hubs = m.content.slice(0, 3).map((r) => r.url);
    const iss = byCode.get('unanswered_high_value');
    // P1 csak ténylegesen megfigyelt AI-citation gap esetén; generált (nem igazolt) kérdéseknél a probléma prioritása öröklődik
    const prio: PriorityLevel = gaps.some((g) => g.basis === 'observed_citation') ? 'P1' : iss?.priority ?? 'P2';
    push({
      issueId: iss?.id,
      type: 'content_brief',
      url: target,
      title: `Content brief: ${t.label}${target ? ' (meglévő oldal bővítése)' : ' (új oldal)'}`,
      proposed: [
        `Céloldal: ${target ?? `új oldal (javasolt útvonal: /${t.id}/)`}`,
        `Javasolt H1: ${t.label}`,
        `Szerkezet (H2 = a felhasználó kérdése, alatta 40–80 szavas közvetlen válasz, majd részletek):`,
        ...qs.slice(0, 8).map((q) => `  H2: ${q.text}${q.hypothesis ? ' [generált kérdés – keresési adattal ellenőrizendő]' : ''}`),
        `Kötelező bizonyítékok: konkrét számok/árak/határidők a valós adatokból, a szakértő neve és szerepe, frissítési dátum, forráshivatkozások a szakmai állításokhoz.`,
        `Belső linkek: ide mutasson ${[...linkFrom, ...hubs].filter((u) => u !== target).slice(0, 3).join(', ') || 'a releváns hub oldal'}.`,
        gaps.length ? `Versenytárs-referencia: ${[...new Set(gaps.map((g) => g.competitorUrl).filter(Boolean))].slice(0, 3).join(', ')} (${gaps[0].competitorTraits.slice(0, 3).join(', ')})` : '',
        `Strukturált adat: a tartalomtípusnak megfelelő jelölés (Service/Article), csak látható adatokkal.`,
      ].filter(Boolean).join('\n'),
      lang: 'text',
      rationale: `${qs.length} kérdésre nincs teljes válasz ebben a témában${t.competitorCoverage.some((c) => c.coverage === 'full') ? `; ${t.competitorCoverage.filter((c) => c.coverage === 'full').map((c) => c.domain).join(', ')} lefedi` : ''}.`,
      evidence: qs.slice(0, 5).map((q) => ({ url: q.bestUrl, detail: `[${q.coverage}] ${q.text}` })),
      confidence: 0.5,
      validation: 'template',
      validationNote: 'Brief – a kérdések hipotézisek; a tényeket a tartalomgazda adja.',
      priority: prio,
      origin: 'rule',
    });
    push({
      issueId: iss?.id,
      type: 'faq',
      url: target,
      title: `GYIK-jelöltek: ${t.label}`,
      proposed: qs.slice(0, 6).map((q) => `K: ${q.text}\nV: [a tartalomgazda által megadott, igazolt válasz – 40–80 szó]`).join('\n\n'),
      lang: 'text',
      rationale: 'Csak a kérdéseket javasoljuk; választ nem generálunk igazolt adat nélkül. FAQPage jelölés jelenleg nem ad Google rich resultot, de a kérdés–válasz struktúra a szöveg kivonatolását segíti.',
      evidence: qs.slice(0, 3).map((q) => ({ url: q.bestUrl, detail: q.text })),
      confidence: 0.45,
      validation: 'template',
      priority: prio === 'P1' ? 'P2' : 'P3',
      origin: 'rule',
    });
  }
  // belső linkek
  const ml = byCode.get('missing_links');
  for (const l of extra.links.slice(0, 40)) {
    push({ issueId: ml?.id, type: 'internal_link', url: l.from, title: `Belső link → ${truncate(l.to, 70)}`, original: '', proposed: `Forrás: ${l.from}\nCél: ${l.to}\nAnchor: „${l.anchor}”\nHely: a forrásoldal azon bekezdése, amely a céloldal témáját említi.`, lang: 'text', rationale: l.reason, evidence: [{ url: l.to, detail: l.reason }], confidence: Math.min(0.8, 0.4 + l.score), validation: 'unverified', priority: ml?.priority ?? 'P3', origin: 'rule' });
  }
  // szerzői bemutatkozás sablon
  const na = byCode.get('no_author') ?? byCode.get('no_experts');
  if (na) push({ issueId: na.id, type: 'author_bio', url: na.urls[0], title: 'Szerzői/szakértői bemutatkozás sablon', proposed: '[Név] – [szerep/pozíció] a(z) [szervezet]-nél.\n[X] év tapasztalat a(z) [szakterület] területén; [végzettség/képesítés].\nSzakterületei: [1–3 téma].\nProfil: [profiloldal URL] · [LinkedIn vagy szakmai adatbázis URL]', lang: 'text', rationale: 'Csak valós személy valós adataival tölthető ki – nem létező szerzőt nem javaslunk.', evidence: na.evidence.slice(0, 3), confidence: 0.6, validation: 'template', priority: na.priority, origin: 'rule' });
  // entitásleírás
  const ent = byCode.get('sd_no_org') ?? byCode.get('name_inconsistent') ?? byCode.get('no_sameas');
  if (ent && ctx.organization.value) {
    const parts = [
      `${ctx.organization.value}${ctx.activity.value && ctx.activity.confidence >= 0.6 ? ` – ${truncate(ctx.activity.value, 200)}` : ' – [egy mondat: mivel foglalkozik]'}`,
      ctx.offerings.value.length ? `Fő szolgáltatások/termékek: ${ctx.offerings.value.slice(0, 6).join(', ')}.` : 'Fő szolgáltatások: [kitöltendő].',
      ctx.geo.value.filter((g) => !g.endsWith('TLD')).length ? `Földrajzi fókusz: ${ctx.geo.value.filter((g) => !g.endsWith('TLD')).join(', ')}.` : 'Földrajzi fókusz: [kitöltendő].',
      'Alapítás éve, csapat mérete, kiemelt referenciák: [csak igazolt adat].',
    ];
    push({ issueId: ent.id, type: 'entity_description', url: m.crawl.homeUrl, title: 'Egységes entitásleírás (rólunk, láblécszöveg, Organization.description)', proposed: parts.join('\n'), lang: 'text', rationale: `A felismert adatokból (${ctx.organization.source}; ${ctx.offerings.source}). A szögletes zárójeles részek kitöltendők.`, evidence: ent.evidence.slice(0, 3), confidence: Math.min(ctx.organization.confidence, 0.7), validation: 'template', priority: ent.priority, origin: 'rule' });
  }
  const js = byCode.get('js_dependent');
  if (js) push({ issueId: js.id, type: 'html', url: js.urls[0], title: 'Fő tartalom szerveroldali kiszolgálása', proposed: `Érintett oldalak (${js.urls.length}): ${js.urls.slice(0, 5).join(', ')}\n\n1. A fő szöveges tartalom (H1, bevezető, szakaszok) kerüljön a szerver által küldött HTML-be (SSR/SSG vagy pre-render).\n2. Az accordion/tab tartalma legyen a DOM-ban a kezdeti HTML-ben is (CSS-sel rejtve), ne kattintásra töltődjön be.\n3. Ellenőrzés: curl -A "OAI-SearchBot" <URL> | grep "<a fő szöveg egy mondata>"`, lang: 'text', rationale: js.evidence.slice(0, 3).map((e) => e.detail).join('; '), evidence: js.evidence.slice(0, 5), confidence: 0.8, validation: 'template', priority: js.priority, origin: 'rule' });
  return recs;
}

export function buildBacklog(issues: Issue[], recs: Recommendation[]): DeveloperTask[] {
  const tasks: DeveloperTask[] = [];
  const own = issues.filter((i) => !i.id.includes(':'));
  own.forEach((i, idx) => {
    const r = recs.filter((x) => x.issueId === i.id);
    tasks.push({
      id: `GEO-${String(idx + 1).padStart(3, '0')}`,
      title: i.title,
      description: `${i.why}\n\nTeendő: ${i.fix}${i.qa ? `\n\nMegjegyzés: ${i.qa}` : ''}`,
      priority: i.priority,
      impact: i.impact,
      effort: i.effort,
      owner: i.owner,
      urls: i.urls.slice(0, 100),
      technical: [
        `Kategória: ${i.category} · bizonyíték: ${i.evidenceKind} · bizonyosság: ${Math.round(i.confidence * 100)}%`,
        ...i.evidence.slice(0, 5).map((e) => `- ${e.url ? `${e.url}: ` : ''}${e.detail}`),
        r.length ? `Kapcsolódó javaslatok/kódminták: ${r.slice(0, 10).map((x) => x.id).join(', ')}${r.length > 10 ? ` (+${r.length - 10})` : ''}` : '',
      ].filter(Boolean).join('\n'),
      acceptance: [i.acceptance, ...(r.some((x) => x.type === 'jsonld') ? ['A JSON-LD a Schema Markup Validatorban hibátlan, a Rich Results Testben nincs kötelező mezőhiány.'] : []), 'Az érintett URL-ek újra-auditálásakor a probléma nem jelentkezik.'],
      dependencies: [],
      issueIds: [i.id],
      recommendationIds: r.map((x) => x.id),
    });
  });
  // függőségek egyszerű szabályokkal
  const find = (code: string) => tasks.find((t) => t.issueIds.some((id) => id === code));
  const deps: [string, string][] = [
    ['sd_no_breadcrumb', 'sd_no_org'], ['sd_no_article', 'sd_no_org'], ['no_sameas', 'sd_no_org'], ['people_unlinked', 'no_experts'],
    ['missing_links', 'unanswered_high_value'], ['canonical_bad_target', 'duplicate_content'], ['sitemap_missing_pages', 'sitemap_missing'], ['og_missing', 'title_missing'],
  ];
  for (const [a, b] of deps) {
    const ta = find(a);
    const tb = find(b);
    if (ta && tb) ta.dependencies.push(tb.id);
  }
  return tasks;
}

export function executiveSummary(o: {
  score: GeoScore;
  issues: Issue[];
  ctx: BusinessContext;
  opportunities: Opportunity[];
  sources: { label: string; status: string; note?: string }[];
  limitReached: boolean;
  renderNote?: string;
  pages: number;
  topics: TopicRow[];
}): ExecutiveSummary {
  const own = o.issues.filter((i) => !i.id.includes(':'));
  const critical = own.filter((i) => i.priority === 'P0' || i.priority === 'P1');
  const best = o.score.components.filter((c) => c.status === 'ok' && (c.score ?? 0) >= 75).map((c) => `${c.label}: ${c.score}/100`);
  const worst = o.score.components.filter((c) => c.status === 'ok' && (c.score ?? 100) < 50).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const fullTopics = o.topics.filter((t) => t.coverage === 'full').map((t) => t.label);
  const kind = (k: EvidenceKind) => k;
  void kind;
  return {
    headline:
      o.score.overall === null
        ? `A GEO Score nem számítható elégtelen adat miatt (mért súlyarány: ${Math.round(o.score.measuredWeightShare * 100)}%). ${o.pages} oldalt vizsgáltunk.`
        : `GEO Score: ${o.score.overall}/100 (belső értékelés, bizonyosság ${Math.round(o.score.confidence * 100)}%). ${o.pages} oldal, ${critical.length} kritikus/magas prioritású problémacsoport.`,
    findings: [
      ...worst.slice(0, 3).map((c) => `Leggyengébb terület – ${c.label} (${c.score}/100): ${c.explanation}`),
      ...critical.slice(0, 3).map((i) => `${i.priority}: ${i.title} (${i.urls.length} URL)`),
    ],
    strengths: [...best.slice(0, 5), ...(fullTopics.length ? [`Jól lefedett témák: ${fullTopics.slice(0, 5).join(', ')}`] : [])],
    critical: critical.slice(0, 8).map((i) => `${i.priority} · ${i.title} – ${i.urls.length} érintett URL`),
    opportunities: o.opportunities.slice(0, 5).map((x) => `${x.priority} · ${x.title}`),
    limits: [
      ...o.sources.filter((s) => s.status !== 'used').map((s) => `${s.label}: ${s.status === 'not_configured' ? 'nincs konfigurálva' : s.status}${s.note ? ` – ${s.note}` : ''}`),
      ...(o.limitReached ? ['A crawl elérte a beállított oldalszámkorlátot – a linkgráf és a lefedettség részleges.'] : []),
      ...(o.renderNote ? [o.renderNote] : []),
      'A generált kérdések hipotézisek, amíg keresési adat nem támasztja alá őket.',
      'A Citation Potential becslés; tényleges idézést csak az AI Visibility modul mér, ha konfigurált.',
    ],
  };
}
