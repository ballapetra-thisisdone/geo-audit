// Adatelérési réteg a site-audit táblákhoz.
import crypto from 'node:crypto';
import type {
  AIResponseRow, AuditRecord, AuditStatus, CompetitorRow, DataSource, DeveloperTask, EntityEdge, EntityNode, Issue, Opportunity, PageRow,
  QueryRow, Recommendation, ScoreComponent, SiteAuditInput, StepState, StructuredDataRecord, TopicRow,
} from '../../shared/site.ts';
import { METHOD_VERSION } from '../../shared/site.ts';
import { getDb, j, pj, tx } from './db.ts';
import { hostKey } from './crawl/url.ts';

export const STEPS: { id: string; title: string }[] = [
  { id: 'validate', title: '1. Input validálása' },
  { id: 'preflight', title: '2. Domain-ellenőrzés (DNS, SSRF-védelem, elérhetőség)' },
  { id: 'robots_sitemap', title: '3. robots.txt és sitemap feldolgozása' },
  { id: 'crawl', title: '4. Crawl' },
  { id: 'render', title: '5. Renderelés (headless böngésző)' },
  { id: 'extract', title: '6–7. HTML, metaadat és tartalomkinyerés' },
  { id: 'context', title: 'Üzleti kontextus felismerése' },
  { id: 'technical', title: 'Technikai és AI-crawler audit' },
  { id: 'structured', title: '8. Strukturált adat elemzés' },
  { id: 'entities', title: '9. Entitások és kapcsolatok' },
  { id: 'content', title: '10. Tartalmi GEO elemzés' },
  { id: 'queries', title: '11. Query-k generálása, klaszterezése, megválaszolhatóság' },
  { id: 'competitors', title: '12. Key competitor elemzés' },
  { id: 'visibility', title: '13. AI/search vizsgálat' },
  { id: 'citations', title: '14. Citation és source URL feldolgozás' },
  { id: 'compare', title: '15. Saját oldal és competitorok összehasonlítása' },
  { id: 'qa', title: '17–18. False positive ellenőrzés és prioritás (a pontozás előtt fut, mert arra épül)' },
  { id: 'scoring', title: '16. Scoring' },
  { id: 'recommendations', title: '19. Ajánlások és fejlesztői feladatok' },
  { id: 'report', title: '20. Riport és export' },
];

const now = () => new Date().toISOString();
const newId = () => crypto.randomBytes(6).toString('hex');

export function ensureProject(host: string): { projectId: string; domainId: string } {
  const db = getDb();
  const user = 'local';
  db.prepare('INSERT OR IGNORE INTO users(id, email, name, created_at) VALUES (?,?,?,?)').run(user, null, 'Helyi felhasználó', now());
  const key = hostKey(host);
  let row = db.prepare("SELECT p.id pid, d.id did FROM domains d JOIN projects p ON p.id = d.project_id WHERE d.host = ? AND d.role = 'own'").get(key) as { pid: string; did: string } | undefined;
  if (!row) {
    const pid = newId();
    const did = newId();
    tx(db, () => {
      db.prepare('INSERT INTO projects(id, user_id, name, created_at) VALUES (?,?,?,?)').run(pid, user, key, now());
      db.prepare("INSERT INTO domains(id, project_id, host, role, created_at) VALUES (?,?,?,'own',?)").run(did, pid, key, now());
    });
    row = { pid, did };
  }
  return { projectId: row.pid, domainId: row.did };
}

export function addCompetitorDomains(projectId: string, hosts: string[]) {
  const db = getDb();
  for (const h of hosts) {
    const host = hostKey(new URL(/^https?:\/\//i.test(h) ? h : `https://${h}`).hostname);
    db.prepare("INSERT OR IGNORE INTO domains(id, project_id, host, role, created_at) VALUES (?,?,?,'competitor',?)").run(newId(), projectId, host, now());
  }
}

export function createAudit(input: SiteAuditInput): AuditRecord {
  const host = new URL(input.url).hostname;
  const { projectId, domainId } = ensureProject(host);
  addCompetitorDomains(projectId, input.competitors);
  const id = `${hostKey(host).replace(/[^a-z0-9]+/g, '-')}-${newId()}`;
  const steps: StepState[] = STEPS.map((s) => ({ id: s.id, title: s.title, status: 'pending' }));
  const audit: AuditRecord = { id, projectId, domain: hostKey(host), status: 'queued', createdAt: now(), input, methodVersion: METHOD_VERSION, steps, dataSources: [], partial: true };
  getDb()
    .prepare('INSERT INTO audits(id, project_id, domain_id, status, created_at, method_version, input, steps, data_sources, partial) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(id, projectId, domainId, audit.status, audit.createdAt, METHOD_VERSION, j(input), j(steps), j([]));
  return audit;
}

type AuditRow = { id: string; project_id: string; status: AuditStatus; created_at: string; started_at: string | null; finished_at: string | null; method_version: string; input: string; steps: string; data_sources: string; error: string | null; partial: number; host: string };

function toAudit(r: AuditRow): AuditRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    domain: r.host,
    status: r.status,
    createdAt: r.created_at,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    input: pj(r.input, {} as SiteAuditInput),
    methodVersion: r.method_version,
    steps: pj(r.steps, []),
    dataSources: pj(r.data_sources, []),
    error: r.error ?? undefined,
    partial: !!r.partial,
  };
}

const AUDIT_SEL = 'SELECT a.*, d.host FROM audits a JOIN domains d ON d.id = a.domain_id';

export function getAudit(id: string): AuditRecord {
  const r = getDb().prepare(`${AUDIT_SEL} WHERE a.id = ?`).get(id) as AuditRow | undefined;
  if (!r) throw Object.assign(new Error('Nincs ilyen audit.'), { statusCode: 404 });
  return toAudit(r);
}

export function listAudits(): AuditRecord[] {
  return (getDb().prepare(`${AUDIT_SEL} ORDER BY a.created_at DESC LIMIT 200`).all() as AuditRow[]).map(toAudit);
}

export function updateAudit(id: string, p: Partial<Pick<AuditRecord, 'status' | 'startedAt' | 'finishedAt' | 'steps' | 'dataSources' | 'error' | 'partial'>>) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const map: Record<string, [string, (v: unknown) => string | number | null]> = {
    status: ['status', (v) => v as string],
    startedAt: ['started_at', (v) => (v as string) ?? null],
    finishedAt: ['finished_at', (v) => (v as string) ?? null],
    steps: ['steps', (v) => j(v)],
    dataSources: ['data_sources', (v) => j(v)],
    error: ['error', (v) => (v as string) ?? null],
    partial: ['partial', (v) => (v ? 1 : 0)],
  };
  for (const [k, v] of Object.entries(p)) {
    const m = map[k];
    if (!m) continue;
    sets.push(`${m[0]} = ?`);
    vals.push(m[1](v));
  }
  if (sets.length) getDb().prepare(`UPDATE audits SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

export function deleteAudit(id: string) {
  getDb().prepare('DELETE FROM audits WHERE id = ?').run(id);
}

/** Újrafuttatás előtt az audit minden származtatott adatát töröljük (idempotens pipeline). */
export function clearAuditData(id: string) {
  const db = getDb();
  tx(db, () => {
    for (const t of ['crawl_jobs', 'pages', 'links', 'issues', 'recommendations', 'scores', 'entities', 'entity_relationships', 'structured_data_records', 'topics', 'query_clusters', 'queries', 'competitors', 'ai_responses', 'source_urls', 'citations', 'opportunities', 'developer_tasks', 'audit_evidence', 'artifacts']) {
      db.prepare(`DELETE FROM ${t} WHERE audit_id = ?`).run(id);
    }
  });
}

export function log(id: string, level: 'info' | 'warn' | 'error', msg: string) {
  getDb().prepare('INSERT INTO audit_logs(audit_id, t, level, msg) VALUES (?,?,?,?)').run(id, now(), level, msg.slice(0, 2000));
}

export function getLogs(id: string, after = 0) {
  return getDb().prepare('SELECT id, t, level, msg FROM audit_logs WHERE audit_id = ? AND id > ? ORDER BY id LIMIT 500').all(id, after) as { id: number; t: string; level: string; msg: string }[];
}

export function saveArtifact(id: string, key: string, data: unknown) {
  getDb().prepare('INSERT OR REPLACE INTO artifacts(audit_id, key, data) VALUES (?,?,?)').run(id, key, j(data));
}

export function getArtifact<T>(id: string, key: string): T | undefined {
  const r = getDb().prepare('SELECT data FROM artifacts WHERE audit_id = ? AND key = ?').get(id, key) as { data: string } | undefined;
  return r ? pj<T>(r.data, undefined as T) : undefined;
}

export function saveCrawlJob(id: string, site: string, root: string, status: string, pages: number, data: unknown, startedAt?: string, finishedAt?: string) {
  getDb().prepare('INSERT INTO crawl_jobs(audit_id, site, root_url, status, started_at, finished_at, pages, data) VALUES (?,?,?,?,?,?,?,?)').run(id, site, root, status, startedAt ?? null, finishedAt ?? null, pages, j(data));
}

export function savePages(id: string, rows: PageRow[], snapshots: (url: string) => Record<string, unknown>) {
  const db = getDb();
  tx(db, () => {
    const ins = db.prepare('INSERT OR REPLACE INTO pages(audit_id, site, url, status, page_class, depth, word_count, importance, data) VALUES (?,?,?,?,?,?,?,?,?)');
    const snap = db.prepare('INSERT OR REPLACE INTO page_snapshots(page_id, kind, data, created_at) VALUES (?,?,?,?)');
    for (const r of rows) {
      const res = ins.run(id, r.site, r.url, r.status ?? null, r.pageClass, r.depth, r.wordCount, r.importance, j(r));
      const pageId = Number(res.lastInsertRowid);
      for (const [kind, data] of Object.entries(snapshots(r.url))) if (data !== undefined) snap.run(pageId, kind, j(data), now());
    }
  });
}

export function listPages(id: string, f: { site?: string; cls?: string; flag?: string; q?: string; limit?: number; offset?: number } = {}) {
  const where = ['audit_id = ?'];
  const vals: (string | number)[] = [id];
  if (f.site) {
    where.push('site = ?');
    vals.push(f.site);
  }
  if (f.cls) {
    where.push('page_class = ?');
    vals.push(f.cls);
  }
  if (f.q) {
    where.push('url LIKE ?');
    vals.push(`%${f.q}%`);
  }
  if (f.flag) {
    where.push('data LIKE ?');
    vals.push(`%"${f.flag}"%`);
  }
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) n FROM pages WHERE ${where.join(' AND ')}`).get(...vals) as { n: number }).n;
  const rows = db.prepare(`SELECT id, data FROM pages WHERE ${where.join(' AND ')} ORDER BY importance DESC, depth ASC LIMIT ? OFFSET ?`).all(...vals, f.limit ?? 200, f.offset ?? 0) as { id: number; data: string }[];
  return { total, rows: rows.map((r) => ({ ...pj<PageRow>(r.data, {} as PageRow), id: r.id })) };
}

export function getPage(id: string, pageId: number) {
  const db = getDb();
  const r = db.prepare('SELECT id, data FROM pages WHERE audit_id = ? AND id = ?').get(id, pageId) as { id: number; data: string } | undefined;
  if (!r) throw Object.assign(new Error('Nincs ilyen oldal.'), { statusCode: 404 });
  const snaps = db.prepare('SELECT kind, data FROM page_snapshots WHERE page_id = ?').all(pageId) as { kind: string; data: string }[];
  return { row: { ...pj<PageRow>(r.data, {} as PageRow), id: r.id }, snapshots: Object.fromEntries(snaps.map((s) => [s.kind, pj(s.data, null)])) };
}

export function saveLinks(id: string, site: string, edges: { from: string; to: string; anchor: string; zone: string; nofollow: boolean }[]) {
  const db = getDb();
  tx(db, () => {
    const st = db.prepare('INSERT INTO links(audit_id, site, from_url, to_url, anchor, zone, nofollow) VALUES (?,?,?,?,?,?,?)');
    for (const e of edges.slice(0, 50000)) st.run(id, site, e.from, e.to, e.anchor.slice(0, 200), e.zone, e.nofollow ? 1 : 0);
  });
}

export function linksFor(id: string, url: string) {
  const db = getDb();
  return {
    inbound: db.prepare("SELECT from_url url, anchor, zone FROM links WHERE audit_id = ? AND site = 'own' AND to_url = ? LIMIT 200").all(id, url),
    outbound: db.prepare("SELECT to_url url, anchor, zone FROM links WHERE audit_id = ? AND site = 'own' AND from_url = ? LIMIT 300").all(id, url),
  };
}

export function saveIssues(id: string, issues: Issue[]) {
  const db = getDb();
  tx(db, () => {
    const st = db.prepare('INSERT OR REPLACE INTO issues(id, audit_id, site, code, category, priority, data) VALUES (?,?,?,?,?,?,?)');
    const evs = db.prepare('INSERT INTO audit_evidence(audit_id, ref_type, ref_id, url, kind, detail, snippet) VALUES (?,?,?,?,?,?,?)');
    for (const i of issues) {
      st.run(i.id, id, i.site, i.code, i.category, i.priority, j(i));
      for (const e of i.evidence) evs.run(id, 'issue', i.id, e.url ?? null, i.evidenceKind, e.detail, e.snippet ?? null);
    }
  });
}

export function listIssues(id: string): Issue[] {
  return (getDb().prepare("SELECT data FROM issues WHERE audit_id = ? ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END").all(id) as { data: string }[]).map((r) => pj<Issue>(r.data, {} as Issue));
}

export function saveRecommendations(id: string, recs: Recommendation[]) {
  const db = getDb();
  tx(db, () => {
    const st = db.prepare('INSERT OR REPLACE INTO recommendations(id, audit_id, issue_id, type, url, priority, data) VALUES (?,?,?,?,?,?,?)');
    for (const r of recs) st.run(r.id, id, r.issueId ?? null, r.type, r.url ?? null, r.priority, j(r));
  });
}

export function listRecommendations(id: string): Recommendation[] {
  return (getDb().prepare('SELECT data FROM recommendations WHERE audit_id = ? ORDER BY priority, id').all(id) as { data: string }[]).map((r) => pj<Recommendation>(r.data, {} as Recommendation));
}

export function saveScores(id: string, site: string, comps: ScoreComponent[]) {
  const db = getDb();
  tx(db, () => {
    const st = db.prepare('INSERT OR REPLACE INTO scores(audit_id, site, component, score, weight, confidence, data) VALUES (?,?,?,?,?,?,?)');
    for (const c of comps) st.run(id, site, c.id, c.score, c.weight, c.confidence, j(c));
  });
}

export function saveEntities(id: string, site: string, nodes: EntityNode[], edges: EntityEdge[]) {
  const db = getDb();
  tx(db, () => {
    const n = db.prepare('INSERT OR REPLACE INTO entities(id, audit_id, site, type, name, data) VALUES (?,?,?,?,?,?)');
    for (const x of nodes) n.run(x.id, id, site, x.type, x.name, j(x));
    const e = db.prepare('INSERT INTO entity_relationships(audit_id, site, from_id, to_id, type, data) VALUES (?,?,?,?,?,?)');
    for (const x of edges) e.run(id, site, x.from, x.to, x.type, j(x));
  });
}

export function saveStructured(id: string, site: string, records: StructuredDataRecord[]) {
  const db = getDb();
  tx(db, () => {
    const st = db.prepare('INSERT INTO structured_data_records(audit_id, site, url, format, types, valid, data) VALUES (?,?,?,?,?,?,?)');
    for (const r of records) st.run(id, site, r.url, r.format, r.types.join(','), r.syntaxValid && !r.errors.length ? 1 : 0, j(r));
  });
}

export function structuredFor(id: string, url?: string): StructuredDataRecord[] {
  const rows = url
    ? getDb().prepare("SELECT data FROM structured_data_records WHERE audit_id = ? AND site = 'own' AND url = ?").all(id, url)
    : getDb().prepare("SELECT data FROM structured_data_records WHERE audit_id = ? AND site = 'own' LIMIT 2000").all(id);
  return (rows as { data: string }[]).map((r) => pj<StructuredDataRecord>(r.data, {} as StructuredDataRecord));
}

export function saveQueries(id: string, queries: QueryRow[], topics: TopicRow[]) {
  const db = getDb();
  tx(db, () => {
    const t = db.prepare('INSERT OR REPLACE INTO topics(id, audit_id, label, data) VALUES (?,?,?,?)');
    for (const x of topics) t.run(x.id, id, x.label, j(x));
    const c = db.prepare('INSERT OR REPLACE INTO query_clusters(id, audit_id, label, topic_id, weight) VALUES (?,?,?,?,?)');
    const clusters = new Map<string, { label: string; w: number }>();
    for (const q of queries) {
      const cur = clusters.get(q.cluster) ?? { label: q.topic, w: 0 };
      cur.w += q.weight;
      clusters.set(q.cluster, cur);
    }
    for (const [cid, v] of clusters) c.run(cid, id, v.label, cid, Math.round(v.w * 100) / 100);
    const q = db.prepare('INSERT OR REPLACE INTO queries(id, audit_id, text, cluster_id, coverage, weight, data) VALUES (?,?,?,?,?,?,?)');
    for (const x of queries) q.run(x.id, id, x.text, x.cluster, x.coverage, x.weight, j(x));
  });
}

export function listQueries(id: string): QueryRow[] {
  return (getDb().prepare('SELECT data FROM queries WHERE audit_id = ? ORDER BY weight DESC').all(id) as { data: string }[]).map((r) => pj<QueryRow>(r.data, {} as QueryRow));
}

export function listTopics(id: string): TopicRow[] {
  return (getDb().prepare('SELECT data FROM topics WHERE audit_id = ?').all(id) as { data: string }[]).map((r) => pj<TopicRow>(r.data, {} as TopicRow));
}

export function saveCompetitors(id: string, rows: CompetitorRow[]) {
  const db = getDb();
  tx(db, () => {
    const st = db.prepare('INSERT OR REPLACE INTO competitors(id, audit_id, domain, source, data) VALUES (?,?,?,?,?)');
    for (const r of rows) st.run(r.id, id, r.domain, r.source, j(r));
  });
}

export function listCompetitors(id: string): CompetitorRow[] {
  return (getDb().prepare('SELECT data FROM competitors WHERE audit_id = ?').all(id) as { data: string }[]).map((r) => pj<CompetitorRow>(r.data, {} as CompetitorRow));
}

export function savePlatforms(platforms: { id: string; name: string; kind: string; docs: string }[]) {
  const st = getDb().prepare('INSERT OR REPLACE INTO ai_platforms(id, name, kind, docs) VALUES (?,?,?,?)');
  for (const p of platforms) st.run(p.id, p.name, p.kind, p.docs);
}

export function saveResponses(id: string, responses: AIResponseRow[], classify: (domain: string) => { isOwn: boolean; competitorId?: string; topic?: string }, topicOf: (queryId: string) => string | undefined) {
  const db = getDb();
  tx(db, () => {
    const r = db.prepare('INSERT OR REPLACE INTO ai_responses(id, audit_id, query_id, platform_id, at, data) VALUES (?,?,?,?,?,?)');
    const c = db.prepare('INSERT INTO citations(audit_id, response_id, kind, url, domain, title, query_id, platform_id) VALUES (?,?,?,?,?,?,?,?)');
    const s = db.prepare('INSERT OR IGNORE INTO source_urls(audit_id, url, domain, topic, competitor_id, is_own) VALUES (?,?,?,?,?,?)');
    for (const x of responses) {
      r.run(x.id, id, x.queryId, x.platform, x.at, j(x));
      for (const ci of x.citations) {
        c.run(id, x.id, 'citation', ci.url, ci.domain, ci.title ?? null, x.queryId, x.platform);
        const k = classify(ci.domain);
        s.run(id, ci.url, ci.domain, topicOf(x.queryId) ?? null, k.competitorId ?? null, k.isOwn ? 1 : 0);
      }
      for (const m of x.mentions) c.run(id, x.id, 'mention', null, m, null, x.queryId, x.platform);
    }
  });
}

export function listResponses(id: string): AIResponseRow[] {
  return (getDb().prepare('SELECT data FROM ai_responses WHERE audit_id = ? ORDER BY query_id, platform_id').all(id) as { data: string }[]).map((r) => pj<AIResponseRow>(r.data, {} as AIResponseRow));
}

export function sourceDomains(id: string) {
  return getDb().prepare('SELECT domain, COUNT(*) n, MAX(is_own) own, MAX(competitor_id) competitor, GROUP_CONCAT(DISTINCT topic) topics FROM source_urls WHERE audit_id = ? GROUP BY domain ORDER BY n DESC LIMIT 50').all(id);
}

export function saveOpportunities(id: string, ops: Opportunity[]) {
  const st = getDb().prepare('INSERT OR REPLACE INTO opportunities(id, audit_id, priority, data) VALUES (?,?,?,?)');
  for (const o of ops) st.run(o.id, id, o.priority, j(o));
}

export function listOpportunities(id: string): Opportunity[] {
  return (getDb().prepare('SELECT data FROM opportunities WHERE audit_id = ? ORDER BY priority').all(id) as { data: string }[]).map((r) => pj<Opportunity>(r.data, {} as Opportunity));
}

export function saveTasks(id: string, tasks: DeveloperTask[]) {
  const db = getDb();
  tx(db, () => {
    const st = db.prepare('INSERT OR REPLACE INTO developer_tasks(id, audit_id, priority, data) VALUES (?,?,?,?)');
    for (const t of tasks) st.run(t.id, id, t.priority, j(t));
  });
}

export function listTasks(id: string): DeveloperTask[] {
  return (getDb().prepare('SELECT data FROM developer_tasks WHERE audit_id = ? ORDER BY priority, id').all(id) as { data: string }[]).map((r) => pj<DeveloperTask>(r.data, {} as DeveloperTask));
}

export function setStep(audit: AuditRecord, stepId: string, p: Partial<StepState>) {
  const s = audit.steps.find((x) => x.id === stepId);
  if (!s) return;
  Object.assign(s, p);
  updateAudit(audit.id, { steps: audit.steps });
}

export function setSources(audit: AuditRecord, sources: DataSource[]) {
  audit.dataSources = sources;
  updateAudit(audit.id, { dataSources: sources });
}
