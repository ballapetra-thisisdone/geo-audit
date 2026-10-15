// Strukturált adat audit: JSON-LD, Microdata, RDFa. Külön kezeljük:
//  1) szintaktikai érvényesség (JSON, @context, @type),
//  2) schema.org szókincs (ismert típus/property – figyelmeztetés),
//  3) Google rich result követelmények (config/structured-data.json, forrással),
//  4) a jelölt tartalom láthatósága és az oldalak közötti ellentmondások.
// Az AI-rendszerek tényleges feldolgozásáról ez nem mond semmit – ezt a riport külön jelzi.
import fs from 'node:fs';
import path from 'node:path';
import type { BusinessContext, Evidence, ExtractedPage, StructuredDataRecord } from '../../../shared/site.ts';
import { env } from '../../env.ts';
import { IssueCollector, type IssueDef } from './issues.ts';
import type { SiteModel } from './model.ts';
import { typesOf, walkLd } from './context.ts';
import { truncate } from './text.ts';

interface TypeSpec {
  extends?: string;
  props: string[];
  rich?: { feature: string; required: string[]; requiredOneOf?: string[][]; recommended: string[]; source: string; checked?: string };
}
export interface SdConfig {
  googleGallery: { checked: string; source: string; features: string[]; notInGallery: Record<string, string> };
  types: Record<string, TypeSpec>;
}

let cached: SdConfig | undefined;
export function loadSdConfig(dir = env.configDir): SdConfig {
  cached ??= JSON.parse(fs.readFileSync(path.join(dir, 'structured-data.json'), 'utf8')) as SdConfig;
  return cached;
}

function allProps(cfg: SdConfig, type: string, seen = new Set<string>()): Set<string> | undefined {
  const spec = cfg.types[type];
  if (!spec || seen.has(type)) return spec ? new Set(spec.props) : undefined;
  seen.add(type);
  const parent = spec.extends ? allProps(cfg, spec.extends, seen) : undefined;
  return new Set([...(parent ?? []), ...spec.props]);
}

function isOrgLike(cfg: SdConfig, type: string): boolean {
  let t: string | undefined = type;
  for (let i = 0; t && i < 6; i++) {
    if (t === 'Organization') return true;
    t = cfg.types[t]?.extends;
  }
  return false;
}

const has = (o: Record<string, unknown>, k: string) => {
  const v = o[k];
  return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
};

export interface NodeCheck {
  types: string[];
  errors: string[];
  warnings: string[];
  rich: StructuredDataRecord['richResults'];
}

/** Egy JSON-LD csomópont ellenőrzése (a javasolt JSON-LD validálására is ezt használjuk). */
export function checkNode(o: Record<string, unknown>, cfg: SdConfig = loadSdConfig()): NodeCheck {
  const types = typesOf(o);
  const errors: string[] = [];
  const warnings: string[] = [];
  const rich: StructuredDataRecord['richResults'] = [];
  if (!types.length) errors.push('Hiányzó @type.');
  for (const t of types) {
    const props = allProps(cfg, t);
    if (!props) {
      warnings.push(`A(z) "${t}" típus nincs a vizsgált készletben (nem feltétlenül hibás).`);
      continue;
    }
    for (const k of Object.keys(o)) {
      if (k.startsWith('@')) continue;
      if (!props.has(k)) warnings.push(`${t}: a(z) "${k}" property nem szerepel a vizsgált schema.org készletben – ellenőrizd a helyesírást.`);
    }
    const spec = cfg.types[t];
    if (cfg.googleGallery.notInGallery[t]) rich.push({ type: t, eligibleType: false, missingRequired: [], missingRecommended: [], note: cfg.googleGallery.notInGallery[t] });
    if (spec?.rich) {
      const missingRequired = spec.rich.required.filter((k) => !has(o, k));
      for (const group of spec.rich.requiredOneOf ?? []) if (!group.some((k) => has(o, k))) missingRequired.push(group.join(' | '));
      rich.push({ type: t, eligibleType: true, missingRequired, missingRecommended: spec.rich.recommended.filter((k) => !has(o, k)), note: `${spec.rich.feature} – ${spec.rich.source}` });
    }
    if (t === 'BreadcrumbList' && Array.isArray(o.itemListElement)) {
      (o.itemListElement as Record<string, unknown>[]).forEach((li, i) => {
        if (!has(li, 'position')) errors.push(`BreadcrumbList ${i + 1}. elem: hiányzó position.`);
        if (!has(li, 'name') && !(li.item && typeof li.item === 'object' && has(li.item as Record<string, unknown>, 'name'))) errors.push(`BreadcrumbList ${i + 1}. elem: hiányzó name.`);
      });
    }
  }
  for (const k of ['url', 'logo', 'image', 'sameAs', 'thumbnailUrl', 'contentUrl']) {
    const vals = ([] as unknown[]).concat(o[k] ?? []);
    for (const v of vals) if (typeof v === 'string' && v && !/^https?:\/\//.test(v)) warnings.push(`"${k}" értéke nem abszolút URL: ${truncate(v, 60)}`);
  }
  for (const k of ['datePublished', 'dateModified', 'startDate', 'endDate', 'uploadDate']) {
    const v = o[k];
    if (typeof v === 'string' && Number.isNaN(Date.parse(v))) errors.push(`"${k}" nem ISO 8601 dátum: ${v}`);
  }
  return { types, errors, warnings, rich };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function visibleCheck(o: Record<string, unknown>, types: string[], visible: string): string[] {
  const out: string[] = [];
  const contains = (s: string) => visible.includes(norm(s).slice(0, 80));
  if (types.includes('Question')) {
    const name = typeof o.name === 'string' ? o.name : '';
    const ans = o.acceptedAnswer as Record<string, unknown> | undefined;
    const text = ans && typeof ans.text === 'string' ? ans.text.replace(/<[^>]+>/g, ' ') : '';
    if (name && !contains(name)) out.push(`A jelölt kérdés nem látható az oldalon: „${truncate(name, 80)}”`);
    if (text && !contains(text)) out.push(`A jelölt válasz nem látható az oldalon: „${truncate(text, 80)}”`);
  }
  if (types.some((t) => t === 'Review' || t === 'AggregateRating')) {
    const rv = (o.reviewRating as Record<string, unknown> | undefined)?.ratingValue ?? o.ratingValue;
    if (rv !== undefined && !visible.includes(String(rv).replace('.', ',')) && !visible.includes(String(rv))) out.push(`A jelölt értékelés (${rv}) nem található a látható szövegben.`);
  }
  if (types.includes('Offer')) {
    const price = o.price;
    if (price !== undefined && !visible.replace(/[\s.]/g, '').includes(String(price).replace(/[\s.]/g, '').replace(/,00$/, ''))) out.push(`A jelölt ár (${price}) nem található a látható szövegben.`);
  }
  return out;
}

const D = (x: IssueDef) => x;
export const SD: Record<string, IssueDef> = {
  sd_syntax: D({ category: 'structured_data', title: 'Hibás JSON-LD szintaxis', why: 'Az érvénytelen JSON-t a feldolgozók teljes egészében figyelmen kívül hagyják.', fix: 'Javítsd a JSON szintaxist (idézőjelek, vesszők, escape-elés); a sablont validáld minden kiadás előtt.', acceptance: 'Minden <script type="application/ld+json"> blokk hibátlanul JSON.parse-olható.', impact: 3, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.95 }),
  sd_errors: D({ category: 'structured_data', title: 'Strukturált adat hibák (dátumformátum, kötelező mezők)', why: 'A hibás értékek miatt az adott jelölés nem, vagy hibásan kerül feldolgozásra.', fix: 'Javítsd a megjelölt mezőket a javasolt formátum szerint.', acceptance: 'A blokk hibalistája üres.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  sd_rich_required: D({ category: 'structured_data', title: 'Hiányzó, rich result szempontból kötelező property', why: 'A Google dokumentációja szerinti kötelező mezők nélkül a jelölés nem jogosult a rich result megjelenésre (a schema.org szerint ettől még érvényes lehet).', fix: 'Pótold a kötelező mezőket – csak az oldalon ténylegesen látható, igazolt adatokkal.', acceptance: 'A Rich Results Test nem jelez kötelező mezőhiányt.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  sd_no_org: D({ category: 'entity', title: 'Nincs Organization/LocalBusiness strukturált adat', why: 'A szervezet gépileg olvasható leírása (név, URL, logó, elérhetőség, sameAs) egyértelművé teszi az entitás azonosítását.', fix: 'Helyezz el a kezdőoldalon (vagy sablonszinten) Organization – illetve ha van ügyfélfogadó telephely, LocalBusiness – JSON-LD-t a látható, igazolt adatokkal.', acceptance: 'A kezdőoldalon érvényes Organization/LocalBusiness JSON-LD van, @id-vel, és a látható adatokkal egyezik.', impact: 3, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.9 }),
  sd_no_website: D({ category: 'structured_data', title: 'Nincs WebSite strukturált adat a kezdőoldalon', why: 'A WebSite jelölés rögzíti a webhely nevét és kapcsolatát a kiadó szervezettel.', fix: 'Adj WebSite JSON-LD-t a kezdőoldalhoz (name, url, publisher → Organization @id).', acceptance: 'A kezdőoldalon érvényes WebSite JSON-LD.', impact: 1, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  sd_no_breadcrumb: D({ category: 'structured_data', title: 'Látható breadcrumb BreadcrumbList jelölés nélkül', why: 'A BreadcrumbList gépileg is leírja az oldal helyét a webhely hierarchiájában.', fix: 'A látható breadcrumb mellé adj BreadcrumbList JSON-LD-t (position, name, item).', acceptance: 'A breadcrumbbal rendelkező oldalakon érvényes BreadcrumbList.', impact: 1, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.8 }),
  sd_no_article: D({ category: 'structured_data', title: 'Cikk jellegű oldalak Article/BlogPosting jelölés nélkül', why: 'Az Article jelölés rögzíti a szerzőt, a megjelenés és frissítés dátumát – ezek bizalmi és frissességi jelek.', fix: 'Adj Article/BlogPosting JSON-LD-t (headline, author, datePublished, dateModified, image) a látható adatok alapján.', acceptance: 'A cikkoldalakon érvényes Article/BlogPosting a látható szerzővel és dátumokkal.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'observed', confidence: 0.7 }),
  sd_not_visible: D({ category: 'structured_data', title: 'A strukturált adat nem látható tartalmat jelöl', why: 'A jelölésnek a felhasználó számára látható tartalmat kell leírnia; a rejtett vagy eltérő adat félrevezető, és irányelvsértésnek minősülhet.', fix: 'A jelölt értékek pontosan egyezzenek az oldalon látható szöveggel, vagy töröld a jelölést.', acceptance: 'Minden jelölt kérdés, válasz, ár és értékelés megtalálható a látható szövegben.', impact: 3, effort: 'S', owner: 'both', evidenceKind: 'measured', confidence: 0.75 }),
  sd_self_reviews: D({ category: 'structured_data', title: 'Saját magáról szóló értékelés Organization/LocalBusiness jelölésben', why: 'A Google review-snippet dokumentációja szerint a saját maga által kezelt értékelések (beágyazott widgettel is) nem jogosultak csillagos megjelenésre.', fix: 'Távolítsd el a saját szervezetre vonatkozó Review/AggregateRating jelölést, vagy csak független, a dokumentációnak megfelelő esetben használd.', acceptance: 'Az Organization/LocalBusiness csomópont nem tartalmaz saját értékelést.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.75 }),
  sd_conflict: D({ category: 'entity', title: 'Egymásnak ellentmondó szervezeti adatok a strukturált adatban', why: 'Ha a szervezet neve, telefonszáma vagy címe oldalanként eltér, az entitás azonosítása bizonytalanná válik.', fix: 'Egységesítsd a szervezeti JSON-LD-t (egy sablon, egy @id), és egyeztesd a látható adatokkal.', acceptance: 'Minden oldalon ugyanaz a név, telefonszám és cím szerepel a szervezeti jelölésben.', impact: 3, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.85 }),
  sd_not_in_gallery: D({ category: 'structured_data', title: 'FAQPage/HowTo jelölés – jelenleg nem Google rich result típus', why: 'A Google rich result galériájában jelenleg nem szerepel; a jelölés szemantikai értéke megmaradhat, de keresési rich resultot nem várhatsz tőle.', fix: 'Ne a rich result miatt tartsd fenn; ha a tartalom valóban GYIK, a jelölés maradhat, a látható tartalommal egyezően.', acceptance: 'A csapat tisztában van vele, hogy a jelölés nem ad Google rich resultot.', impact: 1, effort: 'S', owner: 'both', evidenceKind: 'measured', confidence: 0.8 }),
};

export interface StructuredReport {
  records: StructuredDataRecord[];
  typeCounts: Record<string, number>;
  pagesWithSd: number;
  pagesTotal: number;
  orgNodes: { url: string; name?: string; telephone?: string; address?: string; id?: string }[];
  note: string;
}

export function structuredAudit(m: SiteModel, ctx?: BusinessContext): { issues: IssueCollector; report: StructuredReport } {
  const cfg = loadSdConfig();
  const ic = new IssueCollector(m.site);
  const records: StructuredDataRecord[] = [];
  const typeCounts: Record<string, number> = {};
  const orgNodes: StructuredReport['orgNodes'] = [];
  let pagesWithSd = 0;
  const pages = m.rows.filter((r) => (r.pageClass === 'indexable' || r.pageClass === 'canonicalized' || r.pageClass === 'noindex') && m.raw(r.url));
  for (const r of pages) {
    const e = m.best(r.url)!;
    const visible = norm(e.mainText + ' ' + e.headings.map((h) => h.text).join(' '));
    let any = false;
    for (const b of e.jsonld) {
      any = true;
      if (b.error) {
        records.push({ url: r.url, format: 'json-ld', types: [], syntaxValid: false, errors: [b.error], warnings: [], richResults: [], visibilityMismatches: [], raw: truncate(b.raw, 3000) });
        ic.add('sd_syntax', SD.sd_syntax, { url: r.url, detail: `JSON-hiba: ${b.error}`, snippet: truncate(b.raw, 300) });
        continue;
      }
      const rec: StructuredDataRecord = { url: r.url, format: 'json-ld', types: [], syntaxValid: true, errors: [], warnings: [], richResults: [], visibilityMismatches: [], raw: truncate(b.raw, 3000) };
      const ctxVal = (b.parsed as Record<string, unknown>)?.['@context'] ?? (Array.isArray(b.parsed) ? (b.parsed[0] as Record<string, unknown>)?.['@context'] : undefined);
      if (!ctxVal || !/schema\.org/i.test(JSON.stringify(ctxVal))) rec.warnings.push('A @context nem schema.org (vagy hiányzik).');
      walkLd(b.parsed, (o) => {
        const c = checkNode(o, cfg);
        rec.types.push(...c.types);
        rec.errors.push(...c.errors);
        rec.warnings.push(...c.warnings);
        rec.richResults.push(...c.rich);
        rec.visibilityMismatches.push(...visibleCheck(o, c.types, visible));
        for (const t of c.types) {
          typeCounts[t] = (typeCounts[t] ?? 0) + 1;
          if (isOrgLike(cfg, t)) {
            const addr = o.address && typeof o.address === 'object' ? Object.values(o.address as Record<string, unknown>).filter((v) => typeof v === 'string' && !String(v).startsWith('Postal')).join(', ') : typeof o.address === 'string' ? o.address : undefined;
            orgNodes.push({ url: r.url, name: typeof o.name === 'string' ? o.name : undefined, telephone: typeof o.telephone === 'string' ? o.telephone : undefined, address: addr, id: typeof o['@id'] === 'string' ? o['@id'] : undefined });
            if (has(o, 'aggregateRating') || has(o, 'review')) ic.add('sd_self_reviews', SD.sd_self_reviews, { url: r.url, detail: `${t} csomópont értékelést tartalmaz (${has(o, 'aggregateRating') ? 'aggregateRating' : 'review'}). Ellenőrizd, hogy független forrásból származik-e.` }, { confidence: 0.6 });
          }
        }
      });
      rec.types = [...new Set(rec.types)];
      records.push(rec);
      if (rec.errors.length) ic.add('sd_errors', SD.sd_errors, { url: r.url, detail: rec.errors.slice(0, 3).join(' ') });
      for (const rr of rec.richResults) {
        if (rr.eligibleType && rr.missingRequired.length) ic.add('sd_rich_required', SD.sd_rich_required, { url: r.url, detail: `${rr.type}: hiányzik ${rr.missingRequired.join(', ')} (${rr.note})` });
        if (!rr.eligibleType) ic.add('sd_not_in_gallery', SD.sd_not_in_gallery, { url: r.url, detail: `${rr.type}: ${rr.note}` });
      }
      for (const v of rec.visibilityMismatches) ic.add('sd_not_visible', SD.sd_not_visible, { url: r.url, detail: v });
    }
    for (const [format, list] of [['microdata', e.microdata], ['rdfa', e.rdfa]] as const) {
      for (const it of list) {
        any = true;
        typeCounts[it.type] = (typeCounts[it.type] ?? 0) + 1;
        const props = Object.fromEntries(Object.entries(it.props).map(([k, v]) => [k, v[0]]));
        const c = checkNode({ '@type': it.type, ...props }, cfg);
        records.push({ url: r.url, format, types: [it.type], syntaxValid: true, errors: c.errors, warnings: c.warnings.filter((w) => !w.includes('nem abszolút')), richResults: c.rich, visibilityMismatches: [], raw: truncate(JSON.stringify(it.props), 2000) });
      }
    }
    if (any) pagesWithSd++;
    // hiányzó jelölések
    const types = new Set(records.filter((x) => x.url === r.url).flatMap((x) => x.types));
    if (e.breadcrumb.length >= 2 && !types.has('BreadcrumbList')) ic.add('sd_no_breadcrumb', SD.sd_no_breadcrumb, { url: r.url, detail: `Látható breadcrumb: ${e.breadcrumb.join(' › ')}` });
    const articleLike = r.pageClass === 'indexable' && (/\/(blog|hirek|hír|news|cikk|article|magazin|tudastar|tudástár|post)s?\/[^/?#]+/i.test(r.url) || (!!e.datePublished && e.author.length > 0));
    if (articleLike && ![...types].some((t) => /Article|BlogPosting|NewsArticle|Report|ScholarlyArticle/.test(t))) {
      ic.add('sd_no_article', SD.sd_no_article, { url: r.url, detail: `Cikk jellegű oldal (${e.author.length ? `szerző: ${e.author[0].name}` : 'URL-minta'}${e.datePublished ? `, dátum: ${e.datePublished}` : ''}), Article jelölés nélkül.` });
    }
  }
  const allTypes = new Set(Object.keys(typeCounts));
  if (![...allTypes].some((t) => isOrgLike(cfg, t))) {
    ic.add('sd_no_org', SD.sd_no_org, { url: m.crawl.homeUrl, detail: `A bejárt ${pages.length} oldal egyikén sincs Organization/LocalBusiness jelölés.${ctx?.organization.value ? ` Felismert szervezetnév: ${ctx.organization.value}.` : ''}` });
  }
  if (m.home) {
    const homeTypes = new Set(records.filter((x) => x.url === m.home!.url).flatMap((x) => x.types));
    if (!homeTypes.has('WebSite')) ic.add('sd_no_website', SD.sd_no_website, { url: m.home.url, detail: 'A kezdőoldalon nincs WebSite jelölés.' });
  }
  // ellentmondások a szervezeti csomópontok között
  const field = (k: 'name' | 'telephone' | 'address') => new Set(orgNodes.map((o) => o[k]?.toLowerCase().replace(/[\s-]/g, '')).filter(Boolean));
  const conflicts: Evidence[] = [];
  for (const k of ['name', 'telephone', 'address'] as const) {
    const vals = field(k);
    if (vals.size > 1) conflicts.push({ url: orgNodes[0]?.url, detail: `${k}: ${[...new Set(orgNodes.map((o) => o[k]).filter(Boolean))].slice(0, 5).join(' | ')}` });
  }
  if (conflicts.length) ic.add('sd_conflict', SD.sd_conflict, conflicts);

  return {
    issues: ic,
    report: {
      records,
      typeCounts,
      pagesWithSd,
      pagesTotal: pages.length,
      orgNodes: orgNodes.slice(0, 50),
      note: `A schema.org szintaktikai érvényesség, a Google rich result követelmények (galéria ellenőrizve: ${cfg.googleGallery.checked}) és az AI-rendszerek tényleges feldolgozása három külön kérdés. A strukturált adat megléte nem garantál megjelenést vagy idézést.`,
    },
  };
}

/** Megfigyelt adatokból összeállított Organization + WebSite JSON-LD javaslat. Csak a crawl során látott értékeket használja. */
export function suggestOrgJsonLd(m: SiteModel, ctx: BusinessContext): { json: object; missing: string[]; sources: string[] } | undefined {
  const home = m.home ? m.best(m.home.url) : undefined;
  if (!home || !ctx.organization.value) return undefined;
  const origin = new URL(m.crawl.homeUrl).origin;
  const sources: string[] = [`Név: ${ctx.organization.source}`];
  const org: Record<string, unknown> = { '@type': 'Organization', '@id': `${origin}/#organization`, name: ctx.organization.value, url: `${origin}/` };
  const missing: string[] = [];
  const logo = home.images.find((i) => /logo/i.test(i.src) || /logo/i.test(i.alt ?? ''));
  if (logo?.src) {
    try {
      org.logo = new URL(logo.src, origin).toString();
      sources.push(`Logó: <img> a kezdőoldalon (${truncate(logo.src, 60)})`);
    } catch {
      missing.push('logo');
    }
  } else missing.push('logo (nem azonosítható logókép)');
  if (home.socialProfiles.length) {
    org.sameAs = home.socialProfiles;
    sources.push('sameAs: a kezdőoldal közösségimédia-linkjei');
  } else missing.push('sameAs (nincs közösségi profil link)');
  const tels = [...new Set(m.content.slice(0, 20).flatMap((r) => m.best(r.url)?.contactSignals.tel ?? []))];
  if (tels.length === 1) {
    org.telephone = tels[0];
    sources.push('telephone: tel: link / szöveg (egyetlen egyedi érték a webhelyen)');
  } else missing.push(tels.length ? `telephone (több eltérő szám: ${tels.slice(0, 3).join(', ')} – válaszd ki a hivatalosat)` : 'telephone');
  const emails = [...new Set(m.content.slice(0, 20).flatMap((r) => m.best(r.url)?.contactSignals.email ?? []))];
  if (emails.length === 1) {
    org.email = emails[0];
    sources.push('email: mailto: link / szöveg');
  } else missing.push('email');
  if (ctx.activity.value && ctx.activity.confidence >= 0.6) {
    org.description = ctx.activity.value;
    sources.push(`description: ${ctx.activity.source}`);
  }
  missing.push('address (csak akkor add meg, ha a cím az oldalon látható)');
  const website = { '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: ctx.organization.value, publisher: { '@id': `${origin}/#organization` }, ...(ctx.language.value ? { inLanguage: ctx.language.value } : {}) };
  return { json: { '@context': 'https://schema.org', '@graph': [org, website] }, missing, sources };
}

/** BreadcrumbList a látható breadcrumb alapján – az URL-eket a breadcrumbban szereplő linkekből vesszük. */
export function suggestBreadcrumb(e: ExtractedPage): object | undefined {
  if (e.breadcrumb.length < 2) return undefined;
  const items = e.breadcrumb.map((name, i) => {
    const link = e.links.find((l) => l.internal && l.text === name);
    const item: Record<string, unknown> = { '@type': 'ListItem', position: i + 1, name };
    if (link) item.item = link.href;
    else if (i === e.breadcrumb.length - 1) item.item = e.url;
    return item;
  });
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

/** Article jelölés a látható adatokból (szerző, dátumok, cím, kép). */
export function suggestArticle(e: ExtractedPage, orgId?: string): { json: object; missing: string[] } {
  const a: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'Article', headline: e.headings.find((h) => h.level === 1)?.text ?? e.title, mainEntityOfPage: e.url };
  const missing: string[] = [];
  if (e.og['og:image']) a.image = [e.og['og:image']];
  else missing.push('image');
  if (e.datePublished) a.datePublished = e.datePublished;
  else missing.push('datePublished (a megjelenés dátuma nem látható)');
  if (e.dateModified) a.dateModified = e.dateModified;
  if (e.author.length) a.author = e.author.map((x) => ({ '@type': 'Person', name: x.name, ...(x.url ? { url: x.url } : {}) }));
  else missing.push('author (nincs azonosítható szerző – ne adj meg nem létező személyt)');
  if (orgId) a.publisher = { '@id': orgId };
  return { json: a, missing };
}
