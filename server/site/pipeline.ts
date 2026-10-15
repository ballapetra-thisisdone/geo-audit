// Audit-pipeline: a 20 lépés sorrendben, lépésenként független hibakezeléssel.
// Ha egy nem kritikus lépés (pl. AI-visibility, LLM, versenytárs-crawl) hibázik, a technikai és tartalmi audit lefut.
import type { AuditRecord, CostEstimate, DataSource, Issue, QueryRow, SiteAuditInput } from '../../shared/site.ts';
import { DEFAULT_CRAWL } from '../../shared/site.ts';
import { loadBots } from '../config.ts';
import { env } from '../env.ts';
import { crawlSite, CRAWLER_UA, type CrawlResult } from './crawl/crawler.ts';
import { Renderer } from './crawl/render.ts';
import { toStartUrl, hostKey } from './crawl/url.ts';
import { assertPublicHost, assertSafeUrl, defaultPolicy, type NetPolicy } from './security.ts';
import { buildModel, type SiteModel } from './analyze/model.ts';
import { detectContext } from './analyze/context.ts';
import { technicalAudit } from './analyze/technical.ts';
import { aiBotAudit, type AiBotReport } from './analyze/aibots.ts';
import { structuredAudit, type StructuredReport } from './analyze/structured.ts';
import { entityAudit, type EntityReport } from './analyze/entities.ts';
import { contentAudit, type ContentReport } from './analyze/content.ts';
import { trustAudit, type TrustReport } from './analyze/trust.ts';
import { linkAudit } from './analyze/links.ts';
import { answerability, buildPassageIndex, competitorAnswerability, coverageScore, generateQueries, queryIssues, topicMatrix } from './analyze/queries.ts';
import { buildCompetitorRows, opportunities, queryGaps, type SiteSnapshot } from './analyze/compare.ts';
import { computeScore } from './scoring.ts';
import { buildBacklog, buildRecommendations, executiveSummary, qualityCheck } from './recommend.ts';
import { AnthropicProvider, estimateLlmCost, LlmError, type LlmProvider } from './llm/provider.ts';
import { llmJudgeQueries, llmPageEval } from './llm/tasks.ts';
import { defaultAdapters, platformStatuses, type PlatformAdapter } from './visibility/adapters.ts';
import { runVisibility, type TrackedDomain } from './visibility/run.ts';
import * as repo from './repo.ts';
import type { BusinessContext, LinkGraphSummary, QueryGap, TopicRow, VisibilitySummary, AIResponseRow } from '../../shared/site.ts';

export interface PipelineDeps {
  adapters?: PlatformAdapter[];
  policy?: NetPolicy;
  renderer?: (ua: string) => Renderer | undefined;
  llm?: (input: SiteAuditInput) => LlmProvider | undefined;
}

export const siteEnv = {
  llmModel: process.env.LLM_MODEL ?? env.claudeModel,
};

const controllers = new Map<string, AbortController>();
export const cancelAudit = (id: string) => controllers.get(id)?.abort();

export function normalizeInput(raw: Partial<SiteAuditInput> & { url?: string }): SiteAuditInput {
  if (!raw.url) throw Object.assign(new Error('A domain vagy URL megadása kötelező.'), { statusCode: 400 });
  const url = toStartUrl(raw.url);
  assertSafeUrl(url);
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : []).map((s) => String(s).trim()).filter(Boolean).slice(0, max);
  // séma+port megmarad, ha meg van adva (pl. http://host:8080); egyébként a domain kulcs (https feltételezve)
  const competitors = [...new Set(list(raw.competitors, 10).map((c) => (/^https?:\/\//i.test(c) ? new URL(c).origin : hostKey(new URL(toStartUrl(c)).hostname))))].filter((c) => compDomain(c) !== hostKey(new URL(url).hostname));
  const c = { ...DEFAULT_CRAWL, ...(raw.crawl ?? {}) };
  const num = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
  return {
    url,
    country: raw.country?.trim() || undefined,
    language: raw.language?.trim().toLowerCase() || undefined,
    category: raw.category?.trim() || undefined,
    products: list(raw.products, 30),
    competitors,
    topics: list(raw.topics, 30),
    queries: list(raw.queries, 50),
    crawl: {
      maxPages: num(c.maxPages, 1, 2000, DEFAULT_CRAWL.maxPages),
      maxDepth: num(c.maxDepth, 0, 15, DEFAULT_CRAWL.maxDepth),
      timeoutMs: num(c.timeoutMs, 2000, 60000, DEFAULT_CRAWL.timeoutMs),
      concurrency: num(c.concurrency, 1, 8, DEFAULT_CRAWL.concurrency),
      delayMs: num(c.delayMs, 0, 10000, DEFAULT_CRAWL.delayMs),
      render: ['auto', 'all', 'off'].includes(c.render) ? c.render : 'auto',
      renderMax: num(c.renderMax, 0, 200, DEFAULT_CRAWL.renderMax),
      includeSubdomains: !!c.includeSubdomains,
      queryParams: ['strip-tracking', 'drop-all', 'keep'].includes(c.queryParams) ? c.queryParams : 'strip-tracking',
      retries: num(c.retries, 0, 5, DEFAULT_CRAWL.retries),
    },
    competitorMaxPages: num(raw.competitorMaxPages, 1, 300, 30),
    visibility: { platforms: list(raw.visibility?.platforms, 10), maxQueries: num(raw.visibility?.maxQueries, 1, 200, 20) },
    llm: { enabled: raw.llm?.enabled ?? !!env.anthropicKey, maxCalls: num(raw.llm?.maxCalls, 0, 500, 12) },
  };
}

/** Versenytárs-bejegyzés → domain kulcs, illetve kezdő URL. */
export const compDomain = (c: string) => hostKey(new URL(toStartUrl(c)).hostname);
export const compStart = (c: string) => toStartUrl(c);

export function estimate(input: SiteAuditInput, adapters: PlatformAdapter[] = defaultAdapters()): CostEstimate {
  const renders = input.crawl.render === 'off' ? 0 : input.crawl.render === 'all' ? Math.min(input.crawl.maxPages, input.crawl.renderMax) : Math.min(input.crawl.renderMax, input.crawl.maxPages);
  const llmOn = input.llm.enabled && !!env.anthropicKey;
  const llmCalls = llmOn ? Math.min(input.llm.maxCalls, 8 + Math.ceil(Math.min(20, input.visibility.maxQueries) / 10)) : 0;
  const cost = estimateLlmCost(siteEnv.llmModel, llmCalls, 14000, 900);
  const statuses = platformStatuses(adapters, input.visibility.platforms);
  return {
    pages: input.crawl.maxPages,
    renders,
    competitorPages: input.competitors.length * input.competitorMaxPages,
    llmCalls,
    llmInputTokens: cost.inTok,
    llmOutputTokens: cost.outTok,
    llmModel: siteEnv.llmModel,
    llmCostUsd: llmOn ? cost.usd : 0,
    externalQueries: statuses.map((s) => ({ platform: s.name, calls: s.status === 'used' ? input.visibility.maxQueries : 0, configured: s.configured })),
    notes: [
      'Legfeljebb ennyi oldalt kérünk le; a tényleges szám a webhely méretétől függ.',
      `A becslés ${llmOn ? `legfeljebb ${llmCalls} LLM-hívással (≈4 karakter/token) számol; a tényleges költség a futás után látható` : 'LLM nélkül készült: az LLM nincs bekapcsolva vagy nincs ANTHROPIC_API_KEY'}.`,
      'A külső AI/search API-k díjait a szolgáltatók árazása határozza meg – ezt itt nem becsüljük.',
    ],
  };
}

export async function runAudit(auditId: string, deps: PipelineDeps = {}): Promise<void> {
  const audit = repo.getAudit(auditId);
  const input = audit.input;
  const ac = new AbortController();
  controllers.set(auditId, ac);
  const policy = deps.policy ?? defaultPolicy();
  const log = (level: 'info' | 'warn' | 'error', msg: string) => repo.log(auditId, level, msg);
  repo.clearAuditData(auditId);
  audit.steps.forEach((s) => Object.assign(s, { status: 'pending', startedAt: undefined, finishedAt: undefined, error: undefined, note: undefined, progress: undefined }));
  repo.updateAudit(auditId, { status: 'running', startedAt: new Date().toISOString(), finishedAt: undefined, error: undefined, partial: true, steps: audit.steps });
  const sources: DataSource[] = [
    { id: 'crawl', label: 'Saját crawler (HTTP)', kind: 'measured', status: 'skipped' },
    { id: 'render', label: 'Headless renderelés', kind: 'measured', status: 'skipped' },
    { id: 'llm', label: `LLM-értékelés (${siteEnv.llmModel})`, kind: 'ai', status: 'skipped' },
    { id: 'competitors', label: 'Versenytárs-crawl', kind: 'observed', status: 'skipped' },
  ];
  const adapters = deps.adapters ?? defaultAdapters();
  for (const s of platformStatuses(adapters, input.visibility.platforms)) sources.push({ id: `platform:${s.id}`, label: s.name, kind: 'external', status: s.status === 'used' ? 'skipped' : s.status, note: s.note });
  repo.setSources(audit, sources);
  const src = (id: string, status: DataSource['status'], note?: string) => {
    const s = sources.find((x) => x.id === id);
    if (s) Object.assign(s, { status, note });
    repo.setSources(audit, sources);
  };
  repo.savePlatforms(adapters.map((a) => ({ id: a.id, name: a.name, kind: a.kind, docs: a.docs })));

  const failed = new Set<string>();
  const step = async <T>(id: string, fn: () => Promise<T> | T, opts: { requires?: string[] } = {}): Promise<T | undefined> => {
    if (ac.signal.aborted) {
      repo.setStep(audit, id, { status: 'skipped', note: 'Megszakítva.' });
      return undefined;
    }
    const missing = (opts.requires ?? []).filter((r) => failed.has(r));
    if (missing.length) {
      failed.add(id);
      repo.setStep(audit, id, { status: 'skipped', note: `Kihagyva: a(z) ${missing.join(', ')} lépés sikertelen.` });
      return undefined;
    }
    repo.setStep(audit, id, { status: 'running', startedAt: new Date().toISOString() });
    try {
      const r = await fn();
      const cur = audit.steps.find((s) => s.id === id);
      repo.setStep(audit, id, { status: cur?.status === 'skipped' ? 'skipped' : 'done', finishedAt: new Date().toISOString() });
      return r;
    } catch (e) {
      failed.add(id);
      const msg = (e as Error).message;
      log('error', `${id}: ${msg}`);
      repo.setStep(audit, id, { status: 'failed', finishedAt: new Date().toISOString(), error: msg.slice(0, 500) });
      return undefined;
    }
  };

  let llm: LlmProvider | undefined;
  let crawl: CrawlResult | undefined;
  let model: SiteModel | undefined;
  let ctx: BusinessContext | undefined;
  let aiBots: AiBotReport | undefined;
  let structured: StructuredReport | undefined;
  let entities: EntityReport | undefined;
  let content: ContentReport | undefined;
  let trust: TrustReport | undefined;
  let links: LinkGraphSummary | undefined;
  let queries: QueryRow[] = [];
  let topics: TopicRow[] = [];
  let gaps: QueryGap[] = [];
  let vis: VisibilitySummary | undefined;
  let responses: AIResponseRow[] = [];
  const comps: SiteSnapshot[] = [];
  const rawIssues: (Issue & { _blocker?: boolean; _business?: number })[] = [];

  await step('validate', () => {
    assertSafeUrl(input.url, policy);
    llm = deps.llm ? deps.llm(input) : input.llm.enabled ? new AnthropicProvider(siteEnv.llmModel, env.anthropicKey || undefined, input.llm.maxCalls) : undefined;
    if (llm && !llm.enabled()) llm = undefined;
    const llmMissingKey = !deps.llm && !env.anthropicKey;
    src('llm', llm ? 'used' : llmMissingKey ? 'not_configured' : 'skipped', llm ? undefined : llmMissingKey ? 'Nincs ANTHROPIC_API_KEY.' : 'Kikapcsolva az audit beállításaiban.');
    log('info', `Audit indul: ${input.url} · max ${input.crawl.maxPages} oldal, mélység ${input.crawl.maxDepth}, renderelés: ${input.crawl.render}`);
  });
  await step('preflight', () => assertPublicHost(new URL(input.url).hostname, policy), { requires: ['validate'] });

  const renderer = input.crawl.render === 'off' ? undefined : deps.renderer ? deps.renderer(CRAWLER_UA) : new Renderer(CRAWLER_UA, env.browserChannel, policy);
  const phaseStep = { robots_sitemap: 'robots_sitemap', crawl: 'crawl', render: 'render' } as const;
  await step(
    'extract',
    async () => {
      repo.setStep(audit, 'extract', { status: 'pending' });
      try {
        crawl = await crawlSite({
          site: 'own',
          startUrl: input.url,
          config: input.crawl,
          policy,
          renderer,
          signal: ac.signal,
          log,
          progress: (done, total) => {
            const cur = audit.steps.find((s) => s.status === 'running' && (s.id === 'crawl' || s.id === 'render'));
            if (cur && (done % 5 === 0 || done === total)) repo.setStep(audit, cur.id, { progress: { done, total } });
          },
          phase: (p, state, note) => {
            const id = phaseStep[p];
            if (state === 'start') repo.setStep(audit, id, { status: 'running', startedAt: new Date().toISOString() });
            else repo.setStep(audit, id, { status: state === 'done' ? 'done' : 'skipped', finishedAt: new Date().toISOString(), note });
          },
        });
      } catch (e) {
        for (const id of ['robots_sitemap', 'crawl', 'render']) {
          const s = audit.steps.find((x) => x.id === id);
          if (s && (s.status === 'running' || s.status === 'pending')) repo.setStep(audit, id, { status: 'failed', error: (e as Error).message });
        }
        failed.add('crawl');
        throw e;
      } finally {
        await renderer?.close();
      }
      repo.setStep(audit, 'extract', { status: 'running', startedAt: new Date().toISOString() });
      model = buildModel(crawl, input.crawl.queryParams);
      src('crawl', 'used', `${crawl.pages.length} URL${crawl.limitReached ? ', oldalkorlát elérve' : ''}`);
      src('render', crawl.renderUnavailable ? 'failed' : input.crawl.render === 'off' ? 'skipped' : 'used', crawl.renderUnavailable ?? (crawl.renderer ? `motor: ${crawl.renderer}` : undefined));
      repo.saveCrawlJob(auditId, 'own', crawl.homeUrl, 'done', crawl.pages.length, { robots: { status: crawl.robots.status, crawlDelay: crawl.robots.crawlDelay }, sitemaps: crawl.sitemaps.files, skipped: crawl.skipped.slice(0, 300), limitReached: crawl.limitReached, renderer: crawl.renderer }, crawl.startedAt, crawl.finishedAt);
      persistPages(auditId, model);
      log('info', `Crawl kész: ${crawl.pages.length} URL, ${model.content.length} indexelhető tartalmi oldal.`);
      if (!model.home || !model.raw(model.home.url)) throw new Error(`A kezdőoldal nem tölthető le (${model.home?.status ?? model.home?.error ?? 'nincs válasz'}).`);
    },
    { requires: ['preflight'] },
  );
  // a crawl-lépések állapota a phase-callbackből jön; ha a crawl elbukott, a további lépések kimaradnak
  if (failed.has('extract')) failed.add('crawl');

  await step('context', () => {
    ctx = detectContext(model!, input);
    repo.saveArtifact(auditId, 'context', ctx);
  }, { requires: ['crawl'] });

  await step('technical', async () => {
    const t = technicalAudit(model!);
    rawIssues.push(...t.issues.list());
    repo.saveArtifact(auditId, 'technical', t.report);
    const bots = await loadBots();
    const a = await aiBotAudit(model!, bots, { policy, timeoutMs: input.crawl.timeoutMs, uaTest: true });
    aiBots = a.report;
    rawIssues.push(...a.issues.list());
    repo.saveArtifact(auditId, 'aibots', a.report);
    const l = linkAudit(model!, ctx!);
    links = l.report;
    rawIssues.push(...l.issues.list());
    repo.saveArtifact(auditId, 'links', l.report);
    repo.saveLinks(auditId, 'own', model!.edges);
  }, { requires: ['context'] });

  await step('structured', () => {
    const s = structuredAudit(model!, ctx);
    structured = s.report;
    rawIssues.push(...s.issues.list());
    repo.saveStructured(auditId, 'own', s.report.records);
    repo.saveArtifact(auditId, 'structured', { ...s.report, records: undefined });
  }, { requires: ['context'] });

  await step('entities', () => {
    const e = entityAudit(model!, ctx!);
    entities = e.report;
    rawIssues.push(...e.issues.list());
    repo.saveEntities(auditId, 'own', e.report.nodes, e.report.edges);
    repo.saveArtifact(auditId, 'entities', e.report);
  }, { requires: ['context'] });

  await step('content', async () => {
    const c = contentAudit(model!, ctx!);
    content = c.report;
    rawIssues.push(...c.issues.list());
    const t = trustAudit(model!, c.report);
    trust = t.report;
    rawIssues.push(...t.issues.list());
    if (llm) {
      const top = c.report.pages.filter((p) => p.kind !== 'legal' && p.kind !== 'contact').slice(0, Math.min(8, Math.floor(input.llm.maxCalls * 0.6)));
      let ok = 0;
      for (const p of top) {
        try {
          const e = model!.best(p.url)!;
          p.llm = await llmPageEval(llm, p.url, e.title ?? '', e.mainText, ctx!.language.value ?? 'hu');
          ok++;
        } catch (err) {
          log('warn', `LLM oldalértékelés (${p.url}): ${(err as Error).message}`);
          if (err instanceof LlmError && ['auth', 'budget', 'disabled'].includes(err.kind)) break;
        }
      }
      log('info', `LLM oldalértékelés: ${ok}/${top.length} oldal.`);
    }
    repo.saveArtifact(auditId, 'content', c.report);
    repo.saveArtifact(auditId, 'trust', t.report);
  }, { requires: ['context'] });

  await step('queries', async () => {
    queries = generateQueries(ctx!, input);
    answerability(model!, ctx!, queries);
    if (llm) await llmRefineQueries(llm, model!, ctx!, queries, log);
    rawIssues.push(...queryIssues('own', queries).list());
    log('info', `${queries.length} kérdés, Answer Coverage Score: ${coverageScore(queries) ?? '—'}`);
  }, { requires: ['context'] });

  await step('competitors', async () => {
    if (!input.competitors.length) {
      repo.setStep(audit, 'competitors', { status: 'skipped', note: 'Nincs megadott key competitor.' });
      return;
    }
    src('competitors', 'used');
    for (const entry of input.competitors) {
      const domain = compDomain(entry);
      if (ac.signal.aborted) break;
      log('info', `Versenytárs-crawl: ${domain}`);
      try {
        const cr = await crawlSite({ site: domain, startUrl: compStart(entry), config: { ...input.crawl, maxPages: input.competitorMaxPages, render: 'off', concurrency: Math.min(2, input.crawl.concurrency) }, policy, signal: ac.signal, log: (l, m) => log(l, `[${domain}] ${m}`) });
        const cm = buildModel(cr, input.crawl.queryParams);
        const cctx = detectContext(cm, { ...input, products: [], topics: [], competitors: [], queries: [] });
        const cc = contentAudit(cm, cctx, 40);
        const cs = structuredAudit(cm, cctx);
        const ct = trustAudit(cm, cc.report);
        comps.push({ domain, model: cm, content: cc.report, structured: cs.report, trust: ct.report });
        competitorAnswerability(cm, domain, queries, ctx!.language.value);
        persistPages(auditId, cm, true);
        repo.saveCrawlJob(auditId, domain, cr.homeUrl, 'done', cr.pages.length, { limitReached: cr.limitReached }, cr.startedAt, cr.finishedAt);
      } catch (e) {
        log('warn', `Versenytárs (${domain}) crawl sikertelen: ${(e as Error).message}`);
        comps.push({ domain, error: (e as Error).message });
        repo.saveCrawlJob(auditId, domain, compStart(entry), 'failed', 0, { error: (e as Error).message });
      }
    }
  }, { requires: ['queries'] });

  await step('visibility', async () => {
    const own: TrackedDomain = { domain: model!.crawl.rootHost, names: ctx!.brandVariants.filter((n) => n.length >= 3), isOwn: true };
    const tracked: TrackedDomain[] = [own, ...input.competitors.map(compDomain).map((d) => ({ domain: d, names: comps.find((c) => c.domain === d)?.model ? detectContext(comps.find((c) => c.domain === d)!.model!, { ...input, products: [], topics: [], queries: [], competitors: [] }).brandVariants.slice(0, 2) : [], isOwn: false }))];
    const r = await runVisibility({
      adapters,
      selected: input.visibility.platforms,
      queries,
      maxQueries: input.visibility.maxQueries,
      tracked,
      country: input.country,
      language: ctx!.language.value ?? undefined,
      log,
      progress: (done, total) => repo.setStep(audit, 'visibility', { progress: { done, total } }),
    });
    vis = r.summary;
    responses = r.responses;
    for (const p of r.summary.platforms) src(`platform:${p.id}`, p.status, p.note);
    if (r.summary.state === 'not_configured') repo.setStep(audit, 'visibility', { status: 'skipped', note: 'Nincs konfigurált AI/search API – az AI visibility nem mérhető. A többi elemzés ettől függetlenül teljes.' });
    repo.saveArtifact(auditId, 'visibility', { ...r.summary, suggestedCompetitors: r.suggestedCompetitors });
  }, { requires: ['queries'] });

  await step('citations', () => {
    if (!responses.length) {
      repo.setStep(audit, 'citations', { status: 'skipped', note: 'Nincs AI/search válasz – citation nem dolgozható fel.' });
      return;
    }
    const ownDomain = model!.crawl.rootHost;
    const isDom = (d: string, x: string) => x === d || x.endsWith('.' + d);
    repo.saveResponses(
      auditId,
      responses,
      (d) => ({ isOwn: isDom(ownDomain, d), competitorId: input.competitors.map(compDomain).find((c) => isDom(c, d)) }),
      (qid) => queries.find((q) => q.id === qid)?.topic,
    );
  }, { requires: ['visibility'] });

  await step('compare', () => {
    topics = topicMatrix(model!, ctx!, queries, comps.filter((c) => c.model).map((c) => c.domain));
    gaps = queryGaps(queries, responses, comps, model!.crawl.rootHost);
    const rows = buildCompetitorRows({ domain: model!.crawl.rootHost, model, content, structured, trust }, comps, queries, topics, responses, input.competitors.map(compDomain));
    const ops = opportunities(topics, gaps, rows, new Map());
    repo.saveQueries(auditId, queries, topics);
    repo.saveCompetitors(auditId, rows);
    repo.saveOpportunities(auditId, ops);
    repo.saveArtifact(auditId, 'gaps', gaps);
  }, { requires: ['queries'] });

  let finalIssues: Issue[] = [];
  let score: ReturnType<typeof computeScore> | undefined;
  await step('qa', () => {
    finalIssues = qualityCheck(rawIssues, model!, { limitReached: model!.crawl.limitReached, renderRan: !!model!.rows.some((r) => r.rendered) });
    repo.saveIssues(auditId, finalIssues);
    log('info', `False-positive ellenőrzés után ${finalIssues.length} problémacsoport (a ${rawIssues.length} jelöltből).`);
  }, { requires: ['context'] });

  await step('scoring', () => {
    score = computeScore({ model: model!, issues: finalIssues, content, structured, trust, entities, aiBots, links, queries, topics, visibility: vis, orgDetected: !!ctx?.organization.value, offeringsDetected: !!ctx?.offerings.value.length });
    repo.saveScores(auditId, 'own', score.components);
    repo.saveArtifact(auditId, 'score', score);
  }, { requires: ['qa'] });

  await step('recommendations', () => {
    const recs = buildRecommendations(finalIssues, model!, ctx!, { links: links?.suggestions ?? [], queries, topics, gaps, aiBots });
    repo.saveRecommendations(auditId, recs);
    const tasks = buildBacklog(finalIssues, recs);
    repo.saveTasks(auditId, tasks);
    log('info', `${recs.length} javaslat, ${tasks.length} fejlesztői feladat.`);
  }, { requires: ['qa'] });

  await step('report', () => {
    if (score && ctx) {
      const summary = executiveSummary({
        score,
        issues: finalIssues,
        ctx,
        opportunities: repo.listOpportunities(auditId),
        sources: sources.map((s) => ({ label: s.label, status: s.status, note: s.note })),
        limitReached: !!model?.crawl.limitReached,
        renderNote: model?.crawl.renderUnavailable ? `Renderelés nem futott: ${model.crawl.renderUnavailable}` : undefined,
        pages: model?.rows.length ?? 0,
        topics,
      });
      repo.saveArtifact(auditId, 'summary', summary);
    }
    if (llm) {
      src('llm', 'used', `${llm.usage.calls} hívás (${llm.usage.cached} cache-ből, ${llm.usage.failed} sikertelen), ≈${llm.usage.inputTokens + llm.usage.outputTokens} token, becsült költség ≈ $${llm.usage.costUsd.toFixed(2)}`);
      repo.saveArtifact(auditId, 'llmUsage', llm.usage);
    }
  });

  controllers.delete(auditId);
  const anyFailed = audit.steps.some((s) => s.status === 'failed');
  const crawlFailed = failed.has('crawl') || failed.has('extract');
  repo.updateAudit(auditId, {
    status: ac.signal.aborted ? 'cancelled' : crawlFailed ? 'failed' : anyFailed ? 'partial' : 'done',
    finishedAt: new Date().toISOString(),
    partial: ac.signal.aborted || crawlFailed || anyFailed,
    error: crawlFailed ? audit.steps.find((s) => s.status === 'failed')?.error : undefined,
  });
  log(anyFailed ? 'warn' : 'info', `Audit befejezve: ${ac.signal.aborted ? 'megszakítva' : crawlFailed ? 'sikertelen (crawl)' : anyFailed ? 'részleges (lásd a sikertelen lépéseket)' : 'kész'}.`);
}

function persistPages(auditId: string, m: SiteModel, competitor = false) {
  repo.savePages(auditId, m.rows, (url) => {
    const p = m.crawled.get(url);
    if (!p) return {};
    const e = p.extracted;
    if (competitor) return { raw: e ? { title: e.title, h1: e.headings.find((h) => h.level === 1)?.text, wordCount: e.wordCount, jsonldTypes: e.jsonld.length } : undefined };
    return {
      http: { status: p.status, error: p.error, headers: pick(p.headers, ['content-type', 'x-robots-tag', 'last-modified', 'cache-control', 'server', 'content-length', 'link']), redirects: p.redirects, ttfbMs: p.ttfbMs, bytes: p.bytes, truncated: p.truncated, via: p.via, inSitemap: p.inSitemap, sitemapLastmod: p.sitemapLastmod, robotsBlocked: p.robotsBlocked, attempts: p.attempts, redirectedFrom: p.redirectedFrom },
      raw: e ? { ...e, mainText: e.mainText.slice(0, 30000), passages: e.passages.slice(0, 80), links: e.links.slice(0, 400), images: e.images.slice(0, 100) } : undefined,
      rendered: p.rendered ? { ok: p.rendered.ok, error: p.rendered.error, loadMs: p.rendered.loadMs, blockedRequests: p.rendered.blockedRequests, visibleText: p.rendered.visibleText?.slice(0, 5000), wordCount: p.rendered.extracted?.wordCount, title: p.rendered.extracted?.title, canonical: p.rendered.extracted?.canonical, headings: p.rendered.extracted?.headings.slice(0, 60), jsonld: p.rendered.extracted?.jsonld.length, metaRobots: p.rendered.extracted?.metaRobots } : undefined,
    };
  });
}

const pick = (o: Record<string, string>, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

async function llmRefineQueries(llm: LlmProvider, m: SiteModel, ctx: BusinessContext, queries: QueryRow[], log: (l: 'info' | 'warn' | 'error', s: string) => void) {
  const index = buildPassageIndex(m, ctx.language.value);
  const top = [...queries].sort((a, b) => b.weight - a.weight).slice(0, 20);
  for (let i = 0; i < top.length; i += 10) {
    const batch = top.slice(i, i + 10).map((q) => ({ id: q.id, query: q.text, passages: index.search(q.text, 3).map((h) => ({ url: h.item.url, text: `${h.item.heading} — ${h.item.text}` })) }));
    try {
      const res = await llmJudgeQueries(llm, batch, ctx.language.value ?? 'hu');
      for (const q of top.slice(i, i + 10)) {
        const r = res.get(q.id);
        if (!r) continue;
        q.coverage = r.coverage;
        q.judgedBy = 'llm';
        if (r.url) q.bestUrl = r.url;
        if (r.quote) q.snippet = r.quote;
        q.action = r.coverage === 'full' ? 'none' : r.coverage === 'partial' ? 'improve' : q.bestUrl ? 'improve' : 'new_content';
      }
    } catch (e) {
      log('warn', `LLM kérdés-értékelés: ${(e as Error).message}`);
      if (e instanceof LlmError && ['auth', 'budget', 'disabled'].includes(e.kind)) return;
    }
  }
}
