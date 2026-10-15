// Export: teljes JSON, CSV-k (problémák, backlog, oldalak, kérdések, gapek, javaslatok) és nyomtatható HTML-riport.
// Minden lényeges megállapításnál az érintett URL és a bizonyíték visszakereshető.
import type { AuditRecord, BusinessContext, CompetitorRow, ExecutiveSummary, GeoScore, Issue, QueryGap, Recommendation, TopicRow, VisibilitySummary } from '../../shared/site.ts';
import { CATEGORY_LABEL, COMPETITOR_TYPE_LABEL, EVIDENCE_KIND_LABEL, QUERY_TYPE_LABEL } from '../../shared/site.ts';
import * as repo from './repo.ts';
import type { EntityReport } from './analyze/entities.ts';
import type { TechnicalReport } from './analyze/technical.ts';
import type { AiBotReport } from './analyze/aibots.ts';
import type { TrustReport } from './analyze/trust.ts';
import type { ContentReport } from './analyze/content.ts';

export function bundle(id: string) {
  const audit = repo.getAudit(id);
  const a = <T>(k: string) => repo.getArtifact<T>(id, k);
  return {
    audit,
    context: a<BusinessContext>('context'),
    summary: a<ExecutiveSummary>('summary'),
    score: a<GeoScore>('score'),
    technical: a<TechnicalReport>('technical'),
    aiBots: a<AiBotReport>('aibots'),
    structured: a('structured'),
    structuredRecords: repo.structuredFor(id),
    entities: a<EntityReport>('entities'),
    content: a<ContentReport>('content'),
    trust: a<TrustReport>('trust'),
    links: a('links'),
    queries: repo.listQueries(id),
    topics: repo.listTopics(id),
    competitors: repo.listCompetitors(id),
    gaps: a<QueryGap[]>('gaps') ?? [],
    opportunities: repo.listOpportunities(id),
    visibility: a<VisibilitySummary>('visibility'),
    aiResponses: repo.listResponses(id),
    issues: repo.listIssues(id),
    recommendations: repo.listRecommendations(id),
    backlog: repo.listTasks(id),
    pages: repo.listPages(id, { site: 'own', limit: 5000 }).rows,
    llmUsage: a('llmUsage'),
  };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows: Record<string, unknown>[], cols: [string, string][]): string {
  // BOM: az Excel így helyesen kezeli az ékezeteket
  return '﻿' + [cols.map(([, h]) => cell(h)).join(','), ...rows.map((r) => cols.map(([k]) => cell(r[k])).join(','))].join('\r\n');
}

export function csv(id: string, kind: string): string {
  switch (kind) {
    case 'issues':
      return toCsv(repo.listIssues(id).map((i) => ({ ...i, category: CATEGORY_LABEL[i.category], evidenceKind: EVIDENCE_KIND_LABEL[i.evidenceKind], evidence: i.evidence.slice(0, 20).map((e) => `${e.url ?? ''} ${e.detail}`), urlCount: i.urls.length })), [
        ['id', 'ID'], ['site', 'Webhely'], ['priority', 'Prioritás'], ['category', 'Kategória'], ['title', 'Probléma'], ['why', 'Miért fontos'], ['fix', 'Javasolt megoldás'], ['acceptance', 'Elfogadási kritérium'], ['impact', 'Hatás (1-5)'], ['effort', 'Ráfordítás'], ['confidence', 'Bizonyosság'], ['evidenceKind', 'Adat eredete'], ['owner', 'Felelős'], ['urlCount', 'Érintett URL-ek száma'], ['urls', 'Érintett URL-ek'], ['evidence', 'Bizonyítékok'], ['qa', 'QA-megjegyzés'],
      ]);
    case 'backlog':
      return toCsv(repo.listTasks(id) as unknown as Record<string, unknown>[], [
        ['id', 'ID'], ['title', 'Cím'], ['priority', 'Prioritás'], ['impact', 'Hatás'], ['effort', 'Ráfordítás'], ['owner', 'Felelős'], ['description', 'Leírás'], ['technical', 'Technikai részletek'], ['acceptance', 'Elfogadási kritériumok'], ['dependencies', 'Függőségek'], ['urls', 'Érintett URL-ek'], ['recommendationIds', 'Javaslatok'],
      ]);
    case 'pages':
      return toCsv(repo.listPages(id, { limit: 20000 }).rows as unknown as Record<string, unknown>[], [
        ['site', 'Webhely'], ['url', 'URL'], ['status', 'HTTP'], ['pageClass', 'Besorolás'], ['flags', 'Jelzők'], ['depth', 'Mélység'], ['inlinks', 'Bejövő linkek'], ['outlinks', 'Kimenő linkek'], ['wordCount', 'Szószám'], ['title', 'Title'], ['h1', 'H1'], ['metaDescription', 'Meta description'], ['canonical', 'Canonical'], ['inSitemap', 'Sitemapben'], ['rendered', 'Renderelve'], ['importance', 'Fontosság'], ['duplicateOf', 'Duplikátuma'], ['discoveredVia', 'Felfedezve'], ['ttfbMs', 'TTFB ms'],
      ]);
    case 'queries':
      return toCsv(repo.listQueries(id).map((q) => ({ ...q, type: QUERY_TYPE_LABEL[q.type], competitors: q.competitors.map((c) => `${c.domain}: ${c.coverage}${c.url ? ` (${c.url})` : ''}`), hypothesis: q.hypothesis ? 'igen' : 'nem' })), [
        ['id', 'ID'], ['text', 'Kérdés'], ['type', 'Típus'], ['branded', 'Márkázott'], ['topic', 'Téma'], ['weight', 'Súly'], ['origin', 'Eredet'], ['hypothesis', 'Hipotézis'], ['coverage', 'Lefedettség'], ['bestUrl', 'Válaszoló URL'], ['snippet', 'Részlet'], ['specificity', 'Konkrétság'], ['hasEvidence', 'Bizonyíték'], ['contradiction', 'Ellentmondás'], ['action', 'Teendő'], ['judgedBy', 'Értékelés módja'], ['competitors', 'Versenytársak'],
      ]);
    case 'gaps':
      return toCsv((repo.getArtifact<QueryGap[]>(id, 'gaps') ?? []) as unknown as Record<string, unknown>[], [
        ['query', 'Kérdés'], ['topic', 'Téma'], ['intent', 'Szándék'], ['competitor', 'Versenytárs'], ['competitorUrl', 'Versenytárs URL'], ['competitorTraits', 'Versenytárs válaszjellemzők'], ['ownUrl', 'Saját URL'], ['ownGap', 'Saját hiány'], ['suggestion', 'Javaslat'], ['impact', 'Hatás'], ['effort', 'Ráfordítás'], ['confidence', 'Bizonyosság'], ['priority', 'Prioritás'], ['basis', 'Alap'],
      ]);
    case 'recommendations':
      return toCsv(repo.listRecommendations(id) as unknown as Record<string, unknown>[], [
        ['id', 'ID'], ['priority', 'Prioritás'], ['type', 'Típus'], ['url', 'URL'], ['title', 'Cím'], ['original', 'Eredeti állapot'], ['proposed', 'Javasolt állapot'], ['rationale', 'Indoklás'], ['confidence', 'Bizonyosság'], ['validation', 'Validáció'], ['validationNote', 'Validációs megjegyzés'], ['issueId', 'Kapcsolódó probléma'],
      ]);
    default:
      throw Object.assign(new Error(`Ismeretlen export: ${kind}`), { statusCode: 404 });
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>');

/** Önálló, nyomtatható (PDF-be menthető) HTML-riport. */
export function htmlReport(id: string): string {
  const b = bundle(id);
  const au: AuditRecord = b.audit;
  const issues = b.issues.filter((i) => i.site === 'own');
  const comps: CompetitorRow[] = b.competitors;
  const topics: TopicRow[] = b.topics;
  const recs: Recommendation[] = b.recommendations;
  const issueRow = (i: Issue) => `<tr><td><span class="p ${i.priority}">${i.priority}</span></td><td><b>${esc(i.title)}</b><div class="muted">${esc(i.why)}</div><div><b>Megoldás:</b> ${esc(i.fix)}</div><details><summary>${i.urls.length} érintett URL · bizonyítékok</summary><ul>${i.evidence.slice(0, 25).map((e) => `<li>${e.url ? `<a href="${esc(e.url)}">${esc(e.url)}</a> – ` : ''}${esc(e.detail)}</li>`).join('')}</ul></details></td><td>${esc(CATEGORY_LABEL[i.category])}</td><td>${i.impact}/5 · ${i.effort}</td><td>${Math.round(i.confidence * 100)}%<div class="muted">${esc(EVIDENCE_KIND_LABEL[i.evidenceKind])}</div></td></tr>`;
  const s = b.score;
  const sum = b.summary;
  const ctx = b.context;
  const vis = b.visibility;
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GEO Audit – ${esc(au.domain)}</title>
<style>
:root{--ink:#1a1a1a;--muted:#6b6b6b;--line:#e0e0e0;--accent:#e63e17;--bg:#fff}
body{font-family:'Open Sans',Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);margin:0;padding:32px;max-width:1100px;margin:auto;font-size:13px;line-height:1.5}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;border-bottom:2px solid var(--accent);padding-bottom:4px;margin-top:36px}h3{font-size:14px;margin:18px 0 6px}
table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{font-size:11px;color:var(--muted);text-transform:uppercase}
.muted{color:var(--muted)}.p{display:inline-block;padding:1px 8px;border-radius:99px;font-weight:700;font-size:11px}.P0{background:#d03b3b;color:#fff}.P1{background:#ec835a}.P2{background:#fab219}.P3{background:#e0e0e0}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.kpi div{border:1px solid var(--line);border-radius:6px;padding:10px}.kpi b{font-size:22px;display:block}
.note{background:#fdece7;border:1px solid #f6c7b9;padding:8px 12px;border-radius:6px}pre{white-space:pre-wrap;background:#f6f6f6;padding:8px;border-radius:4px;font-size:11.5px}
@media print{body{padding:0}details{display:block}details>summary{list-style:none}a{color:inherit}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<p class="muted">GEO Audit riport · ${esc(au.id)} · ${esc(new Date(au.createdAt).toLocaleString('hu-HU'))} · módszer: ${esc(au.methodVersion)}${au.partial ? ' · <b>RÉSZLEGES EREDMÉNY</b>' : ''}</p>
<h1>${esc(au.domain)}</h1>
<p class="muted">Kezdő URL: ${esc(au.input.url)} · Állapot: ${esc(au.status)}</p>

<h2>Executive Summary</h2>
<p><b>${esc(sum?.headline ?? '—')}</b></p>
<div class="kpi">${(s?.components ?? []).map((c) => `<div><span class="muted">${esc(c.label)}</span><b>${c.score ?? '—'}${c.score !== null ? '<small>/100</small>' : ''}</b><span class="muted">${c.status === 'ok' ? `bizonyosság ${Math.round(c.confidence * 100)}%` : c.status === 'not_measured' ? 'nem mérhető' : 'elégtelen adat'}</span></div>`).join('')}</div>
<p class="note">${esc(s?.note ?? '')}</p>
<h3>Legfontosabb megállapítások</h3>${list(sum?.findings ?? [])}
<h3>Fő erősségek</h3>${list(sum?.strengths ?? [])}
<h3>Kritikus problémák</h3>${list(sum?.critical ?? [])}
<h3>Legjobb lehetőségek</h3>${list(sum?.opportunities ?? [])}
<h3>Mérési korlátok és adatforrások</h3>${list(sum?.limits ?? [])}
<table><tr><th>Adatforrás</th><th>Típus</th><th>Állapot</th><th>Megjegyzés</th></tr>${au.dataSources.map((d) => `<tr><td>${esc(d.label)}</td><td>${esc(EVIDENCE_KIND_LABEL[d.kind])}</td><td>${esc(d.status)}</td><td>${esc(d.note ?? '')}</td></tr>`).join('')}</table>

<h2>Felismert üzleti kontextus</h2>
${ctx ? `<table>${[
    ['Nyelv', ctx.language.value, ctx.language],
    ['Szervezet', ctx.organization.value, ctx.organization],
    ['Tevékenység', ctx.activity.value, ctx.activity],
    ['Kínálat', ctx.offerings.value.join(', '), ctx.offerings],
    ['Földrajz', ctx.geo.value.join(', '), ctx.geo],
    ['Témák', ctx.topics.value.join(', '), ctx.topics],
  ].map(([k, v, d]) => `<tr><td>${esc(k)}</td><td>${esc(v ?? '—')}</td><td class="muted">${esc((d as { source: string }).source)} · ${Math.round(((d as { confidence: number }).confidence) * 100)}%</td></tr>`).join('')}</table>${ctx.clarifications.length ? `<p class="note"><b>Pontosítás szükséges:</b> ${esc(ctx.clarifications.join(' '))}</p>` : ''}` : '<p class="muted">Nem áll rendelkezésre.</p>'}

<h2>Technical GEO</h2>
${b.technical ? `<p>Oldalbesorolás: ${Object.entries(b.technical.classCounts).filter(([, v]) => v).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</p><p>robots.txt: ${b.technical.robots.present ? 'van' : 'nincs'} (HTTP ${b.technical.robots.status ?? '—'})${b.technical.robots.crawlDelay ? `, Crawl-delay ${b.technical.robots.crawlDelay}s` : ''} · Sitemap-fájlok: ${b.technical.sitemapFiles.length} · Renderelés: ${esc(b.technical.renderer ?? b.technical.renderUnavailable ?? 'nem futott')}</p>` : ''}
${b.aiBots ? `<h3>AI-crawler hozzáférés (robots.txt)</h3><table><tr><th>Robot</th><th>Cél</th><th>Kezdőoldal</th><th>Következmény</th></tr>${b.aiBots.rows.map((r) => `<tr><td>${esc(r.name)} <span class="muted">(${esc(r.owner)})</span></td><td>${esc(r.purpose)}</td><td>${r.allowedHome === null ? '—' : r.allowedHome ? 'engedélyezett' : `<b>tiltott</b> ${esc(r.rule ?? '')}`}</td><td class="muted">${esc(r.consequence)}</td></tr>`).join('')}</table><p class="muted">${esc(b.aiBots.note)}</p>` : ''}
<table><tr><th>Prio</th><th>Probléma</th><th>Kategória</th><th>Hatás · ráfordítás</th><th>Bizonyosság</th></tr>${issues.filter((i) => ['crawl', 'indexing', 'ai_access', 'html', 'metadata', 'rendering', 'structured_data'].includes(i.category)).map(issueRow).join('')}</table>

<h2>Content GEO</h2>
${b.content ? `<p>Átlagok: ${Object.entries(b.content.averages).map(([k, v]) => `${esc(k)} ${v ?? '—'}`).join(' · ')}</p><p class="muted">${esc(b.content.note)}</p>` : ''}
<h3>Topic Coverage Matrix</h3><table><tr><th>Téma</th><th>Saját URL-ek</th><th>Lefedettség</th><th>Hiány</th><th>Versenytársak</th><th>Javaslat</th></tr>${topics.map((t) => `<tr><td>${esc(t.label)}</td><td>${t.ownUrls.slice(0, 3).map((u) => `<div>${esc(u)}</div>`).join('')}</td><td>${esc(t.coverage)}</td><td>${t.missingQueries.slice(0, 4).map((q) => `<div>${esc(q)}</div>`).join('')}</td><td>${t.competitorCoverage.map((c) => `<div>${esc(c.domain)}: ${esc(c.coverage)}</div>`).join('')}</td><td>${esc(t.recommendation)}</td></tr>`).join('')}</table>
<h3>Query Coverage (Answer Coverage Score: ${s?.components.find((c) => c.id === 'query_coverage')?.score ?? '—'})</h3>
<table><tr><th>Kérdés</th><th>Típus</th><th>Lefedettség</th><th>URL</th></tr>${b.queries.slice(0, 60).map((q) => `<tr><td>${esc(q.text)}${q.hypothesis ? ' <span class="muted">(hipotézis)</span>' : ''}</td><td>${esc(QUERY_TYPE_LABEL[q.type])}</td><td>${esc(q.coverage)}</td><td>${esc(q.bestUrl ?? '')}</td></tr>`).join('')}</table>
${b.trust ? `<h3>Bizalmi jelek (E-E-A-T)</h3><table>${b.trust.signals.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.present === null ? 'nem értékelhető' : x.present ? 'van' : '<b>hiányzik</b>'}</td><td class="muted">${x.evidence.slice(0, 2).map((e) => esc(`${e.url ?? ''} ${e.detail}`)).join('<br>')}${x.note ? `<br>${esc(x.note)}` : ''}</td></tr>`).join('')}</table><p class="muted">${esc(b.trust.note)}</p>` : ''}
<table><tr><th>Prio</th><th>Probléma</th><th>Kategória</th><th>Hatás · ráfordítás</th><th>Bizonyosság</th></tr>${issues.filter((i) => ['content', 'answerability', 'trust', 'freshness', 'linking'].includes(i.category)).map(issueRow).join('')}</table>

<h2>Entity &amp; Knowledge Graph</h2>
${b.entities ? `<table><tr><th>Entitás</th><th>Típus</th><th>Jelölve</th><th>Forrás URL-ek</th></tr>${b.entities.nodes.slice(0, 60).map((n) => `<tr><td>${esc(n.name)}</td><td>${esc(n.type)}</td><td>${n.inSchema ? 'igen' : 'nem'}</td><td>${n.urls.slice(0, 2).map(esc).join('<br>')}</td></tr>`).join('')}</table><h3>Kapcsolatok</h3><ul>${b.entities.edges.slice(0, 60).map((e) => `<li>${esc(b.entities!.nodes.find((n) => n.id === e.from)?.name ?? e.from)} → <i>${esc(e.type)}</i> → ${esc(b.entities!.nodes.find((n) => n.id === e.to)?.name ?? e.to)}${e.urls[0] ? ` <span class="muted">(${esc(e.urls[0])})</span>` : ''}</li>`).join('')}</ul><p class="muted">${esc(b.entities.note)}</p>` : ''}
<table><tr><th>Prio</th><th>Probléma</th><th>Kategória</th><th>Hatás · ráfordítás</th><th>Bizonyosság</th></tr>${issues.filter((i) => i.category === 'entity').map(issueRow).join('')}</table>

<h2>AI Visibility</h2>
${vis?.measured ? `<table><tr><th>Domain</th><th>Mentions</th><th>Citations</th><th>Mention share</th><th>Citation share</th></tr>${vis.metrics.map((m) => `<tr><td>${esc(m.domain)}${m.isOwn ? ' (saját)' : ''}</td><td>${m.mentions}</td><td>${m.citations}</td><td>${m.mentionShare ?? '—'}%</td><td>${m.citationShare ?? '—'}%</td></tr>`).join('')}</table><h3>Megfigyelt válaszok és forrás URL-ek</h3><table><tr><th>Kérdés</th><th>Platform</th><th>Idézett URL-ek</th></tr>${b.aiResponses.filter((r) => !r.error).slice(0, 80).map((r) => `<tr><td>${esc(r.query)}</td><td>${esc(r.platform)}</td><td>${r.citations.slice(0, 6).map((c) => esc(c.url)).join('<br>')}</td></tr>`).join('')}</table>` : `<p class="note"><b>Nem mérhető.</b> ${esc(vis?.state === 'not_configured' ? 'Nincs konfigurált AI/search API. A technikai és tartalmi audit ettől függetlenül teljes; tényleges AI-megjelenést nem állítunk.' : 'Nem volt sikeres AI/search válasz.')}</p>`}
<p class="muted">${esc(vis?.methodology ?? '')}</p>

<h2>Key Competitors</h2>
${comps.length ? `<table><tr><th>Domain</th><th>Típus</th><th>Oldalak</th><th>Kérdés-lefedettség</th><th>Citation potential</th><th>Erősségek</th><th>Hiányosságok</th></tr>${comps.map((c) => `<tr><td>${esc(c.domain)}${c.error ? `<div class="muted">hiba: ${esc(c.error)}</div>` : ''}</td><td>${c.types.map((t) => esc(COMPETITOR_TYPE_LABEL[t])).join(', ')}</td><td>${c.pages}</td><td>${c.metrics.answerCoverage ?? '—'}</td><td>${c.metrics.citationPotential ?? '—'}</td><td>${c.strengths.map(esc).join('<br>')}</td><td>${c.weaknesses.map(esc).join('<br>')}</td></tr>`).join('')}</table>
<h3>Competitor Query Gaps</h3><table><tr><th>Prio</th><th>Kérdés</th><th>Versenytárs</th><th>Alap</th><th>Saját hiány · javaslat</th></tr>${b.gaps.slice(0, 60).map((g) => `<tr><td><span class="p ${g.priority}">${g.priority}</span></td><td>${esc(g.query)}</td><td>${esc(g.competitor)}<div class="muted">${esc(g.competitorUrl ?? '')}</div></td><td>${esc(g.basis === 'observed_citation' ? 'megfigyelt AI-citation' : g.basis === 'serp' ? 'SERP' : 'tartalmi összehasonlítás (következtetés)')}</td><td>${esc(g.ownGap)}<div>${esc(g.suggestion)}</div></td></tr>`).join('')}</table>
<h3>Opportunities</h3>${b.opportunities.map((o) => `<p><span class="p ${o.priority}">${o.priority}</span> <b>${esc(o.title)}</b><br><span class="muted">Versenytárs:</span> ${esc(o.competitorSide.join(' '))}<br><span class="muted">Saját:</span> ${esc(o.ownSide.join(' '))}<br><span class="muted">Teendő:</span> ${esc(o.action)}<br><span class="muted">Várható hatás:</span> ${esc(o.expectedImpact)} <span class="muted">Bizonytalanság:</span> ${esc(o.uncertainty)}</p>`).join('')}` : '<p class="muted">Nem volt megadott key competitor.</p>'}

<h2>Recommendations</h2>
<h3>Quick wins (alacsony ráfordítás, P0–P2)</h3>${list(issues.filter((i) => i.effort === 'S' && i.priority !== 'P3').map((i) => `${i.priority} · ${i.title} (${i.urls.length} URL)`))}
<h3>Hosszabb távú fejlesztések</h3>${list(issues.filter((i) => i.effort === 'L' || (i.effort === 'M' && i.priority !== 'P3')).map((i) => `${i.priority} · ${i.title}`))}
<h3>Konkrét javaslatok</h3>
${recs.slice(0, 80).map((r) => `<div style="break-inside:avoid"><p><span class="p ${r.priority}">${r.priority}</span> <b>${esc(r.id)} · ${esc(r.title)}</b> ${r.url ? `<span class="muted">${esc(r.url)}</span>` : ''}<br><span class="muted">Validáció: ${esc(r.validation)}${r.validationNote ? ` – ${esc(r.validationNote)}` : ''} · bizonyosság ${Math.round(r.confidence * 100)}%</span></p>${r.original ? `<pre>Eredeti: ${esc(r.original)}</pre>` : ''}<pre>${esc(r.proposed)}</pre><p class="muted">${esc(r.rationale)}</p></div>`).join('')}

<h2>Developer Backlog</h2>
<table><tr><th>ID</th><th>Feladat</th><th>Prio</th><th>Hatás</th><th>Ráfordítás</th><th>Függ</th></tr>${b.backlog.map((t) => `<tr><td>${esc(t.id)}</td><td><b>${esc(t.title)}</b><div class="muted">${t.urls.length} URL · ${esc(t.acceptance[0] ?? '')}</div></td><td>${t.priority}</td><td>${t.impact}/5</td><td>${t.effort}</td><td>${esc(t.dependencies.join(', '))}</td></tr>`).join('')}</table>
<p class="muted">A riport a ${esc(au.methodVersion)} módszertannal, egyetlen időpontban készült pillanatfelvétel. A GEO Score belső értékelés; nem garantál keresési vagy AI-megjelenést, illetve idézést.</p>
</body></html>`;
}
