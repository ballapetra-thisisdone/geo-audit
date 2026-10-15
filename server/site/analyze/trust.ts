// E-E-A-T és bizalmi jelek. Nem egyetlen pontszám: jelenként mutatjuk, mi található és mi hiányzik, bizonyítékkal.
import type { Evidence, EvidenceKind } from '../../../shared/site.ts';
import { IssueCollector, type IssueDef } from './issues.ts';
import type { SiteModel } from './model.ts';
import type { ContentReport } from './content.ts';

export interface TrustSignal {
  id: string;
  label: string;
  group: 'Szervezet' | 'Szakértelem' | 'Tapasztalat' | 'Bizonyíték' | 'Átláthatóság';
  present: boolean | null;
  evidence: Evidence[];
  kind: EvidenceKind;
  note?: string;
}

const D = (x: IssueDef) => x;
const TRUST: Record<string, IssueDef> = {
  no_contact: D({ category: 'trust', title: 'Nem található kapcsolatfelvételi oldal vagy elérhetőség', why: 'Az elérhetőség a szervezet valódiságának és elszámoltathatóságának alapvető jele.', fix: 'Készíts kapcsolat oldalt telefonszámmal, e-maillel és (ha van) címmel; linkeld a láblécből.', acceptance: 'Minden oldalról elérhető kapcsolat oldal valós elérhetőségekkel.', impact: 3, effort: 'S', owner: 'content', evidenceKind: 'observed', confidence: 0.75 }),
  no_company_info: D({ category: 'trust', title: 'Nem azonosíthatók a cégadatok (impresszum)', why: 'A cégnév, székhely és nyilvántartási adatok ellenőrizhetővé teszik a szervezetet.', fix: 'Adj impresszum/cégadatok oldalt (cégnév, székhely, cégjegyzékszám, adószám), és linkeld a láblécből.', acceptance: 'Látható impresszum a hivatalos cégadatokkal.', impact: 2, effort: 'S', owner: 'business', evidenceKind: 'observed', confidence: 0.65 }),
  no_about: D({ category: 'trust', title: 'Nincs bemutatkozó (rólunk) oldal', why: 'A szervezet háttere, története és csapata a szakértelem és tapasztalat legfontosabb kontextusa.', fix: 'Készíts rólunk oldalt: alapítás, tevékenység, csapat, szakmai háttér, elérések – igazolható tényekkel.', acceptance: 'Elérhető rólunk oldal konkrét, ellenőrizhető adatokkal.', impact: 2, effort: 'M', owner: 'content', evidenceKind: 'observed', confidence: 0.65 }),
  no_experts: D({ category: 'trust', title: 'Nem azonosíthatók a szakértők/szerzők', why: 'A szakmai tartalmak mögötti valós személyek és szakértelmük a hitelesség kulcsa.', fix: 'Mutasd be a szakértőket (név, szerep, végzettség, tapasztalat), és kapcsold őket a tartalmaikhoz; csak valós adatokkal.', acceptance: 'Szakértői profilok elérhetők, és a szakmai tartalmakon fel vannak tüntetve.', impact: 3, effort: 'M', owner: 'content', evidenceKind: 'observed', confidence: 0.6 }),
  no_proof: D({ category: 'trust', title: 'Nincsenek referenciák vagy esettanulmányok', why: 'A konkrét referenciák és eredmények igazolják a tapasztalatot.', fix: 'Publikálj valós referenciákat/esettanulmányokat (ügyfél hozzájárulásával): kiinduló helyzet, megoldás, mérhető eredmény.', acceptance: 'Legalább egy esettanulmány vagy referencialista elérhető.', impact: 2, effort: 'L', owner: 'business', evidenceKind: 'observed', confidence: 0.55 }),
};

export interface TrustReport {
  signals: TrustSignal[];
  note: string;
}

export function trustAudit(m: SiteModel, content: ContentReport): { issues: IssueCollector; report: TrustReport } {
  const ic = new IssueCollector(m.site);
  const pages = m.content;
  const findPages = (re: RegExp) => pages.filter((r) => re.test(r.url.toLowerCase()) || re.test((m.best(r.url)?.headings.find((h) => h.level === 1)?.text ?? '').toLowerCase()));
  const textHits = (re: RegExp, max = 5): Evidence[] => {
    const out: Evidence[] = [];
    for (const r of pages) {
      const t = m.best(r.url)!.mainText;
      const mm = re.exec(t);
      re.lastIndex = 0;
      if (mm) out.push({ url: r.url, detail: 'Szöveges előfordulás', snippet: t.slice(Math.max(0, mm.index - 60), mm.index + 100) });
      if (out.length >= max) break;
    }
    return out;
  };
  const anySig = (k: 'impressum' | 'about' | 'contact' | 'privacy') => pages.filter((r) => m.best(r.url)!.contactSignals[k]).slice(0, 3);
  const tels = [...new Set(pages.flatMap((r) => m.best(r.url)!.contactSignals.tel))];
  const emails = [...new Set(pages.flatMap((r) => m.best(r.url)!.contactSignals.email))];
  const addr = pages.filter((r) => m.best(r.url)!.contactSignals.address).slice(0, 3);
  const contactPages = findPages(/kapcsolat|contact|elerhetoseg|elérhetőség/);
  const aboutPages = findPages(/rolunk|rólunk|about|bemutatkoz|kik-vagyunk/);
  const teamPages = findPages(/csapat|team|munkatars|munkatárs|orvos|szakert|szakért|experts?|our-people/);
  const authorPages = findPages(/\/(author|szerzo|szerző)\//);
  const refPages = findPages(/referenci|esettanulm|case-stud|portfolio|projektek|projects|ugyfeleink|ügyfeleink|clients/);
  const companyReg = textHits(/\b(Cg\.\s?\d{2}-\d{2}-\d{6}|cégjegyzékszám|adószám|VAT (?:number|ID)|company registration)/gi, 3);
  const testimonials = textHits(/\b(vélemények?|ajánlás|értékelés(?:ek)?|testimonials?|reviews?|mondták rólunk)\b/gi, 3);
  const certs = textHits(/\b(ISO\s?\d{4,5}|tanúsít\w*|minősít\w*|akkredit\w*|díj(?:at|as|azott)?|award\w*|certified|certification)\b/gi, 3);
  const articles = content.pages.filter((p) => p.kind === 'article');
  const withAuthor = articles.filter((p) => p.signals.authors.length);
  const withDate = content.pages.filter((p) => p.signals.ageDays !== null);
  const extRefPages = content.pages.filter((p) => p.signals.externalRefs > 0);
  const firstHand = content.pages.filter((p) => p.signals.originality > 0);

  const sig = (s: TrustSignal) => s;
  const signals: TrustSignal[] = [
    sig({ id: 'contact', label: 'Kapcsolat oldal', group: 'Átláthatóság', present: contactPages.length > 0 || anySig('contact').length > 0, evidence: [...contactPages.slice(0, 2), ...anySig('contact').slice(0, 1)].map((r) => ({ url: r.url, detail: 'kapcsolat link/oldal' })), kind: 'observed' }),
    sig({ id: 'phone', label: 'Telefonszám', group: 'Átláthatóság', present: tels.length > 0, evidence: tels.slice(0, 3).map((t) => ({ detail: t })), kind: 'measured', note: tels.length > 1 ? `${tels.length} különböző szám – ellenőrizd az egységességet.` : undefined }),
    sig({ id: 'email', label: 'E-mail cím', group: 'Átláthatóság', present: emails.length > 0, evidence: emails.slice(0, 3).map((t) => ({ detail: t })), kind: 'measured' }),
    sig({ id: 'address', label: 'Postai cím', group: 'Szervezet', present: addr.length > 0, evidence: addr.map((r) => ({ url: r.url, detail: '<address> vagy címminta' })), kind: 'observed' }),
    sig({ id: 'company', label: 'Cégadatok / impresszum', group: 'Szervezet', present: anySig('impressum').length > 0 || companyReg.length > 0, evidence: [...anySig('impressum').map((r) => ({ url: r.url, detail: 'impresszum link' })), ...companyReg], kind: 'observed' }),
    sig({ id: 'privacy', label: 'Adatkezelési tájékoztató', group: 'Átláthatóság', present: anySig('privacy').length > 0, evidence: anySig('privacy').map((r) => ({ url: r.url, detail: 'adatvédelmi link' })), kind: 'observed' }),
    sig({ id: 'about', label: 'Rólunk / bemutatkozás', group: 'Szervezet', present: aboutPages.length > 0 || anySig('about').length > 0, evidence: [...aboutPages, ...anySig('about')].slice(0, 3).map((r) => ({ url: r.url, detail: 'bemutatkozó oldal/link' })), kind: 'observed' }),
    sig({ id: 'team', label: 'Csapat / szakértők bemutatása', group: 'Szakértelem', present: teamPages.length > 0, evidence: teamPages.slice(0, 3).map((r) => ({ url: r.url, detail: 'csapat/szakértő oldal' })), kind: 'observed' }),
    sig({ id: 'authors', label: 'Szerzők a cikkeken', group: 'Szakértelem', present: articles.length ? withAuthor.length / articles.length >= 0.5 : null, evidence: withAuthor.slice(0, 3).map((p) => ({ url: p.url, detail: p.signals.authors.join(', ') })), kind: 'measured', note: articles.length ? `${withAuthor.length}/${articles.length} cikkoldalon van szerző.` : 'Nincs cikk jellegű oldal a mintában.' }),
    sig({ id: 'author_profiles', label: 'Szerzői profiloldalak', group: 'Szakértelem', present: authorPages.length > 0 ? true : articles.length ? false : null, evidence: authorPages.slice(0, 3).map((r) => ({ url: r.url, detail: 'szerzői oldal' })), kind: 'observed' }),
    sig({ id: 'references', label: 'Referenciák / esettanulmányok', group: 'Tapasztalat', present: refPages.length > 0, evidence: refPages.slice(0, 3).map((r) => ({ url: r.url, detail: 'referencia/esettanulmány oldal' })), kind: 'observed' }),
    sig({ id: 'first_hand', label: 'Saját tapasztalatra/adatra utaló tartalom', group: 'Tapasztalat', present: firstHand.length > 0, evidence: firstHand.slice(0, 3).map((p) => ({ url: p.url, detail: `${p.signals.originality} előfordulás` })), kind: 'observed' }),
    sig({ id: 'testimonials', label: 'Ügyfélvélemények', group: 'Bizonyíték', present: testimonials.length > 0, evidence: testimonials, kind: 'observed', note: 'Szöveges minta alapján; a vélemények valódiságát nem ellenőrizzük.' }),
    sig({ id: 'certifications', label: 'Tanúsítványok, díjak, minősítések', group: 'Bizonyíték', present: certs.length > 0, evidence: certs, kind: 'observed', note: 'Szöveges említés; a tanúsítvány érvényességét nem ellenőrizzük.' }),
    sig({ id: 'sources', label: 'Külső szakmai forráshivatkozások', group: 'Bizonyíték', present: extRefPages.length > 0, evidence: extRefPages.slice(0, 3).map((p) => ({ url: p.url, detail: `${p.signals.externalRefs} külső link a tartalomban` })), kind: 'measured' }),
    sig({ id: 'dates', label: 'Publikációs/frissítési dátumok', group: 'Átláthatóság', present: content.pages.length ? withDate.length / content.pages.length >= 0.3 : null, evidence: withDate.slice(0, 3).map((p) => ({ url: p.url, detail: p.signals.dateModified ?? p.signals.datePublished ?? '' })), kind: 'measured', note: `${withDate.length}/${content.pages.length} vizsgált oldalon azonosítható dátum.` }),
  ];

  const home = m.crawl.homeUrl;
  const s = (id: string) => signals.find((x) => x.id === id)!;
  if (!s('contact').present && !s('phone').present && !s('email').present) ic.add('no_contact', TRUST.no_contact, { url: home, detail: 'Nem található kapcsolat oldal, tel: vagy mailto: link, sem e-mail cím a bejárt oldalakon.' });
  if (!s('company').present) ic.add('no_company_info', TRUST.no_company_info, { url: home, detail: 'Nincs impresszum link, sem cégjegyzékszám/adószám a bejárt oldalakon.' });
  if (!s('about').present) ic.add('no_about', TRUST.no_about, { url: home, detail: 'Nem található rólunk/bemutatkozó oldal.' });
  if (!s('team').present && s('authors').present !== true) ic.add('no_experts', TRUST.no_experts, { url: home, detail: 'Nincs csapat/szakértő oldal, és a cikkek többségén nincs szerző.' });
  if (!s('references').present && !s('first_hand').present) ic.add('no_proof', TRUST.no_proof, { url: home, detail: 'Nem található referencia/esettanulmány oldal vagy saját tapasztalatra utaló tartalom.' });

  return {
    issues: ic,
    report: {
      signals,
      note: 'Az E-E-A-T nem egyetlen közvetlenül mérhető rangsorolási pontszám. Itt a webhelyen megfigyelhető bizalmi jeleket és a hiányzó bizonyítékokat mutatjuk, jelenként a bizonyítékkal. Külső hírnevet (sajtó, értékelések harmadik feleknél) ez a vizsgálat nem mér.',
    },
  };
}
