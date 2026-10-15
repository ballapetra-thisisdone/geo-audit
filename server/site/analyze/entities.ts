// Entity audit és auditon belüli entitásgráf. A gráf a webhelyen talált jelekből épül, forrás-URL-ekkel;
// nem állítjuk, hogy megfelel bármely külső kereső vagy AI-rendszer tudásgráfjának.
import type { BusinessContext, EntityEdge, EntityNode } from '../../../shared/site.ts';
import { IssueCollector, type IssueDef } from './issues.ts';
import type { SiteModel } from './model.ts';
import { typesOf, walkLd } from './context.ts';
import { hostKey } from '../crawl/url.ts';

const D = (x: IssueDef) => x;
const ENT: Record<string, IssueDef> = {
  name_inconsistent: D({ category: 'entity', title: 'A szervezet/márka neve következetlenül szerepel', why: 'Ha ugyanaz a szervezet több eltérő néven szerepel (title, og:site_name, strukturált adat), a gépi rendszerek nehezebben kapcsolják össze az említéseket egy entitással.', fix: 'Rögzíts egy hivatalos nevet (és ha kell, egy rövid márkanevet alternateName-ként), és használd egységesen a title-ben, az og:site_name-ben és a JSON-LD-ben.', acceptance: 'A név minden gépi jelzésben azonos (a jogi forma és a rövid név alternateName-ként dokumentálva).', impact: 2, effort: 'S', owner: 'both', evidenceKind: 'observed', confidence: 0.6 }),
  no_sameas: D({ category: 'entity', title: 'Nincs kapcsolat külső profilokhoz (sameAs)', why: 'A sameAs a szervezetet hivatalos külső profilokhoz (LinkedIn, Wikipedia/Wikidata, cégadatbázis) köti, ami segíti az egyértelmű azonosítást.', fix: 'Add meg az Organization JSON-LD sameAs tömbjében a hivatalos, létező profilokat.', acceptance: 'Az Organization jelölésben szerepel legalább 2 valós, elérhető profil.', impact: 2, effort: 'S', owner: 'dev', evidenceKind: 'measured', confidence: 0.8 }),
  people_unlinked: D({ category: 'entity', title: 'Szerzők/szakértők profil és szervezeti kapcsolat nélkül', why: 'A személy és a szervezet közötti kapcsolat (worksFor, profiloldal) nélkül a szakértelem nem köthető a szervezethez.', fix: 'Hozz létre profiloldalt a valós szakértőknek, és jelöld Person JSON-LD-vel (jobTitle, worksFor, sameAs).', acceptance: 'Minden feltüntetett szerzőnek van profiloldala és Person jelölése worksFor kapcsolattal.', impact: 2, effort: 'M', owner: 'both', evidenceKind: 'observed', confidence: 0.6 }),
};

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const stripLegal = (s: string) => s.toLowerCase().replace(/\b(kft|zrt|bt|nyrt|kkt|ltd|gmbh|inc|llc)\.?\b/g, '').replace(/[.,\s]+/g, ' ').trim();

export interface EntityReport {
  nodes: EntityNode[];
  edges: EntityEdge[];
  nameVariants: { name: string; sources: string[] }[];
  note: string;
}

export function entityAudit(m: SiteModel, ctx: BusinessContext): { issues: IssueCollector; report: EntityReport } {
  const ic = new IssueCollector(m.site);
  const nodes = new Map<string, EntityNode>();
  const edges: EntityEdge[] = [];
  const add = (type: string, name: string, url: string | undefined, o: Partial<EntityNode> = {}) => {
    const id = `${type.toLowerCase()}:${slug(name)}`;
    let n = nodes.get(id);
    if (!n) {
      n = { id, type, name, variants: [], urls: [], confidence: o.confidence ?? 0.5, evidenceKind: o.evidenceKind ?? 'observed', inSchema: false, sameAs: [], description: o.description };
      nodes.set(id, n);
    }
    if (url && !n.urls.includes(url) && n.urls.length < 30) n.urls.push(url);
    if (o.inSchema) n.inSchema = true;
    if (o.confidence && o.confidence > n.confidence) n.confidence = o.confidence;
    if (o.evidenceKind === 'measured') n.evidenceKind = 'measured';
    for (const s of o.sameAs ?? []) if (!n.sameAs.includes(s)) n.sameAs.push(s);
    if (o.description && !n.description) n.description = o.description;
    return n;
  };
  const link = (from: EntityNode, to: EntityNode, type: string, url?: string, kind: EntityEdge['evidenceKind'] = 'observed') => {
    let e = edges.find((x) => x.from === from.id && x.to === to.id && x.type === type);
    if (!e) {
      e = { from: from.id, to: to.id, type, urls: [], evidenceKind: kind };
      edges.push(e);
    }
    if (url && !e.urls.includes(url) && e.urls.length < 20) e.urls.push(url);
    if (kind === 'measured') e.evidenceKind = 'measured';
  };

  const orgName = ctx.organization.value;
  const org = orgName ? add('Organization', orgName, m.crawl.homeUrl, { confidence: ctx.organization.confidence, description: ctx.activity.value ?? undefined }) : undefined;
  if (org) org.variants = ctx.brandVariants.filter((v) => v !== org.name);

  // strukturált adatból
  for (const r of m.content) {
    const e = m.best(r.url)!;
    for (const b of e.jsonld) {
      walkLd(b.parsed, (o) => {
        const types = typesOf(o);
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        if (!name || name.length > 120) return;
        const sameAs = ([] as unknown[]).concat(o.sameAs ?? []).filter((x): x is string => typeof x === 'string');
        let n: EntityNode | undefined;
        if (types.some((t) => /Organization|LocalBusiness|Corporation|Service$|Clinic|Store|Restaurant|Dentist|Physician|NGO/.test(t) && t !== 'Service')) {
          n = org && stripLegal(name) === stripLegal(org.name) ? org : add('Organization', name, r.url, { inSchema: true, evidenceKind: 'measured', confidence: 0.85, sameAs });
          n.inSchema = true;
          for (const s of sameAs) if (!n.sameAs.includes(s)) n.sameAs.push(s);
          if (n !== org && org) link(org, n, 'kapcsolódó szervezet', r.url, 'measured');
        } else if (types.includes('Person')) {
          n = add('Person', name, r.url, { inSchema: true, evidenceKind: 'measured', confidence: 0.85, sameAs });
          const wf = o.worksFor as Record<string, unknown> | undefined;
          if (org && wf && (typeof wf === 'object')) link(n, org, 'worksFor', r.url, 'measured');
        } else if (types.includes('Service')) {
          n = add('Service', name, r.url, { inSchema: true, evidenceKind: 'measured', confidence: 0.8 });
          if (org) link(org, n, 'nyújtja', r.url, 'measured');
        } else if (types.some((t) => /^Product/.test(t))) {
          n = add('Product', name, r.url, { inSchema: true, evidenceKind: 'measured', confidence: 0.8 });
          if (org) link(org, n, 'kínálja', r.url, 'measured');
          const brand = o.brand as Record<string, unknown> | undefined;
          if (brand && typeof brand.name === 'string') link(n, add('Brand', brand.name, r.url, { inSchema: true, evidenceKind: 'measured' }), 'márka', r.url, 'measured');
        } else if (types.includes('Brand')) {
          n = add('Brand', name, r.url, { inSchema: true, evidenceKind: 'measured' });
          if (org) link(org, n, 'márkája', r.url, 'measured');
        } else if (types.some((t) => /Place|City|Country/.test(t))) {
          n = add('Location', name, r.url, { inSchema: true, evidenceKind: 'measured' });
          if (org) link(org, n, 'helyszín', r.url, 'measured');
        }
      });
    }
    // szerzők
    for (const a of e.author) {
      const p = add('Person', a.name, r.url, { confidence: 0.7, evidenceKind: 'measured' });
      if (org) link(p, org, 'szerzőként publikál itt', r.url);
    }
  }
  // kínálat (felismert) – csak ha nincs még ilyen node
  for (const o of ctx.offerings.value.slice(0, 20)) {
    const id = `service:${slug(o)}`;
    if (nodes.has(id) || nodes.has(`product:${slug(o)}`)) continue;
    const page = m.content.find((r) => (m.best(r.url)?.headings.find((h) => h.level === 1)?.text ?? '') === o);
    const n = add('Service', o, page?.url, { confidence: ctx.offerings.confidence, evidenceKind: ctx.offerings.source === 'felhasználói input' ? 'recommendation' : 'observed' });
    if (org) link(org, n, 'nyújtja', page?.url);
  }
  for (const g of ctx.geo.value.filter((g) => !g.endsWith('TLD')).slice(0, 10)) {
    const n = add('Location', g, undefined, { confidence: ctx.geo.confidence });
    if (org) link(org, n, 'földrajzi fókusz');
  }
  // partnerek: "partner" oldalak tartalmi külső linkjei
  for (const r of m.content.filter((r) => /partner/i.test(r.url) || /partner/i.test(r.h1 ?? '')).slice(0, 5)) {
    const e = m.best(r.url)!;
    for (const l of e.links.filter((l) => !l.internal && l.zone === 'main').slice(0, 15)) {
      const dom = hostKey(new URL(l.href).hostname);
      const n = add('Partner', l.text && l.text.length < 60 ? l.text : dom, r.url, { confidence: 0.4 });
      if (org) link(org, n, 'partner (oldal alapján)', r.url);
    }
  }
  // témák/fogalmak
  for (const t of ctx.topics.value.slice(0, 12)) {
    const n = add('Topic', t, undefined, { confidence: ctx.topics.confidence, evidenceKind: 'estimate' });
    for (const s of [...nodes.values()].filter((x) => x.type === 'Service' || x.type === 'Product')) {
      const page = s.urls[0] ? m.best(s.urls[0]) : undefined;
      if (page && page.mainText.toLowerCase().includes(t.toLowerCase())) link(s, n, 'témája', s.urls[0]);
    }
    if (org && !edges.some((e) => e.to === n.id)) link(org, n, 'foglalkozik vele (gyakori kifejezés)');
  }
  if (org) {
    const home = m.home ? m.best(m.home.url) : undefined;
    for (const s of home?.socialProfiles ?? []) if (!org.sameAs.includes(s)) org.sameAs.push(s);
  }

  // problémák
  const variants = new Map<string, string[]>();
  const addVariant = (name: string | undefined, src: string) => {
    if (!name) return;
    const k = stripLegal(name);
    (variants.get(k) ?? variants.set(k, []).get(k)!).push(src);
  };
  for (const v of ctx.organization.evidence ?? []) addVariant(v.replace(/\s\(.*\)$/, ''), v.match(/\((.*)\)$/)?.[1] ?? '');
  const meaningful = [...variants.keys()].filter((k) => k.length > 1);
  if (meaningful.length > 1 && org) {
    ic.add('name_inconsistent', ENT.name_inconsistent, { url: m.crawl.homeUrl, detail: `Névváltozatok: ${(ctx.organization.evidence ?? []).join(' · ')}` });
  }
  if (org && !org.sameAs.length) ic.add('no_sameas', ENT.no_sameas, { url: m.crawl.homeUrl, detail: 'Sem a strukturált adatban, sem a kezdőoldalon nincs hivatalos külső profil link.' });
  const people = [...nodes.values()].filter((n) => n.type === 'Person');
  const unlinked = people.filter((p) => !edges.some((e) => e.from === p.id && e.type === 'worksFor') && !p.sameAs.length);
  if (unlinked.length) ic.add('people_unlinked', ENT.people_unlinked, unlinked.slice(0, 20).map((p) => ({ url: p.urls[0], detail: `${p.name}: nincs worksFor kapcsolat és külső profil` })));

  return {
    issues: ic,
    report: {
      nodes: [...nodes.values()],
      edges,
      nameVariants: [...variants.entries()].map(([name, sources]) => ({ name, sources })),
      note: 'Az auditon belüli entitásgráf a webhelyen talált jelekből (strukturált adat, szerzői metaadatok, oldalstruktúra, gyakori kifejezések) épül. Nem azonos és nem feltétlenül egyezik egy külső kereső vagy AI-rendszer tudásgráfjával.',
    },
  };
}
