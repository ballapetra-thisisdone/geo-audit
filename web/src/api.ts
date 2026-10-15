import type {
  AuditInput, AuditSummary, BacklogItem, BotDef, CheckDef, CustomFinding, Evidence, ModuleDef, Question, QuestionTemplate, Round, Snippet, Status,
} from '../../shared/types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface ConfigPayload {
  checks: CheckDef[];
  modules: ModuleDef[];
  bots: BotDef[];
  templates: QuestionTemplate[];
  runnerKeys: string[];
}

export interface BotRow {
  id: string;
  name: string;
  owner: string;
  purpose: BotDef['purpose'];
  fetched: boolean;
  status: number | null;
  error: string | null;
  challenge: string | null;
  redirects: number | null;
  bytes: number | null;
  ttfbMs: number | null;
  sameStatus: boolean | null;
  robotsAllowed: boolean | null;
  robotsRule: string | null;
  robotsSpecific: boolean | null;
  robotsApplies: BotDef['robotsApplies'];
  textPct: number | null;
  titleMatch: boolean | null;
  keyFound: number | null;
  keyTotal: number;
}

export interface SampleGroup {
  id: string;
  title: string;
  note: string;
  snippets: Snippet[];
}

export type SavedHtml = { fileName: string; html: string };

const base = (id: string, n: number) => `/api/audits/${id}/rounds/${n}`;

export const api = {
  meta: () => req<{ ai: { enabled: boolean; model: string }; version: string }>('GET', '/api/meta'),
  config: () => req<ConfigPayload>('GET', '/api/config'),
  saveChecks: (checks: CheckDef[]) => req('PUT', '/api/config/checks', { checks }),
  saveTemplates: (templates: QuestionTemplate[]) => req('PUT', '/api/config/questions', { templates }),

  audits: () => req<AuditSummary[]>('GET', '/api/audits'),
  audit: (id: string) => req<AuditSummary & { running: boolean }>('GET', `/api/audits/${id}`),
  createAudit: (input: AuditInput, savedHtml?: SavedHtml) => req<{ id: string; n: number }>('POST', '/api/audits', { input, savedHtml }),
  updateInput: (id: string, input: AuditInput) => req('PUT', `/api/audits/${id}/input`, input),
  deleteAudit: (id: string) => req('DELETE', `/api/audits/${id}`),
  newRound: (id: string, opts: { savedHtml?: SavedHtml; note?: string }) => req<{ n: number }>('POST', `/api/audits/${id}/rounds`, opts),

  round: (id: string, n: number) => req<Round>('GET', base(id, n)),
  backlog: (id: string, n: number) => req<BacklogItem[]>('GET', `${base(id, n)}/backlog`),
  samples: (id: string, n: number) => req<SampleGroup[]>('GET', `${base(id, n)}/samples`),
  botMatrix: (id: string, n: number) => req<BotRow[]>('GET', `${base(id, n)}/botmatrix`),
  bodyUrl: (id: string, n: number, file: string) => `${base(id, n)}/body?file=${encodeURIComponent(file)}`,
  rerun: (id: string, n: number, opts: { checkId?: string; refreshChecks?: boolean }) => req<Round>('POST', `${base(id, n)}/rerun`, opts),
  override: (id: string, n: number, checkId: string, o: { status: Status; evidence: Evidence; note: string }) =>
    req<Round>('PUT', `${base(id, n)}/findings/${encodeURIComponent(checkId)}/override`, o),
  clearOverride: (id: string, n: number, checkId: string) => req<Round>('DELETE', `${base(id, n)}/findings/${encodeURIComponent(checkId)}/override`),
  saveCustom: (id: string, n: number, custom: CustomFinding[]) => req<Round>('PUT', `${base(id, n)}/custom`, { custom }),
  saveQuestions: (id: string, n: number, questions: Question[]) => req<Round>('PUT', `${base(id, n)}/questions`, { questions }),
  aiQuestions: (id: string, n: number) => req<Round>('POST', `${base(id, n)}/ai/questions`),
};

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
