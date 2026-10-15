import type {
  AIResponseRow, AuditRecord, BusinessContext, CompetitorRow, CostEstimate, DeveloperTask, ExecutiveSummary, GeoScore, Issue, LinkGraphSummary, Opportunity,
  PageRow, PlatformStatus, QueryGap, QueryRow, Recommendation, SiteAuditInput, StructuredDataRecord, TopicRow, VisibilitySummary, EntityNode, EntityEdge, AiBotRow, CrawlConfig,
} from '../../../shared/site';

async function req<T>(method: string, url: string, body?: unknown, retry = method === 'GET'): Promise<T> {
  const res = await fetch(url, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  // az API újraindulásakor (pl. fejlesztés közben) a proxy 502/503-at ad – egyszer újrapróbáljuk
  if (retry && (res.status === 502 || res.status === 503)) {
    await new Promise((r) => setTimeout(r, 2000));
    return req<T>(method, url, body, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface SiteMeta {
  methodVersion: string;
  defaults: { crawl: CrawlConfig; competitorMaxPages: number; visibility: { maxQueries: number }; llm: { maxCalls: number } };
  llm: { configured: boolean; model: string; env: string };
  platforms: (PlatformStatus & { env: string })[];
}

export interface AuditListItem {
  id: string;
  domain: string;
  status: AuditRecord['status'];
  createdAt: string;
  finishedAt?: string;
  partial: boolean;
  score: number | null;
  competitors: number;
}

export interface AuditDetail {
  audit: AuditRecord;
  context?: BusinessContext;
  score?: GeoScore;
  summary?: ExecutiveSummary;
  llmUsage?: { calls: number; cached: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number };
  counts: Record<string, number>;
}

export interface TechnicalPayload {
  technical?: {
    statusCounts: Record<string, number>;
    classCounts: Record<string, number>;
    renderComparisons: { url: string; rawWords: number; renderedWords: number; titleDiffers: boolean; canonicalDiffers: boolean; jsonldRaw: number; jsonldRendered: number; hiddenBlocks: { kind: string; count: number }[]; visibleWords?: number }[];
    hiddenContent: { url: string; kind: string; count: number }[];
    sitemapFiles: { url: string; status?: number; type: string; urls: number; error?: string }[];
    robots: { url: string; status?: number; present: boolean; crawlDelay?: number; sitemaps: string[]; text?: string };
    skipped: number;
    limitReached: boolean;
    renderer?: string;
    renderUnavailable?: string;
  };
  aiBots?: { rows: AiBotRow[]; uaTests: { bot: string; status?: number; bytes?: number; challenge?: string; error?: string; sameAsBrowser: boolean | null }[]; note: string };
  links?: LinkGraphSummary;
}

export interface ContentPageEval {
  url: string;
  kind: string;
  topic: string;
  words: number;
  signals: Record<string, unknown> & { answerFirst: boolean; firstParagraph?: string; authors: string[]; ageDays: number | null };
  scores: Record<string, number | null>;
  citationPotential: number;
  strengths: string[];
  missing: string[];
  llm?: { summary: string; mainQuestion: string; answered: string; missing: string[]; claimsWithoutEvidence: string[] };
}

export interface TrustSignal {
  id: string;
  label: string;
  group: string;
  present: boolean | null;
  evidence: { url?: string; detail: string; snippet?: string }[];
  kind: string;
  note?: string;
}

export interface PageDetail {
  row: PageRow;
  snapshots: { http?: Record<string, unknown>; raw?: Record<string, unknown>; rendered?: Record<string, unknown> };
  issues: { id: string; title: string; priority: string; category: string; evidence: { url?: string; detail: string }[] }[];
  recommendations: Recommendation[];
  structured: StructuredDataRecord[];
  links: { inbound: { url: string; anchor: string; zone: string }[]; outbound: { url: string; anchor: string; zone: string }[] };
  content?: ContentPageEval;
  queries: { id: string; text: string; coverage: string }[];
}

const b = (id: string) => `/api/v2/audits/${encodeURIComponent(id)}`;

export const siteApi = {
  meta: () => req<SiteMeta>('GET', '/api/v2/meta'),
  estimate: (input: Partial<SiteAuditInput>) => req<CostEstimate>('POST', '/api/v2/estimate', input),
  create: (input: Partial<SiteAuditInput>) => req<{ id: string }>('POST', '/api/v2/audits', input),
  list: () => req<AuditListItem[]>('GET', '/api/v2/audits'),
  get: (id: string) => req<AuditDetail>('GET', b(id)),
  logs: (id: string, after: number) => req<{ id: number; t: string; level: string; msg: string }[]>('GET', `${b(id)}/logs?after=${after}`),
  cancel: (id: string) => req('POST', `${b(id)}/cancel`),
  rerun: (id: string) => req('POST', `${b(id)}/rerun`),
  remove: (id: string) => req('DELETE', b(id)),
  pages: (id: string, q: Record<string, string>) => req<{ total: number; rows: PageRow[] }>('GET', `${b(id)}/pages?${new URLSearchParams(q)}`),
  page: (id: string, pageId: number) => req<PageDetail>('GET', `${b(id)}/pages/${pageId}`),
  issues: (id: string) => req<Issue[]>('GET', `${b(id)}/issues`),
  recommendations: (id: string) => req<Recommendation[]>('GET', `${b(id)}/recommendations`),
  backlog: (id: string) => req<DeveloperTask[]>('GET', `${b(id)}/backlog`),
  technical: (id: string) => req<TechnicalPayload>('GET', `${b(id)}/technical`),
  content: (id: string) => req<{ content?: { pages: ContentPageEval[]; averages: Record<string, number | null>; note: string }; trust?: { signals: TrustSignal[]; note: string }; topics: TopicRow[] }>('GET', `${b(id)}/content`),
  entities: (id: string) => req<{ nodes: EntityNode[]; edges: EntityEdge[]; nameVariants: { name: string; sources: string[] }[]; note: string } | null>('GET', `${b(id)}/entities`),
  structured: (id: string) => req<{ summary?: { typeCounts: Record<string, number>; pagesWithSd: number; pagesTotal: number; orgNodes: { url: string; name?: string; telephone?: string; address?: string }[]; note: string }; records: StructuredDataRecord[] }>('GET', `${b(id)}/structured`),
  queries: (id: string) => req<{ queries: QueryRow[]; topics: TopicRow[] }>('GET', `${b(id)}/queries`),
  visibility: (id: string) => req<{ summary: (VisibilitySummary & { suggestedCompetitors?: { domain: string; kind: string; queries: number; urls: string[] }[] }) | null; responses: AIResponseRow[]; sources: { domain: string; n: number; own: number; competitor: string | null; topics: string | null }[] }>('GET', `${b(id)}/visibility`),
  competitors: (id: string) => req<{ competitors: CompetitorRow[]; gaps: QueryGap[]; opportunities: Opportunity[] }>('GET', `${b(id)}/competitors`),
  exportUrl: (id: string, kind: 'json' | 'html' | string) => (kind === 'json' ? `${b(id)}/export.json` : kind === 'html' ? `${b(id)}/report.html` : `${b(id)}/export/${kind}.csv`),
};
