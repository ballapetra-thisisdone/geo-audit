import type { Artifacts, AuditInput, BotDef, Evidence, Finding, PageFacts, Question, Snippet, Status } from '../../shared/types.ts';
import type { Bodies } from '../collect/collect.ts';
import { parseRobots, type ParsedRobots } from '../collect/robots.ts';

export interface CheckContext {
  input: AuditInput;
  a: Artifacts;
  bodies: Bodies;
  bots: BotDef[];
  robots?: ParsedRobots;
  pagePath: string;
  questions: Question[];
  /** A legjobb elérhető nézet: renderelt, ha van, különben nyers. */
  facts?: PageFacts;
  raw?: PageFacts;
  rendered?: PageFacts;
}

export type RunnerResult = Omit<Finding, 'checkId' | 'ranAt' | 'override'>;
export type Runner = (ctx: CheckContext) => RunnerResult;

export function buildContext(input: AuditInput, a: Artifacts, bodies: Bodies, bots: BotDef[], questions: Question[]): CheckContext {
  const u = new URL(input.url);
  return {
    input,
    a,
    bodies,
    bots,
    questions,
    robots: a.robots?.status === 200 && a.robots.text !== undefined ? parseRobots(a.robots.text) : undefined,
    pagePath: u.pathname + u.search,
    facts: a.facts.rendered ?? a.facts.raw,
    raw: a.facts.raw,
    rendered: a.facts.rendered,
  };
}

export function r(
  status: Status,
  summary: string,
  extra: { evidence?: Evidence; details?: string[]; snippets?: Snippet[]; data?: unknown } = {},
): RunnerResult {
  return {
    status,
    evidence: extra.evidence ?? (status === 'unverifiable' ? 'unverifiable' : 'observed'),
    summary,
    details: extra.details,
    snippets: extra.snippets,
    data: extra.data,
  };
}

const ORDER: Status[] = ['fail', 'warn', 'unverifiable', 'info', 'pass', 'na'];
export function worst(...s: Status[]): Status {
  return s.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] ?? 'na';
}
