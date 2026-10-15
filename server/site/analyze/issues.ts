// Problémagyűjtő: azonos kódú megállapítások egy csoportba kerülnek, az érintett URL-ek és bizonyítékok megmaradnak.
import type { EffortLevel, Evidence, EvidenceKind, Issue, IssueCategory, Owner, PriorityLevel } from '../../../shared/site.ts';

export interface IssueDef {
  category: IssueCategory;
  title: string;
  why: string;
  fix: string;
  acceptance: string;
  impact: number; // 1–5
  effort: EffortLevel;
  owner: Owner;
  evidenceKind: EvidenceKind;
  confidence: number;
  /** Ha true: blokkoló hiba – P0 lehet. */
  blocker?: boolean;
  /** Üzleti fontosság szorzó (0.5–1.5). */
  business?: number;
}

export class IssueCollector {
  private map = new Map<string, Issue & { _blocker?: boolean; _business?: number }>();
  constructor(private site: string) {}

  add(code: string, def: IssueDef, ev: Evidence | Evidence[], opts: { confidence?: number; titleSuffix?: string } = {}) {
    const list = Array.isArray(ev) ? ev : [ev];
    let issue = this.map.get(code);
    if (!issue) {
      issue = {
        id: `${this.site === 'own' ? '' : this.site + ':'}${code}`,
        code,
        category: def.category,
        title: def.title + (opts.titleSuffix ?? ''),
        priority: 'P3',
        impact: def.impact,
        effort: def.effort,
        confidence: opts.confidence ?? def.confidence,
        evidenceKind: def.evidenceKind,
        why: def.why,
        fix: def.fix,
        acceptance: def.acceptance,
        owner: def.owner,
        urls: [],
        evidence: [],
        site: this.site,
        _blocker: def.blocker,
        _business: def.business,
      };
      this.map.set(code, issue);
    } else if (opts.confidence !== undefined) issue.confidence = Math.max(issue.confidence, opts.confidence);
    for (const e of list) {
      if (e.url && !issue.urls.includes(e.url)) issue.urls.push(e.url);
      if (issue.evidence.length < 200) issue.evidence.push(e);
    }
  }

  list(): (Issue & { _blocker?: boolean; _business?: number })[] {
    return [...this.map.values()];
  }
}

/** Prioritás: hatás × üzleti fontosság × kiterjedés × bizonyosság, osztva a ráfordítással. */
export function prioritize(issue: Issue & { _blocker?: boolean; _business?: number }, totalPages: number): PriorityLevel {
  const effortW = issue.effort === 'S' ? 1 : issue.effort === 'M' ? 1.4 : 2;
  const spread = issue.urls.length <= 1 ? 1 : Math.min(1.5, 1 + Math.log10(issue.urls.length) / 2 + (totalPages ? issue.urls.length / totalPages / 2 : 0));
  const evidenceQ = issue.evidenceKind === 'measured' || issue.evidenceKind === 'external' ? 1 : issue.evidenceKind === 'observed' ? 0.9 : 0.75;
  const v = (issue.impact * (issue._business ?? 1) * spread * issue.confidence * evidenceQ) / effortW;
  if (issue._blocker && issue.confidence >= 0.8) return 'P0';
  if (v >= 3) return 'P1';
  if (v >= 1.6) return 'P2';
  return 'P3';
}
