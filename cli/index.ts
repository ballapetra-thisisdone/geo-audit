// GEO audit parancssori eszköz (a Claude Code skill ezt futtatja).
//   collect --input input.json [--out <mappa>] [--saved mentett.html]   adatgyűjtés + gépi ellenőrzések
//   report  --dir <mappa> [--refresh-checks]                             analysis.json beolvasása, riport generálása
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditInput, BotDef, CheckDef, CustomFinding, ModuleDef, Question, QuestionTemplate, Round } from '../shared/types.ts';
import { collect, type Bodies } from '../server/collect/collect.ts';
import { runChecks, seedQuestions } from '../server/checks/run.ts';
import { buildBacklog, computeScores } from '../server/scoring.ts';
import { buildContext } from '../server/checks/context.ts';
import { botMatrix } from '../server/checks/runners.ts';
import { buildSamples } from '../server/samples.ts';
import { renderReport, type Analysis } from './report.ts';
import { renderSummary } from './summary.ts';
import { toCsv } from './csv.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
// Bundle-ben: <skill>/scripts/geo-audit.mjs → <skill>/config; forrásból: geo-audit/cli → geo-audit/config
const configDir = [path.join(here, '..', 'config'), path.join(here, 'config')].find((d) => fs.existsSync(path.join(d, 'checks.json')))!;
const assetsDir = [path.join(here, '..', 'assets'), path.join(here, '..', 'web', 'public')].find((d) => fs.existsSync(d));

const readJson = <T,>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as T;
const writeJson = (file: string, data: unknown) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

function args() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i++;
    } else opts[key] = true;
  }
  return { cmd, opts };
}

function loadConfig() {
  const { checks, modules } = readJson<{ checks: CheckDef[]; modules: ModuleDef[] }>(path.join(configDir, 'checks.json'));
  const bots = readJson<{ bots: BotDef[] }>(path.join(configDir, 'bots.json')).bots;
  const templates = readJson<{ templates: QuestionTemplate[] }>(path.join(configDir, 'questions.json')).templates;
  return { checks, modules, bots, templates };
}

function normalizeInput(i: Partial<AuditInput>, modules: ModuleDef[]): AuditInput {
  if (!i.url) throw new Error('Az input.json-ban az "url" kötelező.');
  const u = new URL(i.url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Csak http(s) URL vizsgálható.');
  return {
    url: u.toString(),
    name: i.name?.trim() ?? '',
    org: i.org?.trim() ?? '',
    pageType: i.pageType?.trim() ?? '',
    entityType: i.entityType?.trim() ?? '',
    cms: i.cms?.trim() ?? 'nem ismert',
    // Nyelvet nem feltételezünk: ha nincs megadva, a lang-ellenőrzés csak a jelenlétet nézi.
    languages: (i.languages ?? []).filter(Boolean),
    keyData: (i.keyData ?? []).filter((k) => k.label?.trim()).map((k) => ({ label: k.label.trim(), value: k.value?.trim() || undefined })),
    // Alapértelmezés: minden alapból bekapcsolt kiegészítő modul.
    modules: i.modules ?? modules.filter((m) => m.id !== 'core' && m.defaultOn).map((m) => m.id),
    notes: i.notes,
  };
}

function loadBodies(dir: string, round: Round): Bodies {
  const a = round.artifacts!;
  const read = (rel?: string) => (rel && fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : undefined);
  const bodies: Bodies = { byBot: {} };
  for (const f of a.fetches) {
    const b = read(f.bodyFile);
    if (b !== undefined) bodies.byBot[f.botId] = b;
  }
  bodies.rendered = read(a.render?.bodyFile);
  bodies.saved = read(a.saved?.bodyFile);
  return bodies;
}

async function cmdCollect(opts: Record<string, string | true>) {
  if (typeof opts.input !== 'string') throw new Error('Használat: collect --input input.json [--out mappa] [--saved mentett.html]');
  const { checks, modules, bots, templates } = loadConfig();
  const input = normalizeInput(readJson<Partial<AuditInput>>(opts.input), modules);
  const host = new URL(input.url).hostname.replace(/^www\./, '');
  const date = new Date().toISOString().slice(0, 10);
  let dir = typeof opts.out === 'string' ? opts.out : path.join('geo-audit-reports', `${host}-${date}`);
  if (typeof opts.out !== 'string') {
    let i = 2;
    const base = dir;
    while (fs.existsSync(dir)) dir = `${base}-${i++}`;
  }
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  writeJson(path.join(dir, 'input.json'), input);

  const savedPath = typeof opts.saved === 'string' ? opts.saved : undefined;
  const savedHtml = savedPath ? { fileName: path.basename(savedPath), html: fs.readFileSync(savedPath, 'utf8') } : undefined;

  const round: Round = {
    n: 1,
    createdAt: new Date().toISOString(),
    status: 'running',
    input,
    checks,
    findings: {},
    custom: [],
    questions: seedQuestions(templates, input),
    log: [],
  };
  const log = async (level: 'info' | 'warn' | 'error', msg: string) => {
    round.log.push({ t: new Date().toISOString(), level, msg });
    console.log(`${level === 'info' ? '' : level.toUpperCase() + ': '}${msg}`);
  };
  const { artifacts, bodies } = await collect({
    input,
    bots,
    savedHtml,
    log,
    saveBody: async (name, body) => {
      fs.writeFileSync(path.join(dir, 'raw', name), body, 'utf8');
      return `raw/${name}`;
    },
    browserChannel: process.env.GEO_BROWSER_CHANNEL,
  });
  round.artifacts = artifacts;
  runChecks(round, artifacts, bodies, bots);
  round.scores = computeScores(round);
  round.status = 'done';
  round.finishedAt = new Date().toISOString();

  // Az oldal szövege Claude-nak (kérdés-értékeléshez, idézhetőséghez) – a renderelt, ha van.
  const facts = artifacts.facts.rendered ?? artifacts.facts.raw;
  fs.writeFileSync(path.join(dir, 'page-text.txt'), facts?.text ?? '', 'utf8');
  if (artifacts.facts.raw) fs.writeFileSync(path.join(dir, 'page-text-raw.txt'), artifacts.facts.raw.text, 'utf8');
  const matrix = botMatrix(buildContext(input, artifacts, bodies, bots, round.questions));
  writeJson(path.join(dir, 'audit.json'), round);
  fs.writeFileSync(path.join(dir, 'summary.md'), renderSummary(round, matrix), 'utf8');

  console.log('');
  if (!artifacts.render?.ok) {
    console.log('!!! FIGYELEM: a renderelés sikertelen – a page-text.txt a nyers (JS nélküli) szöveg, a JS-függőségi ellenőrzések nem ellenőrizhetők.');
    console.log(`!!! Ok: ${artifacts.render?.error}. Próbáld újra, állítsd be a GEO_BROWSER_PATH-t, vagy add meg a mentett HTML-t (--saved).`);
  }
  console.log(`Kész: ${path.resolve(dir)}`);
  console.log(`Pontszám – Bing/Copilot: ${round.scores.surfaces.bing.score ?? '—'}, ChatGPT: ${round.scores.surfaces.chatgpt.score ?? '—'}`);
  console.log(`Következő lépés: olvasd el a summary.md-t és a page-text.txt-t, írd meg az analysis.json-t, majd: report --dir "${dir}"`);
}

function applyAnalysis(round: Round, an: Analysis) {
  if (an.questions?.length) {
    round.questions = an.questions.map((q, i) => ({
      id: q.id ?? `a${i + 1}`,
      kind: q.kind ?? 'search',
      text: q.text,
      coverage: q.coverage ?? 'unknown',
      fact: q.fact || undefined,
      missing: q.missing || undefined,
      sourceOwner: q.sourceOwner || undefined,
      results: q.results ?? [],
      origin: q.origin ?? 'llm',
    })) as Question[];
  }
  round.custom = (an.custom ?? []).map(
    (c, i): CustomFinding => ({
      checkId: c.id ?? `custom-${i + 1}`,
      title: c.title,
      topic: c.topic,
      surfaces: c.surfaces?.length ? c.surfaces : ['bing', 'chatgpt'],
      weight: Math.max(0, Math.min(5, c.weight ?? 2)),
      status: c.status,
      evidence: c.evidence,
      summary: c.summary,
      details: c.details,
      backlog: c.backlog,
      sources: c.sources,
      ranAt: new Date().toISOString(),
    }),
  );
}

async function cmdReport(opts: Record<string, string | true>) {
  if (typeof opts.dir !== 'string') throw new Error('Használat: report --dir <audit mappa> [--refresh-checks]');
  const dir = opts.dir;
  const { checks, bots } = loadConfig();
  const round = readJson<Round>(path.join(dir, 'audit.json'));
  if (!round.artifacts) throw new Error('Az audit.json-ban nincs begyűjtött adat – előbb futtasd a collect parancsot.');
  if (opts['refresh-checks']) round.checks = checks;

  const anPath = path.join(dir, 'analysis.json');
  const analysis: Analysis = fs.existsSync(anPath) ? readJson<Analysis>(anPath) : {};
  if (!fs.existsSync(anPath)) console.log('Figyelem: nincs analysis.json – a riport csak a gépi eredményeket tartalmazza.');

  applyAnalysis(round, analysis);
  // A felülírásokat a futtatás előtt töröljük, majd az analysis szerint újra felvesszük (idempotens).
  for (const f of Object.values(round.findings)) delete f.override;
  const bodies = loadBodies(dir, round);
  runChecks(round, round.artifacts, bodies, bots);
  const unknown: string[] = [];
  for (const o of analysis.overrides ?? []) {
    const f = round.findings[o.checkId];
    if (!f) {
      unknown.push(o.checkId);
      continue;
    }
    f.override = { status: o.status, evidence: o.evidence, note: o.note ?? '', at: analysis.meta?.date ?? new Date().toISOString(), backlog: o.backlog };
  }
  if (unknown.length) console.log(`Figyelem: ismeretlen checkId az overrides-ban: ${unknown.join(', ')}`);
  round.scores = computeScores(round);

  const backlog = buildBacklog(round);
  const samples = buildSamples(round);
  const matrix = botMatrix(buildContext(round.input, round.artifacts, bodies, bots, round.questions));
  const logo = assetsDir && fs.existsSync(path.join(assetsDir, 'logo-dark.svg')) ? fs.readFileSync(path.join(assetsDir, 'logo-dark.svg'), 'utf8') : undefined;

  fs.writeFileSync(path.join(dir, 'report.html'), renderReport({ round, analysis, backlog, samples, matrix, logo }), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'backlog.csv'),
    toCsv([
      ['#', 'Cím', 'Kategória', 'Érintett felület', 'Felelős', 'Jelenlegi állapot', 'Javasolt változtatás', 'Megvalósítás', 'Várható előny', 'Prioritás', 'Ráfordítás', 'Ráfordítás indoka', 'Ellenőrzés', 'Azonosító'],
      ...backlog.map((b) => [
        b.n,
        b.title,
        b.category,
        b.surfaces.includes('bing') && b.surfaces.includes('chatgpt') ? 'mindkettő' : b.surfaces.includes('chatgpt') ? 'ChatGPT' : 'Bing/Copilot',
        b.owner,
        b.current,
        b.change,
        b.implementation,
        b.benefit,
        b.priority,
        b.effort,
        b.effortReason,
        b.verification,
        b.checkId,
      ]),
    ]),
    'utf8',
  );
  writeJson(path.join(dir, 'audit.json'), round);
  console.log(`Riport: ${path.resolve(dir, 'report.html')}`);
  console.log(`Backlog: ${path.resolve(dir, 'backlog.csv')} (${backlog.length} tétel)`);
  console.log(`Pontszám – Bing/Copilot: ${round.scores.surfaces.bing.score ?? '—'} (lefedettség ${round.scores.surfaces.bing.coverage}%), ChatGPT: ${round.scores.surfaces.chatgpt.score ?? '—'} (lefedettség ${round.scores.surfaces.chatgpt.coverage}%)`);
}

const { cmd, opts } = args();
const run = cmd === 'collect' ? cmdCollect : cmd === 'report' ? cmdReport : undefined;
if (!run) {
  console.log('Használat:\n  geo-audit collect --input input.json [--out mappa] [--saved mentett.html]\n  geo-audit report --dir <audit mappa> [--refresh-checks]');
  process.exit(cmd ? 1 : 0);
}
run(opts).catch((e) => {
  console.error(`HIBA: ${(e as Error).message}`);
  process.exit(1);
});
