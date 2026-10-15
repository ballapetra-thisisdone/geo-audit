// Önálló HTML-riport (DONE-arculat, nyomtatható) a kör adataiból és Claude elemzéséből.
import {
  EVIDENCE_LABEL, STATUS_LABEL, TOPICS,
  type BacklogItem, type BacklogTemplate, type Coverage, type Evidence, type Finding, type Priority, type QuestionResult, type Round, type SourceLink, type Status, type Surface, type TopicId,
} from '../shared/types.ts';
import { BANDS, CATEGORY_TEXT, COVERAGE_TEXT, EFFORT, EVIDENCE_TEXT, OWNER_TEXT, PRIORITY, STATUS_TEXT, SURFACE_TEXT } from '../shared/glossary.ts';
import { ACCESS_REQUEST, MANUAL_TASKS } from '../shared/manualTasks.ts';
import { hasPlaceholder, SOURCES_FOLLOWUP, urlReadPrompt } from '../shared/prompts.ts';
import { effective } from '../server/scoring.ts';
import type { botMatrix } from '../server/checks/runners.ts';
import type { SampleGroup } from '../server/samples.ts';

/** Claude elemzése – lásd a skill references/analysis-schema.md fájlját. */
export interface Analysis {
  meta?: { analyst?: string; date?: string; docsChecked?: { url: string; date: string; note?: string }[] };
  executiveSummary?: string[];
  overrides?: { checkId: string; status: Status; evidence: Evidence; note?: string; backlog?: Partial<BacklogTemplate> | null }[];
  custom?: {
    id?: string;
    title: string;
    topic: TopicId;
    surfaces?: Surface[];
    weight?: number;
    status: Status;
    evidence: Evidence;
    summary: string;
    details?: string[];
    backlog?: BacklogTemplate;
    sources?: SourceLink[];
  }[];
  questions?: {
    id?: string;
    kind?: 'search' | 'conversational';
    text: string;
    coverage?: Coverage;
    fact?: string;
    missing?: string;
    sourceOwner?: string;
    results?: QuestionResult[];
    origin?: 'template' | 'manual' | 'llm';
  }[];
  jsonld?: { note?: string; code: string };
  notes?: string[];
  limitations?: string[];
}

type Matrix = ReturnType<typeof botMatrix>;

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
/** Egyszerű kiemelés: **félkövér** és `kód`. */
const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

const ICON: Record<Status, string> = { pass: '✓', warn: '!', fail: '✕', info: 'i', na: '–', unverifiable: '?' };
const badge = (s: Status) => `<span class="status ${s}" title="${esc(STATUS_TEXT[s])}"><span class="ic">${ICON[s]}</span>${STATUS_LABEL[s]}</span>`;
const evTag = (e: Evidence) => `<span class="tag ev-${e}" title="${esc(EVIDENCE_TEXT[e])}">[${EVIDENCE_LABEL[e]}]</span>`;
const surfaceLabel = (s: Surface[]) =>
  s.includes('bing') && s.includes('chatgpt') ? 'mindkettő' : s.includes('chatgpt') ? 'ChatGPT' : s.includes('bing') ? 'Bing/Copilot' : 'egyéb AI';
const surfTag = (s: Surface[]) => `<span class="tag outline">${surfaceLabel(s)}</span>`;
const prio = (p: Priority) => `<span class="prio prio-${p}">${p}</span><span class="explain">${esc(PRIORITY[p].short)}</span>`;

function band(score: number | null) {
  if (score === null) return { cls: 'none', label: 'Nincs adat', text: 'Még nincs elég adat az értékeléshez.' };
  const b = BANDS.find((x) => score >= Number(x.range.split('–')[0]))!;
  return { cls: b.cls, label: b.label, text: b.text };
}

function scoreTile(title: string, score: number | null, coverage: number) {
  const b = band(score);
  return `<div class="card tile"><p class="label">${esc(title)}</p>
  <div class="tile-row"><div class="big band-${b.cls}">${score ?? '—'}<small>/100</small></div>
  <div class="tile-txt"><b class="band-${b.cls}">${b.label}</b><div class="meter"><div class="bg-${b.cls}" style="width:${score ?? 0}%"></div></div>
  <span class="small">${esc(b.text)}</span><span class="small muted">Lefedettség: ${coverage}% – ennyit tudtunk ténylegesen ellenőrizni</span></div></div></div>`;
}

function radar(topics: { label: string; score: number | null }[]) {
  const W = 720, H = 360, cx = W / 2, cy = H / 2 + 6, R = 120;
  const n = topics.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  };
  const rings = [0.25, 0.5, 0.75, 1]
    .map((v) => `<polygon points="${topics.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" stroke="#e1e0d9"/>`)
    .join('');
  const spokes = topics.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" stroke="#e1e0d9"/>`).join('');
  const poly = topics.map((t, i) => pt(i, (t.score ?? 0) / 100).join(',')).join(' ');
  const dots = topics
    .map((t, i) => {
      const [x, y] = pt(i, (t.score ?? 0) / 100);
      return `<circle cx="${x}" cy="${y}" r="4.5" fill="#2a78d6" stroke="#fff" stroke-width="2"><title>${esc(t.label)}: ${t.score ?? 'nincs adat'}</title></circle>`;
    })
    .join('');
  const labels = topics
    .map((t, i) => {
      const [x, y] = pt(i, 1.2);
      const anchor = Math.abs(x - cx) < 10 ? 'middle' : x > cx ? 'start' : 'end';
      return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="11" fill="#52514e">${esc(t.label)}<tspan font-weight="700" fill="#1a1a1a"> ${t.score ?? 'n.a.'}</tspan></text>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Témakörök pontszáma" style="width:100%;max-width:${W}px">${rings}${spokes}
  <polygon points="${poly}" fill="#2a78d6" fill-opacity=".15" stroke="#2a78d6" stroke-width="2"/>${dots}${labels}</svg>`;
}

function sourcesHtml(s?: SourceLink[]) {
  if (!s?.length) return '';
  return `<div class="small sources">Források: ${s
    .map((x) => `<a href="${esc(x.url)}">${esc(x.title)}${x.official === false ? ' (másodlagos)' : ''}${x.checked ? ` · ellenőrizve: ${esc(x.checked)}` : ''}</a>`)
    .join(' · ')}</div>`;
}

function findingHtml(title: string, f: Finding | undefined, extra: { surfaces: Surface[]; description?: string; howTo?: string; sources?: SourceLink[]; tag?: string }) {
  const st = effective(f);
  const ev: Evidence = f?.override?.evidence ?? f?.evidence ?? 'unverifiable';
  const open = st === 'fail' || st === 'warn' ? ' open' : '';
  const ov = f?.override
    ? `<div class="override"><b>Szakértői értékelés:</b> ${STATUS_LABEL[f.override.status]} · ${EVIDENCE_LABEL[f.override.evidence]}${f.override.note ? `<br>${md(f.override.note)}` : ''}${
        f.status !== f.override.status ? `<div class="muted small">Gépi eredmény: ${STATUS_LABEL[f.status]} – ${esc(f.summary)}</div>` : ''
      }</div>`
    : '';
  return `<details class="finding"${open}><summary>${badge(st)}<span class="ft"><b>${esc(title)}</b> ${extra.tag ?? ''}<span class="s">${esc(
    f?.override?.note || f?.summary || 'Nincs eredmény.',
  )}</span></span><span class="fm">${evTag(ev)} ${surfTag(extra.surfaces)}</span></summary>
  <div class="fbody">${extra.description ? `<p class="small muted">${esc(extra.description)}</p>` : ''}${
    extra.howTo && st === 'unverifiable' ? `<p class="small"><b>Hogyan ellenőrizd:</b> ${esc(extra.howTo)}</p>` : ''
  }${ov}${f?.details?.length ? `<ul class="small">${f.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}${(f?.snippets ?? [])
    .map((s) => `<details class="snip"><summary class="small">${esc(s.label)}</summary><pre>${esc(s.code)}</pre></details>`)
    .join('')}${sourcesHtml(extra.sources)}</div></details>`;
}

function legend() {
  const row = (dt: string, dd: string) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
  return `<details class="card legend" open><summary><span class="label">Jelmagyarázat</span> <b>Hogyan olvasd az auditot?</b></summary><div class="lgrid">
  <div><h3>Pontszám (0–100)</h3><dl>${BANDS.map((b) => row(`<b class="band-${b.cls}">${b.label}</b> <span class="muted">${b.range}</span>`, esc(b.text))).join('')}${row(
    '<b>Lefedettség</b>',
    esc(COVERAGE_TEXT),
  )}${row('', '<span class="muted">A pontszám a felkészültséget méri, nem garantálja a megjelenést.</span>')}</dl></div>
  <div><h3>Az ellenőrzések eredménye</h3><dl>${(['pass', 'warn', 'fail', 'info', 'unverifiable', 'na'] as Status[]).map((s) => row(badge(s), esc(STATUS_TEXT[s]))).join('')}</dl></div>
  <div><h3>Mennyire biztos a megállapítás?</h3><dl>${(['observed', 'likely', 'hypothesis', 'unverifiable'] as Evidence[]).map((e) => row(evTag(e), esc(EVIDENCE_TEXT[e]))).join('')}</dl></div>
  <div><h3>Prioritás – mikor érdemes elvégezni?</h3><dl>${(Object.keys(PRIORITY) as Priority[])
    .map((p) => row(`<span class="prio prio-${p}">${p}</span>`, `<b>${esc(PRIORITY[p].short)}.</b> ${esc(PRIORITY[p].text)}`))
    .join('')}</dl></div>
  <div><h3>Ráfordítás – mekkora munka?</h3><dl>${(['S', 'M', 'L'] as const).map((e) => row(`<span class="effort">${e}</span>`, `<b>${esc(EFFORT[e].short)}.</b> ${esc(EFFORT[e].text)}`)).join('')}${row(
    '',
    '<span class="muted">Tájékoztató becslés; a pontos ráfordítást a fejlesztő adja meg.</span>',
  )}</dl></div>
  <div><h3>Felelős és érintett felület</h3><dl>${Object.entries(OWNER_TEXT).map(([k, v]) => row(`<b>${k}</b>`, esc(v))).join('')}${Object.entries(SURFACE_TEXT)
    .map(([k, v]) => row(`<span class="tag outline">${k}</span>`, esc(v)))
    .join('')}</dl></div>
  <div><h3>Kategória – milyen jellegű a feladat?</h3><dl>${Object.entries(CATEGORY_TEXT).map(([k, v]) => row(`<b>${k}</b>`, esc(v))).join('')}</dl></div>
  </div></details>`;
}

const EFFORT_DAYS = { S: 1, M: 3, L: 8 } as const;

function packages(items: BacklogItem[]) {
  const pk = [
    { id: 'tech', name: 'Technikai alapozás', goal: 'A robotok akadálytalanul elérik, és helyesen indexelik az oldalt.', gpt: false, items: [] as BacklogItem[] },
    { id: 'chatgpt', name: 'ChatGPT-láthatósági csomag', goal: 'Kifejezetten a ChatGPT search és a ChatGPT-be beillesztett URL-ek olvashatóságát célozza.', gpt: true, items: [] as BacklogItem[] },
    { id: 'bing', name: 'Bing- és Copilot-csomag', goal: 'Gyorsabb Bing-indexelés és teljes értékű Copilot-felhasználás.', gpt: false, items: [] as BacklogItem[] },
    { id: 'schema', name: 'Entitásmodell és strukturált adat', goal: 'Gépileg egyértelmű, ki az üzemeltető és mi a fő entitás. Nem garantál rich resultot.', gpt: false, items: [] as BacklogItem[] },
    { id: 'content', name: 'Idézhető tartalom', goal: 'Tényszerű, dátummal ellátott válaszok a tipikus kérdésekre. Az adatokat az ügyfél adja.', gpt: false, items: [] as BacklogItem[] },
  ];
  const by = (id: string) => pk.find((p) => p.id === id)!;
  for (const b of items) {
    const onlyGpt = b.surfaces.length === 1 && b.surfaces[0] === 'chatgpt';
    const onlyBing = b.surfaces.length === 1 && b.surfaces[0] === 'bing';
    if (onlyGpt || b.checkId === 'bots.chatgpt-user') by('chatgpt').items.push(b);
    else if (onlyBing) by('bing').items.push(b);
    else if (b.category === 'Strukturált adat') by('schema').items.push(b);
    else if (b.category === 'Tartalom/IA' || b.owner === 'ügyfél') by('content').items.push(b);
    else by('tech').items.push(b);
  }
  return pk.filter((p) => p.items.length);
}

const COV: Record<Coverage, { l: string; c: string }> = {
  yes: { l: 'Igen', c: '#0ca30c' },
  partial: { l: 'Részben', c: '#fab219' },
  no: { l: 'Nem', c: '#d03b3b' },
  unknown: { l: 'Nem értékelt', c: '#e0e0e0' },
};

export function renderReport(p: { round: Round; analysis: Analysis; backlog: BacklogItem[]; samples: SampleGroup[]; matrix: Matrix; logo?: string }) {
  const { round, analysis: an, backlog, samples, matrix } = p;
  const s = round.scores!;
  const a = round.artifacts!;
  const inp = round.input;
  const checks = Object.fromEntries(round.checks.map((c) => [c.id, c]));
  const active = round.checks.filter((c) => c.enabled && (c.module === 'core' || inp.modules.includes(c.module)));
  const date = new Date(round.finishedAt ?? round.createdAt).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });

  // ---- A. Vezetői összefoglaló ----
  const blockers = active.filter((c) => effective(round.findings[c.id]) === 'fail' && ['crawl', 'bots'].includes(c.topic) && c.weight >= 4);
  const strengths = active.filter((c) => effective(round.findings[c.id]) === 'pass' && c.weight >= 4).slice(0, 4);
  const unverifiable = active.filter((c) => effective(round.findings[c.id]) === 'unverifiable');
  const bB = band(s.surfaces.bing.score);
  const gB = band(s.surfaces.chatgpt.score);
  const autoSummary = [
    `<b>Bing/Copilot:</b> ${s.surfaces.bing.score ?? '—'}/100 – <span class="band-${bB.cls}">${bB.label.toLowerCase()}</span> (lefedettség ${s.surfaces.bing.coverage}%).`,
    `<b>ChatGPT:</b> ${s.surfaces.chatgpt.score ?? '—'}/100 – <span class="band-${gB.cls}">${gB.label.toLowerCase()}</span> (lefedettség ${s.surfaces.chatgpt.coverage}%).`,
    blockers.length ? `<b>Hozzáférési akadály:</b> ${blockers.map((c) => esc(c.title)).join('; ')}.` : 'Nincs kritikus feltérképezési vagy robot-hozzáférési akadály.',
    strengths.length ? `<b>Jól működik:</b> ${strengths.map((c) => esc(c.title.toLowerCase())).join(', ')}.` : '',
    `<b>A 3 legnagyobb lehetőség:</b> ${backlog.length ? `<ol>${backlog.slice(0, 3).map((b) => `<li>${esc(b.title)} <span class="muted small">(${b.priority} prioritás; ${EFFORT[b.effort].short})</span></li>`).join('')}</ol>` : 'nincs nyitott tétel.'}`,
    unverifiable.length ? `<span class="muted">${unverifiable.length} tétel nem ellenőrizhető vagy kézi rögzítésre vár – lásd a Kézi teendők fejezetet.</span>` : '',
  ].filter(Boolean);
  const summaryLines = an.executiveSummary?.length ? an.executiveSummary.map(md) : autoSummary;

  // ---- Kulcsadat-mátrix ----
  type KeyRow = { label: string; value: string; raw: boolean | null; rendered: boolean | null; jsonld: boolean | null; alt: boolean | null; chatgptUser: boolean | null };
  const keyRows = (round.findings['html.keydata']?.data as KeyRow[] | undefined) ?? [];
  const cell = (v: boolean | null) => (v === null ? '<td class="c na">—</td>' : `<td class="c ${v ? 'pass' : 'fail'}">${v ? '✓ van' : '✕ nincs'}</td>`);

  // ---- Bot-mátrix ----
  const purpose: Record<string, string> = { browser: 'viszonyítás', crawler: 'keresőrobot', search: 'keresés / válasz', training: 'modelltanítás', user: 'felhasználói lekérés', ads: 'hirdetés' };
  const fetched = matrix.filter((m) => m.fetched);
  const robotsOnly = matrix.filter((m) => !m.fetched);

  // ---- B. Részletes audit ----
  const detailed = TOPICS.map((t) => {
    const list = active.filter((c) => c.topic === t.id);
    const custom = round.custom.filter((c) => c.topic === t.id);
    const general = list.filter((c) => !(c.surfaces.length === 1 && c.surfaces[0] === 'chatgpt'));
    const gpt = list.filter((c) => c.surfaces.length === 1 && c.surfaces[0] === 'chatgpt');
    const ts = s.topics.find((x) => x.topic === t.id)!;
    const f = (c: (typeof list)[number]) =>
      findingHtml(c.title, round.findings[c.id], {
        surfaces: c.surfaces,
        description: c.description,
        howTo: c.howTo,
        sources: c.sources,
        tag: c.experimental ? '<span class="tag orange">kísérleti</span>' : c.runner === 'manual' ? '<span class="tag outline">kézi</span>' : '',
      });
    return `<section class="card flat topic"><div class="topic-h"><div><p class="label">${t.n}. témakör</p><h3>${t.title}</h3></div><span class="small muted">${ts.score ?? '—'}/100 · lefedettség ${ts.coverage}%</span></div>
    ${general.map(f).join('')}
    ${custom.map((c) => findingHtml(c.title, c, { surfaces: c.surfaces, sources: c.sources, tag: '<span class="tag outline">szakértői</span>' })).join('')}
    ${gpt.length ? `<div class="sub-h">ChatGPT-specifikus megállapítások</div>${gpt.map(f).join('')}` : ''}</section>`;
  }).join('');

  // ---- Kérdések ----
  const qs = round.questions;
  const covCounts = (['yes', 'partial', 'no', 'unknown'] as Coverage[]).map((c) => ({ c, n: qs.filter((q) => q.coverage === c).length }));
  const resCell = (q: (typeof qs)[number], surf: 'chatgpt' | 'copilot') => {
    const r = q.results.filter((x) => x.surface === surf);
    if (!r.length) return '<span class="muted">—</span>';
    return r
      .map((x) => `${x.appears === 'yes' ? '✓ megjelent' : x.appears === 'no' ? '✕ nem jelent meg' : '? nem egyértelmű'}${x.accurate === 'no' ? ' · <b style="color:#9d2222">pontatlan</b>' : ''} <span class="muted">(${esc(x.date)})</span>${x.quotedFact ? `<br><span class="small">„${esc(x.quotedFact)}”</span>` : ''}`)
      .join('<br>');
  };

  // ---- C. Backlog ----
  const prios: Priority[] = ['kritikus', 'magas', 'közepes', 'alacsony'];
  const matrixRows = prios
    .map((pr) => {
      const cells = (['S', 'M', 'L'] as const)
        .map((e) => {
          const items = backlog.filter((b) => b.priority === pr && b.effort === e);
          const quick = (pr === 'kritikus' || pr === 'magas') && e === 'S' && items.length;
          return `<td class="num" style="${items.length ? `background:${quick ? '#e8f6e8' : '#f6f6f6'}` : ''}">${items.length ? `<b>${items.length}</b> <span class="small muted">#${items.map((b) => b.n).join(', #')}</span>` : '<span class="muted">·</span>'}</td>`;
        })
        .join('');
      return `<tr><td>${prio(pr)}</td>${cells}</tr>`;
    })
    .join('');

  // ---- Kézi teendők ----
  const activeId = (id: string) => active.some((c) => c.id === id);
  const tasks = MANUAL_TASKS.filter((t) => t.checks.some(activeId));
  const covered = new Set(tasks.flatMap((t) => t.checks));
  const otherManual = active.filter((c) => c.runner === 'manual' && !covered.has(c.id));
  const readyQs = qs.filter((q) => q.text.trim() && !hasPlaceholder(q.text));

  const docs = an.meta?.docsChecked ?? [];
  const toc = [
    ['a', 'A. Vezetői összefoglaló'],
    ['scores', 'Pontszámok'],
    ['keydata', 'Kulcsadat-mátrix'],
    ['bots', 'Bot-mátrix'],
    ['b', 'B. Részletes audit'],
    ['questions', 'Kérdések és AI-teszt'],
    ['c', 'C. Fejlesztési backlog'],
    ['d', 'D. Kódminták'],
    ['e', 'E. Mérési terv'],
    ['f', 'F. Fejlesztési csomagok'],
    ['manual', 'Kézi teendők'],
    ['limits', 'Korlátok és források'],
  ];

  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GEO audit – ${esc(inp.name || new URL(inp.url).hostname)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<header class="top"><div class="logo">${p.logo ?? '<b style="font-size:20px">DONE<span style="color:#e63e17">.</span></b>'}</div><div class="small muted">GEO / AI-láthatósági audit · ${esc(date)}</div></header>
<main>
<div class="cover"><div class="stripe"></div><div><p class="label">GEO audit – Bing/Copilot és ChatGPT</p><h1>${esc(inp.name || inp.url)}</h1>
<p class="muted"><a href="${esc(inp.url)}">${esc(inp.url)}</a> · ${esc(inp.org || '—')} · ${esc(inp.pageType || '—')} · ${esc(date)}</p></div></div>

<nav class="toc card no-print"><b>Tartalom:</b> ${toc.map(([id, l]) => `<a href="#${id}">${l}</a>`).join(' · ')}</nav>

${legend()}

<section id="a" class="card"><p class="label">A. Vezetői összefoglaló</p><ul class="summary">${summaryLines.map((l) => `<li>${l}</li>`).join('')}</ul></section>

<section id="scores"><div class="grid3">${scoreTile('Bing / Copilot', s.surfaces.bing.score, s.surfaces.bing.coverage)}${scoreTile('ChatGPT', s.surfaces.chatgpt.score, s.surfaces.chatgpt.coverage)}${scoreTile(
    'Összesített',
    s.overall,
    Math.round((s.surfaces.bing.coverage + s.surfaces.chatgpt.coverage) / 2),
  )}</div>
<div class="grid2"><div class="card"><p class="label">Témakörök</p>${radar(TOPICS.map((t) => ({ label: `${t.n}. ${t.title}`, score: s.topics.find((x) => x.topic === t.id)?.score ?? null })))}</div>
<div class="card flat"><table class="t"><thead><tr><th>Témakör</th><th style="width:40%">Pontszám</th><th class="num">Lefedettség</th></tr></thead><tbody>${TOPICS.map((t) => {
    const ts = s.topics.find((x) => x.topic === t.id)!;
    const b = band(ts.score);
    return `<tr><td>${t.n}. ${t.title}</td><td><b class="band-${b.cls}">${ts.score ?? '—'}</b> <span class="meter inline"><span class="bg-${b.cls}" style="width:${ts.score ?? 0}%"></span></span></td><td class="num">${ts.coverage}%</td></tr>`;
  }).join('')}</tbody></table>
<div class="pad small muted">Ellenőrzések: ${(['pass', 'warn', 'fail', 'info', 'unverifiable', 'na'] as Status[]).map((k) => `${STATUS_LABEL[k]} ${s.counts[k]}`).join(' · ')}</div></div></div></section>

<section id="keydata" class="card flat"><div class="pad"><p class="label">Kulcsadat-mátrix</p><p class="small muted">Hol olvasható ki gépileg az egyes kulcsadat?</p></div>
${keyRows.length ? `<div class="tw"><table class="t heat"><thead><tr><th>Kulcsadat</th><th>Mintaérték</th><th>Nyers HTML (JS nélkül)</th><th>Renderelt</th><th>JSON-LD</th><th>Csak alt/kép</th><th>ChatGPT-User</th></tr></thead><tbody>${keyRows
    .map(
      (k) =>
        `<tr><td><b>${esc(k.label)}</b></td><td class="small">${k.value ? esc(k.value) : '<span class="muted">nincs megadva</span>'}</td>${cell(k.raw)}${cell(k.rendered)}${cell(k.jsonld)}${
          k.alt === null ? '<td class="c na">—</td>' : `<td class="c ${k.alt && !k.raw ? 'warn' : 'na'}">${k.alt ? 'alt-ban is' : '—'}</td>`
        }${cell(k.chatgptUser)}</tr>`,
    )
    .join('')}</tbody></table></div>` : '<p class="pad small muted">Nem volt kulcsadat megadva a bemenetben.</p>'}</section>

<section id="bots" class="card flat"><div class="pad"><p class="label">Bot-mátrix</p><p class="small muted">Ugyanaz az URL a robotok user-agentjével, JS nélkül. A UA-hamisítás nem helyettesíti a valódi robot-IP-ről érkező kérést – a WAF IP alapján is dönthet.</p></div>
<div class="tw"><table class="t heat"><thead><tr><th>Robot</th><th>Cél</th><th>HTTP</th><th>Blokk / challenge</th><th>robots.txt</th><th>Szöveg a böngészőhöz képest</th><th>Title egyezik</th><th>Kulcsadat</th><th class="num">TTFB</th></tr></thead><tbody>${fetched
    .map(
      (m) =>
        `<tr><td><b>${esc(m.name)}</b><div class="small muted">${esc(m.owner)}</div></td><td class="small">${purpose[m.purpose]}</td>${
          m.error ? '<td class="c fail">hiba</td>' : `<td class="c ${m.status === 200 ? 'pass' : 'fail'}">${m.status}</td>`
        }<td class="c ${m.challenge ? 'fail' : 'pass'}">${esc(m.challenge ?? 'nincs')}</td>${
          m.robotsAllowed === null ? '<td class="c na">—</td>' : `<td class="c ${m.robotsAllowed ? 'pass' : m.purpose === 'training' ? 'info' : 'fail'}">${m.robotsAllowed ? 'engedélyezett' : 'tiltva'}</td>`
        }<td class="c ${m.textPct === null ? 'na' : m.textPct < 70 ? 'warn' : 'pass'}">${m.textPct === null ? '—' : m.textPct + '%'}</td><td class="c ${m.titleMatch === null ? 'na' : m.titleMatch ? 'pass' : 'warn'}">${
          m.titleMatch === null ? '—' : m.titleMatch ? 'igen' : 'nem'
        }</td><td class="c ${m.keyFound === null ? 'na' : m.keyFound === m.keyTotal ? 'pass' : m.keyFound === 0 ? 'fail' : 'warn'}">${m.keyFound === null ? '—' : `${m.keyFound}/${m.keyTotal}`}</td><td class="num">${m.ttfbMs ?? '—'} ms</td></tr>`,
    )
    .join('')}</tbody></table></div>
${robotsOnly.length ? `<div class="pad"><p class="small"><b>További AI-robotok (csak robots.txt)</b> – engedélyezésük üzleti döntés, nem automatikus javaslat.</p></div><div class="tw"><table class="t heat"><thead><tr><th>Robot</th><th>Üzemeltető</th><th>Cél</th><th>Döntés</th><th>Szabály</th></tr></thead><tbody>${robotsOnly
    .map(
      (m) =>
        `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.owner)}</td><td class="small">${purpose[m.purpose]}</td>${
          m.robotsAllowed === null ? '<td class="c na">n. a.</td>' : `<td class="c ${m.robotsAllowed ? 'pass' : m.purpose === 'training' ? 'info' : 'warn'}">${m.robotsAllowed ? 'engedélyezett' : 'tiltva'}</td>`
        }<td class="small"><code>${esc(m.robotsRule ?? (m.robotsSpecific ? 'saját csoport' : "'*' csoport / nincs szabály"))}</code></td></tr>`,
    )
    .join('')}</tbody></table></div>` : ''}
<p class="pad small muted">Renderelés: ${a.render?.ok ? esc(a.render.engine) : `sikertelen (${esc(a.render?.error)})`}.</p></section>

<section id="b"><p class="label sec">B. Részletes audit</p>${detailed}</section>

${an.notes?.length ? `<section class="card"><p class="label">Szakértői megjegyzések</p><ul>${an.notes.map((n) => `<li>${md(n)}</li>`).join('')}</ul></section>` : ''}

<section id="questions" class="card flat"><div class="pad"><p class="label">Kérdések és AI-teszt</p>
<p class="small muted">Valószínű keresési és ChatGPT-stílusú kérdések a célközönség szemszögéből: ad-e rájuk az oldal egyértelmű, idézhető tényt? Az AI-teszt kézi pillanatfelvétel – ha az oldal nem jelenik meg, abból nem következik, hogy nincs indexelve.</p>
<div class="bar">${covCounts.filter((x) => x.n).map((x) => `<div style="flex:${x.n};background:${COV[x.c].c}" title="${COV[x.c].l}: ${x.n}"></div>`).join('')}</div>
<div class="legend-row small">${covCounts.map((x) => `<span><i style="background:${COV[x.c].c}"></i>${COV[x.c].l} ${x.n}</span>`).join('')}</div></div>
<div class="tw"><table class="t"><thead><tr><th>#</th><th>Kérdés</th><th>Megválaszolja?</th><th>Tény az oldalon / hiány</th><th>ChatGPT</th><th>Copilot</th></tr></thead><tbody>${qs
    .map(
      (q, i) =>
        `<tr><td class="muted">${i + 1}</td><td>${esc(q.text)}<div class="small muted">${q.kind === 'search' ? 'keresési' : 'társalgási'}</div></td><td><span class="dot" style="background:${COV[q.coverage].c}"></span> ${COV[q.coverage].l}</td><td class="small">${
          q.fact ? `„${esc(q.fact)}”` : ''
        }${q.missing ? `<div style="color:#9d2222">Hiányzik: ${esc(q.missing)}${q.sourceOwner ? ` (forrás: ${esc(q.sourceOwner)})` : ''}</div>` : ''}</td><td class="small">${resCell(q, 'chatgpt')}</td><td class="small">${resCell(q, 'copilot')}</td></tr>`,
    )
    .join('')}</tbody></table></div></section>

<section id="c" class="card flat"><div class="pad"><p class="label">C. Fejlesztési backlog</p><p class="small muted">Minden tétel önállóan továbbadható. A „Jelenlegi állapot” az audit megállapításából jön. A backlog CSV-ben is elérhető (backlog.csv).</p></div>
${backlog.length ? `<div class="pad"><table class="t" style="max-width:640px"><thead><tr><th></th>${(['S', 'M', 'L'] as const).map((e) => `<th class="num">${e} – ${EFFORT[e].short}</th>`).join('')}</tr></thead><tbody>${matrixRows}</tbody></table>
<p class="small muted">Zöld háttér: gyors nyerő – fontos feladat, kevés munkával. Becsült összes ráfordítás: ~${backlog.reduce((x, b) => x + EFFORT_DAYS[b.effort], 0)} embernap (durva becslés).</p></div>
<div class="tw"><table class="t brand"><thead><tr><th>#</th><th>Cím</th><th>Kategória</th><th>Felület</th><th>Jelenlegi állapot</th><th>Javasolt változtatás</th><th>Megvalósítás</th><th>Várható előny</th><th>Prioritás</th><th>Ráfordítás</th><th>Ellenőrzés</th></tr></thead><tbody>${backlog
    .map(
      (b) =>
        `<tr><td>${b.n}</td><td><b>${esc(b.title)}</b><span class="explain">${esc(b.owner)}</span></td><td class="small">${esc(b.category)}<span class="explain">${esc(CATEGORY_TEXT[b.category])}</span></td><td>${surfTag(
          b.surfaces,
        )}</td><td class="small">${badge(b.status)}<div>${esc(b.current)}</div></td><td class="small">${esc(b.change)}</td><td class="small">${esc(b.implementation)}</td><td class="small">${esc(b.benefit)}</td><td>${prio(
          b.priority,
        )}</td><td class="small"><span class="effort">${b.effort}</span><span class="explain">${EFFORT[b.effort].short}</span><span class="explain">${esc(b.effortReason)}</span></td><td class="small"><code>${esc(b.verification)}</code></td></tr>`,
    )
    .join('')}</tbody></table></div>` : '<p class="pad">Nincs nyitott backlog-tétel. Ha valami jól működik, az is eredmény.</p>'}</section>

<section id="d" class="card"><p class="label">D. Kódminták</p><p class="small muted">Szemléltető jellegűek. A <code>&lt;&lt;…&gt;&gt;</code> helyőrzőket valós, az oldalon igazolható adatra kell cserélni.</p>
${an.jsonld ? `<h3>Javasolt JSON-LD erre az oldalra</h3>${an.jsonld.note ? `<p class="small">${md(an.jsonld.note)}</p>` : ''}<pre>${esc(an.jsonld.code)}</pre>` : ''}
${samples.map((g) => `<h3>${esc(g.title)}</h3><p class="small muted">${esc(g.note)}</p>${g.snippets.map((x) => `<p class="small"><b>${esc(x.label)}</b></p><pre>${esc(x.code)}</pre>`).join('')}`).join('')}</section>

<section id="e" class="card"><p class="label">E. Mérési terv</p>
<h3>1. Bing Webmaster Tools</h3><ul class="small"><li>Indexelés: a vizsgált URL állapota (URL Inspection), indexelt oldalak, sitemap-feldolgozás.</li><li>Crawl-hibák, robots.txt-tesztelő, IndexNow-beküldések.</li><li>Megjelenések és kattintások a fő kérdésekre.</li><li><b>AI Performance:</b> Copilot-idézések és grounding query-k – havonta mentve.</li></ul>
<h3>2. Szervernapló</h3><p class="small">A bingbot, OAI-SearchBot, GPTBot és ChatGPT-User kéréseit külön kell szűrni, és IP alapján ellenőrizni (OpenAI: searchbot.json, gptbot.json, chatgpt-user.json; bingbot: fordított DNS, *.search.msn.com).</p>
<h3>3. Analitika</h3><ul class="small"><li>ChatGPT-forgalom: <code>utm_source=chatgpt.com</code> és a chatgpt.com referrer – külön csatornacsoportba.</li><li>Copilot-forgalom külön (copilot.microsoft.com, bing.com referrer).</li><li>Konverziók forrás szerint.</li><li><b>Alulmérés okai:</b> hiányzó referrer, cookie-hozzájárulás elutasítása, kattintás nélküli (a felületen megválaszolt) kérdések.</li></ul>
<h3>4. Negyedéves kézi kérdésteszt</h3><p class="small">Ugyanazzal a kérdéslistával ChatGPT-ben és Copilotban, az eredmények rögzítésével. A trend számít, nem az egyes futások.</p></section>

<section id="f" class="card"><p class="label">F. Üzletileg bemutatható fejlesztési csomagok</p><p class="small muted">Garanciaígéret nélkül: a csomagok a láthatóság feltételeit javítják, a megjelenésről a keresők és az AI-felületek döntenek.</p>
<div class="grid2">${packages(backlog)
    .map(
      (pk) =>
        `<div class="card pkg"><h3>${pk.name} ${pk.gpt ? '<span class="tag orange">ChatGPT-fókusz</span>' : ''}</h3><p class="small muted">${pk.goal}</p><ul class="small">${pk.items
          .map((b) => `<li>#${b.n} ${esc(b.title)} <span class="muted">(${b.priority} prioritás; ${EFFORT[b.effort].short})</span></li>`)
          .join('')}</ul><p class="small"><b>~${pk.items.reduce((x, b) => x + EFFORT_DAYS[b.effort], 0)} embernap</b> · felelős: ${[...new Set(pk.items.map((b) => b.owner))].join(', ')}</p></div>`,
    )
    .join('')}<div class="card pkg"><h3>Mérés és monitorozás</h3><p class="small muted">Bing Webmaster Tools AI Performance, szervernapló botonként, ChatGPT/Copilot-forgalom az analitikában, negyedéves kérdésteszt.</p><p class="small"><b>~2–3 embernap</b> beállítás + negyedévente ~0,5 nap</p></div></div></section>

<section id="manual" class="card"><p class="label">Kézi teendők</p><p>Ezeket sem a gépi ellenőrzés, sem AI nem tudja elvégezni: a ChatGPT/Copilot felületén kell kipróbálni, vagy az ügyfél hozzáférése kell hozzá. Amíg nincsenek rögzítve, „Nem ellenőrizhető” státuszúak, és nem számítanak bele a pontszámba.</p>
${tasks
    .map((t) => {
      const done = t.questionsTab
        ? qs.some((q) => q.results.some((r) => r.surface === (t.id === 'chatgpt-test' ? 'chatgpt' : 'copilot')))
        : t.checks.every((id) => !!round.findings[id]?.override);
      const prompts = t.questionsTab
        ? `<details class="snip" open><summary>Beilleszthető promptok</summary>
<p class="small"><b>1. Kérdések</b> – kérdésenként új beszélgetésben, változtatás nélkül${t.id === 'chatgpt-test' ? ', bekapcsolt kereséssel' : ''}. A kérdésbe ne írd bele a weboldal nevét, ha a valódi érdeklődő sem írná.</p>
<pre>${esc(readyQs.map((q, i) => `${i + 1}. ${q.text}`).join('\n') || 'Nincs beilleszthető kérdés.')}</pre>
${qs.length > readyQs.length ? `<p class="small" style="color:#9d2222">${qs.length - readyQs.length} kérdésben kitöltetlen [helyőrző] van – valós adattal kell kitölteni, addig nem használható.</p>` : ''}
<p class="small"><b>2. Forráskérő követő prompt</b> – a válasz után, ugyanabban a beszélgetésben:</p><pre>${esc(SOURCES_FOLLOWUP)}</pre>
<p class="small"><b>3. URL-olvasási teszt</b> – egyszer, új beszélgetésben:</p><pre>${esc(urlReadPrompt(inp))}</pre></details>`
        : '';
      return `<div class="task"><h3>${badge(done ? 'pass' : 'warn').replace(STATUS_LABEL.pass, 'Rögzítve').replace(STATUS_LABEL.warn, 'Teendő')} ${esc(t.title)}</h3>
<p class="small">${esc(t.why)}</p><dl class="kv small"><dt>Ki végzi?</dt><dd>${esc(t.who)}</dd><dt>Mi kell hozzá?</dt><dd>${esc(t.access)}</dd><dt>Időigény</dt><dd>${esc(t.time)}</dd></dl>
<ol class="small">${t.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${prompts}</div>`;
    })
    .join('')}
${otherManual.length ? `<div class="task"><h3>További kézi ellenőrzések</h3><ul class="small">${otherManual.map((c) => `<li><b>${esc(c.title)}</b> – ${esc(c.howTo ?? c.description)}</li>`).join('')}</ul></div>` : ''}
<details class="snip"><summary>Hozzáférés kérése az ügyféltől (levélvázlat)</summary><pre>${esc(ACCESS_REQUEST(new URL(inp.url).hostname, inp.org))}</pre></details></section>

<section id="limits" class="card"><p class="label">Korlátok és források</p><ul class="small">
<li>A robotok user-agentjével végzett lekérés nem azonos a valódi robot-IP-ről érkező kéréssel.</li>
<li>A ChatGPT- és Copilot-teszt kézi pillanatfelvétel; az eredmények munkamenetenként, helyenként és időben változnak.</li>
<li>A JSON-LD nem garantál rangsorolást vagy AI-megjelenést. A ChatGPT search schema.org-használatáról nincs hivatalos OpenAI-állítás.</li>
${(an.limitations ?? []).map((l) => `<li>${md(l)}</li>`).join('')}</ul>
${docs.length ? `<p class="small"><b>Ellenőrzött hivatalos dokumentáció:</b></p><ul class="small">${docs.map((d) => `<li><a href="${esc(d.url)}">${esc(d.url)}</a> – lekérve: ${esc(d.date)}${d.note ? ` – ${esc(d.note)}` : ''}</li>`).join('')}</ul>` : ''}
<p class="small muted">Gépi adatgyűjtés: ${esc(round.finishedAt)} · ellenőrzések: ${active.length} · ${an.meta?.analyst ? `elemzés: ${esc(an.meta.analyst)}` : 'szakértői elemzés nélkül'}</p></section>
</main>
<footer class="foot"><span>thisisdone.com</span><span>GEO audit · ${esc(new URL(inp.url).hostname)}</span></footer>
<script>window.addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true));</script>
</body></html>`;
}

const CSS = `
:root{--black:#1a1a1a;--gray:#f6f6f6;--ultra:#e0e0e0;--light:#a0a0a0;--muted:#6b6b6b;--orange:#e63e17;--orange-soft:#fdece7}
*{box-sizing:border-box}body{margin:0;font-family:'Gotham','Open Sans',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:var(--black);background:var(--gray)}
a{color:var(--black)}a:hover{color:var(--orange)}code,pre{font-family:Consolas,'Courier New',monospace;font-size:12.5px}
pre{background:var(--black);color:#f6f6f6;padding:12px 14px;border-radius:6px;overflow:auto;white-space:pre-wrap;word-break:break-word;max-height:520px}
.top{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;background:#fff;border-bottom:1px solid var(--ultra)}.top .logo svg{height:22px;width:auto}
main{max-width:1240px;margin:0 auto;padding:24px 16px 60px;display:flex;flex-direction:column;gap:16px}
.cover{display:flex;gap:16px}.cover .stripe{width:11px;background:var(--orange);border-radius:2px}.cover h1{font-size:28px;margin:0 0 4px;line-height:1.2}
.label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--orange);margin:0 0 6px}.label.sec{margin:8px 0 0}
h3{font-size:15px;margin:14px 0 8px}.small{font-size:12.5px}.muted{color:var(--muted)}
.card{background:#fff;border:1px solid var(--ultra);border-radius:6px;padding:20px}.card.flat{padding:0;overflow:hidden}.pad{padding:16px 20px}
.toc a{margin:0 4px}.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}
@media(max-width:860px){.grid3,.grid2{grid-template-columns:1fr}}
.tile-row{display:flex;gap:16px;align-items:center}.big{font-size:40px;font-weight:700;line-height:1}.big small{font-size:16px;color:var(--light)}.tile-txt{display:flex;flex-direction:column;gap:4px;flex:1}
.meter{height:8px;border-radius:4px;background:var(--gray);overflow:hidden}.meter>div,.meter>span{display:block;height:100%;border-radius:4px}.meter.inline{display:inline-block;width:60%;vertical-align:middle}
.band-good{color:#006300}.band-warn{color:#8a5a00}.band-serious{color:#a8461f}.band-critical{color:#9d2222}.band-none{color:var(--muted)}
.bg-good{background:#0ca30c}.bg-warn{background:#fab219}.bg-serious{background:#ec835a}.bg-critical{background:#d03b3b}.bg-none{background:var(--ultra)}
.status{display:inline-flex;align-items:center;gap:6px;padding:2px 10px 2px 6px;border-radius:100px;font-size:12px;font-weight:600;white-space:nowrap;background:var(--gray)}
.status .ic{width:16px;height:16px;border-radius:50%;display:inline-grid;place-items:center;font-size:10px;color:#fff;font-weight:700}
.status.pass{color:#006300;background:#e8f6e8}.status.pass .ic{background:#0ca30c}.status.warn{color:#8a5a00;background:#fff5dc}.status.warn .ic{background:#fab219;color:#1a1a1a}
.status.fail{color:#9d2222;background:#fbe9e9}.status.fail .ic{background:#d03b3b}.status.info{color:#1c5cab;background:#e8f1fb}.status.info .ic{background:#2a78d6}
.status.na,.status.unverifiable{color:var(--muted)}.status.na .ic{background:var(--ultra);color:var(--muted)}.status.unverifiable .ic{background:var(--light)}
.tag{display:inline-block;padding:1px 8px;border-radius:100px;background:var(--ultra);font-size:11px;font-weight:600;white-space:nowrap}.tag.outline{background:transparent;border:1px solid var(--ultra);color:var(--muted)}.tag.orange{background:var(--orange-soft);color:var(--orange)}
.ev-observed{background:#e8f6e8;color:#006300}.ev-likely{background:#e8f1fb;color:#1c5cab}.ev-hypothesis{background:#fff5dc;color:#8a5a00}.ev-unverifiable{background:var(--gray);color:var(--muted);border:1px dashed var(--light)}
.prio{display:inline-block;padding:1px 10px;border-radius:100px;font-size:12px;font-weight:700;white-space:nowrap}.prio-kritikus{background:#d03b3b;color:#fff}.prio-magas{background:#ec835a}.prio-közepes{background:#fab219}.prio-alacsony{background:var(--ultra)}
.effort{display:inline-grid;place-items:center;width:26px;height:22px;border-radius:4px;background:var(--black);color:#fff;font-size:12px;font-weight:700}.explain{display:block;font-size:12px;color:var(--muted);margin-top:2px}
table.t{width:100%;border-collapse:collapse;font-size:13px}table.t th,table.t td{padding:8px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--ultra)}table.t th{font-size:12px;color:var(--muted);font-weight:600}
table.t.brand th{background:var(--orange);color:#fff}table.t.brand tbody tr:nth-child(even) td{background:var(--gray)}.num{text-align:right;font-variant-numeric:tabular-nums}.tw{overflow-x:auto}
.heat td.c{text-align:center;font-weight:600;font-size:12px;white-space:nowrap}.c.pass{background:#e8f6e8;color:#006300}.c.warn{background:#fff5dc;color:#8a5a00}.c.fail{background:#fbe9e9;color:#9d2222}.c.info{background:#e8f1fb;color:#1c5cab}.c.na{color:var(--light)}
.summary{margin:0;padding-left:18px}.summary li{margin:4px 0}.summary ol{margin:4px 0;padding-left:18px}
.topic{margin-top:12px}.topic-h{display:flex;justify-content:space-between;align-items:flex-end;padding:16px 20px;border-bottom:1px solid var(--ultra)}.topic-h h3{margin:0}
.sub-h{padding:8px 20px;background:var(--gray);border-top:1px solid var(--ultra);font-weight:700;font-size:12.5px}
.finding{border-top:1px solid var(--ultra);padding:12px 20px}.finding:first-of-type{border-top:0}.finding>summary{display:flex;gap:12px;align-items:flex-start;cursor:pointer;list-style:none}.finding>summary::-webkit-details-marker{display:none}
.ft{flex:1;min-width:0}.ft b{display:block}.ft .s{color:var(--muted)}.fm{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.fbody{padding-top:8px}.fbody ul{padding-left:18px}
.override{border-left:3px solid var(--orange);padding-left:10px;margin:8px 0;font-size:12.5px}.snip{margin:8px 0}.snip>summary{cursor:pointer;font-weight:600}
.legend>summary{cursor:pointer}.lgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px 32px;margin-top:8px}.lgrid h3{font-size:13px}.lgrid dl{margin:0;display:flex;flex-direction:column;gap:8px;font-size:12.5px}
.lgrid dl>div{display:grid;grid-template-columns:140px 1fr;gap:10px}.lgrid dd{margin:0}
.bar{display:flex;height:20px;border-radius:4px;overflow:hidden;gap:2px;margin-top:8px}.legend-row{display:flex;gap:14px;margin-top:6px;color:var(--muted)}.legend-row i,.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.pkg{margin:0}.pkg h3{margin-top:0}.task{border-top:1px solid var(--ultra);padding-top:8px;margin-top:12px}.kv{display:grid;grid-template-columns:130px 1fr;gap:2px 12px}.kv dd{margin:0}.kv dt{color:var(--muted)}
.sources a{margin-right:6px}.foot{display:flex;justify-content:space-between;max-width:1240px;margin:0 auto;padding:12px 16px 32px;color:var(--light);font-size:12px;border-top:1px solid var(--ultra)}
@media print{body{background:#fff}.no-print{display:none}.card{border:0;padding:0 0 12px;break-inside:auto}main{padding:0}pre{max-height:none}.finding{break-inside:avoid}}
`;
