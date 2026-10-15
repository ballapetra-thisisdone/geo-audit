// Közös típusok a szerver és a frontend között.

export type Surface = 'bing' | 'chatgpt' | 'other';
export type TopicId = 'crawl' | 'html' | 'schema' | 'ai' | 'bots' | 'tech' | 'test';
export type Evidence = 'observed' | 'likely' | 'hypothesis' | 'unverifiable';
export type Status = 'pass' | 'warn' | 'fail' | 'info' | 'na' | 'unverifiable';
export type RunnerKind = 'auto' | 'manual' | 'llm';
export type Priority = 'kritikus' | 'magas' | 'közepes' | 'alacsony';
export type Effort = 'S' | 'M' | 'L';
export type BacklogCategory =
  | 'Hibajavítás'
  | 'SEO/indexelés'
  | 'Strukturált adat'
  | 'AI-láthatóság'
  | 'Tartalom/IA'
  | 'Kísérleti';
export type Owner = 'fejlesztő' | 'ügyfél' | 'mindkettő';

export interface SourceLink {
  title: string;
  url: string;
  /** Mikor ellenőriztük utoljára a dokumentumot (YYYY-MM-DD). */
  checked?: string;
  official?: boolean;
}

export interface BacklogTemplate {
  title: string;
  category: BacklogCategory;
  owner: Owner;
  implementation: string; // HTML/JSON-LD/PHP/CMS/header/robots/WAF
  change: string;
  benefit: string;
  priority: Priority;
  effort: Effort;
  effortReason: string;
  verification: string;
}

/** Egy ellenőrzés definíciója: adat, nem kód. A config/checks.json-ban él. */
export interface CheckDef {
  id: string;
  version: number;
  title: string;
  topic: TopicId;
  surfaces: Surface[];
  /** 1–5: mennyire számít a pontozásban. */
  weight: number;
  runner: RunnerKind;
  /** Az 'auto' futtató kulcsa a server/checks/runners.ts-ben. */
  impl?: string;
  /** Modul: 'core' vagy kiegészítő modul azonosítója (ki-be kapcsolható). */
  module: string;
  enabled: boolean;
  description: string;
  /** Kézi ellenőrzésnél: mit kell megnézni. */
  howTo?: string;
  sources: SourceLink[];
  backlog?: BacklogTemplate;
  experimental?: boolean;
}

export interface ModuleDef {
  id: string;
  title: string;
  description: string;
  defaultOn: boolean;
}

export interface BotDef {
  id: string;
  name: string;
  owner: string;
  /** search = keresés/válasz, training = modelltanítás, user = felhasználói lekérés, ads, crawler = klasszikus kereső */
  purpose: 'search' | 'training' | 'user' | 'ads' | 'crawler' | 'browser';
  surface: Surface;
  /** robots.txt user-agent token */
  token: string;
  /** Teljes UA-sztring, ha le is kérjük vele az oldalt. */
  ua?: string;
  fetch: boolean;
  module: string;
  robotsApplies: 'igen' | 'nem feltétlenül' | 'nem dokumentált';
  ipList?: string;
  note?: string;
  sources: SourceLink[];
}

export interface QuestionTemplate {
  id: string;
  kind: 'search' | 'conversational';
  text: string;
  hint?: string;
}

export interface KeyDatum {
  label: string;
  /** Minta érték, ahogy az oldalon szerepel (pl. "89 900 Ft"). Ezzel keressük. */
  value?: string;
}

export interface AuditInput {
  url: string;
  name: string;
  org: string;
  pageType: string;
  entityType: string;
  cms: string;
  languages: string[];
  keyData: KeyDatum[];
  modules: string[];
  notes?: string;
}

export interface Snippet {
  label: string;
  code: string;
  lang?: string;
}

export interface Finding {
  checkId: string;
  status: Status;
  evidence: Evidence;
  summary: string;
  details?: string[];
  snippets?: Snippet[];
  data?: unknown;
  ranAt: string;
  override?: {
    status: Status;
    evidence: Evidence;
    note: string;
    at: string;
    /** A sablon backlog-tételét módosítja (mezőnként felülírja); null: ehhez nem kell backlog-tétel (pl. máshol már szerepel). */
    backlog?: Partial<BacklogTemplate> | null;
  };
}

/** Kézzel felvett, könyvtáron kívüli megállapítás. */
export interface CustomFinding extends Finding {
  title: string;
  topic: TopicId;
  surfaces: Surface[];
  weight: number;
  /** Ha hibás/figyelmeztető, ebből lesz backlog-tétel. */
  backlog?: BacklogTemplate;
  sources?: SourceLink[];
}

export type Coverage = 'yes' | 'partial' | 'no' | 'unknown';

export interface QuestionResult {
  surface: 'chatgpt' | 'copilot';
  date: string;
  appears: 'yes' | 'no' | 'unknown';
  url?: string;
  quotedFact?: string;
  accurate?: 'yes' | 'no' | 'partial' | 'unknown';
  note?: string;
}

export interface Question {
  id: string;
  kind: 'search' | 'conversational';
  text: string;
  coverage: Coverage;
  /** Melyik tény válaszolja meg, ha van. */
  fact?: string;
  missing?: string;
  sourceOwner?: string;
  results: QuestionResult[];
  origin: 'template' | 'manual' | 'llm';
}

export interface FetchResult {
  botId: string;
  ua: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  redirects: { url: string; status: number }[];
  headers: Record<string, string>;
  bytes?: number;
  ttfbMs?: number;
  totalMs?: number;
  bodyFile?: string;
  error?: string;
  challenge?: string;
}

export interface RenderResult {
  ok: boolean;
  engine?: string;
  error?: string;
  status?: number;
  bodyFile?: string;
  loadMs?: number;
  lcpMs?: number;
  cls?: number;
  requestCount?: number;
  transferBytes?: number;
  thirdPartyDomains?: string[];
  consoleErrors?: string[];
}

export interface PageFacts {
  title?: string;
  metaDescription?: string;
  canonical: string[];
  robotsMeta: Record<string, string>;
  lang?: string;
  hreflang: { lang: string; href: string }[];
  og: Record<string, string>;
  viewport?: string;
  generator?: string;
  msvalidate?: boolean;
  headings: { level: number; text: string }[];
  landmarks: Record<string, number>;
  links: { internal: number; external: number; empty: number; generic: string[]; params: number };
  images: { total: number; missingAlt: number; emptyAlt: number };
  iframes: string[];
  videos: number;
  sliders: number;
  maps: number;
  pdfs: string[];
  tables: number;
  dls: number;
  jsonld: { raw: string; parsed?: unknown; error?: string; types: string[] }[];
  microdata: number;
  textLength: number;
  text: string;
  adminBar: boolean;
  scripts: { total: number; external: string[] };
  consent: string[];
  footerText?: string;
  contact: { tel: number; mailto: number; impressum: boolean; about: boolean; contactPage: boolean; address: boolean };
  dates: string[];
}

export interface Artifacts {
  fetches: FetchResult[];
  render?: RenderResult;
  saved?: { fileName: string; bodyFile: string };
  robots?: { status?: number; text?: string; error?: string };
  sitemaps: {
    url: string;
    status?: number;
    urls: number;
    containsPage: boolean;
    pageLastmod?: string;
    lastmods: string[];
    error?: string;
    children?: number;
  }[];
  soft404?: { url: string; status?: number; error?: string };
  llmsTxt?: { status?: number; bytes?: number };
  bingSiteAuth?: { status?: number };
  pdfHeads: { url: string; status?: number; lastModified?: string; bytes?: number }[];
  ogImage?: { url: string; status?: number; type?: string };
  httpToHttps?: { status?: number; location?: string; error?: string };
  facts: { raw?: PageFacts; rendered?: PageFacts; saved?: PageFacts };
}

export interface LogEntry {
  t: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface TopicScore {
  topic: TopicId;
  score: number | null;
  coverage: number;
}

export interface Scores {
  overall: number | null;
  surfaces: Record<'bing' | 'chatgpt', { score: number | null; coverage: number }>;
  topics: TopicScore[];
  counts: Record<Status, number>;
}

export interface Round {
  n: number;
  createdAt: string;
  finishedAt?: string;
  status: 'running' | 'done' | 'error';
  input: AuditInput;
  checks: CheckDef[];
  artifacts?: Artifacts;
  findings: Record<string, Finding>;
  custom: CustomFinding[];
  questions: Question[];
  scores?: Scores;
  log: LogEntry[];
  note?: string;
}

export interface AuditSummary {
  id: string;
  createdAt: string;
  input: AuditInput;
  rounds: { n: number; createdAt: string; status: Round['status']; scores?: Scores }[];
}

export interface BacklogItem extends BacklogTemplate {
  n: number;
  checkId: string;
  surfaces: Surface[];
  current: string;
  status: Status;
}

export const TOPICS: { id: TopicId; n: number; title: string }[] = [
  { id: 'crawl', n: 1, title: 'Feltérképezés és indexelés' },
  { id: 'html', n: 2, title: 'HTML és szemantika' },
  { id: 'schema', n: 3, title: 'Strukturált adatok' },
  { id: 'ai', n: 4, title: 'AI-keresés és idézhetőség' },
  { id: 'bots', n: 5, title: 'Robotok és hozzáférés' },
  { id: 'tech', n: 6, title: 'Technikai alapok' },
  { id: 'test', n: 7, title: 'Gyakorlati AI-teszt' },
];

export const STATUS_LABEL: Record<Status, string> = {
  pass: 'Rendben',
  warn: 'Figyelmeztetés',
  fail: 'Hiba',
  info: 'Információ',
  na: 'Nem releváns',
  unverifiable: 'Nem ellenőrizhető',
};

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  observed: 'Megfigyelt',
  likely: 'Valószínű',
  hypothesis: 'Hipotézis',
  unverifiable: 'Nem ellenőrizhető',
};
