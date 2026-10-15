// Belső linkgráf és tudásszerkezet: hubok, orphan és gyengén linkelt oldalak, mély oldalak, hibás linkek,
// anchor-problémák, témaklaszterek és konkrét belső link javaslatok (forrás → cél → anchor → indoklás).
import type { BusinessContext, LinkGraphSummary, LinkSuggestion } from '../../../shared/site.ts';
import { IssueCollector, type IssueDef } from './issues.ts';
import type { SiteModel } from './model.ts';
import { cosine, tfVector, tokens, truncate } from './text.ts';

const GENERIC = /^(tovább|tovább olvasom|tovább »|részletek|részletesen|bővebben|kattints ide|kattintson ide|ide|itt|read more|more|learn more|click here|here|megnézem|>|»|→|link|weboldal|website)$/i;

const D = (x: IssueDef) => x;
const LNK: Record<string, IssueDef> = {
  generic_anchor: D({ category: 'linking', title: 'Semmitmondó anchor szövegek a tartalomban', why: 'A „tovább”, „részletek” típusú anchor nem mond semmit a céloldal témájáról; a leíró anchor a kapcsolat jelentését is átadja.', fix: 'Cseréld leíró anchorra, amely megnevezi a céloldal témáját.', acceptance: 'A tartalmi linkek anchor szövege megnevezi a céloldal témáját.', impact: 1, effort: 'S', owner: 'content', evidenceKind: 'measured', confidence: 0.85 }),
  missing_links: D({ category: 'linking', title: 'Hiányzó belső linkek tematikusan összetartozó oldalak között', why: 'A kapcsolódó tartalmak összekötése erősíti a témaklasztereket, és segíti a gyengén linkelt oldalak felfedezését.', fix: 'Helyezd el a javasolt belső linkeket a forrásoldalak releváns bekezdésében, a javasolt anchorral.', acceptance: 'A javasolt linkek élesek, a céloldalak legalább 2 tartalmi belső linket kapnak.', impact: 2, effort: 'S', owner: 'content', evidenceKind: 'estimate', confidence: 0.55 }),
};

export function linkAudit(m: SiteModel, ctx: BusinessContext): { issues: IssueCollector; report: LinkGraphSummary } {
  const ic = new IssueCollector(m.site);
  const lang = ctx.language.value;
  const indexable = m.content;
  const hubs = [...indexable].sort((a, b) => b.inlinks - a.inlinks).slice(0, 15).map((r) => ({ url: r.url, inlinks: r.inlinks, rank: r.importance }));
  const orphans = m.rows.filter((r) => r.flags.includes('orphan')).map((r) => r.url);
  const lowInlinks = m.rows.filter((r) => r.flags.includes('low_inlinks')).map((r) => r.url);
  const deep = m.rows.filter((r) => r.flags.includes('deep') && r.pageClass === 'indexable').map((r) => ({ url: r.url, depth: r.depth }));
  const broken = m.edges
    .filter((e) => m.byUrl.get(e.to)?.pageClass === 'error')
    .map((e) => ({ from: e.from, to: e.to, status: m.byUrl.get(e.to)?.status }))
    .filter((x, i, a) => a.findIndex((y) => y.from === x.from && y.to === x.to) === i)
    .slice(0, 200);
  const genericAnchors = m.edges.filter((e) => e.zone === 'main' && GENERIC.test(e.anchor.trim())).slice(0, 100).map((e) => ({ from: e.from, to: e.to, anchor: e.anchor }));
  for (const g of genericAnchors.slice(0, 50)) ic.add('generic_anchor', LNK.generic_anchor, { url: g.from, detail: `„${g.anchor}” → ${g.to}` });

  // tematikus hasonlóság
  const vecs = new Map(indexable.slice(0, 250).map((r) => {
    const e = m.best(r.url)!;
    return [r.url, tfVector([e.title, e.headings.filter((h) => h.level <= 2).map((h) => h.text).join(' '), e.mainText.slice(0, 2500)].join(' '), lang)];
  }));
  const linked = new Set(m.edges.map((e) => `${e.from}→${e.to}`));
  const suggestions: LinkSuggestion[] = [];
  const targets = indexable.filter((r) => r !== m.home && (r.flags.includes('low_inlinks') || r.flags.includes('orphan') || r.flags.includes('deep') || r.inlinks < 3));
  for (const t of targets.slice(0, 60)) {
    const tv = vecs.get(t.url);
    if (!tv) continue;
    const te = m.best(t.url)!;
    const anchorBase = te.headings.find((h) => h.level === 1)?.text ?? te.title ?? '';
    const cands = [...vecs.entries()]
      .filter(([u]) => u !== t.url && !linked.has(`${u}→${t.url}`))
      .map(([u, v]) => ({ u, s: cosine(tv, v) }))
      .filter((x) => x.s >= 0.25)
      .sort((a, b) => b.s - a.s)
      .slice(0, 2);
    for (const c of cands) {
      const src = m.best(c.u)!;
      const shared = [...new Set(tokens(anchorBase, lang))].filter((w) => tfVector(src.mainText.slice(0, 3000), lang).has(w));
      suggestions.push({
        from: c.u,
        to: t.url,
        anchor: truncate(anchorBase.replace(/\s[|–-]\s.*$/, ''), 70),
        reason: `Tematikus hasonlóság ${Math.round(c.s * 100)}% (szógyakoriság-alapú)${shared.length ? `; közös kifejezések: ${shared.slice(0, 4).join(', ')}` : ''}. A céloldalra ${t.inlinks} belső link mutat${t.depth > 0 ? `, mélység: ${t.depth}` : t.depth === -1 ? ', linkekből nem elérhető' : ''}.`,
        score: Math.round(c.s * 100) / 100,
      });
    }
  }
  if (suggestions.length) ic.add('missing_links', LNK.missing_links, suggestions.slice(0, 40).map((s) => ({ url: s.to, detail: `Javasolt link: ${s.from} → ${s.to} („${s.anchor}”)` })));

  // klaszterek: első útvonalszegmens szerint (megfigyelhető struktúra)
  const clusters = new Map<string, string[]>();
  for (const r of indexable) {
    const seg = new URL(r.url).pathname.split('/').filter(Boolean)[0] ?? '(gyökér)';
    (clusters.get(seg) ?? clusters.set(seg, []).get(seg)!).push(r.url);
  }
  return {
    issues: ic,
    report: {
      hubs,
      orphans,
      lowInlinks,
      deep,
      broken,
      genericAnchors,
      suggestions: suggestions.sort((a, b) => b.score - a.score).slice(0, 60),
      clusters: [...clusters.entries()].filter(([, u]) => u.length >= 2).map(([label, urls]) => ({ label, urls })).sort((a, b) => b.urls.length - a.urls.length).slice(0, 20),
    },
  };
}
