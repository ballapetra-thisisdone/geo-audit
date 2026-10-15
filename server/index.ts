import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.ts';
import { store } from './store.ts';
import { loadBots, loadChecks, loadQuestionTemplates, saveChecks, saveQuestionTemplates } from './config.ts';
import { getBotMatrix, isRunning, mutateRound, rerun, startRound } from './pipeline.ts';
import { buildBacklog } from './scoring.ts';
import { buildSamples } from './samples.ts';
import { hasRunner, runners } from './checks/runners.ts';
import { ai, suggestQuestions } from './ai/claude.ts';
import { initSite, siteRoutes } from './site/routes.ts';
import type { AuditInput, CheckDef, CustomFinding, Evidence, Question, QuestionTemplate, Round, Status } from '../shared/types.ts';

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 25 * 1024 * 1024 });

const QUESTION_CHECKS = ['ai.questions', 'test.chatgpt', 'test.copilot'];
const STATUSES: Status[] = ['pass', 'warn', 'fail', 'info', 'na', 'unverifiable'];
const EVIDENCES: Evidence[] = ['observed', 'likely', 'hypothesis', 'unverifiable'];

type P = { id: string; n: string };

/** A teljes oldalszöveget nem küldjük ki minden lekéréskor. */
function slim(round: Round): Round {
  if (!round.artifacts) return round;
  const facts = Object.fromEntries(Object.entries(round.artifacts.facts).map(([k, f]) => [k, f ? { ...f, text: '' } : f]));
  return { ...round, artifacts: { ...round.artifacts, facts } };
}

function validateInput(i: Partial<AuditInput>): AuditInput {
  if (!i.url) throw new Error('Az URL kötelező.');
  const u = new URL(i.url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Csak http(s) URL vizsgálható.');
  return {
    url: u.toString(),
    name: i.name?.trim() ?? '',
    org: i.org?.trim() ?? '',
    pageType: i.pageType?.trim() ?? '',
    entityType: i.entityType?.trim() ?? '',
    cms: i.cms?.trim() ?? '',
    languages: (i.languages ?? ['hu']).filter(Boolean),
    keyData: (i.keyData ?? []).filter((k) => k.label?.trim()).map((k) => ({ label: k.label.trim(), value: k.value?.trim() || undefined })),
    modules: i.modules ?? [],
    notes: i.notes,
  };
}

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  reply.status(err.statusCode && err.statusCode < 500 ? err.statusCode : 400).send({ error: err.message });
});

// ---- meta & konfiguráció ----
app.get('/api/meta', async () => ({ ai: { enabled: ai.enabled(), model: ai.model() }, version: '0.1.0' }));

app.get('/api/config', async () => {
  const { checks, modules } = await loadChecks();
  return { checks, modules, bots: await loadBots(), templates: await loadQuestionTemplates(), runnerKeys: Object.keys(runners).sort() };
});

app.put<{ Body: { checks: CheckDef[] } }>('/api/config/checks', async (req) => {
  const checks = req.body.checks;
  const ids = new Set<string>();
  for (const c of checks) {
    if (!c.id || !/^[a-z0-9.-]+$/.test(c.id)) throw new Error(`Érvénytelen azonosító: ${c.id}`);
    if (ids.has(c.id)) throw new Error(`Duplikált azonosító: ${c.id}`);
    ids.add(c.id);
    if (c.runner === 'auto' && !hasRunner(c.impl)) throw new Error(`${c.id}: nincs „${c.impl}” futtató a kódban. Kézi ellenőrzéshez válaszd a „manual” típust.`);
    c.weight = Math.max(0, Math.min(5, Number(c.weight) || 1));
  }
  await saveChecks(checks);
  return { ok: true };
});

app.put<{ Body: { templates: QuestionTemplate[] } }>('/api/config/questions', async (req) => {
  await saveQuestionTemplates(req.body.templates.filter((t) => t.text?.trim()));
  return { ok: true };
});

// ---- auditok ----
app.get('/api/audits', async () => store.listAudits());

app.post<{ Body: { input: AuditInput; savedHtml?: { fileName: string; html: string } } }>('/api/audits', async (req) => {
  const input = validateInput(req.body.input);
  const id = await store.createAudit(input);
  const n = await startRound(id, { savedHtml: req.body.savedHtml });
  return { id, n };
});

app.get<{ Params: { id: string } }>('/api/audits/:id', async (req) => ({ ...(await store.summary(req.params.id)), running: isRunning(req.params.id) }));

app.put<{ Params: { id: string }; Body: AuditInput }>('/api/audits/:id/input', async (req) => {
  await store.updateInput(req.params.id, validateInput(req.body));
  return { ok: true };
});

app.delete<{ Params: { id: string } }>('/api/audits/:id', async (req) => {
  await store.deleteAudit(req.params.id);
  return { ok: true };
});

app.post<{ Params: { id: string }; Body: { savedHtml?: { fileName: string; html: string }; note?: string } }>('/api/audits/:id/rounds', async (req) => {
  const n = await startRound(req.params.id, req.body ?? {});
  return { n };
});

app.get<{ Params: P }>('/api/audits/:id/rounds/:n', async (req) => slim(await store.getRound(req.params.id, Number(req.params.n))));

app.get<{ Params: P }>('/api/audits/:id/rounds/:n/backlog', async (req) => buildBacklog(await store.getRound(req.params.id, Number(req.params.n))));

app.get<{ Params: P }>('/api/audits/:id/rounds/:n/samples', async (req) => buildSamples(await store.getRound(req.params.id, Number(req.params.n))));

app.get<{ Params: P }>('/api/audits/:id/rounds/:n/botmatrix', async (req) => getBotMatrix(req.params.id, Number(req.params.n)));

app.get<{ Params: P; Querystring: { file: string } }>('/api/audits/:id/rounds/:n/body', async (req, reply) => {
  const body = await store.readBody(req.params.id, req.query.file);
  reply.type('text/plain; charset=utf-8').send(body);
});

app.post<{ Params: P; Body: { checkId?: string; refreshChecks?: boolean } }>('/api/audits/:id/rounds/:n/rerun', async (req) =>
  slim(await rerun(req.params.id, Number(req.params.n), req.body ?? {})),
);

app.put<{ Params: P & { checkId: string }; Body: { status: Status; evidence: Evidence; note: string } }>(
  '/api/audits/:id/rounds/:n/findings/:checkId/override',
  async (req) => {
    const { status, evidence, note } = req.body;
    if (!STATUSES.includes(status) || !EVIDENCES.includes(evidence)) throw new Error('Érvénytelen státusz vagy bizonyíték.');
    return slim(
      await mutateRound(req.params.id, Number(req.params.n), (r) => {
        const f = r.findings[req.params.checkId] ?? {
          checkId: req.params.checkId,
          status: 'unverifiable',
          evidence: 'unverifiable',
          summary: 'Kézi ellenőrzés.',
          ranAt: new Date().toISOString(),
        };
        f.override = { status, evidence, note: note ?? '', at: new Date().toISOString() };
        r.findings[req.params.checkId] = f;
      }),
    );
  },
);

app.delete<{ Params: P & { checkId: string } }>('/api/audits/:id/rounds/:n/findings/:checkId/override', async (req) =>
  slim(
    await mutateRound(req.params.id, Number(req.params.n), (r) => {
      const f = r.findings[req.params.checkId];
      if (f) delete f.override;
    }),
  ),
);

app.put<{ Params: P; Body: { custom: CustomFinding[] } }>('/api/audits/:id/rounds/:n/custom', async (req) =>
  slim(
    await mutateRound(req.params.id, Number(req.params.n), (r) => {
      r.custom = req.body.custom.map((c, i) => ({
        ...c,
        checkId: c.checkId || `custom-${Date.now().toString(36)}-${i}`,
        ranAt: c.ranAt || new Date().toISOString(),
        weight: Math.max(0, Math.min(5, Number(c.weight) || 1)),
      }));
    }),
  ),
);

app.put<{ Params: P; Body: { questions: Question[] } }>('/api/audits/:id/rounds/:n/questions', async (req) =>
  slim(
    await mutateRound(
      req.params.id,
      Number(req.params.n),
      (r) => {
        r.questions = req.body.questions;
      },
      QUESTION_CHECKS,
    ),
  ),
);

app.post<{ Params: P }>('/api/audits/:id/rounds/:n/ai/questions', async (req) => {
  const n = Number(req.params.n);
  const round = await store.getRound(req.params.id, n);
  const facts = round.artifacts?.facts.rendered ?? round.artifacts?.facts.raw;
  if (!facts) throw new Error('A körnek nincs elemezhető oldalszövege.');
  const generated = await suggestQuestions(round.input, facts);
  return slim(await mutateRound(req.params.id, n, (r) => void r.questions.push(...generated), QUESTION_CHECKS));
});

// ---- webhely-szintű GEO audit (v2) ----
initSite({ worker: process.env.GEO_EMBEDDED_WORKER !== '0' });
await app.register(siteRoutes);

// ---- statikus frontend (npm run build után) ----
const dist = path.join(env.root, 'dist');
if (fs.existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.status(404).send({ error: 'Nincs ilyen végpont' }) : reply.sendFile('index.html')));
}

await app.listen({ port: env.port, host: '127.0.0.1' });
console.log(`GEO Audit API: http://localhost:${env.port}${fs.existsSync(dist) ? ' (frontend kiszolgálva)' : ''}`);
console.log(`Claude API: ${ai.enabled() ? `bekapcsolva (${ai.model()})` : 'kikapcsolva – nincs ANTHROPIC_API_KEY'}`);
