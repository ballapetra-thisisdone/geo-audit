// Tömör, Claude-nak szóló összefoglaló a gépi eredményekről (hogy ne kelljen a teljes audit.json-t beolvasni).
import { STATUS_LABEL, TOPICS, type Round } from '../shared/types.ts';
import type { botMatrix } from '../server/checks/runners.ts';
import { effective } from '../server/scoring.ts';

type Matrix = ReturnType<typeof botMatrix>;

export function renderSummary(round: Round, matrix: Matrix): string {
  const s = round.scores!;
  const a = round.artifacts!;
  const f = a.facts.rendered ?? a.facts.raw;
  const L: string[] = [];
  L.push(`# Gépi eredmények – ${round.input.url}`, '');
  if (!a.render?.ok) {
    L.push(
      `> **FIGYELEM: a renderelés sikertelen** (${a.render?.error ?? 'ismeretlen hiba'}). A page-text.txt ezért a NYERS (JS nélküli) szöveget tartalmazza, és a JS-függőségi ellenőrzések nem ellenőrizhetők. Lásd a SKILL.md „Ha a renderelés sikertelen” részét.`,
      '',
    );
  }
  L.push(`Készült: ${round.finishedAt}`);
  L.push(`Bemenet: ${JSON.stringify(round.input)}`, '');
  L.push(`## Pontszám (csak gépi, elemzés előtt)`);
  L.push(`- Bing/Copilot: ${s.surfaces.bing.score ?? '—'} (lefedettség ${s.surfaces.bing.coverage}%)`);
  L.push(`- ChatGPT: ${s.surfaces.chatgpt.score ?? '—'} (lefedettség ${s.surfaces.chatgpt.coverage}%)`);
  L.push(`- Témakörök: ${s.topics.map((t) => `${t.topic} ${t.score ?? '—'}`).join(' · ')}`, '');

  L.push(`## Renderelés`);
  L.push(a.render?.ok ? `${a.render.engine}, ${a.render.loadMs} ms` : `Sikertelen: ${a.render?.error}`, '');

  L.push(`## Bot-mátrix`);
  L.push('| Bot | HTTP | challenge | robots.txt | szöveg % | title egyezik | kulcsadat |', '|---|---|---|---|---|---|---|');
  for (const m of matrix) {
    L.push(
      `| ${m.name} | ${m.fetched ? (m.error ? 'hiba: ' + m.error : m.status) : '—'} | ${m.challenge ?? ''} | ${m.robotsAllowed === null ? 'n.a.' : m.robotsAllowed ? 'engedélyezett' : 'TILTVA ' + (m.robotsRule ?? '')} | ${m.textPct ?? ''} | ${m.titleMatch ?? ''} | ${m.keyFound === null ? '' : `${m.keyFound}/${m.keyTotal}`} |`,
    );
  }
  L.push('');

  L.push(`## Nem „Rendben” státuszú ellenőrzések`);
  for (const t of TOPICS) {
    const items = round.checks.filter((c) => c.topic === t.id && round.findings[c.id] && effective(round.findings[c.id]) !== 'pass');
    if (!items.length) continue;
    L.push(`### ${t.n}. ${t.title}`);
    for (const c of items) {
      const fd = round.findings[c.id];
      L.push(`- **${c.id}** [${STATUS_LABEL[effective(fd)]} / ${fd.evidence}] ${c.title}: ${fd.summary}`);
      for (const d of (fd.details ?? []).slice(0, 6)) L.push(`  - ${d}`);
    }
  }
  L.push('');
  L.push(`## Rendben lévő ellenőrzések`);
  L.push(round.checks.filter((c) => round.findings[c.id] && effective(round.findings[c.id]) === 'pass').map((c) => c.id).join(', '), '');

  if (f) {
    L.push(`## Oldaltények (renderelt)`);
    L.push(`- title: ${f.title ?? '—'}`);
    L.push(`- meta description: ${f.metaDescription ?? '—'}`);
    L.push(`- canonical: ${f.canonical.join(', ') || '—'} · lang: ${f.lang ?? '—'}`);
    L.push(`- H1: ${f.headings.filter((h) => h.level === 1).map((h) => h.text).join(' | ') || '—'}`);
    L.push(`- Címsorok: ${f.headings.slice(0, 25).map((h) => `H${h.level} ${h.text.slice(0, 60)}`).join(' · ')}`);
    L.push(`- JSON-LD típusok: ${[...new Set(f.jsonld.flatMap((j) => j.types))].join(', ') || 'nincs'}`);
    L.push(`- og:site_name: ${f.og['og:site_name'] ?? '—'} · lábléc: ${(f.footerText ?? '').slice(0, 200)}`);
    L.push(`- Látható dátumok: ${f.dates.join('; ') || 'nincs'}`);
    L.push(`- PDF-ek: ${f.pdfs.join(', ') || 'nincs'}`);
    L.push(`- iframe-ek: ${f.iframes.join(', ') || 'nincs'} · térkép: ${f.maps} · slider: ${f.sliders} · videó: ${f.videos}`);
    L.push(`- Kapcsolat: ${JSON.stringify(f.contact)}`);
    L.push(`- Szöveghossz: renderelt ${a.facts.rendered?.textLength ?? '—'} / nyers ${a.facts.raw?.textLength ?? '—'} karakter (teljes szöveg: page-text.txt)`);
    L.push('');
  }

  L.push(`## Sablonból indított kérdések (felülírandók az analysis.json-ban)`);
  for (const q of round.questions) L.push(`- [${q.kind}] ${q.text}`);
  L.push('');
  L.push(`## Kézi / nem ellenőrizhető tételek`);
  L.push(
    round.checks
      .filter((c) => round.findings[c.id] && effective(round.findings[c.id]) === 'unverifiable')
      .map((c) => c.id)
      .join(', '),
  );
  return L.join('\n') + '\n';
}
