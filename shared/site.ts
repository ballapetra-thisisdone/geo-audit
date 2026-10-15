// Webhely-szintű GEO audit (v2) közös típusai a szerver és a felület között.
// Minden állításnál jelöljük az adat eredetét (EvidenceKind) és a bizonyosságot (confidence 0–1).

export const METHOD_VERSION = 'site-audit/1.0.0';

/** Az adat eredete – a riportban mindig megjelenik. */
export type EvidenceKind =
  | 'measured' // determinisztikus technikai mérés (HTTP, robots, HTML-elemzés)
  | 'observed' // a crawl során megfigyelt tartalom (heurisztikus értelmezés)
  | 'external' // külső API-ból származó, ténylegesen megfigyelt adat (AI/SERP)
  | 'ai' // LLM-alapú értékelés
  | 'estimate' // algoritmikus becslés
  | 'recommendation' // javaslat
  | 'unverifiable'; // nem ellenőrizhető

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  measured: 'Mért technikai tény',
  observed: 'Crawl alapján megfigyelt',
  external: 'Külső API – megfigyelt',
  ai: 'AI-alapú értékelés',
  estimate: 'Becslés',
  recommendation: 'Ajánlás',
  unverifiable: 'Nem ellenőrizhető',
};

export type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3';
export type EffortLevel = 'S' | 'M' | 'L';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type AuditStatus = 'queued' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled';
export type Owner = 'dev' | 'content' | 'both' | 'business';

export interface CrawlConfig {
  maxPages: number;
  maxDepth: number;
  timeoutMs: number;
  concurrency: number;
  /** Minimális szünet két kérés között ugyanarra a hosztra (ms). A robots.txt Crawl-delay felülírhatja felfelé. */
  delayMs: number;
  /** auto: a fontos oldalakat és a gyanúsan üres oldalakat rendereli; all: mindent (renderMax-ig); off: nincs renderelés */
  render: 'auto' | 'all' | 'off';
  renderMax: number;
  includeSubdomains: boolean;
  /** strip-tracking: utm_*, gclid stb. eltávolítása; drop-all: minden query paraméter eldobása; keep: megtartás */
  queryParams: 'strip-tracking' | 'drop-all' | 'keep';
  retries: number;
}

export interface SiteAuditInput {
  url: string;
  country?: string;
  language?: string;
  category?: string;
  products: string[];
  competitors: string[];
  topics: string[];
  queries: string[];
  crawl: CrawlConfig;
  competitorMaxPages: number;
  visibility: { platforms: string[]; maxQueries: number };
  llm: { enabled: boolean; maxCalls: number };
}

export const DEFAULT_CRAWL: CrawlConfig = {
  maxPages: 150,
  maxDepth: 5,
  timeoutMs: 20000,
  concurrency: 4,
  delayMs: 300,
  render: 'auto',
  renderMax: 12,
  includeSubdomains: false,
  queryParams: 'strip-tracking',
  retries: 2,
};

export interface StepState {
  id: string;
  title: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  note?: string;
  progress?: { done: number; total: number };
}

export interface DataSource {
  id: string;
  label: string;
  kind: EvidenceKind;
  status: 'used' | 'not_configured' | 'failed' | 'skipped';
  note?: string;
}

export interface AuditRecord {
  id: string;
  projectId: string;
  domain: string;
  status: AuditStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  input: SiteAuditInput;
  methodVersion: string;
  steps: StepState[];
  dataSources: DataSource[];
  error?: string;
  /** A futtatás vége előtt minden eredmény részleges. */
  partial: boolean;
}

export interface Detected<T> {
  value: T;
  confidence: number;
  source: string;
  evidence?: string[];
}

export interface BusinessContext {
  language: Detected<string | null>;
  organization: Detected<string | null>;
  brandVariants: string[];
  activity: Detected<string | null>;
  offerings: Detected<string[]>;
  audience: Detected<string | null>;
  geo: Detected<string[]>;
  topics: Detected<string[]>;
  importantPages: Detected<string[]>;
  people: Detected<string[]>;
  intents: Detected<string[]>;
  /** Üzletileg fontos, nem kikövetkeztethető adatok – célzott pontosítás kell. */
  clarifications: string[];
}

export type PageClass =
  | 'indexable'
  | 'noindex'
  | 'canonicalized'
  | 'redirect'
  | 'error'
  | 'blocked'
  | 'non_html';

export interface PageRow {
  id: number;
  site: string; // 'own' vagy a versenytárs domainje
  url: string;
  finalUrl?: string;
  status?: number;
  error?: string;
  depth: number;
  discoveredVia: 'seed' | 'link' | 'sitemap' | 'redirect';
  inSitemap: boolean;
  contentType?: string;
  pageClass: PageClass;
  flags: string[]; // thin, duplicate, near_duplicate, orphan, deep, hard_to_discover, js_dependent, low_inlinks
  title?: string;
  h1?: string;
  metaDescription?: string;
  wordCount: number;
  canonical?: string;
  lang?: string;
  inlinks: number;
  outlinks: number;
  rendered: boolean;
  ttfbMs?: number;
  bytes?: number;
  duplicateOf?: string;
  lastModified?: string;
  importance: number;
}

export interface Passage {
  heading: string;
  text: string;
}

export interface ExtractedPage {
  url: string;
  title?: string;
  metaDescription?: string;
  metaRobots: string[];
  xRobotsTag: string[];
  canonical: string[];
  lang?: string;
  hreflang: { lang: string; href: string }[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  headings: { level: number; text: string }[];
  landmarks: Record<string, number>;
  mainText: string;
  wordCount: number;
  passages: Passage[];
  firstParagraph?: string;
  links: { href: string; text: string; internal: boolean; zone: 'nav' | 'header' | 'footer' | 'aside' | 'main'; nofollow: boolean }[];
  images: { src: string; alt: string | null; inMain: boolean; textLikely: boolean }[];
  jsonld: { raw: string; parsed?: unknown; error?: string }[];
  microdata: { type: string; props: Record<string, string[]> }[];
  rdfa: { type: string; props: Record<string, string[]> }[];
  breadcrumb: string[];
  author: { name: string; source: string; url?: string }[];
  datePublished?: string;
  dateModified?: string;
  visibleDates: string[];
  lists: number;
  orderedLists: number;
  tables: number;
  definitionLists: number;
  faqBlocks: number;
  questionHeadings: string[];
  definitions: string[];
  numbers: number;
  examples: number;
  externalRefs: string[];
  iframes: string[];
  videos: number;
  pdfLinks: string[];
  hiddenBlocks: { kind: string; count: number }[];
  contactSignals: { tel: string[]; email: string[]; address: boolean; impressum: boolean; about: boolean; contact: boolean; privacy: boolean };
  socialProfiles: string[];
  textHash: string;
  simhash: string;
  scripts: number;
  generator?: string;
}

export interface Evidence {
  url?: string;
  detail: string;
  snippet?: string;
}

export interface Issue {
  id: string;
  code: string;
  category: IssueCategory;
  title: string;
  priority: PriorityLevel;
  impact: number; // 1–5
  effort: EffortLevel;
  confidence: number; // 0–1
  evidenceKind: EvidenceKind;
  why: string;
  fix: string;
  acceptance: string;
  owner: Owner;
  urls: string[];
  evidence: Evidence[];
  site: string;
  /** Ha a false-positive szűrő módosított rajta. */
  qa?: string;
}

export type IssueCategory =
  | 'crawl'
  | 'indexing'
  | 'ai_access'
  | 'html'
  | 'metadata'
  | 'rendering'
  | 'structured_data'
  | 'content'
  | 'answerability'
  | 'entity'
  | 'trust'
  | 'linking'
  | 'freshness'
  | 'competitor';

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  crawl: 'Feltérképezés',
  indexing: 'Indexelhetőség',
  ai_access: 'AI-crawler hozzáférés',
  html: 'HTML és szemantika',
  metadata: 'Metaadatok',
  rendering: 'Renderelés és JS',
  structured_data: 'Strukturált adat',
  content: 'Tartalom',
  answerability: 'Megválaszolhatóság',
  entity: 'Entitások',
  trust: 'Bizalom (E-E-A-T)',
  linking: 'Belső linkelés',
  freshness: 'Frissesség',
  competitor: 'Versenytárs',
};

export type RecType =
  | 'title'
  | 'meta_description'
  | 'h1'
  | 'heading_outline'
  | 'answer_block'
  | 'faq'
  | 'jsonld'
  | 'internal_link'
  | 'content_brief'
  | 'entity_description'
  | 'author_bio'
  | 'html'
  | 'robots';

export interface Recommendation {
  id: string;
  issueId?: string;
  type: RecType;
  url?: string;
  title: string;
  original?: string;
  proposed: string;
  lang?: string; // kódnyelv: html, json, text
  rationale: string;
  evidence: Evidence[];
  confidence: number;
  /** tested: automatikusan validált (pl. JSON.parse + séma-ellenőrzés); unverified: ellenőrizetlen minta; template: kitöltendő sablon */
  validation: 'tested' | 'unverified' | 'template';
  validationNote?: string;
  priority: PriorityLevel;
  origin: 'rule' | 'llm';
}

export interface ScoreComponent {
  id: string;
  label: string;
  score: number | null;
  max: number;
  weight: number;
  confidence: number;
  explanation: string;
  method: string;
  source: EvidenceKind;
  evidence: Evidence[];
  urls: string[];
  /** insufficient: nincs elég adat – nem nulla pont, kimarad a súlyozásból. */
  status: 'ok' | 'insufficient' | 'not_measured';
}

export interface GeoScore {
  overall: number | null;
  measuredWeightShare: number;
  confidence: number;
  components: ScoreComponent[];
  note: string;
}

export interface EntityNode {
  id: string;
  type: string;
  name: string;
  variants: string[];
  urls: string[];
  confidence: number;
  evidenceKind: EvidenceKind;
  inSchema: boolean;
  description?: string;
  sameAs: string[];
}

export interface EntityEdge {
  from: string;
  to: string;
  type: string;
  urls: string[];
  evidenceKind: EvidenceKind;
}

export interface StructuredDataRecord {
  url: string;
  format: 'json-ld' | 'microdata' | 'rdfa';
  types: string[];
  syntaxValid: boolean;
  errors: string[];
  warnings: string[];
  richResults: { type: string; eligibleType: boolean; missingRequired: string[]; missingRecommended: string[]; note?: string }[];
  visibilityMismatches: string[];
  raw: string;
}

export type QueryType =
  | 'informational'
  | 'definitional'
  | 'how_to'
  | 'comparison'
  | 'commercial'
  | 'transactional'
  | 'navigational'
  | 'problem_solving'
  | 'expert'
  | 'local';

export const QUERY_TYPE_LABEL: Record<QueryType, string> = {
  informational: 'Információs',
  definitional: 'Definíciós',
  how_to: 'How-to',
  comparison: 'Összehasonlító',
  commercial: 'Kereskedelmi',
  transactional: 'Tranzakciós',
  navigational: 'Navigációs',
  problem_solving: 'Problémamegoldó',
  expert: 'Szakértői',
  local: 'Lokális',
};

export type Coverage = 'full' | 'partial' | 'missing';

export interface QueryRow {
  id: string;
  text: string;
  type: QueryType;
  branded: boolean;
  topic: string;
  cluster: string;
  weight: number;
  origin: 'user' | 'generated' | 'llm';
  /** A generált kérdés hipotézis, amíg keresési adat nem támasztja alá. */
  hypothesis: boolean;
  coverage: Coverage;
  bestUrl?: string;
  matchScore: number;
  snippet?: string;
  hasEvidence: boolean;
  specificity: 'high' | 'medium' | 'low';
  contradiction?: string;
  action: 'none' | 'improve' | 'new_content';
  judgedBy: 'lexical' | 'llm';
  competitors: { domain: string; coverage: Coverage; url?: string }[];
}

export interface TopicRow {
  id: string;
  label: string;
  terms: string[];
  ownUrls: string[];
  coverage: Coverage;
  depthWords: number;
  queryCount: number;
  missingQueries: string[];
  competitorCoverage: { domain: string; coverage: Coverage; urls: string[] }[];
  recommendation: string;
}

export type CompetitorType = 'direct' | 'indirect' | 'serp' | 'ai_search' | 'content';

export const COMPETITOR_TYPE_LABEL: Record<CompetitorType, string> = {
  direct: 'Direct',
  indirect: 'Indirect',
  serp: 'SERP',
  ai_search: 'AI Search',
  content: 'Content',
};

export interface CompetitorRow {
  id: string;
  domain: string;
  types: CompetitorType[];
  source: 'user' | 'serp' | 'ai';
  confirmed: boolean;
  crawlStatus: 'pending' | 'done' | 'failed' | 'skipped';
  error?: string;
  pages: number;
  metrics: Record<string, number | null>;
  strengths: string[];
  weaknesses: string[];
  topics: string[];
  seenInQueries: number;
  citedUrls: string[];
}

export interface PlatformStatus {
  id: string;
  name: string;
  kind: 'ai' | 'serp';
  configured: boolean;
  status: 'used' | 'not_configured' | 'failed' | 'skipped';
  note?: string;
  docs: string;
}

export interface AIResponseRow {
  id: string;
  queryId: string;
  query: string;
  platform: string;
  at: string;
  excerpt: string;
  mentions: string[]; // domainek/márkák, amelyek szövegesen szerepelnek
  citations: { url: string; domain: string; title?: string }[];
  method: string;
  confidence: number;
  source: EvidenceKind;
  error?: string;
}

export interface VisibilityMetric {
  domain: string;
  isOwn: boolean;
  mentions: number;
  citations: number;
  queriesWithMention: number;
  queriesWithCitation: number;
  mentionShare: number | null;
  citationShare: number | null;
}

export interface VisibilitySummary {
  measured: boolean;
  state: 'measured' | 'not_configured' | 'no_data' | 'failed';
  platforms: PlatformStatus[];
  queryCount: number;
  responseCount: number;
  metrics: VisibilityMetric[];
  methodology: string;
}

export interface QueryGap {
  id: string;
  query: string;
  topic: string;
  intent: QueryType;
  competitor: string;
  competitorUrl?: string;
  competitorTraits: string[];
  ownUrl?: string;
  ownGap: string;
  suggestion: string;
  impact: number;
  effort: EffortLevel;
  confidence: number;
  priority: PriorityLevel;
  basis: 'observed_citation' | 'serp' | 'content_inferred';
}

export interface Opportunity {
  id: string;
  title: string;
  competitor?: string;
  competitorSide: string[];
  ownSide: string[];
  action: string;
  expectedImpact: string;
  uncertainty: string;
  priority: PriorityLevel;
  urls: string[];
}

export interface DeveloperTask {
  id: string;
  title: string;
  description: string;
  priority: PriorityLevel;
  impact: number;
  effort: EffortLevel;
  owner: Owner;
  urls: string[];
  technical: string;
  acceptance: string[];
  dependencies: string[];
  issueIds: string[];
  recommendationIds: string[];
}

export interface LinkSuggestion {
  from: string;
  to: string;
  anchor: string;
  reason: string;
  score: number;
}

export interface LinkGraphSummary {
  hubs: { url: string; inlinks: number; rank: number }[];
  orphans: string[];
  lowInlinks: string[];
  deep: { url: string; depth: number }[];
  broken: { from: string; to: string; status?: number }[];
  genericAnchors: { from: string; to: string; anchor: string }[];
  suggestions: LinkSuggestion[];
  clusters: { label: string; urls: string[] }[];
}

export interface AiBotRow {
  token: string;
  name: string;
  owner: string;
  purpose: string;
  allowedHome: boolean | null;
  rule?: string;
  specificGroup: boolean;
  blockedSample: string[];
  consequence: string;
  docs: string;
}

export interface CostEstimate {
  pages: number;
  renders: number;
  competitorPages: number;
  llmCalls: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmModel: string;
  llmCostUsd: number | null;
  externalQueries: { platform: string; calls: number; configured: boolean }[];
  notes: string[];
}

export interface AuditBundle {
  audit: AuditRecord;
  context?: BusinessContext;
  score?: GeoScore;
  summary?: ExecutiveSummary;
  counts: Record<string, number>;
}

export interface ExecutiveSummary {
  headline: string;
  findings: string[];
  strengths: string[];
  critical: string[];
  opportunities: string[];
  limits: string[];
}
