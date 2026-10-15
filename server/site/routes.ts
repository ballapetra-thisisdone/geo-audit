// /api/v2 – webhely-szintű GEO audit API.
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { env } from '../env.ts';
import { getDb } from './db.ts';
import * as repo from './repo.ts';
import { enqueue, listJobs, registerHandler, startWorker } from './jobs.ts';
import { cancelAudit, estimate, normalizeInput, runAudit, siteEnv } from './pipeline.ts';
import { bundle, csv, htmlReport } from './export.ts';
import { defaultAdapters, envName, platformStatuses } from './visibility/adapters.ts';
import { DEFAULT_CRAWL, METHOD_VERSION, type SiteAuditInput } from '../../shared/site.ts';

export function initSite(opts: { worker?: boolean } = {}) {
  getDb(process.env.GEO_DB_FILE ?? path.join(env.dataDir, 'geo-site.sqlite'));
  registerHandler('audit.run', async (p) => {
    const id = String(p.auditId);
    try {
      await runAudit(id);
    } catch (e) {
      repo.updateAudit(id, { status: 'failed', error: (e as Error).message, finishedAt: new Date().toISOString() });
      throw e;
    }
  });
  if (opts.worker !== false) startWorker();
}

export async function siteRoutes(app: FastifyInstance) {
  app.get('/api/v2/meta', async () => {
    const adapters = defaultAdapters();
    return {
      methodVersion: METHOD_VERSION,
      defaults: { crawl: DEFAULT_CRAWL, competitorMaxPages: 30, visibility: { maxQueries: 20 }, llm: { maxCalls: 12 } },
      llm: { configured: !!env.anthropicKey, model: siteEnv.llmModel, env: 'ANTHROPIC_API_KEY' },
      platforms: platformStatuses(adapters, []).map((p) => ({ ...p, env: envName(p.id) })),
      browserChannel: env.browserChannel,
    };
  });

  app.post<{ Body: Partial<SiteAuditInput> }>('/api/v2/estimate', async (req) => estimate(normalizeInput(req.body ?? {})));

  app.post<{ Body: Partial<SiteAuditInput> }>('/api/v2/audits', async (req) => {
    const input = normalizeInput(req.body ?? {});
    const audit = repo.createAudit(input);
    enqueue('audit.run', { auditId: audit.id });
    return { id: audit.id };
  });

  app.get('/api/v2/audits', async () =>
    repo.listAudits().map((a) => ({ id: a.id, domain: a.domain, status: a.status, createdAt: a.createdAt, finishedAt: a.finishedAt, partial: a.partial, score: repo.getArtifact<{ overall: number | null }>(a.id, 'score')?.overall ?? null, competitors: a.input.competitors.length })),
  );

  app.get<{ Params: { id: string } }>('/api/v2/audits/:id', async (req) => {
    const id = req.params.id;
    const audit = repo.getAudit(id);
    const issues = repo.listIssues(id);
    return {
      audit,
      context: repo.getArtifact(id, 'context'),
      score: repo.getArtifact(id, 'score'),
      summary: repo.getArtifact(id, 'summary'),
      llmUsage: repo.getArtifact(id, 'llmUsage'),
      counts: {
        pages: repo.listPages(id, { site: 'own', limit: 1 }).total,
        issues: issues.filter((i) => i.site === 'own').length,
        p0: issues.filter((i) => i.priority === 'P0').length,
        p1: issues.filter((i) => i.priority === 'P1').length,
        recommendations: repo.listRecommendations(id).length,
        tasks: repo.listTasks(id).length,
        queries: repo.listQueries(id).length,
        competitors: repo.listCompetitors(id).length,
      },
    };
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/api/v2/audits/:id/logs', async (req) => repo.getLogs(req.params.id, Number(req.query.after ?? 0)));

  app.post<{ Params: { id: string } }>('/api/v2/audits/:id/cancel', async (req) => {
    cancelAudit(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/v2/audits/:id/rerun', async (req) => {
    const a = repo.getAudit(req.params.id);
    if (a.status === 'running' || a.status === 'queued') throw Object.assign(new Error('Az audit már fut vagy sorban áll.'), { statusCode: 409 });
    repo.updateAudit(a.id, { status: 'queued' });
    enqueue('audit.run', { auditId: a.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/v2/audits/:id', async (req) => {
    cancelAudit(req.params.id);
    repo.deleteAudit(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { site?: string; cls?: string; flag?: string; q?: string; limit?: string; offset?: string } }>('/api/v2/audits/:id/pages', async (req) =>
    repo.listPages(req.params.id, { site: req.query.site ?? 'own', cls: req.query.cls || undefined, flag: req.query.flag || undefined, q: req.query.q || undefined, limit: Math.min(1000, Number(req.query.limit ?? 200)), offset: Number(req.query.offset ?? 0) }),
  );

  app.get<{ Params: { id: string; pageId: string } }>('/api/v2/audits/:id/pages/:pageId', async (req) => {
    const id = req.params.id;
    const p = repo.getPage(id, Number(req.params.pageId));
    const url = p.row.url;
    return {
      ...p,
      issues: repo.listIssues(id).filter((i) => i.urls.includes(url)).map((i) => ({ id: i.id, title: i.title, priority: i.priority, category: i.category, evidence: i.evidence.filter((e) => e.url === url) })),
      recommendations: repo.listRecommendations(id).filter((r) => r.url === url),
      structured: repo.structuredFor(id, url),
      links: repo.linksFor(id, url),
      content: repo.getArtifact<{ pages: { url: string }[] }>(id, 'content')?.pages.find((x) => x.url === url),
      queries: repo.listQueries(id).filter((q) => q.bestUrl === url).map((q) => ({ id: q.id, text: q.text, coverage: q.coverage })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/issues', async (req) => repo.listIssues(req.params.id));
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/recommendations', async (req) => repo.listRecommendations(req.params.id));
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/backlog', async (req) => repo.listTasks(req.params.id));
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/technical', async (req) => ({ technical: repo.getArtifact(req.params.id, 'technical'), aiBots: repo.getArtifact(req.params.id, 'aibots'), links: repo.getArtifact(req.params.id, 'links') }));
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/content', async (req) => ({ content: repo.getArtifact(req.params.id, 'content'), trust: repo.getArtifact(req.params.id, 'trust'), topics: repo.listTopics(req.params.id) }));
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/entities', async (req) => repo.getArtifact(req.params.id, 'entities') ?? null);
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/structured', async (req) => ({ summary: repo.getArtifact(req.params.id, 'structured'), records: repo.structuredFor(req.params.id) }));
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/queries', async (req) => ({ queries: repo.listQueries(req.params.id), topics: repo.listTopics(req.params.id) }));
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/visibility', async (req) => ({ summary: repo.getArtifact(req.params.id, 'visibility') ?? null, responses: repo.listResponses(req.params.id), sources: repo.sourceDomains(req.params.id) }));
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/competitors', async (req) => ({ competitors: repo.listCompetitors(req.params.id), gaps: repo.getArtifact(req.params.id, 'gaps') ?? [], opportunities: repo.listOpportunities(req.params.id) }));

  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/export.json', async (req, reply) => {
    reply.header('content-disposition', `attachment; filename="geo-audit-${req.params.id}.json"`);
    return bundle(req.params.id);
  });
  app.get<{ Params: { id: string; kind: string } }>('/api/v2/audits/:id/export/:kind.csv', async (req, reply) => {
    const body = csv(req.params.id, req.params.kind);
    reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="geo-audit-${req.params.id}-${req.params.kind}.csv"`).send(body);
  });
  app.get<{ Params: { id: string } }>('/api/v2/audits/:id/report.html', async (req, reply) => {
    reply.type('text/html; charset=utf-8').send(htmlReport(req.params.id));
  });
  app.get('/api/v2/jobs', async () => listJobs());
}
