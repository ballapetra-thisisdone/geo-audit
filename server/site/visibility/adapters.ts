// AI/search platform adapterek. Mindegyik dokumentált API-t használ, és csak a ténylegesen visszakapott
// válaszból és forráshivatkozásokból dolgozik. Kulcs nélkül az adapter "nincs konfigurálva" – nem szimulál.
import Anthropic from '@anthropic-ai/sdk';
import type { PlatformStatus } from '../../../shared/site.ts';

export interface PlatformAnswer {
  text: string;
  citations: { url: string; title?: string }[];
  /** A szolgáltató által visszaadott, de nem inline idézett források (pl. "sources" lista). */
  sources: { url: string; title?: string }[];
  model?: string;
  raw?: unknown;
}

export interface QueryOpts {
  country?: string;
  language?: string;
  timeoutMs?: number;
}

export interface PlatformAdapter {
  id: string;
  name: string;
  kind: 'ai' | 'serp';
  docs: string;
  method: string;
  configured(): boolean;
  query(q: string, opts: QueryOpts): Promise<PlatformAnswer>;
}

type FetchLike = typeof fetch;

async function postJson(f: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Érvénytelen JSON válasz');
  }
}

/** OpenAI Responses API + web_search eszköz. Citation: message.content[].annotations[type=url_citation]. */
export class OpenAIWebSearchAdapter implements PlatformAdapter {
  id = 'openai';
  name = 'OpenAI (Responses API, web_search)';
  kind = 'ai' as const;
  docs = 'https://developers.openai.com/api/docs/guides/tools-web-search';
  method = 'Responses API, tools=[web_search]; url_citation annotációk + web_search_call.action.sources';
  constructor(private key = process.env.OPENAI_API_KEY, private model = process.env.OPENAI_SEARCH_MODEL ?? 'gpt-5.5', private f: FetchLike = fetch) {}
  configured() {
    return !!this.key;
  }
  async query(q: string, o: QueryOpts): Promise<PlatformAnswer> {
    const tool: Record<string, unknown> = { type: 'web_search' };
    if (o.country) tool.user_location = { type: 'approximate', country: o.country.toUpperCase().slice(0, 2) };
    const data = await postJson(this.f, 'https://api.openai.com/v1/responses', { authorization: `Bearer ${this.key}` }, { model: this.model, tools: [tool], input: q, include: ['web_search_call.action.sources'] }, o.timeoutMs ?? 90000);
    return parseOpenAI(data);
  }
}

export function parseOpenAI(data: Record<string, unknown>): PlatformAnswer {
  const output = (data.output as Record<string, unknown>[] | undefined) ?? [];
  let text = '';
  const citations: PlatformAnswer['citations'] = [];
  const sources: PlatformAnswer['sources'] = [];
  for (const item of output) {
    if (item.type === 'message') {
      for (const c of (item.content as Record<string, unknown>[] | undefined) ?? []) {
        if (c.type !== 'output_text') continue;
        text += String(c.text ?? '');
        for (const a of (c.annotations as Record<string, unknown>[] | undefined) ?? []) {
          if (a.type === 'url_citation' && typeof a.url === 'string') citations.push({ url: a.url, title: typeof a.title === 'string' ? a.title : undefined });
        }
      }
    }
    if (item.type === 'web_search_call') {
      const action = item.action as Record<string, unknown> | undefined;
      for (const s of (action?.sources as Record<string, unknown>[] | undefined) ?? []) if (typeof s.url === 'string') sources.push({ url: s.url });
    }
  }
  return { text, citations, sources, model: typeof data.model === 'string' ? data.model : undefined };
}

/** Perplexity Sonar API (/v1/sonar). Citation: top-level citations[] + search_results[]. */
export class PerplexityAdapter implements PlatformAdapter {
  id = 'perplexity';
  name = 'Perplexity (Sonar API)';
  kind = 'ai' as const;
  docs = 'https://docs.perplexity.ai/api-reference/chat-completions-post';
  method = 'Sonar API, model=sonar; citations[] és search_results[]';
  constructor(private key = process.env.PERPLEXITY_API_KEY, private model = process.env.PERPLEXITY_MODEL ?? 'sonar', private f: FetchLike = fetch) {}
  configured() {
    return !!this.key;
  }
  async query(q: string, o: QueryOpts): Promise<PlatformAnswer> {
    const data = await postJson(this.f, 'https://api.perplexity.ai/v1/sonar', { authorization: `Bearer ${this.key}` }, { model: this.model, messages: [{ role: 'user', content: q }] }, o.timeoutMs ?? 90000);
    return parsePerplexity(data);
  }
}

export function parsePerplexity(data: Record<string, unknown>): PlatformAnswer {
  const choices = (data.choices as Record<string, unknown>[] | undefined) ?? [];
  const msg = choices[0]?.message as Record<string, unknown> | undefined;
  const text = typeof msg?.content === 'string' ? msg.content : '';
  const citations = ((data.citations as unknown[] | undefined) ?? []).filter((u): u is string => typeof u === 'string').map((url) => ({ url }));
  const sources = ((data.search_results as Record<string, unknown>[] | undefined) ?? []).filter((s) => typeof s.url === 'string').map((s) => ({ url: s.url as string, title: typeof s.title === 'string' ? s.title : undefined }));
  return { text, citations, sources, model: typeof data.model === 'string' ? data.model : undefined };
}

/** Claude (Messages API) + web_search szerveroldali eszköz. Citation: text blokkok citations[type=web_search_result_location]. */
export class ClaudeWebSearchAdapter implements PlatformAdapter {
  id = 'claude';
  name = 'Claude (Messages API, web_search)';
  kind = 'ai' as const;
  docs = 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool';
  method = 'Messages API, tools=[web_search_20260209]; text.citations (web_search_result_location)';
  constructor(private key = process.env.ANTHROPIC_API_KEY, private model = process.env.CLAUDE_SEARCH_MODEL ?? process.env.CLAUDE_MODEL ?? 'claude-opus-5-5', private enabledFlag = process.env.CLAUDE_SEARCH_ENABLED === '1') {}
  configured() {
    // külön engedélyezni kell, mert ugyanazt a kulcsot használja, mint az LLM-elemzés
    return !!this.key && this.enabledFlag;
  }
  async query(q: string, o: QueryOpts): Promise<PlatformAnswer> {
    const client = new Anthropic({ apiKey: this.key, maxRetries: 2, timeout: o.timeoutMs ?? 120000 });
    const tool: Record<string, unknown> = { type: 'web_search_20260209', name: 'web_search', max_uses: 3 };
    if (o.country) tool.user_location = { type: 'approximate', country: o.country.toUpperCase().slice(0, 2) };
    const res = await client.messages.create({
      model: this.model,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      tools: [tool as unknown as Anthropic.WebSearchTool20260209],
      messages: [{ role: 'user', content: q }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    if (res.stop_reason === 'refusal') throw new Error('A modell elutasította a kérést.');
    return parseClaude(res.content as unknown as Record<string, unknown>[], res.model);
  }
}

export function parseClaude(content: Record<string, unknown>[], model?: string): PlatformAnswer {
  let text = '';
  const citations: PlatformAnswer['citations'] = [];
  const sources: PlatformAnswer['sources'] = [];
  for (const b of content) {
    if (b.type === 'text') {
      text += String(b.text ?? '');
      for (const c of (b.citations as Record<string, unknown>[] | null | undefined) ?? []) {
        if (c.type === 'web_search_result_location' && typeof c.url === 'string') citations.push({ url: c.url, title: typeof c.title === 'string' ? c.title : undefined });
      }
    }
    // keresési eredmények: siker esetén lista, hiba esetén objektum (error_code)
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content as Record<string, unknown>[]) if (r.type === 'web_search_result' && typeof r.url === 'string') sources.push({ url: r.url, title: typeof r.title === 'string' ? r.title : undefined });
    }
  }
  return { text, citations, sources, model };
}

/** Brave Search API – klasszikus SERP (nem AI-válasz). A "citation" itt a találati lista eleme. */
export class BraveSearchAdapter implements PlatformAdapter {
  id = 'brave';
  name = 'Brave Search API (SERP)';
  kind = 'serp' as const;
  docs = 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started';
  method = 'GET /res/v1/web/search; web.results[] (top 10)';
  constructor(private key = process.env.BRAVE_SEARCH_API_KEY, private f: FetchLike = fetch) {}
  configured() {
    return !!this.key;
  }
  async query(q: string, o: QueryOpts): Promise<PlatformAnswer> {
    const p = new URLSearchParams({ q, count: '10' });
    if (o.country) p.set('country', o.country.toUpperCase().slice(0, 2));
    if (o.language) p.set('search_lang', o.language.slice(0, 2));
    const res = await this.f(`https://api.search.brave.com/res/v1/web/search?${p}`, { headers: { 'X-Subscription-Token': this.key!, accept: 'application/json' }, signal: AbortSignal.timeout(o.timeoutMs ?? 30000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return parseBrave(JSON.parse(text) as Record<string, unknown>);
  }
}

export function parseBrave(data: Record<string, unknown>): PlatformAnswer {
  const results = (((data.web as Record<string, unknown> | undefined)?.results as Record<string, unknown>[] | undefined) ?? []).filter((r) => typeof r.url === 'string');
  return {
    text: results.map((r, i) => `${i + 1}. ${r.title ?? ''} — ${String(r.description ?? '').replace(/<[^>]+>/g, '')}`).join('\n'),
    citations: results.map((r) => ({ url: r.url as string, title: typeof r.title === 'string' ? r.title : undefined })),
    sources: [],
  };
}

export function defaultAdapters(): PlatformAdapter[] {
  return [new OpenAIWebSearchAdapter(), new PerplexityAdapter(), new ClaudeWebSearchAdapter(), new BraveSearchAdapter()];
}

export function platformStatuses(adapters: PlatformAdapter[], selected: string[]): PlatformStatus[] {
  return adapters.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    configured: a.configured(),
    status: !a.configured() ? 'not_configured' : selected.length && !selected.includes(a.id) ? 'skipped' : 'used',
    note: !a.configured() ? `Nincs API-kulcs (${envName(a.id)}).` : undefined,
    docs: a.docs,
  }));
}

export const envName = (id: string) =>
  ({ openai: 'OPENAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', claude: 'ANTHROPIC_API_KEY + CLAUDE_SEARCH_ENABLED=1', brave: 'BRAVE_SEARCH_API_KEY' })[id] ?? id;
