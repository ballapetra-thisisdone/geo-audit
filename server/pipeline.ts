// Körök futtatása és módosítása. Egy kör = egy adatgyűjtés + az akkori check-könyvtár pillanatképe.
import type { Artifacts, CheckDef, LogEntry, Round } from '../shared/types.ts';
import { loadBots, loadChecks, loadQuestionTemplates } from './config.ts';
import { store } from './store.ts';
import { env } from './env.ts';
import { collect, type Bodies } from './collect/collect.ts';
import { buildContext } from './checks/context.ts';
import { botMatrix } from './checks/runners.ts';
import { runChecks, seedQuestions } from './checks/run.ts';
import { computeScores } from './scoring.ts';

const running = new Set<string>();
export const isRunning = (id: string) => running.has(id);

export async function startRound(auditId: string, opts: { savedHtml?: { fileName: string; html: string }; note?: string } = {}) {
  if (running.has(auditId)) throw new Error('Ehhez az audithoz már fut egy kör.');
  const audit = await store.getAudit(auditId);
  const prevN = audit.rounds.length ? Math.max(...audit.rounds) : 0;
  const prev = prevN ? await store.getRound(auditId, prevN).catch(() => undefined) : undefined;
  const { checks } = await loadChecks();
  const round: Round = {
    n: prevN + 1,
    createdAt: new Date().toISOString(),
    status: 'running',
    input: audit.input,
    checks,
    findings: {},
    custom: prev?.custom.map((c) => ({ ...c })) ?? [],
    questions: prev?.questions ?? seedQuestions(await loadQuestionTemplates(), audit.input),
    log: [],
    note: opts.note,
  };
  // Kézi értékelések átvétele az előző körből (a felhasználó munkája ne vesszen el).
  if (prev) {
    for (const [id, f] of Object.entries(prev.findings)) {
      const def = checks.find((c) => c.id === id);
      if (def?.runner === 'manual' && f.override) round.findings[id] = { ...f };
    }
  }
  await store.addRound(auditId, round);
  running.add(auditId);
  void execute(auditId, round, opts.savedHtml).finally(() => running.delete(auditId));
  return round.n;
}

async function execute(auditId: string, round: Round, savedHtml?: { fileName: string; html: string }) {
  let lastSave = 0;
  const log = async (level: LogEntry['level'], msg: string) => {
    round.log.push({ t: new Date().toISOString(), level, msg });
    if (Date.now() - lastSave > 700) {
      lastSave = Date.now();
      await store.saveRound(auditId, round);
    }
  };
  try {
    const bots = await loadBots();
    const { artifacts, bodies } = await collect({
      input: round.input,
      bots,
      savedHtml,
      log,
      saveBody: (name, body) => store.saveBody(auditId, round.n, name, body),
      browserChannel: env.browserChannel,
    });
    round.artifacts = artifacts;
    await log('info', 'Ellenőrzések futtatása…');
    runChecks(round, artifacts, bodies, bots);
    round.scores = computeScores(round);
    round.status = 'done';
    round.finishedAt = new Date().toISOString();
    await log('info', `Kész. Összpontszám: ${round.scores.overall ?? '—'}`);
  } catch (e) {
    round.status = 'error';
    await log('error', `Hiba: ${(e as Error).message}`);
  }
  await store.saveRound(auditId, round);
}

async function loadBodies(auditId: string, a: Artifacts): Promise<Bodies> {
  const bodies: Bodies = { byBot: {} };
  for (const f of a.fetches) if (f.bodyFile) bodies.byBot[f.botId] = await store.readBody(auditId, f.bodyFile).catch(() => '');
  if (a.render?.bodyFile) bodies.rendered = await store.readBody(auditId, a.render.bodyFile).catch(() => undefined);
  if (a.saved?.bodyFile) bodies.saved = await store.readBody(auditId, a.saved.bodyFile).catch(() => undefined);
  return bodies;
}

/** Ellenőrzés(ek) újrafuttatása a kör már begyűjtött adatain. refreshChecks: a check-könyvtár aktuális állapotát veszi át. */
export async function rerun(auditId: string, n: number, opts: { checkId?: string; refreshChecks?: boolean } = {}) {
  const round = await store.getRound(auditId, n);
  if (!round.artifacts) throw new Error('A körnek nincs begyűjtött adata.');
  if (opts.refreshChecks) round.checks = (await loadChecks()).checks;
  const bots = await loadBots();
  const bodies = await loadBodies(auditId, round.artifacts);
  runChecks(round, round.artifacts, bodies, bots, opts.checkId);
  round.scores = computeScores(round);
  await store.saveRound(auditId, round);
  return round;
}

/** Módosítás a körön (felülírás, kérdések, egyedi megállapítás), utána újrapontozás. */
export async function mutateRound(auditId: string, n: number, fn: (r: Round) => void | Promise<void>, rerunIds: string[] = []) {
  const round = await store.getRound(auditId, n);
  await fn(round);
  if (rerunIds.length && round.artifacts) {
    const bots = await loadBots();
    const bodies = await loadBodies(auditId, round.artifacts);
    for (const id of rerunIds) runChecks(round, round.artifacts, bodies, bots, id);
  }
  round.scores = computeScores(round);
  await store.saveRound(auditId, round);
  return round;
}

export async function getBotMatrix(auditId: string, n: number) {
  const round = await store.getRound(auditId, n);
  if (!round.artifacts) return [];
  const bots = await loadBots();
  const bodies = await loadBodies(auditId, round.artifacts);
  return botMatrix(buildContext(round.input, round.artifacts, bodies, bots, round.questions));
}

export type { CheckDef };
